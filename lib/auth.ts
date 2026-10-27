import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth/minimal";
import {emailOTP} from "better-auth/plugins";
import {APIError} from 'better-auth/api';
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { z } from "zod/v3";
import { getDb } from "../db";
import * as s from "../db/schema";
import { getChatGPTUser } from "../app/chatgpt-auth";
import { HTTPError,json } from "./domain";
import {mailMode,mailDeliveryEnabled,mailVerificationAvailable,mailVerificationRequired,canSendMailTo,mailSettings,queueEmail} from "./notifications";
import {loginWindowSeconds,loginAccountMax,loginIpMax,trustedCampusLogin,loginAccountLimitKey} from "./login-policy";

type Settings={BETTER_AUTH_SECRET?:string;BETTER_AUTH_URL?:string;PLATFORM_AUTH_ENABLED?:string;SEU_LOGIN_TRUSTED_CIDRS?:string};
// Reuse the configured service, never a user's identity/session. Every identity
// lookup still checks the request cookie and database; configuration changes
// invalidate the instance, including a changed D1 binding or campus policy.
let authCache:{database:D1Database|undefined;key:string;auth:ReturnType<typeof createSiteAuth>}|undefined;
// Production origins must explicitly opt into platform headers, behind a proxy
// that strips client-supplied identity headers. The local Vite plugin does this.
export function platformLoginEnabled(){return import.meta.env.DEV||(env as typeof env & Settings).PLATFORM_AUTH_ENABLED==='true';}
export function siteAuth(request:Request){
  const cfg=env as typeof env & Settings;
  if(!cfg.BETTER_AUTH_SECRET||cfg.BETTER_AUTH_SECRET.length<32)throw new HTTPError(503,"站内账号服务尚未配置，请联系维护者");
  const origin=cfg.BETTER_AUTH_URL??(import.meta.env.DEV?new URL(request.url).origin:undefined);
  if(!origin)throw new HTTPError(503,"请先配置网站登录地址");
  const key=JSON.stringify([origin,cfg.BETTER_AUTH_SECRET,mailMode(),mailDeliveryEnabled(),mailVerificationRequired(),mailSettings().MAIL_TEST_RECIPIENTS,cfg.SEU_LOGIN_TRUSTED_CIDRS]);
  if(authCache&&authCache.database===env.DB&&authCache.key===key)return authCache.auth;
  const auth=createSiteAuth(origin,cfg);authCache={database:env.DB,key,auth};return auth;
}
function createSiteAuth(origin:string,cfg:typeof env & Settings){
  return betterAuth({
    appName:"共振",baseURL:origin,basePath:"/api/auth",secret:cfg.BETTER_AUTH_SECRET,
    database:drizzleAdapter(getDb(),{provider:"sqlite",transaction:false,schema:{user:s.authUser,session:s.authSession,account:s.authAccount,verification:s.authVerification}}),
    emailAndPassword:{enabled:true,minPasswordLength:12,maxPasswordLength:128,requireEmailVerification:mailVerificationRequired()},
    plugins:[emailOTP({otpLength:6,expiresIn:300,allowedAttempts:3,storeOTP:"hashed",sendVerificationOnSignUp:mailVerificationAvailable(),overrideDefaultEmailVerification:true,disableSignUp:true,rateLimit:{window:60,max:2},sendVerificationOTP:async({email,otp,type})=>{
      if(!canSendMailTo(email))throw new APIError('SERVICE_UNAVAILABLE',{message:'邮箱发送服务尚未启用，或当前收件人不在联调范围内'});
      await queueEmail(`verification:${crypto.randomUUID()}`,email,type==="forget-password"?"共振账号密码重置验证码":"共振账号邮箱验证码",`你的验证码是 ${otp}，5分钟内有效。请勿将验证码告知他人。若非本人操作，可忽略此邮件。`,{purpose:"verification",expiresAt:Date.now()+300000});
    }})],
    session:{expiresIn:60*60*24*7,updateAge:60*60*24},
    advanced:{ipAddress:{ipAddressHeaders:["cf-connecting-ip"]},cookiePrefix:"gongzhen"},
    rateLimit:{enabled:true,window:60,max:600,customRules:{"/sign-in/email":(req:Request)=>trustedCampusLogin(req.headers,cfg.SEU_LOGIN_TRUSTED_CIDRS)?false:{window:loginWindowSeconds,max:loginIpMax},"/sign-up/email":{window:60,max:600},"/change-password":{window:60,max:600},"/get-session":false,"/email-otp/*":{window:60,max:600}},
      customStorage:{consume:async(key,rule)=>{
        const window=rule.window*1000,bucket=Math.floor(Date.now()/window),expires=(bucket+1)*window;
        const row=await env.DB!.prepare("INSERT INTO limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count<? RETURNING count").bind(`auth:${key}:${bucket}`,expires,rule.max).first();
        return {allowed:!!row,retryAfter:row?null:Math.ceil((expires-Date.now())/1000)};
      }}},
  });
}

export async function accountIdentity(request:Request){
  const cfg=env as typeof env & Settings;
  if(cfg.BETTER_AUTH_SECRET){
    const session=await siteAuth(request).api.getSession({headers:request.headers});
    if(session){
      const link=await getDb().select().from(s.accountLinks).where(eq(s.accountLinks.authUserId,session.user.id)).get();
      return {id:link?.profileId??session.user.id,name:session.user.name,createdAt:session.user.createdAt.getTime(),provider:"password"};
    }
  }
  if(!platformLoginEnabled())return null;
  const identity=await getChatGPTUser();
  return identity?{id:identity.userId,name:identity.fullName??"新同学",createdAt:Date.now(),provider:"platform"}:null;
}

export async function registerAccount(request:Request){
  const text=await request.text();
  if(new TextEncoder().encode(text).length>4096)throw new HTTPError(413,"注册信息过长");
  let input:unknown;try{input=JSON.parse(text);}catch{throw new HTTPError(400,"请求必须是JSON");}
  const body=z.object({name:z.string().trim().min(2).max(40),email:z.string().trim().email().max(254),password:z.string().min(12).max(128),linkCurrent:z.boolean().default(false)}).parse(input);
  const registrationAuth=siteAuth(request),accountKey=await loginAccountLimitKey(body.email,(env as typeof env & Settings).BETTER_AUTH_SECRET!);
  const registrationBucket=Math.floor(Date.now()/3600000);
  const registration=await env.DB!.prepare("INSERT INTO limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count<? RETURNING count").bind(`auth:register-account:${accountKey}:${registrationBucket}`,(registrationBucket+1)*3600000,3).first();
  if(!registration)throw new HTTPError(429,'该邮箱注册尝试较频繁，请稍后再试');
  const identity=body.linkCurrent?await accountIdentity(request):null;
  if(body.linkCurrent){
    if(!identity||identity.provider!=="platform")throw new HTTPError(403,"请先登录要关联的平台账户");
    if(await getDb().select().from(s.accountLinks).where(eq(s.accountLinks.profileId,identity.id)).get())throw new HTTPError(409,"当前账户已经设置了站内登录");
  }
  const url=new URL("/api/auth/sign-up/email",request.url),headers=new Headers(request.headers);headers.set("Content-Type","application/json");headers.delete("content-length");
  const response=await registrationAuth.handler(new Request(url,{method:"POST",headers,body:JSON.stringify({name:body.name,email:body.email,password:body.password})}));
  if(response.ok){
    const result=await response.clone().json() as {user?:{id:string}};
    if(!result.user?.id)throw new HTTPError(500,"注册结果不完整");
    if(identity){
      await getDb().insert(s.users).values({id:identity.id,name:identity.name,createdAt:identity.createdAt}).onConflictDoNothing();
      try{await getDb().insert(s.accountLinks).values({authUserId:result.user.id,profileId:identity.id,createdAt:Date.now()});await getDb().update(s.users).set({name:body.name}).where(eq(s.users.id,identity.id));}
      catch{await getDb().delete(s.authSession).where(eq(s.authSession.userId,result.user.id));throw new HTTPError(409,"该账户的关联状态已变化，请使用新账号重新登录");}
    }
  }
  return response;
}

export async function authHandler(request:Request){
  const pathname=new URL(request.url).pathname;
  // All registration goes through validation and the explicit profile-link choice.
  const allowed=["/api/auth/sign-in/email","/api/auth/sign-out","/api/auth/get-session","/api/auth/change-password","/api/auth/email-otp/send-verification-otp","/api/auth/email-otp/verify-email","/api/auth/email-otp/request-password-reset","/api/auth/email-otp/reset-password"];
  if(!allowed.includes(pathname))return json({error:"接口不存在"},404);
  if(pathname.includes("email-otp")&&!mailDeliveryEnabled())throw new HTTPError(503,"邮箱发送服务尚未启用，请稍后再试或联系管理员");
  if(request.method==='POST'&&pathname.includes('/email-otp/')){
    const text=await request.clone().text();if(new TextEncoder().encode(text).length>4096)throw new HTTPError(413,'验证码请求过长');
    let input:unknown;try{input=JSON.parse(text);}catch{throw new HTTPError(400,'请求必须是JSON');}
    const {email}=z.object({email:z.string().trim().email().max(254)}).parse(input);
    const sending=['/api/auth/email-otp/send-verification-otp','/api/auth/email-otp/request-password-reset'].includes(pathname);
    if(sending&&!canSendMailTo(email))throw new HTTPError(503,'邮箱服务正在联调，当前收件人不在允许范围内');
    // Shared campus egress must not combine every student's two requests into
    // one allowance. Keep strict recipient quotas and a larger IP aggregate;
    // the OTP plugin independently limits wrong guesses per issued code.
    const accountKey=await loginAccountLimitKey(email,(env as typeof env & Settings).BETTER_AUTH_SECRET!);
    const bucket=Math.floor(Date.now()/60000),expires=(bucket+1)*60000;
    const allowed=await env.DB!.prepare("INSERT INTO limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count<? RETURNING count").bind(`mail-otp:${sending?'send':'verify'}:${accountKey}:${bucket}`,expires,sending?2:6).first();
    if(!allowed)throw new HTTPError(429,sending?'该邮箱验证码请求较频繁，请稍后再试':'该邮箱验证尝试较频繁，请稍后再试');
  }
  const auth=siteAuth(request);
  if(pathname==='/api/auth/change-password'&&request.method==='POST'){
    const session=await auth.api.getSession({headers:request.headers});
    if(session){const key=await loginAccountLimitKey(session.user.id,(env as typeof env & Settings).BETTER_AUTH_SECRET!),bucket=Math.floor(Date.now()/60000);const allowed=await env.DB!.prepare("INSERT INTO limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count<? RETURNING count").bind(`auth:change-password:${key}:${bucket}`,(bucket+1)*60000,6).first();if(!allowed)throw new HTTPError(429,'该账号修改密码尝试较频繁，请稍后再试');}
  }
  if(pathname==="/api/auth/sign-in/email"&&request.method==="POST"){
    if(Number(request.headers.get("Content-Length")??0)>4096)throw new HTTPError(413,"登录信息过长");
    const text=await request.text();if(new TextEncoder().encode(text).length>4096)throw new HTTPError(413,"登录信息过长");
    let input:unknown;try{input=JSON.parse(text);}catch{throw new HTTPError(400,"请求必须是JSON");}
    const body=z.object({email:z.string().trim().email().max(254),password:z.string().min(1).max(128)}).passthrough().parse(input);
    body.email=body.email.toLowerCase();
    const accountKey=await loginAccountLimitKey(body.email,(env as typeof env & Settings).BETTER_AUTH_SECRET!);
    const window=loginWindowSeconds*1000,bucket=Math.floor(Date.now()/window),expires=(bucket+1)*window;
    // Atomic across requests/isolate instances; changing IP or email casing does
    // not reset a single account's allowance, including trusted campus traffic.
    const allowed=await env.DB!.prepare("INSERT INTO limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count<? RETURNING count")
      .bind(`auth:login-account:${accountKey}:${bucket}`,expires,loginAccountMax).first();
    if(!allowed){const response=json({error:"这个账号的登录尝试过于频繁，请稍后再试",message:"这个账号的登录尝试过于频繁，请稍后再试",code:"LOGIN_ACCOUNT_RATE_LIMITED"},429);response.headers.set("Retry-After",String(Math.max(1,Math.ceil((expires-Date.now())/1000))));return response;}
    const headers=new Headers(request.headers);headers.delete("content-length");
    request=new Request(request.url,{method:"POST",headers,body:JSON.stringify(body)});
  }
  return await auth.handler(request);
}
