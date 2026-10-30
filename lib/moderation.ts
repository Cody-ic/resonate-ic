import {readModelResponse} from './model-response';
import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { projects, revisions, reviews, topics, replies,forumEdits } from "../db/schema";
import { HTTPError, digest } from "./domain";
import {selectPolicy,reviewPrompt,maxReviewInputBytes} from "./review-policy";
import type {ReviewTask} from "./review-policy";
import {parseReviewResult,hasQuote,cleanNotice} from "./review-results";
import {reviewFiles,fileTools,fileToolDefinitions} from "./review-files";
import {prepareFeaturedEvidence} from "./featured-materials";
import {featuredCourseFiles,resolveFeatured} from "./featured";
import {coverForReview} from "./cover-images";
import {notify,alertAdmins,notifyDiscussionPublished} from "./notifications";
import {moderateContent,requireUnlocked} from "./moderation-controls";
import { categories, normalizeSnapshot, resolveClassification, classificationTerms, facetRows } from "./classification";
import { terms } from "./taxonomy";
import {isOffPeak,usageCharge} from "./ai-pricing";
import {kickReviewQueue,reviewConcurrency} from "./review-dispatch";
import {budgetPeriod,budgetBalance,ensureBudgetGrants} from "./ai-budget";
import {discussionInput,discussionEvidence} from './discussion-context';
import {repositoryFiles} from './repository-review';
import {scanFeatured,scanDigest} from './featured-scan';
import {createResourceOffer,requireOfferSource} from './resource-offers';
import {checkResourceReview} from './resource-review';
import {timeouts} from './timeouts';
import {holdsUnsafePublication} from './review-safety';

export type RuntimeConfig = {ADMIN_USER_IDS?:string;REVIEW_API_KEY?:string;REVIEW_MODEL?:string;[key:string]:string|undefined};
export const config=()=>env as typeof env & RuntimeConfig;
export function laneConfig(lane:string){const c=config(),prefix=lane==='discussion'?'DISCUSSION':'PROJECT';return {key:c[`${prefix}_REVIEW_API_KEY`],model:c[`${prefix}_REVIEW_MODEL`]??'deepseek-flash',maxCalls:Number(c[`${prefix}_AI_MONTHLY_MAX_CALLS`]??0),maxBudget:Number(c[`${prefix}_AI_MONTHLY_BUDGET_MICROS`]??0),maxTotal:Number(c.AI_TOTAL_MONTHLY_BUDGET_MICROS??0),inputPrice:Number(c.AI_INPUT_CNY_PER_MTOK??2),outputPrice:Number(c.AI_OUTPUT_CNY_PER_MTOK??8),cachedInputPrice:Number(c.AI_CACHED_INPUT_CNY_PER_MTOK??((c[`${prefix}_REVIEW_MODEL`]??"deepseek-flash")==="deepseek-flash"?0.04:c.AI_INPUT_CNY_PER_MTOK??2))};}
const budgetMonth=budgetPeriod;
export async function refreshBudgetGrants(){await ensureBudgetGrants(env.DB!,{project:laneConfig('project').maxBudget,discussion:laneConfig('discussion').maxBudget,shared:laneConfig('project').maxTotal});}
export async function reviewBudget(){
  await refreshBudgetGrants();
  const {month,start,end}=budgetMonth(),lanes=[];
  const grants=await env.DB!.prepare('SELECT pool,month,amount_micros FROM ai_budget_grants WHERE month<=? ORDER BY month').bind(month).all<any>();
  for(const lane of ["project","discussion"]){const cfg=laneConfig(lane),row=await env.DB!.prepare("SELECT COUNT(CASE WHEN created_at>=? AND created_at<? THEN 1 END) calls,COALESCE(SUM(COALESCE(charged_micros,reserved_micros)),0) committedMicros,COALESCE(SUM(charged_micros),0) settledMicros,COALESCE(SUM(CASE WHEN charged_micros IS NULL THEN reserved_micros ELSE 0 END),0) unsettledMicros FROM ai_calls WHERE currency='CNY' AND lane=?").bind(start,end,lane).first<any>();const balance=budgetBalance(grants.results.filter(g=>g.pool===lane),row?.committedMicros??0,month);lanes.push({lane,configured:!!cfg.key,maxCalls:cfg.maxCalls,maxMicros:balance.grantedMicros,monthlyGrantMicros:cfg.maxBudget,...balance,calls:row?.calls??0,reservedMicros:row?.committedMicros??0,committedMicros:row?.committedMicros??0,settledMicros:row?.settledMicros??0,unsettledMicros:row?.unsettledMicros??0,currency:"CNY"});}
  const committed=lanes.reduce((n,b)=>n+b.committedMicros,0),shared=budgetBalance(grants.results.filter(g=>g.pool==='shared'),committed,month);
  return {month,lanes,currency:"CNY",shared:{...shared,reservedMicros:committed,settledMicros:lanes.reduce((n,b)=>n+b.settledMicros,0),unsettledMicros:lanes.reduce((n,b)=>n+b.unsettledMicros,0),maxMicros:shared.grantedMicros,monthlyGrantMicros:laneConfig("project").maxTotal}};
}
export function projectOffPeak(now=new Date()){
  return isOffPeak(now.getTime(),config().AI_OFFPEAK_DATES??'');
}
export async function applyDecision(review: typeof reviews.$inferSelect, action: string,options:{taxonomy?:unknown;actorId?:string;reason?:string;result?:Record<string,unknown>;humanReason?:string}={}) {
  const db = getDb(),raw=env.DB!,now=Date.now();
  const resource=review.entityType==='revision'&&!!await raw.prepare("SELECT 1 FROM projects p JOIN revisions r ON r.project_id=p.id WHERE r.id=? AND p.kind='resource'").bind(review.entityId).first();
  const safetyHold=holdsUnsafePublication({decision:action,findings:options.result?.findings});
  const publish=action==="pass"||(action==="disputed"&&review.entityType==="revision"&&!resource&&!safetyHold);
  const held=publish&&review.entityType==="revision"&&config().PROJECT_PUBLICATION_ENABLED==="false";
  let proposedClassification:unknown;
  const status = publish ? "published" : action === "revise" ? "needs_changes" : "disputed";
  const statements: D1PreparedStatement[] = [];
  if (review.entityType === "revision") {
    const rev=await db.select().from(revisions).where(eq(revisions.id,review.entityId)).get();
    if(!rev||rev.digest!==review.digest)throw new HTTPError(409,"送审内容摘要不匹配");
    if(publish){await requireUnlocked("project",rev.projectId);await requireOfferSource(rev.projectId);}
    if(held){
      proposedClassification=resolveClassification(normalizeSnapshot(JSON.parse(rev.snapshot)),options.taxonomy,await terms(),{humanReason:options.humanReason});
      statements.push(raw.prepare("UPDATE revisions SET status=CASE WHEN status='published' THEN status ELSE ? END WHERE id=? AND digest=? AND EXISTS(SELECT 1 FROM projects WHERE id=revisions.project_id AND head_id=revisions.id AND deleted_at IS NULL AND admin_lock_at IS NULL)").bind(action==="pass"?"approved":"disputed",rev.id,review.digest));
    }else statements.push(raw.prepare("UPDATE revisions SET status=? WHERE id=? AND digest=? AND EXISTS(SELECT 1 FROM projects WHERE id=revisions.project_id AND head_id=revisions.id AND deleted_at IS NULL AND admin_lock_at IS NULL)").bind(status,rev.id,review.digest));
    if (publish&&!held) {
      const snapshot=normalizeSnapshot(JSON.parse(rev.snapshot));
      if(!categories.includes(snapshot.category))throw new HTTPError(422,"请作者选择嵌入式、FPGA或创意软件中的一类");
      let resolved;
      try{resolved=resolveClassification(snapshot,options.taxonomy,await terms(),{humanReason:options.humanReason});}catch(error){throw new HTTPError(422,error instanceof Error?error.message:"分类处理不合法");}
      statements.push(raw.prepare("INSERT INTO revision_taxonomy(revision_id,digest,resolved,review_id,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(revision_id) DO UPDATE SET digest=excluded.digest,resolved=excluded.resolved,review_id=excluded.review_id,updated_at=excluded.updated_at").bind(rev.id,rev.digest,JSON.stringify(resolved),review.id,now));
      statements.push(raw.prepare("UPDATE projects SET published_id=?,updated_at=? WHERE id=? AND head_id=? AND deleted_at IS NULL AND admin_lock_at IS NULL").bind(rev.id,now,rev.projectId,rev.id));
      const approvedTerms=classificationTerms(resolved);
      for(let i=0;i<approvedTerms.length;i+=14){const chunk=approvedTerms.slice(i,i+14);statements.push(raw.prepare(`INSERT INTO taxonomy_terms(key,kind,parent,name,family,review_id,created_at) SELECT column1,column2,column3,column4,column5,column6,column7 FROM (VALUES ${chunk.map(()=>"(?,?,?,?,?,?,?)").join(",")}) WHERE EXISTS(SELECT 1 FROM projects WHERE id=? AND head_id=? AND published_id=? AND admin_lock_at IS NULL) ON CONFLICT(kind,parent,name) DO NOTHING`).bind(...chunk.flatMap(term=>[JSON.stringify([term.kind,term.parent,term.name]),term.kind,term.parent,term.name,term.family,review.id,now]),rev.projectId,rev.id,rev.id));}
      statements.push(raw.prepare("DELETE FROM content_facets WHERE project_id=? AND EXISTS(SELECT 1 FROM projects WHERE id=? AND published_id=?)").bind(rev.projectId,rev.projectId,rev.id));
      const facets=facetRows(snapshot.category,resolved);
      for(let i=0;i<facets.length;i+=16){const chunk=facets.slice(i,i+16);statements.push(raw.prepare(`INSERT INTO content_facets(key,project_id,revision_id,kind,parent,value) SELECT column1,column2,column3,column4,column5,column6 FROM (VALUES ${chunk.map(()=>"(?,?,?,?,?,?)").join(",")}) WHERE EXISTS(SELECT 1 FROM projects WHERE id=? AND published_id=?) ON CONFLICT(key) DO UPDATE SET revision_id=excluded.revision_id`).bind(...chunk.flatMap(f=>[JSON.stringify([rev.projectId,f.kind,f.parent,f.value]),rev.projectId,rev.id,f.kind,f.parent,f.value]),rev.projectId,rev.id));}
    } else if(!held) {
      statements.push(raw.prepare("DELETE FROM content_facets WHERE revision_id=?").bind(rev.id));
    }
  } else if (["topic_edit","reply_edit"].includes(review.entityType)) {
    const edit=await db.select().from(forumEdits).where(eq(forumEdits.id,review.entityId)).get();
    if(!edit||edit.digest!==review.digest)throw new HTTPError(409,"送审内容摘要不匹配");
    const table=edit.entityType==="topic"?"topics":"replies",value=JSON.parse(edit.snapshot);
    statements.push(raw.prepare("UPDATE forum_edits SET status=? WHERE id=? AND digest=?").bind(status,edit.id,review.digest));
    if(action==="pass")statements.push(raw.prepare(`UPDATE ${table} SET body=?,digest=?,status='published'${table==='topics'?",title=?,board=?,quality_status='none'":''} WHERE id=? AND head_edit_id=? AND deleted_at IS NULL AND admin_lock_at IS NULL`).bind(value.body,edit.digest,...(table==='topics'?[value.title,value.board]:[]),edit.entityId,edit.id));
    if(action==="pass"&&table==="topics")statements.push(raw.prepare("DELETE FROM quality_votes WHERE topic_id=? AND EXISTS(SELECT 1 FROM topics WHERE id=? AND digest=? AND head_edit_id=? AND status='published' AND deleted_at IS NULL AND admin_lock_at IS NULL)").bind(edit.entityId,edit.entityId,edit.digest,edit.id));
  } else if (review.entityType === "topic") {
    statements.push(raw.prepare("UPDATE topics SET status=? WHERE id=? AND digest=? AND deleted_at IS NULL AND admin_lock_at IS NULL").bind(status,review.entityId,review.digest));
  } else if (review.entityType === "reply") {
    statements.push(raw.prepare("UPDATE replies SET status=? WHERE id=? AND digest=? AND deleted_at IS NULL AND admin_lock_at IS NULL").bind(status,review.entityId,review.digest));
  }
  if(options.actorId){
    const state=action==="pass"?"approved":action==="revise"?"needs_changes":"disputed";
    statements.push(raw.prepare("UPDATE reviews SET state=?,result=?,updated_at=? WHERE id=?").bind(state,JSON.stringify({...options.result??{summary:options.reason,method:"human",decision:action,taxonomy:options.taxonomy??{}},...(held?{publicationHeld:true,proposedClassification}:{}),...(safetyHold?{publicationHeld:true,publicationHoldReason:'legal_or_safety'}:{})}),now,review.id));
    statements.push(raw.prepare("INSERT INTO decisions(id,review_id,actor_id,action,reason,taxonomy_plan,created_at) VALUES(?,?,?,?,?,?,?)").bind(crypto.randomUUID(),review.id,options.actorId,action,options.reason??"审核完成",JSON.stringify(options.taxonomy??{}),now));
  }
  if (statements.length) await raw.batch(statements);
}

export async function enqueueReview(entityType:string,entityId:string,ownerId:string,snapshot:string,hash:string,options:{task?:ReviewTask;context?:any;lane?:string}={}){
  const id=crypto.randomUUID(),now=Date.now(),lane=options.lane??(entityType==="revision"||options.task==="technical_check"?"project":"discussion");
  await env.DB!.prepare("INSERT INTO reviews(id,entity_type,entity_id,owner_id,snapshot,digest,state,created_at,updated_at,task,lane,context) VALUES(?,?,?,?,?,?,'queued',?,?,?,?,?)").bind(id,entityType,entityId,ownerId,snapshot,hash,now,now,options.task??"publish",lane,options.context?JSON.stringify(options.context):null).run();
  return {id,state:"queued"};
}
export async function settleCallUsage(callId:string,usage:any,price:any,startedAt:number,receivedAt:number){
  const settled=usageCharge(usage,price,startedAt,receivedAt);
  if(!settled)return null;
  await env.DB!.prepare("UPDATE ai_calls SET charged_micros=?,usage_json=?,settled_at=? WHERE id=? AND currency='CNY' AND charged_micros IS NULL")
    .bind(settled.micros,JSON.stringify(usage),receivedAt,callId).run();
  return settled;
}
export async function modelRequest(review:any,messages:any[],tools?:any[],output=8192,maxInputBytes=maxReviewInputBytes){
  const cfg=laneConfig(review.lane);let images=0;
  const textMessages=messages.map(message=>({...message,content:Array.isArray(message.content)?message.content.map((part:any)=>{if(part.type==='image_url'){images++;return {type:'image_url',image_url:{url:'[image]'}};}return part;}):message.content}));
  const bytes=new TextEncoder().encode(JSON.stringify(textMessages)+JSON.stringify(tools??[])).length;
  if(new TextEncoder().encode(JSON.stringify(messages)).length>4*1024*1024)throw new Error('图片与文字超出单次请求上限');
  if(!cfg.key||![cfg.maxCalls,cfg.maxBudget,cfg.maxTotal].every(v=>Number.isSafeInteger(v)&&v>0)||![cfg.inputPrice,cfg.outputPrice].every(v=>Number.isFinite(v)&&v>0))throw new HTTPError(503,"该审核通道尚未配置密钥和月度额度");
  if(!env.BUCKET)throw new HTTPError(503,"审核断点存储尚未配置");
  if(bytes>maxInputBytes)throw new Error("完整输入超过单次审核上限");
  const body=JSON.stringify({model:cfg.model,thinking:{type:"enabled"},reasoning_effort:"high",max_tokens:output,messages,...(review.task==='featured'&&!tools?{stream:true,stream_options:{include_usage:true},response_format:{type:'json_object'}}:{}),...(tools?{tools,tool_choice:"auto"}:{})});
  const attempt=JSON.parse(review.context??'{}').executionAttempt??0;
  const callId=await digest(JSON.stringify([review.id,attempt,body])),responseKey=`review-private/calls/${callId}.json`;
  const existing=await env.DB!.prepare("SELECT id,created_at,pricing_json FROM ai_calls WHERE id=?").bind(callId).first<any>();
  if(existing){
    const cached=await env.BUCKET.get(responseKey);
    if(!cached)throw new Error("此前模型调用的结果尚不确定，需人工核对；不会自动重复付费调用");
    const saved=await cached.json<any>();
    if(saved.usage&&existing.pricing_json)await settleCallUsage(callId,saved.usage,JSON.parse(existing.pricing_json),existing.created_at,saved.receivedAt);
    if(!['stop','tool_calls'].includes(saved.finishReason))throw new Error(`模型未完整返回（${saved.finishReason??'missing_choice'}）`);
    return saved.message;
  }
  const reserve=Math.ceil((bytes+2048+images*1024)*cfg.inputPrice+output*cfg.outputPrice),{start,end}=budgetMonth(),startedAt=Date.now();
  await refreshBudgetGrants();
  const price={input:cfg.inputPrice,output:cfg.outputPrice,cachedInput:cfg.cachedInputPrice,offPeakDates:config().AI_OFFPEAK_DATES??''};
  // Both settled usage and uncertain/in-flight reservations count atomically.
  const budget=await env.DB!.prepare("INSERT INTO ai_calls(id,review_id,model,reserved_micros,status,created_at,lane,currency,pricing_json) SELECT ?,?,?,?,'reserved',?,?,'CNY',? WHERE (SELECT COUNT(*) FROM ai_calls WHERE currency='CNY' AND created_at>=? AND created_at<? AND lane=?)<? AND (SELECT COALESCE(SUM(COALESCE(charged_micros,reserved_micros)),0) FROM ai_calls WHERE currency='CNY' AND lane=?)+?<=(SELECT COALESCE(SUM(amount_micros),0) FROM ai_budget_grants WHERE pool=? AND month<=?) AND (SELECT COALESCE(SUM(COALESCE(charged_micros,reserved_micros)),0) FROM ai_calls WHERE currency='CNY')+?<=(SELECT COALESCE(SUM(amount_micros),0) FROM ai_budget_grants WHERE pool='shared' AND month<=?) ON CONFLICT(id) DO NOTHING RETURNING id")
    .bind(callId,review.id,cfg.model,reserve,startedAt,review.lane,JSON.stringify(price),start,end,review.lane,cfg.maxCalls,review.lane,reserve,review.lane,budgetMonth().month,reserve,budgetMonth().month).first();
  if(!budget)throw new HTTPError(429,"该通道或共享AI可用额度不足，内容保持待审核");
  try{
    const response=await fetch("https://api.deepseek.com/chat/completions",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${cfg.key}`},signal:AbortSignal.timeout(review.lane==='discussion'?timeouts.discussionAI:timeouts.projectAI),body});
    if(!response.ok)throw new Error(`模型服务响应 ${response.status}`);
    const raw=await readModelResponse(response,{progress:async progress=>{
      if(review.executionOwner)await env.DB!.prepare("UPDATE reviews SET result=json_set(COALESCE(result,'{}'),'$.providerProgress',json(?)),updated_at=? WHERE id=? AND state='running' AND execution_owner=?").bind(JSON.stringify(progress),Date.now(),review.id,review.executionOwner).run();
    }}),receivedAt=Date.now();
    // Keep the complete transport receipt before settlement or workflow finish.
    // Partial streams are diagnostic evidence, never a completed review.
    await env.BUCKET.put(responseKey,JSON.stringify({...raw,receivedAt}));
    await settleCallUsage(callId,raw.usage,price,startedAt,receivedAt);
    await env.DB!.prepare("UPDATE ai_calls SET status='completed',tokens=? WHERE id=?").bind(raw.usage?.total_tokens??null,callId).run();
    if(!raw.message||!['stop','tool_calls'].includes(raw.finishReason??''))throw new Error(`模型未完整返回（${raw.finishReason??'missing_choice'}）`);
    return raw.message;
  }catch(error){await env.DB!.prepare("UPDATE ai_calls SET status='failed' WHERE id=?").bind(callId).run();throw error;}
}
class SupersededReview extends HTTPError{readonly reviewSuperseded=true;constructor(message:string){super(409,message);}}
async function targetInfo(review:any){
  const sql=env.DB!,context=review.context?JSON.parse(review.context):{};
  if(review.entityType==="revision"){
    const row=await sql.prepare("SELECT r.*,p.owner_id,p.kind,p.admin_lock_at,p.deleted_at,p.published_id,p.head_id FROM revisions r JOIN projects p ON p.id=r.project_id WHERE r.id=?").bind(review.entityId).first<any>();
    if(!row||row.digest!==review.digest||row.deleted_at||row.admin_lock_at)throw new HTTPError(423,"送审工程已删除或由管理员下架");
    if(review.task==="publish"&&row.head_id!==row.id)throw new SupersededReview("送审版本已被更新，旧任务不再发布");
    if(review.task==="featured"&&row.published_id!==row.id)throw new SupersededReview("精选提名对应的公开版本已变化");
    return {projectId:row.project_id,revisionId:row.id,ownerId:row.owner_id,kind:row.kind,snapshot:JSON.parse(row.snapshot),href:`/${row.kind==="course"?"courses":"projects"}/${row.project_id}`};
  }
  if(review.task==="technical_check"){
    const row=await sql.prepare("SELECT r.*,p.owner_id,p.kind,p.deleted_at,p.admin_lock_at,p.published_id FROM revisions r JOIN projects p ON p.id=r.project_id WHERE r.id=? AND p.id=?").bind(context.revisionId,context.projectId).first<any>();
    if(!row||row.deleted_at||row.admin_lock_at||row.published_id!==row.id)throw new HTTPError(409,"关联的公开工程版本已变化，需重新核对");
    return {projectId:row.project_id,revisionId:row.id,ownerId:row.owner_id,kind:row.kind,snapshot:JSON.parse(row.snapshot),href:`/projects/${row.project_id}`};
  }
  let type=review.entityType,id=review.entityId;
  if(type.endsWith("_edit")){const e=await sql.prepare("SELECT * FROM forum_edits WHERE id=?").bind(id).first<any>();if(!e||e.digest!==review.digest)throw new HTTPError(409,"修改版本不存在");type=e.entity_type;id=e.entity_id;}
  const query=type==="topic"?"SELECT t.*,p.owner_id project_owner,p.published_id,p.admin_lock_at project_lock,p.deleted_at project_deleted FROM topics t LEFT JOIN projects p ON p.id=t.project_id WHERE t.id=?":"SELECT r.*,t.title,t.body topic_body,t.owner_id topic_owner,t.project_id,t.admin_lock_at topic_lock,t.deleted_at topic_deleted,p.owner_id project_owner,p.published_id,p.admin_lock_at project_lock,p.deleted_at project_deleted FROM replies r JOIN topics t ON t.id=r.topic_id LEFT JOIN projects p ON p.id=t.project_id WHERE r.id=?";
  const row=await sql.prepare(query).bind(id).first<any>();
  if(row&&review.task==="publish"&&!review.entityType.endsWith("_edit")&&(row.digest!==review.digest||row.head_edit_id))throw new SupersededReview("评论已被新修改替代，旧任务不再发布");
  if(!row||row.deleted_at||row.admin_lock_at||row.project_lock||row.project_deleted||row.topic_lock||row.topic_deleted)throw new HTTPError(423,"讨论已删除或下架");
  if(review.entityType.endsWith("_edit")&&row.head_edit_id!==review.entityId)throw new SupersededReview("修改已被更新，旧任务不再发布");
  return {projectId:row.project_id,revisionId:row.published_id,ownerId:row.owner_id,type,id,row,href:row.project_id?`/projects/${row.project_id}#discussion-${type==="topic"?id:row.topic_id}`:"/dashboard",context};
}
async function queueTechnical(review:any,result:any,info:any){
  if(!info.projectId||!info.revisionId)return;
  for(const issue of result.technicalIssues??[]){
    const uid=crypto.randomUUID(),inserted=await env.DB!.prepare("INSERT INTO technical_feedback(id,project_id,revision_id,source_review_id,commenter_id,claim,evidence,created_at,reply_origin) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(source_review_id,claim) DO NOTHING RETURNING id").bind(uid,info.projectId,info.revisionId,review.id,review.ownerId,issue.claim,JSON.stringify(issue.providedEvidence),Date.now(),info.type==="reply"?1:0).first();
    if(!inserted)continue;
    const existing=await env.DB!.prepare("SELECT r.id FROM technical_feedback f JOIN reviews r ON r.id=f.review_id WHERE f.project_id=? AND f.revision_id=? AND f.claim=? AND f.id!=? AND r.state IN ('queued','running') LIMIT 1").bind(info.projectId,info.revisionId,issue.claim,uid).first<{id:string}>();
    if(existing){await env.DB!.prepare("UPDATE technical_feedback SET review_id=? WHERE id=?").bind(existing.id,uid).run();continue;}
    const project=await env.DB!.prepare("SELECT owner_id FROM projects WHERE id=?").bind(info.projectId).first<{owner_id:string}>();if(!project)continue;
    const snapshot=JSON.stringify({task:"technical_check",technicalIssues:[issue]});
    const job=await enqueueReview("technical_check",info.projectId,project.owner_id,snapshot,await digest(snapshot),{task:"technical_check",context:{projectId:info.projectId,revisionId:info.revisionId,feedbackId:uid,replyOrigin:info.type==="reply",sourceReviewId:review.id}});
    await env.DB!.prepare("UPDATE technical_feedback SET review_id=? WHERE id=?").bind(job.id,uid).run();
  }
}
async function completeReview(review:any,result:any,info:any,policy:any,readNames:string[]){
  await targetInfo(review);
  const sql=env.DB!,now=Date.now(),context=review.context?JSON.parse(review.context):{};
  const metadata={...result,model:laneConfig(review.lane).model,sourceDigest:review.digest,policy:policy.id,policyVersion:policy.version,policyDigest:await digest(policy.text),filesRead:readNames};
  if(review.task==="publish"){
    await applyDecision(review,result.decision,{taxonomy:result.taxonomy,actorId:`ai:${review.lane}`,reason:result.summary,result:metadata});
    const resourcePending=info.kind==='resource'&&result.decision==='disputed';
    const safetyPending=holdsUnsafePublication(result);
    const held=review.entityType==="revision"&&config().PROJECT_PUBLICATION_ENABLED==="false"&&["pass","disputed"].includes(result.decision);
    const invitation=info.kind==='project'&&result.decision==='pass'?result.featuredInvitation:null;
    let originalNotice=review.entityType==="revision"?result.authorNotice:result.commenterNotice;
    if(!originalNotice&&result.decision==='revise')originalNotice={title:'内容需要修改后再发布',body:result.summary};
    if(safetyPending)originalNotice={title:'内容暂缓公开，待人工复核',body:'当前版本暂未公开。存在需要人工核对的法律或严重安全疑点，不表示已认定作者违法。\n\n'+originalNotice.body.slice(0,5600)};
    else if(resourcePending)originalNotice={title:'资源检查尚未完成',body:'当前版本暂未公开。以下事项尚不能确认，不是已发现缺陷或认定资源不合格。\n\n'+originalNotice.body.slice(0,5600)};
    if(info.kind==='resource'&&result.resourceReliability){
      const r=result.resourceReliability,proof=r.confirmedIssues.map((p:any)=>`${p.source}\n原文：${p.quote}\n判断依据：${p.basisQuote}\n说明：${p.reasoning}\n影响：${p.impact}\n涉及范围：${p.affectedScope}`).join('\n\n');
      const appendix=`\n\n本次AI检查范围：${r.checkedScope}\n未验证或有限制的部分：${r.limitations.join('；')||'未执行构建或实物测试'}${proof?'\n\n已确认问题的依据：\n'+proof:''}\n作者声明与本次检查均不代表整板或全部功能已获可靠性认证。`;
      originalNotice={...originalNotice,body:originalNotice.body.slice(0,Math.max(0,5900-appendix.length))+appendix.slice(0,5900)};
    }
    if(invitation){
      const extra=`\n\n这个作品在${invitation.criteria.map((c:string)=>({competition:'竞赛复用',teaching:'教学意义',depth:'技术深度',creativity:'创意'} as Record<string,string>)[c]).join('、')}方面展现了精选潜力：${invitation.reason}\n如果你愿意，可以在作品详情页点击“申请精选评估”。这只是申请建议，是否入选仍需独立评估。`;
      if(originalNotice.body.length+extra.length<=6000)originalNotice={...originalNotice,body:originalNotice.body+extra};
      else await notify(review.ownerId,`featured-invitation:${review.id}`,{title:'可以考虑申请精选评估',body:extra.trim()},{href:info.href,reviewId:review.id,kind:'featured_invitation'});
    }
    const notice=held&&originalNotice?{title:result.decision==="pass"?"作品审核通过，尚未上架":"作品待人工复核，尚未上架",body:"审核流程已完成本阶段处理。平台当前暂停作品上架，本次未更改作品的公开版本。\n\n"+originalNotice.body.slice(0,5800)}:originalNotice;
    const draft=result.decision==="disputed"||(result.improvements?.length??0)>0;
    if(notice)await notify(review.ownerId,`review:${review.id}`,notice,{reviewId:review.id,href:info.href,draft,revise:result.decision==='revise'});
    if(draft&&safetyPending)await notify(review.ownerId,`safety-review-status:${review.id}`,{title:'内容暂缓公开，待人工复核',body:'当前版本暂未公开。存在法律或严重安全疑点，管理员将核对具体事实及适用依据；本次暂缓不表示已认定作者违法。\n\n'+result.summary},{reviewId:review.id,href:info.href});
    else if(draft&&resourcePending)await notify(review.ownerId,`resource-review-status:${review.id}`,{title:"资源检查尚未完成",body:"资源当前版本暂未公开。本次检查有尚不能确认的事项，不是缺陷或不合格结论。具体说明文案待确认后通知。"},{reviewId:review.id,href:info.href});
    else if(draft)await notify(review.ownerId,`review-status:${review.id}`,{title:review.entityType==="revision"&&result.decision==="disputed"?(held?"作品待人工复核，尚未上架":"作品已发布，待人工复核"):result.decision==="pass"?"作品审核通过":result.decision==="revise"?"作品暂未通过审核":"评论暂缓发布",body:held?"平台当前暂停作品上架，审核结果已保存。需要人工确认的事项仍按正常流程处理。":review.entityType==="revision"&&result.decision==="disputed"?"本次审核存在待核对事项，作品已先行发布，管理员将进一步审阅。详细说明文案待确认后通知。":result.decision==="pass"?"本次审核通过。详细完善建议文案待确认后通知，不影响发布。":result.decision==="revise"?"本次审核存在需要修改的内容，当前版本尚未发布。可在审核记录中查看原因。":"评论暂不公开，等待进一步核对。"},{reviewId:review.id,href:info.href,revise:result.decision==='revise'});
    if(result.decision==="pass"&&["topic","reply"].includes(review.entityType))await notifyDiscussionPublished(review.entityType,review.entityId,review.id);
    await queueTechnical(review,result,info);
  }else if(review.task==="featured"){
    await resolveFeatured(review,metadata);
  }else if(review.task==="report"){
    if(result.decision==="take_down"){
      const current=await sql.prepare(`SELECT digest FROM ${review.entityType==="topic"?"topics":"replies"} WHERE id=?`).bind(review.entityId).first<{digest:string}>();
      if(!current||current.digest!==review.digest)throw new Error("被举报内容已修改，需重新核对");
      await moderateContent(review.entityType,review.entityId,"ai:report",result.summary,false,review.digest);
    }
    const reporters=await sql.prepare("SELECT reporter_id FROM reports WHERE review_id=?").bind(review.id).all<{reporter_id:string}>();
    for(const row of reporters.results)await notify(row.reporter_id,`report:${review.id}:${row.reporter_id}`,{title:"举报处理结果",body:result.summary},{reviewId:review.id,href:info.href});
    if(result.decision!=="take_down")await notify(review.ownerId,`reported:${review.id}`,{title:"内容复核结果",body:result.summary},{reviewId:review.id,href:info.href,draft:result.decision==="disputed"});
    await queueTechnical(review,result,info);
    await sql.prepare("UPDATE reviews SET state=?,result=?,updated_at=? WHERE id=?").bind(result.decision==="disputed"?"disputed":"approved",JSON.stringify(metadata),now,review.id).run();
  }else if(review.task==="quality"){
    await sql.prepare("UPDATE topics SET quality_status=? WHERE id=? AND digest=? AND admin_lock_at IS NULL AND deleted_at IS NULL AND status='published' AND (SELECT COUNT(*) FROM quality_votes WHERE topic_id=topics.id)>20").bind(result.decision==="qualify"?"qualified":result.decision==="not_qualify"?"not_qualified":"disputed",review.entityId,review.digest).run();
    await sql.prepare("UPDATE reviews SET state=?,result=?,updated_at=? WHERE id=?").bind(result.decision==="disputed"?"disputed":"approved",JSON.stringify(metadata),now,review.id).run();
  }else{
    const feedback=await sql.prepare("SELECT * FROM technical_feedback WHERE review_id=?").bind(review.id).all<any>();
    for(const f of feedback.results)if(result.commenterNotice)await notify(f.commenter_id,`technical:${review.id}:${f.commenter_id}`,result.commenterNotice,{reviewId:review.id,href:`/feedback?id=${f.id}`,draft:false,kind:"technical"});
    if(result.authorNotice)await notify(info.ownerId,`technical-author:${info.projectId}:${info.revisionId}:${await digest(JSON.stringify(result.authorNotice))}`,result.authorNotice,{reviewId:review.id,href:info.href,draft:true,kind:result.authorNotice.kind});
    await sql.prepare("UPDATE reviews SET state=?,result=?,updated_at=? WHERE id=?").bind(result.status==="needs_manual"?"disputed":"approved",JSON.stringify(metadata),now,review.id).run();
  }
  if(result.resourceDraft&&info.kind==='project'){
    try{await createResourceOffer(review,result,info,readNames);}catch(error){await alertAdmins('resource-offer-error:'+review.id,'资源草稿整理未完成',error instanceof Error?error.message:'资源草稿生成失败',review.id);}
  }
  if(result.decision==="disputed"||result.status==="needs_manual"||(result.improvements?.length??0)>0||result.authorNotice?.kind)await alertAdmins(`review-attention:${review.id}`,"有审核事项需要确认",`审核编号：${review.id}\n${result.summary}\n请在管理员工作台查看完整资料及待发送文案。`,review.id);
  return result;
}
export type ReviewStepRunner=(name:string,operation:()=>Promise<any>)=>Promise<any>;
export async function runReview(id:string,options:{forceProject?:boolean;executionOwner?:string;step?:ReviewStepRunner}={}){
  const sql=env.DB!,db=getDb(),owner=options.executionOwner??crypto.randomUUID(),perform:ReviewStepRunner=options.step??(async(_name,operation)=>operation());
  const review=await perform('claim',async()=>{
    const current=await db.select().from(reviews).where(eq(reviews.id,id)).get();
    if(!current||!(current.state==='queued'||current.state==='running'&&current.executionOwner===owner))throw new HTTPError(409,"该任务不在待执行队列");
    const cfg=laneConfig(current.lane);
    if(!cfg.key||cfg.maxCalls<=0||cfg.maxBudget<=0)throw new HTTPError(503,"该通道尚未启用，任务保留待审核");
    if(current.lane==='project'&&!options.forceProject&&!projectOffPeak())throw new HTTPError(409,"作品审核将在低价时段统一处理");
    if(current.state==='running')return current;
    const claimed=await sql.prepare("UPDATE reviews SET state='running',execution_owner=?,next_attempt_at=0,updated_at=? WHERE id=? AND state='queued' AND (SELECT COUNT(*) FROM reviews WHERE state='running' AND lane=?)<? RETURNING id")
      .bind(owner,Date.now(),id,current.lane,reviewConcurrency(current.lane==='discussion'?'discussion':'project')).first();
    if(!claimed)throw new HTTPError(409,"审核并发已满，内容保持排队");
    return {...current,state:'running',executionOwner:owner};
  }) as typeof reviews.$inferSelect;
  const lane=review.lane,task=review.task as ReviewTask;
  const policy=selectPolicy(task,lane);
  let lastModelOutput:string|undefined;
  try{
    let currentArchive:any,currentRepositories:any;
    const preparedKey=await perform('prepare',async()=>{
    const info=await targetInfo(review),vocabulary=(await terms()).slice(0,250);
    const snapshot=JSON.parse(review.snapshot),context=review.context?JSON.parse(review.context):{};
    const previousEvidence=task==='featured'?await prepareFeaturedEvidence(review,snapshot):null;
    const archive=lane==="project"?await reviewFiles(info.snapshot?.fileIds??[],info.ownerId):{files:[],limitations:[]};
    if(task==="featured")archive.files.push(...featuredCourseFiles(snapshot));
    const repositories=task==='featured'||task==='publish'&&info.kind==='resource'?await repositoryFiles(review.id,info.snapshot?.links??[],env.BUCKET!):{files:[],manifests:[],blocked:[]};
    archive.limitations.push(...repositories.blocked);
    archive.files.push(...repositories.files);currentRepositories=repositories;
    const cover=lane==="project"?await coverForReview(info.snapshot?.coverFileId,info.ownerId):null;
    const input={task,kind:info.kind,...(cover?{cover:{marker:cover.marker,fileId:cover.fileId,width:cover.width,height:cover.height,mime:cover.mime}}:{}),project:info.projectId?{id:info.projectId,revisionId:info.revisionId,...(lane==="project"?info.snapshot:{})}:undefined,
      ...(previousEvidence?{previousEvidence:{notes:previousEvidence.notes,limitations:"这些是同一公开版本的既有查证记录与原文引文，不是本次精选结论，也不代表通读全部课程。"}}:{}),
      ...(task==="publish"&&lane==="discussion"?discussionInput(snapshot,info):task==="publish"?{submission:info.snapshot}:snapshot),context,
      ...(archive.files.length?{attachments:{files:archive.files.map(({name,size})=>({path:name,bytes:size})).slice(0,200),entryPoints:archive.files.filter(f=>/README|\/main\.[ch]$|\.ioc$|\.cproject$/.test(f.name)).slice(0,20).map(f=>f.name),totalFiles:archive.files.length}}:{}),limitations:lane==="project"?["仅检查提交文字与工具实际读取的附件；外链内容未抓取，未执行构建、运行程序或验证硬件。",...archive.limitations]:archive.limitations,
      };
    const messages:any[]=[{role:"system",content:reviewPrompt({task,lane,entityType:review.entityType,kind:info.kind},vocabulary)+(cover?'\n本轮附有真实封面图片，须按相同发布规则检查广告、隐私及辱骂等问题；技术截图和实物照片正常放行。涉及画面的问题在findings.quote中使用cover.marker原文定位，在explanation中说明实际看见的依据；不得声称只看了文字就已检查封面。':'')},{role:"user",content:cover?[{type:'text',text:JSON.stringify(input)},{type:'image_url',image_url:{url:cover.url,detail:'original'}}]:JSON.stringify(input)}];
    currentArchive=archive;
    const key=`review-private/states/${review.id}/${owner}-prepare.json`;
    await env.BUCKET!.put(key,JSON.stringify({info,previousEvidence,cover,messages,archiveCount:archive.files.length}));
    return key;
    });
    const stored=await env.BUCKET!.get(preparedKey);if(!stored)throw new Error('审核断点资料暂不可用');
    const {info,previousEvidence,cover,messages}=await stored.json<any>();
    const archive=currentArchive??(lane==='project'?await reviewFiles(info.snapshot?.fileIds??[],info.ownerId):{files:[],limitations:[]});
    if(!currentArchive&&task==='featured')archive.files.push(...featuredCourseFiles(JSON.parse(review.snapshot)));
    if(!currentArchive&&task==='publish'&&info.kind==='resource'){const repositories=await repositoryFiles(review.id,info.snapshot?.links??[],env.BUCKET!);archive.files.push(...repositories.files);archive.limitations.push(...repositories.blocked);}
    if(task==='featured'&&(info.snapshot?.links??[]).some((l:any)=>l.type==='repository')){
      const repositories=currentRepositories??await repositoryFiles(review.id,info.snapshot.links??[],env.BUCKET!);
      if(!currentArchive)archive.files.push(...repositories.files);
      const repositorySnapshots=repositories.manifests.map((m:any)=>({url:m.source.url,commit:m.commit,snapshotDigest:m.snapshotDigest,retrievedAt:m.retrievedAt,limitations:m.limitations}));
      const scan=await scanFeatured({reviewId:review.id,windowId:owner,files:archive.files,blocked:[...repositories.blocked,...archive.limitations],manifestFingerprint:await scanDigest(JSON.stringify({files:archive.files.map((f:any)=>[f.name,f.size]),repositories:repositorySnapshots})),bucket:env.BUCKET!,snapshot:review.snapshot,project:info.snapshot,system:policy.text,repositories:repositorySnapshots,perform,
        model:async messages=>{if(!options.forceProject&&!projectOffPeak())throw new HTTPError(503,'仓库审阅保留进度，等待低价时段继续');return modelRequest(review,messages,undefined,24576,512000);},
        validate:(raw,source)=>parseReviewResult(raw,'featured',lane,source),
        saveBatch:async(index,hash,note)=>{await sql.prepare('INSERT INTO review_material_batches(review_id,batch_index,digest,result,created_at) VALUES(?,?,?,?,?) ON CONFLICT(review_id,batch_index) DO UPDATE SET digest=excluded.digest,result=excluded.result').bind(review.id,index,hash,JSON.stringify(note),Date.now()).run();},
        progress:async state=>{const updated=await sql.prepare("UPDATE reviews SET result=json_set(COALESCE(result,'{}'),'$.summary',?,'$.scanProgress',json(?)),updated_at=? WHERE id=? AND state='running' AND execution_owner=?").bind(`正在深入审阅仓库：已读 ${state.cursor.file}/${archive.files.length} 个完整文件`,JSON.stringify({filesCompleted:state.cursor.file,filesTotal:archive.files.length,bytesReviewed:state.bytesReviewed,batches:state.batches,blockedCount:repositories.blocked.length}),Date.now(),review.id,owner).run();if(!updated.meta.changes)throw new HTTPError(409,"审核执行权已变更");}
      });
      if(scan.result)return await perform('apply',()=>completeReview(review,scan.result,info,policy,archive.files.slice(0,scan.state.cursor.file+(scan.state.cursor.offset>0?1:0)).map((f:any)=>f.name)));
      await perform('continue-scan',async()=>{await sql.prepare("UPDATE reviews SET state='queued',next_attempt_at=0,updated_at=? WHERE id=? AND state='running' AND execution_owner=?").bind(Date.now(),review.id,owner).run();return true;});
      return {continuation:true,summary:'仓库审阅尚未完成，已保存断点，继续排队读取。'};
    }
    const initialBytes=new TextEncoder().encode(JSON.stringify(messages)+JSON.stringify(fileToolDefinitions)).length;
    const inputLimit=task==='featured'?512000:maxReviewInputBytes;
    const reader=fileTools(archive.files,{maxBytes:Math.max(1000,Math.min(task==='featured'?200000:60000,inputLimit-initialBytes-30000)),chunkBytes:task==='featured'?16000:10000});
    const rounds=archive.files.length?(task==='featured'?12:6):1;
    for(let i=0;i<rounds;i++){
      if(i===rounds-1&&rounds>1)messages.push({role:"user",content:"本轮只读检查结束，没有更多可调用工具。请按任务协议输出最终结论，如实区分已查看与未检查的资料，不声称执行过构建。"});
      const message=await perform(`model-${i}`,()=>modelRequest({...review,resourceCheck:info.kind==='resource'},messages,i<rounds-1?fileToolDefinitions:undefined,task==='featured'||info.kind==='resource'?24576:8192,task==='featured'?512000:maxReviewInputBytes));messages.push(message);
      if(!message.tool_calls?.length){
        lastModelOutput=message.content??"";
        const source=task==='publish'&&lane==='discussion'?discussionEvidence(JSON.parse(review.snapshot)):review.snapshot+"\n"+(lane==="project"?JSON.stringify(info.snapshot):"")+"\n"+(cover?.marker??"")+"\n"+(previousEvidence?.readSources??[]).join("\n")+"\n"+reader.readSources.join("\n");
        const result=parseReviewResult(lastModelOutput??"",task,lane,source);
        if(task==='publish'&&info.kind==='resource'){
          checkResourceReview(result,reader,info.snapshot);
          if(result.resourceReliability){
            const unread=archive.files.filter((f:any)=>!reader.fullyReadNames.has(f.name));
            result.resourceReliability.inspection={filesRead:reader.readNames.size,filesFullyRead:reader.fullyReadNames.size,filesTotal:archive.files.length};
            const scopeNotes=[...archive.limitations,...(unread.length?[`另有 ${unread.length} 个文本或原生记录分段未完整读取，不在本次完整核验范围内`]:[])];
            result.resourceReliability.limitations=[...new Set<string>([...scopeNotes,...result.resourceReliability.limitations])].slice(0,20);
          }
        }
        const readNames=[...new Set<string>([...(previousEvidence?.readNames??[]),...reader.readNames,...(cover?[cover.marker]:[])])];
        if(task==='featured'){
          if(result.decision==='qualify'&&result.criteriaConfirmed.includes('teaching')&&archive.files.some((f:any)=>f.name.startsWith('courses/'))&&!result.assessments.find((a:any)=>a.criterion==='teaching')?.evidence.some((e:any)=>[...(previousEvidence?.readSources??[]),...reader.readSources].some((text:string)=>hasQuote(text,e.quote))))throw new Error("教学精选需要实际课程正文证据");
          result.coverage={mode:'evidence_driven',chaptersTotal:previousEvidence?.chaptersTotal??0,chaptersConsulted:readNames.filter(p=>p.startsWith('courses/')).length,reusedReviewIds:previousEvidence?.reusedReviewIds??[],limitations:result.investigation.limitations};
        }
        return await perform('apply',()=>completeReview(review,result,info,policy,readNames));
      }

      if(i===rounds-1)throw new Error("模型没有完成结果输出");
      const toolStep=await perform(`tools-${i}`,async()=>{
        const replies=[];
        for(const call of message.tool_calls.slice(0,8)){
          let result:unknown;try{result=await reader.invoke(call.function.name,JSON.parse(call.function.arguments));}catch(error){result={error:error instanceof Error?error.message:"文件读取失败"};}
          replies.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result)});
        }
        await sql.prepare("UPDATE reviews SET updated_at=? WHERE id=? AND state='running'").bind(Date.now(),id).run();
        return {replies,state:reader.snapshot()};
      });
      reader.restore(toolStep.state);messages.push(...toolStep.replies);

    }
    throw new Error("审核未输出结果");
  }catch(error){
    if(error instanceof SupersededReview||(error as any)?.reviewSuperseded){
      const result={decision:"superseded",summary:(error as Error).message+"；当前公开内容不受影响，无需人工审核旧版本。",policy:policy.id,policyVersion:policy.version};
      await sql.prepare("UPDATE reviews SET state='superseded',result=?,updated_at=? WHERE id=? AND state='running' AND execution_owner=?").bind(JSON.stringify(result),Date.now(),id,owner).run();
      return result;
    }
    const savedDiagnostic=await env.BUCKET?.get(`review-diagnostics/${id}.json`);
    const batchDiagnostic=savedDiagnostic?JSON.parse(await savedDiagnostic.text()):{};
    await env.BUCKET?.put(`review-diagnostics/${id}.json`,JSON.stringify({...batchDiagnostic,error:cleanNotice(error instanceof Error?error.message:"审核失败").slice(0,4000),output:lastModelOutput?cleanNotice(lastModelOutput):batchDiagnostic.output??null,recordedAt:Date.now()}));
    const waiting=error instanceof HTTPError&&[429,503].includes(error.status);
    const failureKind=error instanceof HTTPError&&error.status===429?'budget_wait':lastModelOutput?'result_validation':error instanceof HTTPError&&error.status===423?'content_locked':error instanceof Error&&error.message.includes('模型服务')?'provider':error instanceof Error&&error.message.includes('输入')?'input_limit':'review_processing';
    const detail=cleanNotice(error instanceof Error?error.message:"审核处理未完成").slice(0,1600);
    const message=waiting?error.message:`${task==='featured'?'精选评估未完成，本次尚未入选精选':'审核流程未完成，未改变当前公开版本'}。${detail}。需进一步处理，这不是内容违规结论。`;
    const previousProgress=await sql.prepare("SELECT result FROM reviews WHERE id=?").bind(id).first<{result:string}>();
    const progress=previousProgress?.result?JSON.parse(previousProgress.result):{};
    const failureUpdate=await sql.prepare("UPDATE reviews SET state=?,result=?,updated_at=?,next_attempt_at=? WHERE id=? AND state='running' AND execution_owner=?").bind(waiting?"queued":"disputed",JSON.stringify({...progress,summary:message,failureKind,policy:policy.id,policyVersion:policy.version}),Date.now(),failureKind==='budget_wait'?budgetMonth().end:waiting?Date.now()+300000:0,id,owner).run();
    const userMessage=task==='featured'?'精选评估流程尚未完成，当前未入选精选。管理员会进一步处理，这不是对作品违规或质量不合格的判定。':'审核流程尚未完成，当前公开状态保持不变。管理员会进一步处理，这不是内容违规结论。';
    if(!waiting&&failureUpdate.meta.changes){await notify(review.ownerId,`review-failure:${id}`,{title:"审核需要进一步处理",body:userMessage},{href:"/dashboard",reviewId:id});await alertAdmins(`review-failure:${id}`,"自动审核需要人工复核",`审核编号：${id}\n${message}`,id);}
    throw error instanceof HTTPError?error:new HTTPError(502,message);
  }
}
export async function drainQueue(_lane?:"discussion"|"project",_limit=2){
  await kickReviewQueue();
}

