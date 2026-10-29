import {env} from "cloudflare:workers";
import {HTTPError} from "./domain";
import {notify} from "./notifications";
const tables:Record<string,string>={project:"projects",course:"projects",resource:"projects",topic:"topics",reply:"replies"};
export async function requireUnlocked(type:string,id:string){
  const table=tables[type];if(!table)throw new HTTPError(422,"内容类型不支持");
  const row=await env.DB!.prepare(`SELECT admin_lock_at,admin_reason FROM ${table} WHERE id=?`).bind(id).first<any>();
  if(row?.admin_lock_at)throw new HTTPError(423,`内容已由管理员下架：${row.admin_reason}。请申诉，只有管理员可以解除下架。`);
}
export async function moderateContent(type:string,id:string,actor:string,reason:string,restore=false,expectedDigest?:string,expectedLockAt?:number){
  const table=tables[type];if(!table)throw new HTTPError(422,"内容类型不支持");
  const row=await env.DB!.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(id).first<any>();
  if(!row)throw new HTTPError(404,"内容不存在");
  if(!reason.trim()||reason.length>1500)throw new HTTPError(422,"请填写简短处理理由");
  const now=Date.now();
  // AI reports may only remove the exact public version they examined.
  const versionGuard=expectedDigest?table==="projects"?" AND EXISTS(SELECT 1 FROM revisions r WHERE r.id=projects.published_id AND r.digest=?)":" AND digest=?":"";
  const lockGuard=expectedLockAt===undefined?"":" AND admin_lock_at=?";
  const guardArgs=[...(expectedDigest?[expectedDigest]:[]),...(expectedLockAt===undefined?[]:[expectedLockAt])];
  const result=await env.DB!.prepare(`UPDATE ${table} SET admin_lock_at=?,admin_reason=? WHERE id=?${versionGuard}${lockGuard}${restore?"":" AND admin_lock_at IS NULL"} RETURNING id`).bind(restore?null:now,restore?null:reason,id,...guardArgs).first();
  if(!result)return false;
  await env.DB!.prepare("INSERT INTO moderation_actions(id,entity_type,entity_id,actor_id,action,reason,created_at) VALUES(?,?,?,?,?,?,?)").bind(crypto.randomUUID(),type,id,actor,restore?"unlock":"take_down",reason,now).run();
  await notify(row.owner_id,`moderation:${type}:${id}:${now}`,{title:restore?"管理员已解除内容下架":"内容已下架",body:restore?`管理员已解除下架限制。理由：${reason}。后续修改仍按正常审核流程处理。`:`你的内容已下架。理由：${reason}。如有异议，可点击本通知或内容管理中的“提交申诉”，由管理员复核。`},{href:table==='projects'?`/${row.kind==='course'?'courses':'projects'}/${id}`:row.project_id?`/projects/${row.project_id}#discussion-${id}`:'/dashboard',kind:"moderation"});
  return true;
}
