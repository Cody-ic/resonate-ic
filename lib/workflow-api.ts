import {env} from "cloudflare:workers";
import {z} from "zod/v3";
import {HTTPError,json,digest} from "./domain";
import {enqueueReview,drainQueue,laneConfig,projectOffPeak,config,reviewBudget} from "./moderation";
import {notify,approveNotice,mailConfigured,mailDeliveryEnabled,mailMode,mailHealth,kickMailQueue,alertAdmins,notificationLinks,mailSettings,canSendMailTo,queueEmail} from "./notifications";
import {submitContentAppeal,resolveContentAppeal} from "./appeals";
import {resolveFeatured} from "./featured";
import {moderateContent} from "./moderation-controls";
type Actor={id:string;admin:boolean};
async function body(request:Request){const text=await request.text();if(text.length>16000)throw new HTTPError(413,"请求过长");return JSON.parse(text);}
export async function workflowApi(request:Request,path:string[],user:Actor|null){
  const [root,key,id,operation]=path,sql=env.DB!,method=request.method;
  if(root==="appeals"&&method==="POST")return submitContentAppeal(request,user);
  if(root==="technical-feedback"&&method==="GET"){
    if(!user)throw new HTTPError(401,"请先登录");
    const rows=await sql.prepare(`SELECT f.id,f.project_id,f.revision_id,f.claim,f.evidence,f.created_at,r.state,r.result FROM technical_feedback f LEFT JOIN reviews r ON r.id=f.review_id WHERE f.commenter_id=?${key?" AND f.id=?":""} ORDER BY f.created_at DESC LIMIT 40`).bind(user.id,...(key?[key]:[])).all<any>();
    return json({items:rows.results.map(({result,...r})=>({...r,result:result?(user.admin?JSON.parse(result):((v:any)=>({summary:v.summary,status:v.status,questions:v.questions,commenterNotice:v.commenterNotice}))(JSON.parse(result))):null,evidence:JSON.parse(r.evidence)}))});
  }
  if(root==="notifications"){
    if(!user)throw new HTTPError(401,"请先登录");
    if(method==="GET"){
      const offset=Math.max(0,Number(new URL(request.url).searchParams.get("offset"))||0);
      const rows=await sql.prepare("SELECT n.*,EXISTS(SELECT 1 FROM email_outbox e WHERE e.notification_id=n.id) has_email,(SELECT state FROM email_outbox e WHERE e.notification_id=n.id LIMIT 1) email_state FROM notifications n WHERE recipient_id=? AND state='ready' ORDER BY created_at DESC LIMIT 40 OFFSET ?").bind(user.id,offset).all();
      const count=await sql.prepare("SELECT COUNT(*) n FROM notifications WHERE recipient_id=? AND state='ready' AND read_at IS NULL").bind(user.id).first<{n:number}>();
      return json({items:await Promise.all(rows.results.map(n=>notificationLinks(n,user))),unread:count?.n??0,emailConfigured:mailDeliveryEnabled(),mailMode:mailMode(),nextOffset:rows.results.length===40?offset+40:null});
    }
    if(method==="POST"&&key==="read"){
      const input=z.object({id:z.string().uuid().optional()}).parse(await body(request));
      await sql.prepare(`UPDATE notifications SET read_at=? WHERE recipient_id=? AND state='ready'${input.id?" AND id=?":""}`).bind(Date.now(),user.id,...(input.id?[input.id]:[])).run();return json({message:"已标记已读"});
    }
  }
  if(root==="topics"&&key&&id==="recommend"){
    if(!user)throw new HTTPError(401,"请先登录");
    const topic=await sql.prepare("SELECT t.* FROM topics t JOIN projects p ON p.id=t.project_id WHERE t.id=? AND t.status='published' AND t.deleted_at IS NULL AND t.admin_lock_at IS NULL AND p.deleted_at IS NULL AND p.admin_lock_at IS NULL").bind(key).first<any>();
    if(!topic)throw new HTTPError(404,"讨论不可见");
    if(method==="POST")await sql.prepare("INSERT INTO quality_votes(topic_id,user_id,created_at) VALUES(?,?,?) ON CONFLICT(topic_id,user_id) DO NOTHING").bind(key,user.id,Date.now()).run();
    else if(method==="DELETE")await sql.prepare("DELETE FROM quality_votes WHERE topic_id=? AND user_id=?").bind(key,user.id).run();
    const count=await sql.prepare("SELECT COUNT(*) n FROM quality_votes WHERE topic_id=?").bind(key).first<{n:number}>();
    if((count?.n??0)>20&&topic.quality_status==="none"){
      const claim=await sql.prepare("UPDATE topics SET quality_status='queued' WHERE id=? AND quality_status='none' RETURNING id").bind(key).first();
      if(claim){const replies=await sql.prepare("SELECT body FROM replies WHERE topic_id=? AND status='published' AND deleted_at IS NULL AND admin_lock_at IS NULL LIMIT 40").bind(key).all();
        await enqueueReview("topic",key,topic.owner_id,JSON.stringify({task:"quality",target:{title:topic.title,body:topic.body,replies:replies.results}}),topic.digest,{task:"quality",lane:"discussion"});}
    }
    if((count?.n??0)<=20)await sql.prepare("UPDATE topics SET quality_status='none' WHERE id=? AND quality_status!='none'").bind(key).run();
    return json({count:count?.n??0,recommended:method!=="DELETE",message:(count?.n??0)>20?"已达到推荐门槛，等待简要核验":"推荐已记录"});
  }
  if(root==="technical-feedback"&&key&&method==="POST"){
    if(!user)throw new HTTPError(401,"请先登录");
    const f=await sql.prepare("SELECT f.*,r.state FROM technical_feedback f LEFT JOIN reviews r ON r.id=f.review_id WHERE f.id=? AND f.commenter_id=?").bind(key,user.id).first<any>();
    if(!f)throw new HTTPError(404,"反馈记录不存在");
    if(["queued","running"].includes(f.state))throw new HTTPError(409,"核查正在排队或执行，请完成后再补充");
    const input=z.object({details:z.string().trim().min(5).max(6000)}).parse(await body(request));
    const evidence=JSON.parse(f.evidence);if(evidence.includes(input.details))throw new HTTPError(409,"相同材料无需重复提交");evidence.push(input.details);if(evidence.length>8)throw new HTTPError(429,"补充材料较多，请联系管理员合并核查");
    const project=await sql.prepare("SELECT owner_id FROM projects WHERE id=? AND admin_lock_at IS NULL AND deleted_at IS NULL").bind(f.project_id).first<{owner_id:string}>();if(!project)throw new HTTPError(423,"关联工程不可用");
    const text=JSON.stringify({task:"technical_check",technicalIssues:[{claim:f.claim,providedEvidence:evidence,quote:f.claim}]});
    const oldContext=await sql.prepare("SELECT context FROM reviews WHERE id=?").bind(f.review_id).first<{context:string}>();
    const previous=oldContext?.context?JSON.parse(oldContext.context):{};
    const job=await enqueueReview("technical_check",f.project_id,project.owner_id,text,await digest(text),{task:"technical_check",context:{...previous,feedbackId:f.id,projectId:f.project_id,revisionId:f.revision_id}});
    await sql.prepare("UPDATE technical_feedback SET evidence=?,review_id=? WHERE id=?").bind(JSON.stringify(evidence),job.id,f.id).run();return json({message:"补充信息已保存，将继续核查",reviewId:job.id});
  }
  if(root!=="admin"||!["workflows","notices","content","mail","queue","reviews","projects"].includes(key))return null;
  if(!user?.admin)throw new HTTPError(403,"需要管理员权限");
  if(key==="projects"&&id&&operation==="audit"&&method==="POST"){
    const p=await sql.prepare("SELECT p.*,r.snapshot,r.digest FROM projects p JOIN revisions r ON r.id=p.head_id WHERE p.id=? AND p.deleted_at IS NULL AND p.admin_lock_at IS NULL").bind(id).first<any>();
    if(!p)throw new HTTPError(404,"作品不存在或已下架");
    const pending=await sql.prepare("SELECT id FROM reviews WHERE entity_id=? AND task='publish' AND state IN ('queued','running') LIMIT 1").bind(p.head_id).first<{id:string}>();
    if(pending)return json({reviewId:pending.id,message:"该版本已有审核任务，无需重复提交"});
    const job=await enqueueReview("revision",p.head_id,p.owner_id,p.snapshot,p.digest,{});
    return json({reviewId:job.id,message:"已加入审核队列，将按正常流程生成结果与通知；是否公开遵循当前上架设置"});
  }
  if(key==='reviews'&&operation==='retry'&&method==='POST'){
    const row=await sql.prepare("SELECT * FROM reviews WHERE id=? AND state='disputed'").bind(id).first<any>();
    if(!row||!JSON.parse(row.result??'{}').failureKind)throw new HTTPError(409,"只有执行异常的任务可以继续处理");
    const context=JSON.parse(row.context??'{}'),old=JSON.parse(row.result??'{}');delete old.failureKind;
    context.assessmentMode='evidence_driven';delete context.fullCourseReview;
    context.executionAttempt=(Number(context.executionAttempt)||0)+1;
    const changed=await sql.prepare("UPDATE reviews SET state='queued',execution_owner=NULL,next_attempt_at=0,context=?,result=?,updated_at=? WHERE id=? AND state='disputed' RETURNING id").bind(JSON.stringify(context),JSON.stringify({...old,decision:'pending',summary:'等待继续核对；已有查证记录保留。'}),Date.now(),id).first();
    if(!changed)throw new HTTPError(409,"任务状态已经更新");
    return json({message:"已继续处理，保留已有证据与费用记录"});
  }
  if(key==='reviews'&&operation==='materials'&&method==='GET'){
    const review=await sql.prepare("SELECT result FROM reviews WHERE id=?").bind(id).first<{result:string}>();
    const result=review?.result?JSON.parse(review.result):{},ids=[...new Set<string>([id,...(result.coverage?.reusedReviewIds??[])])].slice(0,40);
    const batches=await sql.prepare(`SELECT review_id,batch_index,digest,result FROM review_material_batches WHERE review_id IN (${ids.map(()=>'?').join(',')}) AND result IS NOT NULL ORDER BY json_array_length(result,'$.covered') DESC,batch_index`).bind(...ids).all<any>();
    const seen=new Set<string>();
    return json({items:batches.results.filter(r=>{if(seen.has(r.digest))return false;seen.add(r.digest);return true;}).map(r=>({...r,result:JSON.parse(r.result)}))});
  }
  if(key==="reviews"&&operation==="diagnostic"&&method==="GET"){
    const stored=await env.BUCKET?.get(`review-diagnostics/${id}.json`);
    if(!stored)throw new HTTPError(404,"没有该审核的输出诊断记录");
    return json(JSON.parse(await stored.text()));
  }
  if(key==="reviews"&&operation==="resolve-task"&&method==="POST"){
    const input=z.object({decision:z.enum(["keep","take_down","qualify","not_qualify","resolved","restore","uphold"]),reason:z.string().trim().min(10).max(1500)}).parse(await body(request));
    const row=await sql.prepare("SELECT * FROM reviews WHERE id=? AND task!='publish' AND state IN ('disputed','needs_changes')").bind(id).first<any>();if(!row)throw new HTTPError(409,"该任务当前不能人工处理");
    if(row.task==="appeal"){
      await resolveContentAppeal(row,input.decision,input.reason,user.id);
    }else if(row.task==="featured"){
      if(!["qualify","not_qualify"].includes(input.decision))throw new HTTPError(422,"请选择入选或暂不入选");
      const context=JSON.parse(row.context??"{}");
      await resolveFeatured(row,{task:"featured",decision:input.decision,criteriaConfirmed:input.decision==='qualify'?context.criteria:[],summary:input.reason,method:"human",actorId:user.id},user.id);
    }else if(row.task==="report"){
      if(!["keep","take_down"].includes(input.decision))throw new HTTPError(422,"请选择保留或下架");
      if(input.decision==="take_down")await moderateContent(row.entity_type,row.entity_id,user.id,input.reason,false,row.digest);
      const reporters=await sql.prepare("SELECT reporter_id FROM reports WHERE review_id=?").bind(id).all<{reporter_id:string}>();
      for(const r of reporters.results)await notify(r.reporter_id,`manual-report:${id}:${r.reporter_id}`,{title:"举报人工复核结果",body:input.reason},{reviewId:id,email:row.entity_type!=="reply"});
    }else if(row.task==="quality"){
      if(!["qualify","not_qualify"].includes(input.decision))throw new HTTPError(422,"请选择优质核验结果");
      await sql.prepare("UPDATE topics SET quality_status=? WHERE id=? AND digest=? AND admin_lock_at IS NULL AND deleted_at IS NULL AND (SELECT COUNT(*) FROM quality_votes WHERE topic_id=topics.id)>20").bind(input.decision==="qualify"?"qualified":"not_qualified",row.entity_id,row.digest).run();
    }else if(row.task==="technical_check"){
      const f=await sql.prepare("SELECT commenter_id,reply_origin FROM technical_feedback WHERE review_id=?").bind(id).all<{commenter_id:string;reply_origin:number}>();
      for(const r of f.results)await notify(r.commenter_id,`manual-technical:${id}:${r.commenter_id}`,{title:"技术反馈人工处理说明",body:input.reason},{reviewId:id,email:!r.reply_origin});
    }
    if(!["featured","appeal"].includes(row.task))await sql.prepare("UPDATE reviews SET state='approved',result=?,updated_at=? WHERE id=?").bind(JSON.stringify({summary:input.reason,decision:input.decision,method:"human"}),Date.now(),id).run();
    await sql.prepare("INSERT INTO moderation_actions(id,entity_type,entity_id,actor_id,action,reason,created_at) VALUES(?,'review',?,?,?,?,?)").bind(crypto.randomUUID(),id,user.id,input.decision,input.reason,Date.now()).run();
    return json({message:"人工处理已记录"});
  }
  if(key==="workflows"&&method==="GET"){
    const drafts=await sql.prepare("SELECT n.*,u.name recipient_name FROM notifications n LEFT JOIN users u ON u.id=n.recipient_id WHERE n.state='draft' ORDER BY n.created_at LIMIT 100").all();
    const queues=await sql.prepare("SELECT lane,task,state,COUNT(*) count FROM reviews GROUP BY lane,task,state").all();
    const mail=await sql.prepare("SELECT id,subject,state,error,created_at,purpose,started_at,accepted_at,attempts,next_attempt_at FROM email_outbox WHERE purpose!='verification' ORDER BY created_at DESC LIMIT 50").all();
    const locks=await sql.prepare("SELECT 'project' entity_type,id,admin_reason,admin_lock_at FROM projects WHERE admin_lock_at IS NOT NULL UNION ALL SELECT 'topic',id,admin_reason,admin_lock_at FROM topics WHERE admin_lock_at IS NOT NULL UNION ALL SELECT 'reply',id,admin_reason,admin_lock_at FROM replies WHERE admin_lock_at IS NOT NULL ORDER BY admin_lock_at DESC LIMIT 100").all();
    const budget=await reviewBudget();
    const projects=await sql.prepare("SELECT p.id,p.kind,json_extract(r.snapshot,'$.title') title,(SELECT rv.state FROM reviews rv WHERE rv.entity_id=p.head_id AND json_extract(rv.context,'$.preview')=1 ORDER BY rv.created_at DESC LIMIT 1) audit_state FROM projects p JOIN revisions r ON r.id=p.head_id WHERE p.deleted_at IS NULL AND p.admin_lock_at IS NULL ORDER BY p.updated_at DESC LIMIT 100").all();
    const columns="id,task,lane,state,context,created_at,result,appeal,COALESCE(json_extract(snapshot,'$.title'),json_extract(snapshot,'$.target.title'),'审核事项') title";
    const pending=await sql.prepare(`SELECT ${columns} FROM reviews WHERE state='disputed' OR (state='needs_changes' AND appeal IS NOT NULL) ORDER BY created_at LIMIT 100`).all();
    const automatic=await sql.prepare(`SELECT ${columns} FROM reviews WHERE state IN ('queued','running') ORDER BY created_at LIMIT 100`).all();
    const history=await sql.prepare(`SELECT ${columns} FROM reviews WHERE state IN ('approved','cancelled','superseded') OR (state='needs_changes' AND appeal IS NULL) ORDER BY created_at DESC LIMIT 100`).all();
    return json({drafts:drafts.results,queues:queues.results,pending:pending.results,automatic:automatic.results,history:history.results,mail:mail.results,locks:locks.results,budgets:budget.lanes,sharedBudget:budget.shared,projects:projects.results,publicationEnabled:config().PROJECT_PUBLICATION_ENABLED!=="false",projectOffPeak:projectOffPeak(),mailConfigured:mailConfigured(),mailHealth:await mailHealth()});
  }
  if(key==="notices"&&id&&method==="POST"){
    if(operation==="approve"){
      const input=z.object({title:z.string().min(1).max(160),body:z.string().min(1).max(6000)}).optional().parse(await body(request));
      if(!await approveNotice(id,user.id,input))throw new HTTPError(409,"文案状态已变化");return json({message:"文案已确认并发布站内通知；邮件按配置排队发送"});
    }
    if(operation==="reject"){const input=z.object({reason:z.string().min(2).max(500)}).parse(await body(request));await sql.prepare("UPDATE notifications SET state='rejected',approved_by=? WHERE id=? AND state='draft'").bind(user.id,id).run();await sql.prepare("INSERT INTO moderation_actions(id,entity_type,entity_id,actor_id,action,reason,created_at) VALUES(?,'notice',?,?,'reject',?,?)").bind(crypto.randomUUID(),id,user.id,input.reason,Date.now()).run();return json({message:"文案已撤回，未通知作者"});}
  }
  if(key==="content"&&path[2]&&path[3]&&method==="POST"){
    const input=z.object({reason:z.string().trim().min(2).max(1500)}).parse(await body(request));const action=path[4];if(!["take-down","unlock"].includes(action))throw new HTTPError(404,"操作不存在");
    await moderateContent(path[2],path[3],user.id,input.reason,action==="unlock");return json({message:action==="unlock"?"已解除管理员下架限制":"已下架并记录理由"});
  }
  if(key==="mail"&&method==="POST"){
    if(id==='resume'){
      z.object({confirmedAccountVerified:z.literal(true)}).parse(await body(request));
      const changed=await sql.prepare("UPDATE mail_credentials SET auth_state='unknown',error=NULL,retry_after_at=0 WHERE id=? AND auth_state='account_verification_required' RETURNING id").bind('graph:'+mailSettings().MAIL_GRAPH_CLIENT_ID).first();
      if(!changed)throw new HTTPError(409,'邮箱当前不处于等待微软账号验证的状态');
      await kickMailQueue();return json({message:'已按管理员确认解除暂停；后续投递仍由微软检查，失败邮件不会自动重发'});
    }
    if(id==='test'){
      const input=z.object({target:z.enum(['sender','administrator']).default('sender')}).parse(await body(request));
      const toList=[...new Set((input.target==='administrator'?mailSettings().ADMIN_EMAILS??'':mailSettings().MAIL_FROM??'').split(',').map(x=>x.trim()).filter(Boolean))];
      if(!toList.length||toList.length>10||toList.some(to=>!canSendMailTo(to)))throw new HTTPError(503,'请先完成邮箱授权，并允许向配置的测试收件地址发信');
      const bucket=Math.floor(Date.now()/60000),claim=await sql.prepare("INSERT INTO limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO NOTHING RETURNING key").bind(`mail-test:${bucket}`,(bucket+1)*60000).first();
      if(!claim)throw new HTTPError(429,'测试邮件每分钟最多发送一封，请稍后查看发件箱和收件箱');
      const ids=[];
      for(const to of toList)ids.push(await queueEmail(`mail-connection-test:${crypto.randomUUID()}`,to,input.target==='administrator'?'共振网站 · 管理员邮件连接测试':'共振网站 · 邮箱连接测试',`这是一封由共振网站邮件队列发送的连接测试邮件。\n\n发件地址：${mailSettings().MAIL_FROM}\n发送时间：${new Date().toISOString()}\n\n此邮件用于核对${input.target==='administrator'?'管理员提醒':'发信授权'}与邮件队列是否能正常投递，不是实际审核事项，不包含验证码或用户数据。`,{purpose:'connection-test'}));
      return json({id:ids[0],ids,message:'测试邮件已进入发送队列，请检查收件箱及垃圾邮件夹'});
    }
    if(id==='dispatch'){await kickMailQueue();return json({message:mailDeliveryEnabled()?'已唤醒邮件队列，发送状态会在后台更新':'邮件发送尚未启用，队列已保留'});}
    if(id&&operation==="retry"){
      const input=z.object({confirmedNotSent:z.literal(true)}).parse(await body(request));
      const updated=await sql.prepare("UPDATE email_outbox SET state='queued',error=NULL,next_attempt_at=0,attempts=0,started_at=NULL,execution_owner=NULL WHERE id=? AND state IN ('failed','uncertain') AND purpose!='verification' RETURNING id").bind(id).first();
      if(!updated)throw new HTTPError(409,'该邮件当前不能重试，验证码应重新申请');
      return json({message:'已在确认未投递后重新排队，仍遵守联调收件人和服务限流设置'});
    }
  }
  if(key==="queue"&&method==="POST"){await drainQueue();return json({message:"已唤醒审核队列；空闲名额自动补位，项目遵守低价时段"});}
  return null;
}
