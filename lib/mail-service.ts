import {env} from 'cloudflare:workers';
import {timeouts} from './timeouts';
import {notificationEmailEnabled,notificationEmail,adminIds,adminEmails,supportEmail} from './notification-policy';
import {trackVerificationMail} from './mail-delivery';
type MailSettings={MAIL_PROVIDER?:string;MAIL_FROM?:string;MAIL_GRAPH_CLIENT_ID?:string;MAIL_GRAPH_CLIENT_SECRET?:string;MAIL_GRAPH_REFRESH_TOKEN?:string;MAIL_DELIVERY_MODE?:string;MAIL_TEST_RECIPIENTS?:string;MAIL_REQUIRE_EMAIL_VERIFICATION?:string;ADMIN_USER_IDS?:string;ADMIN_EMAILS?:string;BETTER_AUTH_SECRET?:string};
export const mailSettings=()=>env as typeof env & MailSettings;
export const mailMode=()=>['test','live'].includes(mailSettings().MAIL_DELIVERY_MODE??'')?mailSettings().MAIL_DELIVERY_MODE as 'test'|'live':'off';
export function mailConfigured(){const c=mailSettings();return c.MAIL_PROVIDER==='graph'&&!!c.MAIL_GRAPH_CLIENT_ID&&!!c.MAIL_GRAPH_REFRESH_TOKEN&&!!c.BETTER_AUTH_SECRET&&c.BETTER_AUTH_SECRET.length>=32&&(!c.MAIL_FROM||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.MAIL_FROM));}
const recipients=()=>[...new Set((mailSettings().MAIL_TEST_RECIPIENTS??'').split(',').map(s=>s.trim().toLowerCase()).filter(s=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)))];
export const mailDeliveryEnabled=()=>mailConfigured()&&(mailMode()==='live'||mailMode()==='test'&&recipients().length>0);
export const canSendMailTo=(to:string)=>mailDeliveryEnabled()&&(mailMode()==='live'||recipients().includes(to.trim().toLowerCase()));
export const mailVerificationAvailable=()=>mailConfigured()&&mailMode()==='live';
export const mailVerificationRequired=()=>mailVerificationAvailable()&&mailSettings().MAIL_REQUIRE_EMAIL_VERIFICATION==='true';
export async function kickMailQueue(){
  if(!mailDeliveryEnabled()||!env.REVIEW_COORDINATOR)return false;
  const response=await env.REVIEW_COORDINATOR.get(env.REVIEW_COORDINATOR.idFromName('mail-pool')).fetch('https://mail.internal/mail/kick',{method:'POST'});
  return response.ok;
}
export async function nextMailWake(){
  if(!mailDeliveryEnabled())return null;
  const c=mailSettings(),allowed=mailMode()==='test'?recipients():[];
  const row=await env.DB!.prepare(`SELECT MIN(next_attempt_at) next FROM email_outbox WHERE state='queued' AND attempts<5${mailMode()==='test'?` AND lower(recipient) IN (${allowed.map(()=>'?').join(',')})`:''}`).bind(...allowed).first<any>();
  if(row?.next===null||row?.next===undefined)return null;
  const auth=await env.DB!.prepare('SELECT auth_state,retry_after_at FROM mail_credentials WHERE id=?').bind('graph:'+c.MAIL_GRAPH_CLIENT_ID).first<any>();
  if(['auth_required','account_verification_required'].includes(auth?.auth_state))return null;
  return Math.max(Date.now()+250,row.next,auth?.retry_after_at??0);
}
async function hash(text:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');}
async function cipherKey(){const secret=mailSettings().BETTER_AUTH_SECRET;if(!secret||secret.length<32)throw Error('邮件加密配置不可用');return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret)),'AES-GCM',false,['encrypt','decrypt']);}
export async function encryptMailValue(text:string){const iv=crypto.getRandomValues(new Uint8Array(12)),data=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await cipherKey(),new TextEncoder().encode(text)));return 'encrypted:'+btoa(String.fromCharCode(...iv))+':'+btoa(String.fromCharCode(...data));}
export async function decryptMailValue(text:string){if(!text.startsWith('encrypted:'))return text;const [,iv,data]=text.split(':');return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:Uint8Array.from(atob(iv),c=>c.charCodeAt(0))},await cipherKey(),Uint8Array.from(atob(data),c=>c.charCodeAt(0))));}
export async function queueEmail(key:string,to:string,title:string,body:string,options:{purpose?:string;notificationId?:string;expiresAt?:number;wake?:boolean}={}){
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)||/[\r\n]/.test(to))return null;
  const id=crypto.randomUUID();
  const row=await env.DB!.prepare("INSERT INTO email_outbox(id,event_key,recipient,subject,body,state,purpose,notification_id,created_at,expires_at) VALUES(?,?,?,?,?,'queued',?,?,?,?) ON CONFLICT(event_key) DO NOTHING RETURNING id")
    .bind(id,key,to.trim(),title.replace(/[\r\n]/g,' ').slice(0,160),options.purpose==='verification'?await encryptMailValue(body):body,options.purpose??'notification',options.notificationId??null,Date.now(),options.expiresAt??null).first<{id:string}>();
  if(options.wake!==false)try{await kickMailQueue();}catch{/* Persistent queued rows remain recoverable by the periodic kick. */}
  const queuedId=row?.id??(await env.DB!.prepare('SELECT id FROM email_outbox WHERE event_key=?').bind(key).first<{id:string}>())?.id??null;
  if(queuedId&&options.purpose==='verification')trackVerificationMail(queuedId);
  return queuedId;
}
export async function mailHealth(){
  const c=mailSettings(),row=c.MAIL_GRAPH_CLIENT_ID?await env.DB!.prepare('SELECT auth_state,error,retry_after_at FROM mail_credentials WHERE id=?').bind('graph:'+c.MAIL_GRAPH_CLIENT_ID).first<any>():null;
  return {configured:mailConfigured(),mode:mailMode(),enabled:mailDeliveryEnabled(),sender:c.MAIL_FROM??null,testRecipientCount:recipients().length,verificationRequired:mailVerificationRequired(),authState:row?.auth_state??'not_checked',error:row?.error??null,retryAfterAt:row?.retry_after_at??0};
}
async function authAlert(key:string,reason:string){
  const title='邮件服务需要处理',body=reason+'。站内通知继续可用，请在管理员工作台查看邮件状态并处理授权。邮件提醒会在服务恢复后投递。',covered=new Set<string>();
  // Keep this lower-level path independent of notifications.ts and do not call
  // back into the mail coordinator while its dispatch lock is held.
  for(const uid of adminIds()){
    if(!await env.DB!.prepare('SELECT id FROM users WHERE id=?').bind(uid).first())continue;
    const event='mail-auth:'+key+':'+uid;
    await env.DB!.prepare("INSERT INTO notifications(id,event_key,recipient_id,title,body,href,state,kind,created_at,email_enabled) VALUES(?,?,?,?,?,'/admin','ready','admin',?,1) ON CONFLICT(event_key) DO NOTHING").bind(crypto.randomUUID(),event,uid,title,body,Date.now()).run();
    const notice=await env.DB!.prepare('SELECT id FROM notifications WHERE event_key=?').bind(event).first<{id:string}>(),email=await notificationEmail(uid);
    if(email&&notice){await queueEmail('mail-auth:'+key+':email:'+email,email,title,body,{notificationId:notice.id,wake:false});covered.add(email);}
  }
  for(const email of adminEmails())if(!covered.has(email))await queueEmail('mail-auth:'+key+':email:'+email,email,title,body,{wake:false});
}
async function deliveryAlert(row:any,state:string){
  if(!['failed','uncertain'].includes(state)||row.purpose==='connection-test')return;
  const owner=row.notification_id?await env.DB!.prepare('SELECT recipient_id FROM notifications WHERE id=?').bind(row.notification_id).first<{recipient_id:string}>():await env.DB!.prepare('SELECT p.id recipient_id FROM auth_user u LEFT JOIN account_links l ON l.auth_user_id=u.id JOIN users p ON p.id=COALESCE(l.profile_id,u.id) WHERE lower(u.email)=lower(?) LIMIT 1').bind(row.recipient).first<{recipient_id:string}>();
  if(!owner)return;
  const message=state==='uncertain'?'邮件投递结果尚未确认，系统没有自动重发。':'邮件投递失败。';
  const body=`《${String(row.subject).slice(0,160)}》的${message}原有站内消息仍可查看。请检查邮箱地址及垃圾邮件夹；你也可以在通知设置中关闭邮件通知，站内消息会继续保留。\n\n如需维护者协助，欢迎发邮件至 ${supportEmail}，请说明相关内容和发生时间。`;
  // A delivery-failure reminder must stay in the inbox, avoiding a mail loop.
  await env.DB!.prepare("INSERT INTO notifications(id,event_key,recipient_id,title,body,href,state,kind,created_at,email_enabled) VALUES(?,?,?,?,?,?,'ready','mail_delivery',?,0) ON CONFLICT(event_key) DO NOTHING").bind(crypto.randomUUID(),'mail-delivery:'+row.id,owner.recipient_id,state==='uncertain'?'邮件投递结果待确认':'邮件投递未成功',body,'/dashboard?settings=notifications',Date.now()).run();
}
export function retryDelay(header:string|null,attempt:number,now=Date.now()){
  const seconds=header===null?NaN:Number(header),date=header?Date.parse(header):NaN;
  return Math.max(1000,Math.min(86400000,Number.isFinite(seconds)?seconds*1000:Number.isFinite(date)?date-now:30000*2**Math.min(attempt,8)));
}
// One provider lease serializes refresh-token rotation and sending. Row leases
// separately prevent stale workers from changing a later attempt's outcome.
export async function dispatchMail(limit=5,options:{onlyId?:string}={}){
  const db=env.DB!,c=mailSettings(),mode=mailMode(),id='graph:'+c.MAIL_GRAPH_CLIENT_ID,owner=crypto.randomUUID();
  const report={configured:mailConfigured(),mode,accepted:0};
  if(!mailDeliveryEnabled())return {...report,paused:true};
  const lock=await db.prepare('INSERT INTO mail_dispatch_locks(id,owner,expires_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE expires_at<? RETURNING owner').bind(id,owner,Date.now()+timeouts.mailLease,Date.now()).first();
  if(!lock)return {...report,busy:true};
  let credential:any;
  const own=()=>db.prepare('UPDATE mail_dispatch_locks SET expires_at=? WHERE id=? AND owner=? RETURNING owner').bind(Date.now()+timeouts.mailLease,id,owner).first();
  try{
    const interrupted=await db.prepare("UPDATE email_outbox SET state='uncertain',error='发送任务中断，需核对发件箱后重试',execution_owner=NULL WHERE state='sending' AND (started_at IS NULL OR started_at<?) RETURNING *").bind(Date.now()-timeouts.mailLease).all<any>();
    for(const row of interrupted.results)await deliveryAlert(row,row.state);
    await db.prepare("UPDATE email_outbox SET state='expired',body='' WHERE expires_at IS NOT NULL AND expires_at<=? AND state='queued'").bind(Date.now()).run();
    const allowed=mode==='test'?recipients():[],where=mode==='test'?` AND lower(recipient) IN (${allowed.map(()=>'?').join(',')})`:'';
    const {results}=await db.prepare(`SELECT * FROM email_outbox WHERE state='queued' AND next_attempt_at<=? AND attempts<5${where}${options.onlyId?' AND id=?':''} ORDER BY CASE purpose WHEN 'verification' THEN 0 ELSE 1 END,created_at LIMIT ?`)
      .bind(Date.now(),...allowed,...(options.onlyId?[options.onlyId]:[]),Math.max(1,Math.min(10,limit))).all<any>();
    if(!results.length)return report;
    const seed=await hash(c.MAIL_GRAPH_REFRESH_TOKEN!);
    credential=await db.prepare('SELECT * FROM mail_credentials WHERE id=?').bind(id).first<any>();
    if(!credential||credential.seed_digest!==seed){
      await db.prepare("INSERT INTO mail_credentials(id,seed_digest,refresh_cipher,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET seed_digest=excluded.seed_digest,refresh_cipher=excluded.refresh_cipher,access_cipher=NULL,access_expires_at=0,auth_state='unknown',error=NULL,retry_after_at=0,updated_at=excluded.updated_at").bind(id,seed,await encryptMailValue(c.MAIL_GRAPH_REFRESH_TOKEN!),Date.now()).run();
      credential=await db.prepare('SELECT * FROM mail_credentials WHERE id=?').bind(id).first<any>();
    }
    if(['auth_required','account_verification_required'].includes(credential.auth_state))return {...report,error:credential.error};
    if(credential.retry_after_at>Date.now())return {...report,retryAfterAt:credential.retry_after_at};
    let access:string;
    if(credential.access_cipher&&credential.access_expires_at>Date.now()+60000)access=await decryptMailValue(credential.access_cipher);
    else{
      const form=new URLSearchParams({client_id:c.MAIL_GRAPH_CLIENT_ID!,refresh_token:await decryptMailValue(credential.refresh_cipher),grant_type:'refresh_token',scope:'https://graph.microsoft.com/Mail.Send offline_access'});
      if(c.MAIL_GRAPH_CLIENT_SECRET)form.set('client_secret',c.MAIL_GRAPH_CLIENT_SECRET);
      let response:Response;
      try{response=await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token',{method:'POST',body:form,signal:AbortSignal.timeout(timeouts.mailRequest)});}catch{
        await db.prepare("UPDATE mail_credentials SET error='授权服务暂时无法连接',retry_after_at=?,updated_at=? WHERE id=?").bind(Date.now()+60000,Date.now(),id).run();return {...report,error:'授权服务暂时无法连接'};
      }
      if(!response.ok){
        const problem=await response.json().catch(()=>null) as {error_codes?:number[];error_description?:string}|null;
        if(problem?.error_codes?.includes(70000)&&/service abuse mode/i.test(problem.error_description??'')){
          const reason='微软账号仍处于反滥用限制状态，需由邮箱持有人完成微软账号验证或联系官方支持';
          await db.prepare("UPDATE mail_credentials SET auth_state='account_verification_required',error=?,retry_after_at=0,updated_at=? WHERE id=?").bind(reason,Date.now(),id).run();
          await authAlert(id+':account-verification:'+seed,reason);return {...report,error:reason};
        }
        const temporary=response.status===429||response.status>=500,reason=temporary?'授权服务暂时不可用':'邮箱授权失效或权限配置有误，需要重新授权';
        await db.prepare('UPDATE mail_credentials SET auth_state=?,error=?,retry_after_at=?,updated_at=? WHERE id=?').bind(temporary?'retry_wait':'auth_required',reason,temporary?Date.now()+retryDelay(response.headers.get('Retry-After'),1):0,Date.now(),id).run();
        if(!temporary)await authAlert(id+':'+seed,reason);return {...report,error:reason};
      }
      const token=await response.json() as {access_token?:string;refresh_token?:string;expires_in?:number};
      if(!token.access_token)throw Error('invalid_token_response');
      access=token.access_token;
      if(!await own())return {...report,busy:true};
      // Persist the rotated refresh token before sending any mail. All tokens
      // at rest are encrypted; a failed write stops this dispatcher.
      const stored=await db.prepare("UPDATE mail_credentials SET refresh_cipher=?,access_cipher=?,access_expires_at=?,auth_state='active',error=NULL,retry_after_at=0,updated_at=? WHERE id=? AND seed_digest=? RETURNING id")
        .bind(token.refresh_token?await encryptMailValue(token.refresh_token):credential.refresh_cipher,await encryptMailValue(access),Date.now()+Math.max(60,Math.min(7200,Number(token.expires_in)||3600))*1000,Date.now(),id,seed).first();
      if(!stored)throw Error('credential_changed');
    }
    for(const row of results){
      if(!canSendMailTo(row.recipient)||!await own())break;
      if(row.purpose==='notification'&&row.notification_id){
        const notice=await db.prepare('SELECT recipient_id,kind FROM notifications WHERE id=?').bind(row.notification_id).first<{recipient_id:string;kind:string}>();
        if(notice&&notice.kind!=='admin'&&!await notificationEmailEnabled(notice.recipient_id)){
          await db.prepare("UPDATE email_outbox SET state='cancelled',error='成员已关闭邮件通知' WHERE id=? AND state='queued'").bind(row.id).run();continue;
        }
      }
      const startedAt=Date.now(),executionOwner=crypto.randomUUID();
      const claim=await db.prepare("UPDATE email_outbox SET state='sending',started_at=?,execution_owner=?,attempts=attempts+1,error=NULL WHERE id=? AND state='queued' AND next_attempt_at<=? AND attempts<5 AND (expires_at IS NULL OR expires_at>?) RETURNING attempts").bind(startedAt,executionOwner,row.id,startedAt,startedAt).first<{attempts:number}>();
      if(!claim)continue;
      const finish=async(state:string,error:string|null,next=0)=>{
        const updated=await db.prepare("UPDATE email_outbox SET state=?,error=?,next_attempt_at=?,accepted_at=?,execution_owner=NULL,body=CASE WHEN purpose='verification' AND ? IN ('accepted','expired') THEN '' ELSE body END WHERE id=? AND state='sending' AND execution_owner=?")
          .bind(state,error,next,state==='accepted'?Date.now():null,state,row.id,executionOwner).run();
        if(updated.meta.changes)await deliveryAlert(row,state);
        return updated;
      };
      let body:string;try{body=await decryptMailValue(row.body);}catch{await finish('failed','邮件内容无法解密，需要管理员检查配置');continue;}
      let response:Response;
      try{response=await fetch('https://graph.microsoft.com/v1.0/me/sendMail',{method:'POST',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json'},body:JSON.stringify({message:{subject:row.subject,...(c.MAIL_FROM?{from:{emailAddress:{address:c.MAIL_FROM}}}:{}),body:{contentType:'Text',content:body},toRecipients:[{emailAddress:{address:row.recipient}}]},saveToSentItems:true}),signal:AbortSignal.timeout(timeouts.mailRequest)});}catch{await finish('uncertain','发送结果不确定，需核对发件箱后再决定重试');continue;}
      if(response.status===503&&response.headers.get('X-Resonate-Mail-Not-Started')==='1'){
        await finish(claim.attempts<5?'queued':'failed','连接未建立，尚未向邮件服务发送请求',Date.now()+3000);
      }else if(response.status===502&&response.headers.get('X-Resonate-Mail-Transport')==='uncertain'){
        await finish('uncertain','网站服务器未收到微软发信响应，投递结果不确定，未自动重发');
      }else if(response.status===202){await finish('accepted',null);report.accepted++;}
      else if(response.status===429){
        const next=Date.now()+retryDelay(response.headers.get('Retry-After'),claim.attempts);
        await finish(claim.attempts<5?'queued':'failed',claim.attempts<5?'发信服务限流，等待后重试':'多次限流，自动重试已停止',next);
        await db.prepare('UPDATE mail_credentials SET retry_after_at=? WHERE id=?').bind(next,id).run();break;
      }else if(response.status===401){
        await finish(claim.attempts<5?'queued':'failed','访问授权被拒绝，等待刷新授权',Date.now()+60000);
        await db.prepare("UPDATE mail_credentials SET access_cipher=NULL,access_expires_at=0,retry_after_at=? WHERE id=?").bind(Date.now()+60000,id).run();break;
      }else if(response.status===403){
        const providerError=await response.json().catch(()=>null) as {error?:{code?:string}}|null;
        if(providerError?.error?.code==='ErrorAccountSuspend'){
          const reason='微软已暂停此邮箱发信，需要邮箱持有人完成账号验证；请查看 Outlook 收件箱中的微软通知';
          await finish('failed',reason);
          await db.prepare("UPDATE mail_credentials SET auth_state='account_verification_required',error=? WHERE id=?").bind(reason,id).run();
          await authAlert(id+':account-verification:'+seed,reason);break;
        }
        await finish('failed','发信权限被拒绝，需要管理员处理授权');
        await db.prepare("UPDATE mail_credentials SET auth_state='auth_required',error='发信权限被拒绝，需要重新授权' WHERE id=?").bind(id).run();await authAlert(id+':'+seed,'发信权限被拒绝，需要重新授权');break;
      }else if(response.status>=500||response.status>=200&&response.status<300){await finish('uncertain',`邮件服务响应 ${response.status}，投递结果需核对，未自动重发`);}
      else await finish('failed',`邮件服务拒绝请求（${response.status}），未自动重发`);
    }
    return report;
  }catch{
    // No provider payload or credential is included in logs/notices.
    try{await db.prepare("UPDATE mail_credentials SET error='邮件授权资料或状态保存未完成',retry_after_at=?,updated_at=? WHERE id=?").bind(Date.now()+60000,Date.now(),id).run();}catch{}
    await authAlert(id+':processing','邮件授权资料或状态保存未完成，请检查服务配置');
    return {...report,error:'邮件处理未完成，未自动重发，请查看管理员工作台'};
  }finally{await db.prepare('DELETE FROM mail_dispatch_locks WHERE id=? AND owner=?').bind(id,owner).run();}
}
