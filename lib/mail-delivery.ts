import {env} from 'cloudflare:workers';
import {AsyncLocalStorage} from 'node:async_hooks';
const tracking=new AsyncLocalStorage<string[]>();
export function trackVerificationMail(id:string){tracking.getStore()?.push(id);}
const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const decode=(value:string)=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),x=>x.charCodeAt(0));
async function key(){return crypto.subtle.importKey('raw',new TextEncoder().encode((env as typeof env&{BETTER_AUTH_SECRET:string}).BETTER_AUTH_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function withDeliveryReceipt(operation:()=>Promise<Response>){
  return tracking.run([],async()=>{
    const response=await operation(),ids=tracking.getStore()!;
    if(!response.ok||!ids.length)return response;
    const payload=encode(new TextEncoder().encode(JSON.stringify({id:ids.at(-1),expires:Date.now()+600000})));
    const signature=encode(new Uint8Array(await crypto.subtle.sign('HMAC',await key(),new TextEncoder().encode(payload))));
    const value=await response.json() as Record<string,unknown>,headers=new Headers(response.headers);headers.delete('content-length');headers.set('Cache-Control','no-store');
    return new Response(JSON.stringify({...value,deliveryTicket:payload+'.'+signature}),{status:response.status,headers});
  });
}
export async function deliveryStatus(request:Request){
  const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
  let id:string;
  try{
    const ticket=new URL(request.url).searchParams.get('ticket')??'';if(ticket.length>1024)throw Error();
    const parts=ticket.split('.');if(parts.length!==2||!await crypto.subtle.verify('HMAC',await key(),decode(parts[1]),new TextEncoder().encode(parts[0])))throw Error();
    const data=JSON.parse(new TextDecoder().decode(decode(parts[0])));
    if(typeof data.id!=='string'||!Number.isSafeInteger(data.expires)||data.expires<=Date.now())throw Error();id=data.id;
  }catch{return new Response(JSON.stringify({error:'投递状态凭据无效或已过期，请重新申请验证码'}),{status:401,headers});}
  const row=await env.DB!.prepare("SELECT state,expires_at FROM email_outbox WHERE id=? AND purpose='verification'").bind(id).first<{state:string;expires_at:number|null}>();
  if(!row)return new Response(JSON.stringify({error:'投递记录不可用，请重新申请验证码'}),{status:404,headers});
  const state=row.expires_at&&row.expires_at<=Date.now()?'expired':row.state;
  const messages:Record<string,string>={queued:'验证码邮件正在排队发送，请稍候。',sending:'正在向邮件服务提交验证码，请稍候。',accepted:'邮件服务已接受验证码邮件。请检查收件箱与垃圾邮件夹，实际到达可能稍有延迟。',uncertain:'邮件投递结果未确认，可能没有送达。请重新申请新的验证码；若仍收不到，请联系维护者。',failed:'验证码邮件未能发送，请稍后重新申请；若仍收不到，请联系维护者。',expired:'该验证码已过期，请重新申请。'};
  return new Response(JSON.stringify({state,message:messages[state]??'邮件状态暂不可用，请稍后重新申请验证码。'}),{headers});
}
