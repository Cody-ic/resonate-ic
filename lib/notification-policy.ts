import {env} from 'cloudflare:workers';
export const supportEmail='resonate_ic@outlook.com';
const settings=()=>env as typeof env&{ADMIN_USER_IDS?:string;ADMIN_EMAILS?:string};
export const adminIds=()=>[...new Set((settings().ADMIN_USER_IDS??'').split(',').map(s=>s.trim()).filter(Boolean))];
export const adminEmails=()=>[...new Set((settings().ADMIN_EMAILS??'').split(',').map(s=>s.trim().toLowerCase()).filter(s=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)))];
export async function userEmail(profileId:string){
 const row=await env.DB!.prepare('SELECT u.email FROM auth_user u LEFT JOIN account_links l ON l.auth_user_id=u.id WHERE (u.id=? OR l.profile_id=?) AND u.email_verified=1 LIMIT 1').bind(profileId,profileId).first<{email:string}>();
 return row?.email.trim().toLowerCase();
}
export async function notificationEmail(profileId:string){
 const address=await userEmail(profileId);if(address)return address;
 // Only an unambiguous administrator mapping may use the configured address.
 const ids=adminIds(),emails=adminEmails();return ids.length===1&&ids[0]===profileId&&emails.length===1?emails[0]:undefined;
}
export async function notificationEmailEnabled(profileId:string){
 if(adminIds().includes(profileId))return true;
 const row=await env.DB!.prepare('SELECT email_enabled FROM notification_preferences WHERE user_id=?').bind(profileId).first<{email_enabled:number}>();
 return row?.email_enabled!==0;
}
export async function notificationPreferences(profileId:string){
 return {emailEnabled:await notificationEmailEnabled(profileId),emailAddress:await notificationEmail(profileId)??null,administrator:adminIds().includes(profileId)};
}
export async function saveNotificationPreferences(profileId:string,enabled:boolean){
 if(adminIds().includes(profileId))enabled=true;
 await env.DB!.prepare('INSERT INTO notification_preferences(user_id,email_enabled,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET email_enabled=excluded.email_enabled,updated_at=excluded.updated_at').bind(profileId,enabled?1:0,Date.now()).run();
 if(!enabled)await env.DB!.prepare("UPDATE email_outbox SET state='cancelled',error='成员已关闭邮件通知' WHERE state='queued' AND purpose='notification' AND notification_id IN (SELECT id FROM notifications WHERE recipient_id=? AND kind!='admin')").bind(profileId).run();
 return notificationPreferences(profileId);
}
export function reviseContact(body:string){
 return body.toLowerCase().includes(supportEmail)?body:body+'\n\n如果你对本次修改要求有不同意见，欢迎发邮件至 '+supportEmail+' 与维护者交流。请附上相关内容链接及你的说明。';
}
