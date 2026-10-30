import { env } from "cloudflare:workers";
import { and,eq } from "drizzle-orm";
import { z } from "zod/v3";
import { getDb } from "../db";
import * as s from "../db/schema";
import { boards,digest,forumDecision,HTTPError,json } from "./domain";
import { normalizeSnapshot } from "./classification";
import {requireUnlocked} from "./moderation-controls";
type Actor={id:string;createdAt:number;admin:boolean};
const contentKinds=["project","resource","course","topic","reply"];
const publicDiscussionProject="(t.project_id IS NULL OR EXISTS(SELECT 1 FROM projects p WHERE p.id=t.project_id AND p.deleted_at IS NULL AND p.admin_lock_at IS NULL AND p.published_id IS NOT NULL))";
export async function profile(id:string,privateView=false){
  const u=await getDb().select().from(s.users).where(eq(s.users.id,id)).get();
  if(!u)throw new HTTPError(404,"用户不存在");
  const counts:Record<string,number>={};
  for(const kind of contentKinds){
    if(privateView){const table=kind==='topic'?'topics':kind==='reply'?'replies':'projects';const q=`SELECT COUNT(*) n FROM ${table} WHERE owner_id=? AND deleted_at IS NULL${table==='projects'?' AND kind=?':''}`;const row=await env.DB!.prepare(q).bind(id,...(table==='projects'?[kind]:[])).first<{n:number}>();counts[kind]=row?.n??0;continue;}
    const query=kind==="topic"?`SELECT COUNT(*) n FROM topics t WHERE t.owner_id=? AND t.deleted_at IS NULL AND t.status='published' AND t.admin_lock_at IS NULL AND ${publicDiscussionProject}`:kind==="reply"?`SELECT COUNT(*) n FROM replies x JOIN topics t ON t.id=x.topic_id WHERE x.owner_id=? AND x.deleted_at IS NULL AND x.status='published' AND x.admin_lock_at IS NULL AND t.admin_lock_at IS NULL AND t.deleted_at IS NULL AND t.status='published' AND ${publicDiscussionProject}`:"SELECT COUNT(*) n FROM projects p JOIN revisions r ON r.id=p.published_id WHERE p.owner_id=? AND p.kind=? AND p.deleted_at IS NULL AND p.admin_lock_at IS NULL AND r.status='published'";
    const row=await env.DB!.prepare(query).bind(id,...(["topic","reply"].includes(kind)?[]:[kind])).first<{n:number}>();counts[kind]=row?.n??0;
  }
  return {user:u,counts};
}
export async function authorContent(owner:string,params:URLSearchParams,privateView=false){
  const kind=params.get("kind")??"project",deleted=privateView&&params.get("state")==="deleted";
  if(!contentKinds.includes(kind))throw new HTTPError(422,"内容类型不支持");
  const offset=Math.max(0,Math.min(1000000,Number(params.get("offset"))||0)),limit=24;
  let from:string,where:string,select:string,args:unknown[]=[owner];
  const deletion=`${deleted?'IS NOT NULL':'IS NULL'}`;
  if(kind==="topic"){
    from="FROM topics x";where=`x.owner_id=? AND x.deleted_at ${deletion}${privateView?"":` AND x.status='published' AND x.admin_lock_at IS NULL AND ${publicDiscussionProject.replaceAll('t.project_id','x.project_id')}`}`;
    select="x.project_id AS projectId,x.admin_lock_at AS adminLockAt,x.admin_reason AS adminReason,x.id,x.title,x.body,x.board,x.status,x.created_at AS updatedAt,x.deleted_at AS deletedAt,x.owner_id AS ownerId,x.head_edit_id AS headEditId";
  }else if(kind==="reply"){
    from="FROM replies x JOIN topics t ON t.id=x.topic_id";where=`x.owner_id=? AND x.deleted_at ${deletion}${privateView?"":` AND x.status='published' AND x.admin_lock_at IS NULL AND t.status='published' AND t.deleted_at IS NULL AND t.admin_lock_at IS NULL AND ${publicDiscussionProject}`}`;
    select="t.project_id AS projectId,x.admin_lock_at AS adminLockAt,x.admin_reason AS adminReason,x.id,t.title,x.topic_id AS topicId,x.body,x.status,x.created_at AS updatedAt,x.deleted_at AS deletedAt,x.owner_id AS ownerId,x.head_edit_id AS headEditId,t.deleted_at AS parentDeletedAt";
  }else{
    from=`FROM projects x JOIN revisions r ON r.id=x.${privateView?'head_id':'published_id'} LEFT JOIN revision_taxonomy rt ON rt.revision_id=r.id AND rt.digest=r.digest`;
    where=`x.owner_id=? AND x.kind=? AND x.deleted_at ${deletion}${privateView?"":" AND r.status='published' AND x.admin_lock_at IS NULL"}`;args.push(kind);
    select="x.admin_lock_at AS adminLockAt,x.admin_reason AS adminReason,x.id,x.owner_id AS ownerId,x.deleted_at AS deletedAt,x.updated_at AS updatedAt,r.id AS revisionId,r.status,r.snapshot,rt.resolved";
  }
  const count=await env.DB!.prepare(`SELECT COUNT(*) n ${from} WHERE ${where}`).bind(...args).first<{n:number}>();
  const {results}=await env.DB!.prepare(`SELECT ${select} ${from} WHERE ${where} ORDER BY ${['topic','reply'].includes(kind)?'x.created_at':'x.updated_at'} DESC,x.id DESC LIMIT ? OFFSET ?`).bind(...args,limit,offset).all<any>();
  const items=results.map(({snapshot,resolved,...row})=>({...row,...(snapshot?normalizeSnapshot(JSON.parse(snapshot)):{}),...(resolved?JSON.parse(resolved):{}),kind}));
  return {items,total:count?.n??0,nextOffset:offset+items.length<(count?.n??0)?offset+items.length:null};
}
export async function manageContent(request:Request,path:string[],user:Actor|null){
  const [root,key,action]=path,method=request.method,db=getDb();
  if(root==="users"&&method==="GET")return json(action==="content"?await authorContent(key,new URL(request.url).searchParams):await profile(key,user?.id===key));
  if(root==="me"&&key==="content"&&method==="GET"){
    if(!user)throw new HTTPError(401,"请先登录");return json(await authorContent(user.id,new URL(request.url).searchParams,true));
  }
  if(!["projects","courses","topics","replies"].includes(root)||!key||!((method==="DELETE"&&!action)||(method==="PATCH"&&!action)||(method==="POST"&&action==="restore")||(method==="GET"&&action==="edit")))return null;
  if(root==="projects"||root==="courses"){
    if(method!=="DELETE"&&!(method==="POST"&&action==="restore"))return null;
    if(!user)throw new HTTPError(401,"请先登录");
    const row=await db.select().from(s.projects).where(eq(s.projects.id,key)).get();
    if(!row)throw new HTTPError(404,"内容不存在");if(method==="POST"&&action==="restore")await requireUnlocked("project",key);if(row.ownerId!==user.id)throw new HTTPError(403,"只能管理自己的内容");
    if((root==="courses")!==(row.kind==="course"))throw new HTTPError(404,"内容类型与入口不符");
    await db.update(s.projects).set({deletedAt:method==="DELETE"?Date.now():null,updatedAt:Date.now()}).where(eq(s.projects.id,key));
    return json({message:method==="DELETE"?"已移入回收站，可在内容管理中恢复":"已恢复内容"});
  }
  const table=root==="topics"?s.topics:s.replies,entityType=root==="topics"?"topic":"reply";
  if(!user)throw new HTTPError(401,"请先登录");
  const row=await db.select().from(table).where(eq(table.id,key)).get();
  if(!row)throw new HTTPError(404,"内容不存在");if(method==="POST"&&action==="restore")await requireUnlocked(root==="topics"?"topic":root==="replies"?"reply":"project",key);if(row.ownerId!==user.id)throw new HTTPError(403,"只能管理自己的帖子和回复");
  if(method==="DELETE"||action==="restore"){
    await db.update(table).set({deletedAt:method==="DELETE"?Date.now():null}).where(eq(table.id,key));
    return json({message:method==="DELETE"?"已移入回收站":"已恢复；审核状态保持原样"});
  }
  if(row.deletedAt)throw new HTTPError(409,"请先恢复内容再编辑");
  const edit=row.headEditId?await db.select().from(s.forumEdits).where(eq(s.forumEdits.id,row.headEditId)).get():null;
  const snapshot=edit?JSON.parse(edit.snapshot):{...row};
  if(method==="GET"&&action==="edit")return json({snapshot,editToken:row.headEditId??row.digest,status:edit?.status??row.status});
  if(method!=="PATCH")return null;
  const schema=z.object({body:z.string().trim().min(1).max(6000),title:z.string().trim().min(3).max(100).optional(),board:z.enum(boards).optional(),editToken:z.string().min(1).max(100)});
  const body=schema.parse(await request.json());
  if(body.editToken!==(row.headEditId??row.digest))throw new HTTPError(409,"内容已更新，请重新打开编辑器");
  const next=entityType==="topic"?{title:body.title??snapshot.title,board:body.board??snapshot.board,body:body.body}:{body:body.body};
  const text=JSON.stringify(next),hash=await digest(text),editId=crypto.randomUUID(),now=Date.now();
  const status=forumDecision(Object.values(next).join('\n'),now-user.createdAt<86400000);
  const tableName=entityType==="topic"?"topics":"replies",raw=env.DB!;
  const statements:D1PreparedStatement[]=[];
  // Preserve the old body even for posts created before versioning existed.
  if(!row.headEditId)statements.push(raw.prepare("INSERT INTO forum_edits(id,entity_type,entity_id,owner_id,snapshot,digest,status,created_at) VALUES(?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(),entityType,key,user.id,JSON.stringify(row),row.digest,row.status,now-1));
  statements.push(raw.prepare(`INSERT INTO forum_edits(id,entity_type,entity_id,owner_id,snapshot,digest,status,created_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM ${tableName} WHERE id=? AND COALESCE(head_edit_id,digest)=? AND deleted_at IS NULL)`).bind(editId,entityType,key,user.id,text,hash,status,now,key,body.editToken));
  statements.push(raw.prepare(`UPDATE ${tableName} SET head_edit_id=?${status==='published'?(entityType==='topic'?',title=?,board=?,body=?,digest=?,status=\'published\'':',body=?,digest=?,status=\'published\''):''} WHERE id=? AND COALESCE(head_edit_id,digest)=? AND deleted_at IS NULL`).bind(editId,...(status==='published'?(entityType==='topic'?[(next as any).title,(next as any).board,next.body,hash]:[next.body,hash]):[]),key,body.editToken));
  const reviewId=crypto.randomUUID();
  statements.push(raw.prepare("INSERT INTO reviews(id,entity_type,entity_id,owner_id,snapshot,digest,state,result,created_at,updated_at,lane) SELECT ?,?,?,?,?,?,?,?,?,?,'discussion' WHERE EXISTS(SELECT 1 FROM forum_edits WHERE id=?)").bind(reviewId,entityType+'_edit',editId,user.id,text,hash,'queued',null,now,now,editId));
  const result=await raw.batch(statements);
  if(!result[statements.length-2].meta.changes)throw new HTTPError(409,"内容已更新，请刷新后再编辑");
  return json({id:key,editId,status,message:"修改已提交AI审核，期间保留原公开版本"});
}
