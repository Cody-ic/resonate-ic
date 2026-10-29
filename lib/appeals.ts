import {env} from "cloudflare:workers";
import {z} from "zod/v3";
import {digest,HTTPError,json} from "./domain";
import {notify,alertAdmins} from "./notifications";
import {moderateContent} from "./moderation-controls";
const tables:Record<string,string>={project:"projects",course:"projects",resource:"projects",topic:"topics",reply:"replies"};
export async function submitContentAppeal(request:Request,user:{id:string}|null){
  if(!user)throw new HTTPError(401,"请先登录后申诉");
  const input=z.object({entityType:z.enum(["project","course","resource","topic","reply"]),entityId:z.string().uuid(),reason:z.string().trim().min(10).max(3000)}).parse(await request.json());
  const sql=env.DB!,row=await sql.prepare(`SELECT * FROM ${tables[input.entityType]} WHERE id=?`).bind(input.entityId).first<any>();
  if(!row||row.owner_id!==user.id)throw new HTTPError(403,"只能申诉自己的内容");
  if(!row.admin_lock_at)throw new HTTPError(409,"该内容当前未被下架");
  const prior=await sql.prepare("SELECT id FROM reviews WHERE task='appeal' AND entity_id=? AND json_extract(context,'$.lockAt')=? AND state='disputed' LIMIT 1").bind(input.entityId,row.admin_lock_at).first<any>();
  if(prior)return json({message:"申诉已在等待管理员处理，无需重复提交",appealId:prior.id});
  const id=crypto.randomUUID(),now=Date.now(),snapshot=JSON.stringify({title:"内容下架申诉",reason:input.reason,moderationReason:row.admin_reason,entityType:input.entityType,entityId:input.entityId}),context={entityType:input.entityType,entityId:input.entityId,lockAt:row.admin_lock_at};
  const inserted=await sql.prepare("INSERT INTO reviews(id,entity_type,entity_id,owner_id,snapshot,digest,state,created_at,updated_at,task,lane,context) SELECT ?,?,?,?,?,?,'disputed',?,?,'appeal','human',? WHERE NOT EXISTS(SELECT 1 FROM reviews WHERE task='appeal' AND entity_id=? AND json_extract(context,'$.lockAt')=? AND state='disputed') RETURNING id").bind(id,input.entityType,input.entityId,user.id,snapshot,await digest(snapshot),now,now,JSON.stringify(context),input.entityId,row.admin_lock_at).first<any>();
  if(inserted){await notify(user.id,`appeal-received:${id}`,{title:"申诉已提交",body:"管理员已收到你的申诉。处理完成前保持当前下架状态，结果会通过站内消息和默认开启的邮件通知告知。"},{kind:"appeal"});await alertAdmins(`appeal:${id}`,"收到内容下架申诉",`申诉编号：${id}\n作者说明：${input.reason}\n原处理理由：${row.admin_reason}`,id);}
  return json({message:"申诉已提交，由管理员处理；AI不会据此恢复内容",appealId:inserted?.id??prior?.id},201);
}
export async function resolveContentAppeal(review:any,decision:string,reason:string,actorId:string){
  if(!['restore','uphold'].includes(decision))throw new HTTPError(422,"请选择解除下架或维持下架");
  const sql=env.DB!,context=JSON.parse(review.context),row=await sql.prepare(`SELECT * FROM ${tables[context.entityType]} WHERE id=?`).bind(context.entityId).first<any>();
  if(!row||row.admin_lock_at!==context.lockAt)throw new HTTPError(409,"下架状态已经变化，请核对最新处理记录");
  if(decision==='restore'){
    const changed=await moderateContent(context.entityType,context.entityId,actorId,reason,true,undefined,context.lockAt);
    if(!changed)throw new HTTPError(409,"下架状态已被其他管理员更新");
  }
  const result={summary:reason,decision,method:"human",actorId};
  await sql.prepare("UPDATE reviews SET state='approved',result=?,updated_at=? WHERE id=? AND state='disputed'").bind(JSON.stringify(result),Date.now(),review.id).run();
  await notify(review.owner_id,`appeal-result:${review.id}`,{title:decision==='restore'?"申诉处理：已解除下架":"申诉处理：维持下架",body:`管理员处理说明：${reason}`},{reviewId:review.id,kind:"appeal"});
}
