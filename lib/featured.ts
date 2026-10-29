import {env} from "cloudflare:workers";
import {HTTPError} from "./domain";
import {notify} from "./notifications";
import courseTexts from "../content/trusted-course-review-texts.json";
import type {ReviewFile} from "./review-files";

export async function nominateFeatured(projectId:string,criteria:string[],evidence:string,actorId:string){
  const sql=env.DB!,p=await sql.prepare("SELECT p.owner_id,p.published_id,r.snapshot,r.digest FROM projects p JOIN revisions r ON r.id=p.published_id WHERE p.id=? AND p.kind='project' AND p.deleted_at IS NULL AND p.admin_lock_at IS NULL").bind(projectId).first<any>();
  if(!p)throw new HTTPError(422,"只有已有公开版本且未下架的项目可以提交精选评估");
  const courses=await sql.prepare("SELECT p.id,r.id revision_id,r.snapshot FROM projects p JOIN revisions r ON r.id=p.published_id WHERE p.kind='course' AND p.deleted_at IS NULL AND p.admin_lock_at IS NULL AND json_extract(r.snapshot,'$.projectId')=?").bind(projectId).all<any>();
  const context={projectId,revisionId:p.published_id,requestedBy:actorId,criteria:[...new Set(criteria)],evidence,assessmentMode:"evidence_driven"};
  const snapshot=JSON.stringify({task:"featured",title:JSON.parse(p.snapshot).title,nomination:{criteria:context.criteria,evidence},relatedCourses:courses.results.map(c=>({id:c.id,revisionId:c.revision_id,...JSON.parse(c.snapshot)}))});
  const id=crypto.randomUUID(),now=Date.now();
  await sql.prepare("INSERT INTO reviews(id,entity_type,entity_id,owner_id,snapshot,digest,state,created_at,updated_at,task,lane,context) SELECT ?,'revision',?,?,?,?,'queued',?,?,'featured','project',? WHERE NOT EXISTS(SELECT 1 FROM reviews WHERE entity_id=? AND task='featured' AND state IN ('queued','running','disputed'))")
    .bind(id,p.published_id,p.owner_id,snapshot,p.digest,now,now,JSON.stringify(context),p.published_id).run();
  const job=await sql.prepare("SELECT id,state FROM reviews WHERE entity_id=? AND task='featured' AND state IN ('queued','running','disputed') ORDER BY created_at DESC LIMIT 1").bind(p.published_id).first<any>();
  return {reviewId:job.id,state:job.state,message:job.id===id?"已提交精选评估，通过前不会加入精选":"该公开版本已有精选评估，无需重复提交"};
}
export function featuredCourseFiles(snapshot:any):ReviewFile[]{
  const files:ReviewFile[]=[];
  for(const course of snapshot.relatedCourses??[]){
    for(const module of course.modules??[])for(const lesson of module.lessons??[]){
      const imported=(courseTexts as Record<string,Record<string,string>>)[course.id+":"+course.revisionId]?.[lesson.id];
      const text=imported??lesson.body;
      if(text){const value=`课程：${course.title}\n模块：${module.title}\n章节：${lesson.title}\n${text}`;files.push({name:`courses/${course.id}/${lesson.id}.txt`,size:new TextEncoder().encode(value).length,read:async()=>value});}
    }
  }
  return files;
}
export async function resolveFeatured(review:any,result:any,actorId?:string){
  const sql=env.DB!,context=JSON.parse(review.context??"{}"),now=Date.now();
  const confirmed=result.criteriaConfirmed??[];
  if(result.decision==='qualify'&&(!confirmed.length||confirmed.some((c:string)=>!context.criteria.includes(c))))throw new HTTPError(422,"精选依据必须对应本次所选指标");
  if(!actorId&&result.decision==='qualify'&&(!result.investigation?.evidenceSufficient||result.investigation.unresolvedQuestions.length))throw new HTTPError(422,"精选入选需要充分证据，不能留下影响结论的关键疑点");
  const expected=actorId?'disputed':'running';
  const guard="EXISTS(SELECT 1 FROM projects p JOIN revisions r ON r.id=p.published_id WHERE p.id=? AND p.published_id=? AND r.digest=? AND p.deleted_at IS NULL AND p.admin_lock_at IS NULL)";
  const binds=[context.projectId,context.revisionId,review.digest];
  const statements:D1PreparedStatement[]=[];
  if(result.decision==='qualify')statements.push(sql.prepare(`INSERT INTO selections(project_id,revision_id,criteria,evidence,actor_id,created_at) SELECT ?,?,?,?,?,? WHERE ${guard} AND EXISTS(SELECT 1 FROM reviews WHERE id=? AND state=?) ON CONFLICT(project_id) DO UPDATE SET revision_id=excluded.revision_id,criteria=excluded.criteria,evidence=excluded.evidence,actor_id=excluded.actor_id,created_at=excluded.created_at`)
    .bind(context.projectId,context.revisionId,JSON.stringify(confirmed),context.evidence,actorId??'ai:featured',now,...binds,review.id,expected));
  statements.push(sql.prepare(`UPDATE reviews SET state=?,result=?,updated_at=? WHERE id=? AND state=? AND ${guard}`).bind(result.decision==='disputed'?'disputed':'approved',JSON.stringify(result),now,review.id,expected,...binds));
  const applied=await sql.batch(statements);
  if(!applied[applied.length-1].meta.changes)throw new HTTPError(409,"精选提名已取消、版本已变化或作品已下架，本次不入选");
  const notice=result.authorNotice??{title:result.decision==='qualify'?'作品通过精选评估':result.decision==='disputed'?'精选评估待人工复核':'本次暂未入选精选',body:result.summary};
  for(const recipient of new Set<string>([review.ownerId??review.owner_id,context.requestedBy].filter(Boolean)))await notify(recipient,`featured:${review.id}:${recipient}`,notice,{reviewId:review.id,href:`/projects/${context.projectId}`});
}
export async function cancelFeatured(projectId:string){
  const sql=env.DB!,now=Date.now();
  await sql.batch([
    sql.prepare("UPDATE reviews SET state='cancelled',result=?,updated_at=? WHERE task='featured' AND json_extract(context,'$.projectId')=? AND state IN ('queued','running','disputed')").bind(JSON.stringify({summary:"精选提名已取消",decision:"cancelled"}),now,projectId),
    sql.prepare("DELETE FROM selections WHERE project_id=?").bind(projectId)
  ]);
}
