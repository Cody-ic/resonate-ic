import {env} from "cloudflare:workers";
import {z} from 'zod/v3';
import {cleanNotice,noticeSchema} from "./review-results";
import {queueEmail,mailSettings} from './mail-service';
import {notificationEmail,notificationEmailEnabled,adminIds,adminEmails,reviseContact} from './notification-policy';
export {userEmail} from './notification-policy';
export {mailSettings,mailConfigured,mailMode,mailDeliveryEnabled,mailVerificationAvailable,mailVerificationRequired,canSendMailTo,mailHealth,queueEmail,dispatchMail,kickMailQueue,nextMailWake} from './mail-service';
export async function notificationLinks(row:any,recipient:{id:string;admin:boolean}){
  const moderation=row.kind==='moderation'?row.event_key?.match(/^moderation:(project|course|resource|topic|reply):([^:]+):/):null;
  if(moderation){
    const type=moderation[1],id=moderation[2],table=['project','course','resource'].includes(type)?'projects':type==='topic'?'topics':'replies';
    const content=await env.DB!.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(id).first<any>();
    if(content){
      let href=table==='projects'?`/${content.kind==='course'?'courses':'projects'}/${id}`:undefined;
      if(!href){const topic=type==='topic'?content:await env.DB!.prepare("SELECT id,project_id FROM topics WHERE id=?").bind(content.topic_id).first<any>();if(topic?.project_id)href=`/projects/${topic.project_id}#discussion-${topic.id}`;}
      return {...row,href,appealTarget:content.owner_id===recipient.id&&content.admin_lock_at?{entityType:type,entityId:id}:undefined};
    }
  }
  if(!row.review_id)return {...row,href:row.href==='/dashboard'?undefined:row.href};
  const review=await env.DB!.prepare("SELECT entity_type,entity_id,owner_id,context,task,state FROM reviews WHERE id=?").bind(row.review_id).first<any>();
  if(!review)return row;
  const reviewHref=recipient.admin?`/reviews/${row.review_id}`:undefined;
  if(recipient.admin&&row.kind==='admin')row.href=reviewHref;
  row={...row,...(review.owner_id===recipient.id&&review.task==='publish'&&['needs_changes','disputed'].includes(review.state)?{appealTarget:{reviewId:row.review_id}}:{})};
  if(row.href?.startsWith('/dashboard?review='))row.href='/dashboard';
  if(!["/dashboard","/",""].includes(row.href))return {...row,reviewHref};
  let projectId:string|undefined;
  if(review.entity_type==="revision")projectId=(await env.DB!.prepare("SELECT project_id FROM revisions WHERE id=?").bind(review.entity_id).first<{project_id:string}>())?.project_id;
  else if(review.entity_type==="technical_check")projectId=JSON.parse(review.context??"{}").projectId;
  else{
    let type=review.entity_type,id=review.entity_id;
    if(type.endsWith("_edit")){const e=await env.DB!.prepare("SELECT entity_type,entity_id FROM forum_edits WHERE id=?").bind(id).first<any>();if(e){type=e.entity_type;id=e.entity_id;}}
    const topic=type==="topic"?await env.DB!.prepare("SELECT id,project_id FROM topics WHERE id=?").bind(id).first<any>():type==="reply"?await env.DB!.prepare("SELECT t.id,t.project_id FROM topics t JOIN replies r ON r.topic_id=t.id WHERE r.id=?").bind(id).first<any>():null;
    if(topic?.project_id)return {...row,href:`/projects/${topic.project_id}#discussion-${topic.id}`,reviewHref,relatedKind:"project"};
  }
  if(projectId){const p=await env.DB!.prepare("SELECT kind FROM projects WHERE id=?").bind(projectId).first<{kind:string}>();if(p)return {...row,href:`/${p.kind==="course"?"courses":"projects"}/${projectId}`,reviewHref,relatedKind:p.kind};}
  return {...row,href:reviewHref,reviewHref};
}
export async function notify(recipientId:string,eventKey:string,notice:{title:string;body:string},options:{reviewId?:string;href?:string;draft?:boolean;kind?:string;revise?:boolean;mailEventKey?:string;wakeMail?:boolean}={}){
  const parsed=noticeSchema.parse(notice),id=crypto.randomUUID();
  const title=cleanNotice(parsed.title),body=options.revise?reviseContact(cleanNotice(parsed.body)):cleanNotice(parsed.body),emailEnabled=await notificationEmailEnabled(recipientId);
  const inserted=await env.DB!.prepare("INSERT INTO notifications(id,event_key,recipient_id,review_id,title,body,href,state,kind,created_at,email_enabled) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(event_key) DO NOTHING RETURNING id")
    .bind(id,eventKey,recipientId,options.reviewId??null,title,body,options.href?.startsWith("/")&&!options.href.startsWith("//")?options.href:"/dashboard",options.draft?"draft":"ready",options.kind??"review",Date.now(),emailEnabled?1:0).first<{id:string}>();
  const row=await env.DB!.prepare('SELECT id,title,body,state,email_enabled FROM notifications WHERE event_key=? AND recipient_id=?').bind(eventKey,recipientId).first<any>();
  if(row?.state==='ready'&&row.email_enabled&&emailEnabled){const email=await notificationEmail(recipientId);if(email)await queueEmail(options.mailEventKey??"notice:"+row.id,email,row.title,row.body,{notificationId:row.id,wake:options.wakeMail});}
  return inserted?.id;
}
export async function alertAdmins(eventKey:string,title:string,body:string,reviewId?:string,options:{wakeMail?:boolean}={}){
  const covered=new Set<string>();
  for(const uid of adminIds()){
    if(await env.DB!.prepare("SELECT id FROM users WHERE id=?").bind(uid).first()){
      const email=await notificationEmail(uid);
      await notify(uid,eventKey+":"+uid,{title,body},{href:"/admin",reviewId,kind:"admin",mailEventKey:email?eventKey+":"+email:undefined,wakeMail:options.wakeMail});
      if(email)covered.add(email);
    }
  }
  for(const email of adminEmails())if(!covered.has(email))await queueEmail(eventKey+":"+email,email,title,body,{wake:options.wakeMail});
}
export async function notifyDiscussionPublished(type:"topic"|"reply",entityId:string,reviewId:string){
  const sql=env.DB!;
  if(type==="topic"){
    const row=await sql.prepare("SELECT t.owner_id,t.title,t.body,t.id,t.project_id,p.owner_id project_owner FROM topics t JOIN projects p ON p.id=t.project_id WHERE t.id=? AND t.status='published' AND t.deleted_at IS NULL AND t.admin_lock_at IS NULL AND p.deleted_at IS NULL AND p.admin_lock_at IS NULL").bind(entityId).first<any>();
    if(row&&row.owner_id!==row.project_owner)await notify(row.project_owner,`activity:${reviewId}`,{title:"你的作品收到新评论",body:`${row.title}\n\n${row.body.slice(0,1200)}`},{reviewId,href:`/projects/${row.project_id}#discussion-${row.id}`,kind:"comment"});
  }else{
    const row=await sql.prepare("SELECT r.owner_id,r.body,t.owner_id comment_owner,t.project_id,t.id topic_id,t.title FROM replies r JOIN topics t ON t.id=r.topic_id JOIN projects p ON p.id=t.project_id WHERE r.id=? AND r.status='published' AND r.deleted_at IS NULL AND r.admin_lock_at IS NULL AND t.deleted_at IS NULL AND t.admin_lock_at IS NULL AND p.deleted_at IS NULL AND p.admin_lock_at IS NULL").bind(entityId).first<any>();
    if(row&&row.owner_id!==row.comment_owner)await notify(row.comment_owner,`activity:${reviewId}`,{title:"你的评论收到回复",body:`${row.title}\n\n${row.body.slice(0,1200)}`},{reviewId,href:`/projects/${row.project_id}#discussion-${row.topic_id}`,kind:"reply"});
  }
}
export async function approveNotice(id:string,actorId:string,edit?:{title:string;body:string}){
  const row=await env.DB!.prepare("SELECT * FROM notifications WHERE id=? AND state='draft'").bind(id).first<any>();
  if(!row)return false;
  // Reserve room for the platform's support paragraph after the AI's 6000 chars.
  const value=noticeSchema.extend({body:z.string().trim().min(1).max(6400)}).parse(edit??row);
  const emailEnabled=await notificationEmailEnabled(row.recipient_id);
  const updated=await env.DB!.prepare("UPDATE notifications SET state='ready',title=?,body=?,approved_by=?,email_enabled=? WHERE id=? AND state='draft' RETURNING id").bind(cleanNotice(value.title),cleanNotice(value.body),actorId,emailEnabled?1:0,id).first();
  if(updated&&emailEnabled){const to=await notificationEmail(row.recipient_id);if(to)await queueEmail("notice:"+id,to,cleanNotice(value.title),cleanNotice(value.body),{notificationId:id});}
  return !!updated;
}
