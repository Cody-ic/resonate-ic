import {logApiFailure} from './operation-log';
import {readiness} from './readiness';
import { env } from "cloudflare:workers";
import { and, desc, eq, or, sql as expression } from "drizzle-orm";
import { z } from "zod/v3";
import { getDb } from "../db";
import * as s from "../db/schema";
import { accountIdentity,registerAccount,authHandler,platformLoginEnabled } from "./auth";
import { manageContent } from "./accounts";
import { boards, criteriaLabels, digest, forumDecision, HTTPError, json, projectSchema, resourceSchema, courseSchema, categories } from "./domain";
import {nominateFeatured,cancelFeatured} from "./featured";
import { trustedCourse } from "./trusted-courses";
import { applyDecision, config, runReview,enqueueReview,laneConfig,reviewBudget,drainQueue } from "./moderation";
import {workflowApi} from "./workflow-api";
import {requireUnlocked} from "./moderation-controls";
import {notify,alertAdmins,mailVerificationAvailable,mailVerificationRequired} from "./notifications";
import { taxonomyPlanSchema } from "./classification";
import { snapshotView,taxonomyConfig,publicCatalog } from "./taxonomy";
import {inspectCover,inspectCourseImage,readCover} from "./cover-images";
import {resourceOffersApi,requireOfferSource} from './resource-offers';

const id = () => crypto.randomUUID();
const publicName = (u: {name:string} | null | undefined) => u?.name ?? "社区成员";
function must(value: unknown, code: number, message: string): asserts value { if (!value) throw new HTTPError(code,message); }
async function data(request: Request, maxBytes=90000) {
  if (Number(request.headers.get("Content-Length") ?? 0)>maxBytes) throw new HTTPError(413,"请求过大");
  const body = await request.text();
  if (new TextEncoder().encode(body).length>maxBytes) throw new HTTPError(413,"请求过大");
  try { return JSON.parse(body); } catch { throw new HTTPError(400,"请求必须是 JSON"); }
}
async function actor(request:Request) {
  const identity = await accountIdentity(request);
  if (!identity) return null;
  const db = getDb();
  let user = await db.select().from(s.users).where(eq(s.users.id,identity.id)).get();
  if(!user){
    await db.insert(s.users).values({id:identity.id,name:identity.name,createdAt:identity.createdAt}).onConflictDoNothing();
    user=(await db.select().from(s.users).where(eq(s.users.id,identity.id)).get())!;
  }
  return {...user,provider:identity.provider,admin:(config().ADMIN_USER_IDS??"").split(",").map(x=>x.trim()).includes(user.id)};
}
async function throttle(user:string, operation:string, max:number, window=3600000) {
  const bucket=Math.floor(Date.now()/window), key=`${user}:${operation}:${bucket}`;
  const result=await env.DB!.prepare("INSERT INTO limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count<? RETURNING count")
    .bind(key,(bucket+1)*window,max).first();
  must(result,429,"操作太频繁，请稍后再试");
}
async function review(entityType:string,entityId:string,ownerId:string,snapshot:string,hash:string,state="queued",result?:unknown,task="publish",context?:unknown) {
  const entry={id:id(),entityType,entityId,ownerId,snapshot,digest:hash,state,result:result?JSON.stringify(result):null,createdAt:Date.now(),updatedAt:Date.now(),lane:entityType==="revision"?"project":"discussion",task,context:context?JSON.stringify(context):null};
  await getDb().insert(s.reviews).values(entry);return entry;
}
async function ownProject(projectId:string,userId:string) {
  const p=await getDb().select().from(s.projects).where(eq(s.projects.id,projectId)).get();
  must(p&&!p.deletedAt,404,"项目不存在");must(p.ownerId===userId,403,"只能修改自己的项目");return p;
}
async function checkFiles(fileIds:string[],ownerId:string) {
  for(const fileId of fileIds) {
    const file=await getDb().select().from(s.files).where(eq(s.files.id,fileId)).get();
    must(file && file.ownerId===ownerId,422,"附件不存在或不属于当前作者");
  }
}
async function checkCourseProject(input: z.infer<typeof courseSchema>) {
  if(!input.projectId) return;
  const db=getDb(), project=await db.select().from(s.projects).where(eq(s.projects.id,input.projectId)).get();
  must(project?.publishedId && !project.deletedAt && project.kind==="project",422,"请选择已经公开的完整项目");
  input.projectRevisionId ??= project.publishedId;
  const revision=await db.select().from(s.revisions).where(eq(s.revisions.id,input.projectRevisionId)).get();
  must(revision?.projectId===project.id && revision.status==="published",422,"关联版本必须属于该项目且已公开");
}
async function catalog(ownerId?:string,relatedProjectId?:string) {
  const db=getDb();
  const rows=await db.select().from(s.projects).where(ownerId?eq(s.projects.ownerId,ownerId):relatedProjectId?expression`${s.projects.publishedId} is not null AND ${s.projects.kind}='course' AND EXISTS(SELECT 1 FROM revisions r WHERE r.id=${s.projects.publishedId} AND json_extract(r.snapshot,'$.projectId')=${relatedProjectId})`:expression`${s.projects.publishedId} is not null`).orderBy(desc(s.projects.updatedAt)).limit(200);
  const result=[];
  for(const p of rows) {
    const rid=ownerId?p.headId:p.publishedId;
    const rev=rid?await db.select().from(s.revisions).where(eq(s.revisions.id,rid)).get():null;
    if(!rev || p.deletedAt || (!ownerId && (rev.status!=="published"||p.adminLockAt))) continue;
    const selection=await db.select().from(s.selections).where(eq(s.selections.projectId,p.id)).get();
    const u=await db.select().from(s.users).where(eq(s.users.id,p.ownerId)).get();
    result.push({...p,...await snapshotView(rev),revisionId:rev.id,status:rev.status,author:publicName(u),
      featured:selection?.revisionId===p.publishedId ? {criteria:JSON.parse(selection.criteria),evidence:selection.evidence,date:selection.createdAt}:null});
  }
  return result;
}
async function entitySnapshot(type:string,entityId:string) {
  const db=getDb();
  if(type==="revision") {
    const rev=await db.select().from(s.revisions).where(eq(s.revisions.id,entityId)).get();
    if(!rev) return null;
    const p=await db.select().from(s.projects).where(eq(s.projects.id,rev.projectId)).get();
    if(!p || p.deletedAt || p.adminLockAt || p.publishedId!==rev.id) return null;
    return {ownerId:p.ownerId,snapshot:rev.snapshot,digest:rev.digest};
  }
  const table=type==="topic"?s.topics:s.replies;
  const row=await db.select().from(table).where(eq(table.id,entityId)).get();
  if(!row||row.status!=="published"||row.deletedAt||row.adminLockAt)return null;
  const parent=type==='topic'?row as any:await db.select().from(s.topics).where(eq(s.topics.id,(row as any).topicId)).get();
  if(!parent||parent.status!=='published'||parent.deletedAt||parent.adminLockAt)return null;
  const project=parent.projectId?await db.select().from(s.projects).where(eq(s.projects.id,parent.projectId)).get():null;
  if(!project||!project.publishedId||project.deletedAt||project.adminLockAt)return null;
  return {ownerId:row.ownerId,snapshot:JSON.stringify(row),digest:row.digest};
}

export async function api(request:Request) {
  try {
    const path=new URL(request.url).pathname.replace(/^\/api\/?/,"").split("/").filter(Boolean);
    const courseRequest=path[0]==="courses", root=courseRequest?"projects":path[0], key=path[1], action=path[2], method=request.method;
    if(!["GET","HEAD"].includes(method)) {
      const origin=request.headers.get("Origin");
      must(!origin || origin===new URL(request.url).origin,403,"跨站写入被拒绝");
    }
    if(root==="health" && ["GET","HEAD"].includes(method)) return await readiness(env);
    const db=getDb();
    if(root==="config" && method==="GET") return json({categories,boards,criteria:criteriaLabels,auth:"password_and_platform",platformLoginEnabled:platformLoginEnabled(),maxUploadBytes:10485760,
      emailVerificationEnabled:mailVerificationAvailable(),emailVerificationRequired:mailVerificationRequired(),moderation:{forum:"ai_before_publish",projects:"off_peak_ai",projectPublicationEnabled:config().PROJECT_PUBLICATION_ENABLED!=="false",projectAIConfigured:!!laneConfig("project").key,discussionAIConfigured:!!laneConfig("discussion").key}});
    if(root==="taxonomy"&&method==="GET")return json(await taxonomyConfig());
    if(root==="auth")return await authHandler(request);
    if(root==="account"&&key==="register"&&method==="POST")return await registerAccount(request);
    const user=await actor(request);
    const offerResponse=await resourceOffersApi(request,path,user,projectId=>api(new Request(new URL('/api/projects/'+projectId+'/submit',request.url),{method:'POST',headers:request.headers})));if(offerResponse)return offerResponse;
    const workflow=await workflowApi(request,path,user);if(workflow)return workflow;
    const managed=await manageContent(request,path,user);if(managed)return managed;
    if(root==="me" && method==="GET") {
      if(key==="projects") {must(user,401,"请先登录");return json({items:await catalog(user.id)});}
      if(key==="courses") {must(user,401,"请先登录");return json({items:(await catalog(user.id)).filter(p=>p.kind==="course")});}
      if(key==="reviews") {must(user?.admin,403,"审核详情仅管理员可见");const rows=await db.select().from(s.reviews).where(user.admin?undefined:eq(s.reviews.ownerId,user.id)).orderBy(desc(s.reviews.createdAt)).limit(100);return json({items:rows.map(({snapshot,...r})=>({...r,result:r.result?JSON.parse(r.result):null}))});}
      return json({user});
    }
    if(root==="me" && method==="PATCH") {
      must(user,401,"请先登录");const body=z.object({name:z.string().trim().min(2).max(40),bio:z.string().trim().max(500).optional()}).parse(await data(request));
      await db.update(s.users).set(body).where(eq(s.users.id,user.id));return json({user:{...user,...body}});
    }
    if(root==="projects") {
      if(method==="GET" && !key) {
        const params=new URL(request.url).searchParams,kind=courseRequest?"course":params.get("kind")??"project";
        return json(await publicCatalog(kind,params));
      }
      if(method==="GET" && key) {
        const p=await db.select().from(s.projects).where(eq(s.projects.id,key)).get();must(p&&!p.deletedAt&&(!p.adminLockAt||p.ownerId===user?.id||user?.admin),404,"项目不存在或已下架");
        must(courseRequest?p.kind==="course":p.kind!=="course",404,"内容类型与入口不符");
        const owner=user?.id===p.ownerId||user?.admin, requestedRevision=new URL(request.url).searchParams.get("revision"),rid=requestedRevision??(owner?p.headId:p.publishedId);must(rid,404,"内容尚未公开");
        const rev=await db.select().from(s.revisions).where(eq(s.revisions.id,rid)).get();
        must(rev?.projectId===p.id && (owner||rev.status==="published"),404,"该版本不存在或未公开");
        const history=await db.select({id:s.revisions.id,number:s.revisions.number,status:s.revisions.status,createdAt:s.revisions.createdAt}).from(s.revisions)
          .where(owner?eq(s.revisions.projectId,key):and(eq(s.revisions.projectId,key),eq(s.revisions.status,"published"))).orderBy(desc(s.revisions.number));
        const author=await db.select().from(s.users).where(eq(s.users.id,p.ownerId)).get();
        const snapshot=await snapshotView(rev),attachments=[];
        for(const fid of snapshot.fileIds) {const f=await db.select().from(s.files).where(eq(s.files.id,fid)).get();if(f) attachments.push({id:f.id,name:f.name,size:f.size,digest:f.digest});}
        const pendingHumanReview=rev.status==="published"&&!!await env.DB!.prepare("SELECT id FROM reviews WHERE entity_id=? AND task='publish' AND state='disputed' LIMIT 1").bind(rev.id).first();
        const selection=await db.select().from(s.selections).where(eq(s.selections.projectId,p.id)).get();
        const featuredReview=owner?await env.DB!.prepare("SELECT id,state,result FROM reviews WHERE entity_id=? AND task='featured' ORDER BY created_at DESC LIMIT 1").bind(p.publishedId??rev.id).first<any>():null;
        const publicRevision=p.publishedId?await db.select().from(s.revisions).where(eq(s.revisions.id,p.publishedId)).get():null;
        const publicVersion=publicRevision?{revisionId:publicRevision.id,version:JSON.parse(publicRevision.snapshot).version}:null;
        const fullFeaturedResult=featuredReview?.result?JSON.parse(featuredReview.result):null;
        const visibleFeaturedResult=user?.admin?fullFeaturedResult:fullFeaturedResult?{summary:fullFeaturedResult.failureKind?"精选评估流程尚未完成，已交管理员处理，当前未入选精选。":fullFeaturedResult.summary,decision:fullFeaturedResult.decision,coverage:fullFeaturedResult.coverage?{chaptersTotal:fullFeaturedResult.coverage.chaptersTotal,chaptersComplete:fullFeaturedResult.coverage.chaptersComplete}:undefined}:null;
        const resourceResult=p.kind==='resource'?await env.DB!.prepare("SELECT result FROM reviews WHERE entity_id=? AND task='publish' AND state='approved' ORDER BY updated_at DESC LIMIT 1").bind(rev.id).first<any>():null;
        const reliability=resourceResult?.result?JSON.parse(resourceResult.result).resourceReliability:null;
        const resourceReview=reliability?.ready?{checkedScope:reliability.checkedScope,limitations:reliability.limitations,inspection:reliability.inspection}:null;
        const project={...p,...snapshot,resourceReview,status:rev.status,revisionId:rev.id,author:publicName(author),pendingHumanReview,publicVersion,featuredReview:featuredReview?{id:featuredReview.id,state:featuredReview.state,result:visibleFeaturedResult}:null,featured:selection?.revisionId===p.publishedId?{criteria:JSON.parse(selection.criteria),evidence:selection.evidence,date:selection.createdAt}:null};
        if(courseRequest) {
          let relatedProject=null;
          if(snapshot.projectId && snapshot.projectRevisionId) {
            const linked=await db.select().from(s.projects).where(eq(s.projects.id,snapshot.projectId)).get();
            const linkedRev=await db.select().from(s.revisions).where(eq(s.revisions.id,snapshot.projectRevisionId)).get();
            if(linked?.publishedId && !linked.deletedAt && linkedRev?.projectId===linked.id && linkedRev.status==="published")relatedProject={id:linked.id,revisionId:linkedRev.id,title:JSON.parse(linkedRev.snapshot).title,version:JSON.parse(linkedRev.snapshot).version};
          }
          return json({course:project,history,attachments,relatedProject,trusted:trustedCourse(key,rev.id)});
        }
        return json({project,history,attachments,courses:await catalog(undefined,key)});
      }
      must(user,401,"请先登录后投稿");
      if(method==="POST" && !key) {
        await throttle(user.id,"project",8);
        const body=await data(request,courseRequest?1048576:90000),input=courseRequest?courseSchema.parse(body):(body.kind==="resource"?resourceSchema:projectSchema).parse(body),kind=courseRequest?"course":body.kind==="resource"?"resource":"project";
        if(courseRequest)await checkCourseProject(input as z.infer<typeof courseSchema>);
        await checkFiles(input.fileIds,user.id);if(input.coverFileId)await readCover(input.coverFileId,user.id);
        const projectId=id(),revisionId=id(),snapshot=JSON.stringify(input),now=Date.now();
        await db.batch([
          db.insert(s.projects).values({id:projectId,ownerId:user.id,kind,headId:revisionId,createdAt:now,updatedAt:now}),
          db.insert(s.revisions).values({id:revisionId,projectId,number:1,snapshot,digest:await digest(snapshot),status:"draft",createdAt:now}),
        ]);
        return json({id:projectId,revisionId,status:"draft"},201);
      }
      const project=await ownProject(key,user.id);
      if(action==='featured-nomination'&&method==='POST'){
        await throttle(user.id,'featured',4);
        const input=z.object({criteria:z.array(z.enum(['competition','teaching','depth','creativity'])).min(1).max(4),evidence:z.string().trim().min(10).max(3000)}).parse(await data(request));
        return json(await nominateFeatured(key,input.criteria,input.evidence,user.id));
      }
      if(action==='featured-nomination'&&method==='DELETE'){
        const active=await env.DB!.prepare("SELECT id FROM reviews WHERE task='featured' AND json_extract(context,'$.projectId')=? AND json_extract(context,'$.requestedBy')=? AND state IN ('queued','running','disputed')").bind(key,user.id).first();
        must(active,409,'没有可撤回的本人提名');
        await env.DB!.prepare("UPDATE reviews SET state='cancelled',updated_at=?,result=? WHERE task='featured' AND json_extract(context,'$.projectId')=? AND json_extract(context,'$.requestedBy')=? AND state IN ('queued','running','disputed')").bind(Date.now(),JSON.stringify({summary:'作者撤回精选申请',decision:'cancelled'}),key,user.id).run();
        return json({message:'已撤回精选申请'});
      }
      if(method==="POST"&&action==="submit"){await requireUnlocked("project",key);await requireOfferSource(key);}
      must(courseRequest?project.kind==="course":project.kind!=="course",404,"内容类型与入口不符");
      if(method==="PATCH" && !action) {
        await throttle(user.id,"revision",20);
        const input=courseRequest?courseSchema.parse(await data(request,1048576)):(project.kind==="resource"?resourceSchema:projectSchema).parse(await data(request));await checkFiles(input.fileIds,user.id);if(input.coverFileId)await readCover(input.coverFileId,user.id);
        if(courseRequest)await checkCourseProject(input as z.infer<typeof courseSchema>);
        const previous=(await db.select().from(s.revisions).where(eq(s.revisions.id,project.headId!)).get())!;
        const revisionId=id(),snapshot=JSON.stringify(input),now=Date.now();
        const write=await env.DB!.batch([
          env.DB!.prepare("INSERT INTO revisions(id,project_id,number,snapshot,digest,status,created_at) SELECT ?,?,?,?,?,'draft',? WHERE EXISTS(SELECT 1 FROM projects WHERE id=? AND head_id=?)")
            .bind(revisionId,key,previous.number+1,snapshot,await digest(snapshot),now,key,previous.id),
          env.DB!.prepare("UPDATE projects SET head_id=?,updated_at=? WHERE id=? AND head_id=?").bind(revisionId,now,key,previous.id),
        ]);
        must(write[0].meta.changes===1,409,"内容已在另一处更新，请刷新后继续编辑");
        return json({id:key,revisionId,status:"draft"},201);
      }
      if(method==="POST" && action==="submit") {
        await throttle(user.id,"submit",15);
        const rev=(await db.select().from(s.revisions).where(eq(s.revisions.id,project.headId!)).get())!;
        must(rev.status==="draft",409,"该版本已送审；修改后会生成新版本");
        const input=courseRequest?courseSchema.parse(JSON.parse(rev.snapshot)):(project.kind==="resource"?resourceSchema:projectSchema).parse(JSON.parse(rev.snapshot));
        if(project.kind==='resource')must(resourceSchema.parse(input).verification,422,'请标明当前版本已完成的核验步骤、适用范围及未核验部分；尚未核验也可如实填写');
        if(courseRequest) {
          const course=input as z.infer<typeof courseSchema>,lessons=course.modules.flatMap(m=>m.lessons);
          must(lessons.length>0,422,"课程至少包含一个章节");
          must(lessons.every(l=>l.body.length>=40||l.links.length>0),422,"每章请提供至少40字正文或公开学习资料链接");
          must(course.prerequisites.length>=10 && course.outcomes.length>=10,422,"请写清前置基础和学习目标，各至少10字");
        } else must(input.links.length||input.fileIds.length,422,"请至少附一个资料链接或工程附件");
        if(courseRequest)must(input.instructions.length>=30,422,"请补充至少30字的学习与运行说明");
        const oversized=new TextEncoder().encode(rev.snapshot).length>55000;
        const job={id:id()},state=oversized?"disputed":"queued",now=Date.now();
        const result=oversized?JSON.stringify({summary:"内容超过单次自动审核长度，完整资料已保留，进入人工复核；未截断正文或产生模型费用"}):null;
        const queued=await env.DB!.batch([
          env.DB!.prepare("INSERT INTO reviews(id,entity_type,entity_id,owner_id,snapshot,digest,state,result,created_at,updated_at) SELECT ?,'revision',?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM revisions WHERE id=? AND status='draft')")
            .bind(job.id,rev.id,user.id,rev.snapshot,rev.digest,state,result,now,now,rev.id),
          env.DB!.prepare("UPDATE revisions SET status=? WHERE id=? AND status='draft'").bind(state,rev.id),
        ]);
        must(queued[0].meta.changes===1,409,"该版本已送审");
        if(oversized)return json({reviewId:job.id,status:"disputed",message:"资料完整性检查通过；内容较长，已保留全文并转人工复核"});
        return json({reviewId:job.id,status:"queued",message:"规则检查通过，已进入内容审核队列"});
      }
    }
    if(root==="files"||root==="covers"||root==="course-images") {
      if(root==="files"&&method==="POST" && !key) {
        must(user,401,"请先登录");must(env.BUCKET,503,"附件存储未配置");await throttle(user.id,"upload",12);
        must(Number(request.headers.get("Content-Length")??0)<=11*1024*1024,413,"附件不能超过10MB");
        const form=await request.formData(),file=form.get("file");must(file instanceof File,422,"请附加文件");
        must(file.size>0&&file.size<=10*1024*1024,413,"附件必须在1字节至10MB之间");
        const name=file.name.replace(/[\\/\x00-\x1f]/g,"_").slice(0,160);
        must(/\.(zip|7z|epro2|epro|pdf|md|txt|csv|json|c|h|ino|py|bin|hex|elf|png|jpg|jpeg|webp)$/i.test(name),422,"此文件类型暂不支持");
        const quota=await env.DB!.prepare("SELECT COALESCE(SUM(size),0) AS total FROM files WHERE owner_id=?").bind(user.id).first<{total:number}>();
        must((quota?.total??0)+file.size<=100*1024*1024,413,"账号附件总额度为100MB");
        const bytes=await file.arrayBuffer();if(form.get("purpose")==="cover")inspectCover(new Uint8Array(bytes));const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),v=>v.toString(16).padStart(2,"0")).join("");
        const fileId=id();await env.BUCKET.put(fileId,bytes,{httpMetadata:{contentType:"application/octet-stream"}});
        await db.insert(s.files).values({id:fileId,ownerId:user.id,name,size:file.size,digest:hash,createdAt:Date.now()});
        return json({id:fileId,name,size:file.size,digest:hash},201);
      }
      if(method==="GET"&&key) {
        const f=await db.select().from(s.files).where(eq(s.files.id,key)).get();must(f,404,"附件不存在");
        let allowed=user?.id===f.ownerId||user?.admin;
        if(!allowed){const row=root==="course-images"?await env.DB!.prepare("SELECT 1 present FROM projects p JOIN revisions r ON r.id=p.published_id WHERE p.kind='course' AND p.deleted_at IS NULL AND p.admin_lock_at IS NULL AND r.status='published' AND EXISTS(SELECT 1 FROM json_each(r.snapshot,'$.fileIds') WHERE value=?) LIMIT 1").bind(key).first():await env.DB!.prepare("SELECT 1 present FROM projects p JOIN revisions r ON r.id=p.published_id WHERE p.deleted_at IS NULL AND p.admin_lock_at IS NULL AND r.status='published' AND (json_extract(r.snapshot,'$.coverFileId')=? OR (?=1 AND EXISTS(SELECT 1 FROM json_each(r.snapshot,'$.fileIds') WHERE value=?))) LIMIT 1").bind(key,root==="files"?1:0,key).first();allowed=!!row;}
        must(allowed,404,"附件未公开");const object=await env.BUCKET?.get(key);must(object,404,"附件数据不存在");
        if(root==="covers"||root==="course-images"){const bytes=new Uint8Array(await object.arrayBuffer()),image=root==="course-images"?inspectCourseImage(bytes):inspectCover(bytes);return new Response(bytes,{headers:{"Content-Type":image.mime,"Content-Disposition":"inline","X-Content-Type-Options":"nosniff","Cache-Control":"private, no-store","Content-Security-Policy":"default-src 'none'; sandbox"}});}
        return new Response(object.body as any,{headers:{"Content-Type":"application/octet-stream","Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,"X-Content-Type-Options":"nosniff","Cache-Control":"private, no-store"}});
      }
    }
    if(root==="topics") {
      if(method==="GET"&&!key) {
        const projectFilter=new URL(request.url).searchParams.get("projectId");
        if(!projectFilter)return json({items:[],message:"独立论坛已停用，请在项目下参与讨论"});
        await requireUnlocked("project",projectFilter);
        const rows=await db.select({topic:s.topics,author:s.users.name}).from(s.topics).leftJoin(s.users,eq(s.topics.ownerId,s.users.id))
          .where(and(projectFilter?eq(s.topics.projectId,projectFilter):undefined,expression`${s.topics.deletedAt} is null AND ${s.topics.adminLockAt} is null`,user?or(eq(s.topics.status,"published"),eq(s.topics.ownerId,user.id)):eq(s.topics.status,"published"))).orderBy(desc(s.topics.createdAt)).limit(100);
        const items=[];
        for(const r of rows) {const n=await env.DB!.prepare("SELECT COUNT(*) as n FROM replies WHERE topic_id=? AND status='published' AND deleted_at IS NULL AND admin_lock_at IS NULL").bind(r.topic.id).first<{n:number}>();items.push({...r.topic,author:r.author??"社区成员",replyCount:n?.n??0});}
        return json({items});
      }
      if(method==="GET"&&key) {
        const topic=await db.select().from(s.topics).where(eq(s.topics.id,key)).get();
        if(topic?.projectId)await requireUnlocked("project",topic.projectId);
        must(topic&&!topic.deletedAt&&(!topic.adminLockAt||topic.ownerId===user?.id||user?.admin)&&(topic.status==="published"||topic.ownerId===user?.id||user?.admin),404,"讨论不存在或待审核");
        const rows=await db.select({reply:s.replies,name:s.users.name}).from(s.replies).leftJoin(s.users,eq(s.replies.ownerId,s.users.id))
          .where(and(expression`${s.replies.deletedAt} is null AND ${s.replies.adminLockAt} is null`,eq(s.replies.topicId,key),user?or(eq(s.replies.status,"published"),eq(s.replies.ownerId,user.id)):eq(s.replies.status,"published"))).limit(200);
        const author=await db.select().from(s.users).where(eq(s.users.id,topic.ownerId)).get();
        const votes=await env.DB!.prepare("SELECT COUNT(*) n,MAX(CASE WHEN user_id=? THEN 1 ELSE 0 END) mine FROM quality_votes WHERE topic_id=?").bind(user?.id??"",key).first<any>();
        return json({topic:{...topic,author:publicName(author),recommendCount:votes?.n??0,recommended:!!votes?.mine},replies:rows.map(r=>({...r.reply,author:r.name??"社区成员"}))});
      }
      must(user,401,"请先登录后参与讨论");
      if(method==="POST"&&(!key||action==="replies")) {
        await throttle(user.id,key?"reply":"topic",key?30:6);
        await throttle(user.id,"post-cooldown",1,10000);
        const body=await data(request),content=z.string().trim().min(5).max(6000).parse(body.body);
        let snapshot:string,entityId=id(),type:string;
        const hash=await digest(content),fresh=Date.now()-user.createdAt<86400000;let status=forumDecision(content,fresh);
        const duplicate=await db.select().from(s.topics).where(and(eq(s.topics.ownerId,user.id),eq(s.topics.digest,hash))).get()
          ??await db.select().from(s.replies).where(and(eq(s.replies.ownerId,user.id),eq(s.replies.digest,hash))).get();
        must(!duplicate,409,"这段内容已经发布过");
        if(!key) {
          const title=z.string().trim().min(3).max(100).parse(body.title),board=z.enum(boards).parse(body.board);
          status=forumDecision(`${title}\n${content}`,fresh);
          const projectId=z.string().uuid().parse(body.projectId);
          await requireUnlocked("project",projectId);
          if(projectId) {const p=await db.select().from(s.projects).where(eq(s.projects.id,projectId)).get();must(p?.publishedId&&!p.deletedAt&&!p.adminLockAt,422,"关联项目尚未公开");}
          const row={id:entityId,ownerId:user.id,projectId,board,title,body:content,status,digest:hash,createdAt:Date.now()};
          await db.insert(s.topics).values(row);snapshot=JSON.stringify({title,body:content,board,projectId});type="topic";
        } else {
          const topic=await db.select().from(s.topics).where(eq(s.topics.id,key)).get();must(topic?.status==="published"&&!topic.deletedAt&&!topic.adminLockAt&&topic.projectId,404,"只能回复已公开的项目讨论");
          await requireUnlocked("project",topic.projectId);
          const row={id:entityId,topicId:key,ownerId:user.id,body:content,status,digest:hash,createdAt:Date.now()};
          await db.insert(s.replies).values(row);snapshot=JSON.stringify({topicTitle:topic.title,topicBody:topic.body,body:content});type="reply";
        }
        const job=await review(type,entityId,user.id,snapshot,hash);
        return json({id:entityId,status:"queued",reviewId:job.id,message:"已提交实时AI审核，通过后公开；结果会通过站内通知反馈"},201);
      }
    }
    if(root==="reports"&&method==="GET") {
      must(user,401,"请先登录");
      const rows=await env.DB!.prepare("SELECT p.id,p.reason,p.created_at,r.state,r.result,r.snapshot,r.entity_type,r.entity_id FROM reports p LEFT JOIN reviews r ON r.id=p.review_id WHERE p.reporter_id=? ORDER BY p.created_at DESC LIMIT 100").bind(user.id).all<any>();
      return json({items:await Promise.all(rows.results.map(async r=>{
        const snapshot=JSON.parse(r.snapshot??'{}'),result=JSON.parse(r.result??'{}');
        let href:string|undefined;
        if(r.entity_type==='revision'){const p=await env.DB!.prepare("SELECT p.id,p.kind FROM revisions r JOIN projects p ON p.id=r.project_id WHERE r.id=?").bind(r.entity_id).first<any>();if(p)href=`/${p.kind==='course'?'courses':'projects'}/${p.id}`;}
        else{const t=await env.DB!.prepare(r.entity_type==='topic'?"SELECT id,project_id FROM topics WHERE id=?":"SELECT t.id,t.project_id FROM replies r JOIN topics t ON t.id=r.topic_id WHERE r.id=?").bind(r.entity_id).first<any>();if(t?.project_id)href=`/projects/${t.project_id}#discussion-${t.id}`;}
        const resolved=['approved','cancelled','superseded'].includes(r.state);
        return {id:r.id,reason:r.reason,createdAt:r.created_at,title:snapshot.title??snapshot.target?.title??'内容举报',resolved,summary:resolved?result.summary:undefined,href};
      }))});
    }
    if(root==="reports"&&method==="POST") {
      must(user,401,"请先登录");await throttle(user.id,"report",10);
      const body=z.object({entityType:z.enum(["revision","topic","reply"]),entityId:z.string().uuid(),reason:z.string().trim().min(2).max(1000)}).parse(await data(request));
      const target=await entitySnapshot(body.entityType,body.entityId);must(target,404,"待举报内容不存在或未公开");
      const existing=await db.select().from(s.reports).where(and(eq(s.reports.reporterId,user.id),eq(s.reports.entityType,body.entityType),eq(s.reports.entityId,body.entityId))).get();
      must(!existing,409,"你已举报过该内容");
      if(body.entityType==="revision"){
        const job=await review("revision",body.entityId,target.ownerId,target.snapshot,target.digest,"disputed",{summary:"收到内容举报，待管理员核对；原公开内容保持可见"},"report",{reportReason:body.reason});
        await db.insert(s.reports).values({id:id(),reporterId:user.id,...body,reviewId:job.id,createdAt:Date.now()});
        await alertAdmins(`project-report:${job.id}`,"收到项目资料问题反馈",`审核编号：${job.id}。举报说明：${body.reason}。请核对原文及证据。`,job.id);
      }else{
        const prior=await env.DB!.prepare("SELECT id FROM reviews WHERE task='report' AND entity_type=? AND entity_id=? AND digest=? AND state IN ('queued','running','disputed') LIMIT 1").bind(body.entityType,body.entityId,target.digest).first<{id:string}>();
        const job=prior??await enqueueReview(body.entityType,body.entityId,target.ownerId,JSON.stringify({task:"report",target:JSON.parse(target.snapshot),reportReason:body.reason}),target.digest,{task:"report",lane:"discussion"});
        await db.insert(s.reports).values({id:id(),reporterId:user.id,...body,reviewId:job.id,createdAt:Date.now()});
      }
      await notify(user.id,`report-received:${body.entityType}:${body.entityId}:${user.id}`,{title:"举报已受理",body:"你的举报已保存，核验期间内容不会仅因举报而下架。可在“我的举报”查看进度，处理结果会通过站内消息和默认开启的邮件通知反馈。"},{href:"/reports"});
      return json({message:"举报已受理，可在“我的举报”查看进度；核实后才会处理内容"},201);
    }
    if(root==="reviews"&&method==="POST"&&action==="appeal") {
      must(user,401,"请先登录");await throttle(user.id,"appeal",8);
      const row=await db.select().from(s.reviews).where(eq(s.reviews.id,key)).get();const feedbackOwner=await env.DB!.prepare("SELECT id FROM technical_feedback WHERE review_id=? AND commenter_id=? LIMIT 1").bind(key,user.id).first();
      must(row&&(row.ownerId===user.id||feedbackOwner),404,"审核记录不存在");
      must(["needs_changes","disputed"].includes(row.state),409,"该审核当前不可申诉");
      const body=z.object({reason:z.string().trim().min(10).max(1500)}).parse(await data(request));
      await db.update(s.reviews).set({appeal:body.reason,state:"disputed",updatedAt:Date.now()}).where(eq(s.reviews.id,key));return json({message:"申诉已进入争议队列"});
    }
    if(root==="reviews" && method==="GET" && key) {
      const row=await db.select().from(s.reviews).where(eq(s.reviews.id,key)).get();
      must(user?.admin,403,"审核详情仅管理员可见");must(row,404,"审核记录不存在");
      return json({...row,snapshot:JSON.parse(row.snapshot),result:row.result?JSON.parse(row.result):null});
    }
    if(root==="admin") {
      must(user?.admin,403,"需要维护者权限");
      if(key==="budget"&&method==="GET") {
        return json(await reviewBudget());
      }
      if(key==="reviews"&&action&&method==="POST") {
        const operation=path[3];
        if(operation==='run'){
          const queued=await db.select().from(s.reviews).where(eq(s.reviews.id,action)).get();must(queued,404,'审核记录不存在');
          must(['queued','running'].includes(queued.state),409,'该任务当前不在自动审核队列');
          if(queued.state==='queued'&&queued.task==='publish'&&queued.entityType==='revision'){
            const revision=await db.select().from(s.revisions).where(eq(s.revisions.id,queued.entityId)).get();
            const project=revision?await db.select().from(s.projects).where(eq(s.projects.id,revision.projectId)).get():null;
            if(project&&project.headId!==revision?.id)return json(await runReview(action));
          }
          await drainQueue();return json({reviewId:action,state:queued.state,message:'已唤醒审核队列，结果会通过站内通知反馈；作品审核遵守低价时段'});
        }
        const row=await db.select().from(s.reviews).where(eq(s.reviews.id,action)).get();must(row,404,"记录不存在");
        must(row.state!=="running",409,"AI审核正在执行，暂不能人工覆盖");
        const body=z.object({decision:z.enum(["pass","revise","disputed"]),reason:z.string().trim().min(10).max(1500),taxonomy:taxonomyPlanSchema.optional()}).parse(await data(request));
        const claimed=await env.DB!.prepare("UPDATE reviews SET state='running',updated_at=? WHERE id=? AND state=? RETURNING id").bind(Date.now(),row.id,row.state).first();
        must(claimed,409,"审核记录已被其他任务更新");
        try{
          if(row.task!=="publish")throw new HTTPError(422,"请使用该任务的专用人工处理表单");
          if(row.entityType==="revision"&&body.decision==="revise"){const target=await env.DB!.prepare("SELECT p.id FROM projects p WHERE p.published_id=?").bind(row.entityId).first<{id:string}>();if(target){const {moderateContent}=await import("./moderation-controls");await moderateContent("project",target.id,user.id,body.reason);}}
          await applyDecision(row,body.decision,{taxonomy:body.taxonomy,actorId:user.id,reason:body.reason,humanReason:body.reason});
          await notify(row.ownerId,`human-review:${row.id}:${Date.now()}`,{title:body.decision==="pass"?"作品人工复核通过":body.decision==="revise"?"内容人工复核未通过":"审核待进一步核对",body:body.reason},{href:"/dashboard",reviewId:row.id,revise:body.decision==="revise"});
        }
        catch(error){await db.update(s.reviews).set({state:row.state,updatedAt:Date.now()}).where(and(eq(s.reviews.id,row.id),eq(s.reviews.state,"running")));throw error;}
        return json({message:"审核决定已记录"});
      }
      if(key==="featured"&&method==="POST") {
        const body=z.object({projectId:z.string().uuid(),criteria:z.array(z.enum(["competition","teaching","depth","creativity"])).min(1).max(4),evidence:z.string().trim().min(10).max(3000)}).parse(await data(request));
        return json(await nominateFeatured(body.projectId,body.criteria,body.evidence,user.id));
      }
      if(key==="featured"&&action&&method==="DELETE") {await cancelFeatured(action);return json({message:"已取消精选及待处理提名，项目保留"});}
    }
    return json({error:"接口不存在"},404);
  } catch(error) {
    if(error instanceof HTTPError) return json({error:error.message},error.status);
    if(error instanceof z.ZodError) return json({error:"请检查输入",fields:error.flatten()},422);
    const requestId=logApiFailure(new URL(request.url).pathname.split('/')[2]??'unknown',error);
    return json({error:"服务暂时不可用，请稍后重试",requestId},500);
  }
}
