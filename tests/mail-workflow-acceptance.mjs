// Compiled Worker + real auth library, intercepted Microsoft HTTP only.
import {Miniflare} from 'miniflare';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const root=process.cwd(),out=path.join(root,'outputs','mail-workflow-'+Date.now());mkdirSync(out,{recursive:true});
const workerRoot=path.join(root,'dist/server'),cfg=JSON.parse(readFileSync(path.join(workerRoot,'wrangler.json'),'utf8')),entry=path.join(workerRoot,'index.js');
const modules=[entry,...readdirSync(workerRoot,{recursive:true}).filter(p=>/\.(?:js|mjs)$/.test(p)&&!p.split(/[\\/]/).some(x=>x.startsWith('.'))).map(p=>path.join(workerRoot,p)).filter(p=>p!==entry)].map(p=>({type:'ESModule',path:p}));
const base='http://127.0.0.1:5184',checks=[],mailRequests=[];
const bindings={BETTER_AUTH_SECRET:crypto.randomBytes(32).toString('hex'),BETTER_AUTH_URL:base,MAIL_PROVIDER:'graph',MAIL_GRAPH_CLIENT_ID:'test-client',MAIL_GRAPH_REFRESH_TOKEN:'test-seed',MAIL_DELIVERY_MODE:'off',MAIL_REQUIRE_EMAIL_VERIFICATION:'false',MAIL_TEST_RECIPIENTS:'allowed@example.test',PROJECT_AI_MONTHLY_MAX_CALLS:'0',DISCUSSION_AI_MONTHLY_MAX_CALLS:'0'};
const options={name:'mail-workflow',host:'127.0.0.1',port:5184,modules,modulesRoot:workerRoot,modulesRules:[{type:'ESModule',include:['**/*.js','**/*.mjs'],fallthrough:true}],compatibilityDate:cfg.compatibility_date,compatibilityFlags:cfg.compatibility_flags,bindings,durableObjects:{REVIEW_COORDINATOR:{className:'ReviewCoordinator',useSQLite:true}},durableObjectsPersist:path.join(out,'do'),workflows:{REVIEW_WORKFLOW:{name:'review-workflow',className:'ReviewWorkflow'}},workflowsPersist:path.join(out,'workflows'),d1Databases:{DB:'mail-test'},d1Persist:path.join(out,'d1'),r2Buckets:{BUCKET:'mail-test'},r2Persist:path.join(out,'r2'),outboundService:async req=>{
 const url=new URL(req.url);if(url.hostname==='login.microsoftonline.com')return Response.json({access_token:'test-access',refresh_token:'rotated-test-refresh',expires_in:3600});
 if(url.hostname==='graph.microsoft.com'){mailRequests.push(await req.json());return new Response(null,{status:202});}
 throw Error('Unapproved test HTTP host');
}};
const mf=new Miniflare(options);let db;
function client(){const cookies=new Map();return {async call(method,p,body){const r=await fetch(base+'/api/'+p,{method,headers:{Origin:base,'Content-Type':'application/json',Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),'CF-Connecting-IP':'203.0.113.9'},body:body===undefined?undefined:JSON.stringify(body)});for(const cookie of r.headers.getSetCookie()){const first=cookie.split(';')[0],split=first.indexOf('=');cookies.set(first.slice(0,split),first.slice(split+1));}let value;try{value=await r.json();}catch{value={};}return {status:r.status,value};},async ok(method,p,body){const r=await this.call(method,p,body);assert.ok(r.status>=200&&r.status<300,`${p}: ${r.status} ${JSON.stringify(r.value)}`);return r.value;}};}
const admin=client(),allowed=client(),foreign=client(),check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS',name);};
const reconfigure=async()=>{await mf.setOptions({...options,bindings});await mf.ready;db=await mf.getD1Database('DB');};
const wait=async fn=>{for(let i=0;i<1500;i++){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,20));}throw Error('Expected asynchronous state missing');};
try{
 await mf.ready;db=await mf.getD1Database('DB');for(const file of readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+file,'utf8').replace(/--> statement-breakpoint/g,'').split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();
 const password='isolated-mail-test-password-1234';
 await admin.ok('POST','account/register',{name:'邮件验收管理员',email:'admin@example.test',password});const me=await admin.ok('GET','me');bindings.ADMIN_USER_IDS=me.user.id;await reconfigure();
 await allowed.ok('POST','account/register',{name:'联调账号',email:'allowed@example.test',password});await foreign.ok('POST','account/register',{name:'非联调账号',email:'other@example.test',password});
 const initial=await allowed.ok('GET','config');check('configured but off leaves existing login and OTP policy unchanged',!initial.emailVerificationEnabled&&!initial.emailVerificationRequired&&mailRequests.length===0);
 check('administrator sees configured transport independently of disabled delivery',(await admin.ok('GET','admin/workflows')).mailHealth.mode==='off');
 const blocked=await allowed.call('POST','auth/email-otp/send-verification-otp',{email:'allowed@example.test',type:'email-verification'});check('off mode rejects OTP requests without mail',blocked.status===503&&mailRequests.length===0);
 bindings.MAIL_DELIVERY_MODE='test';bindings.MAIL_REQUIRE_EMAIL_VERIFICATION='true';await reconfigure();
 await allowed.ok('POST','auth/sign-out',{});await allowed.ok('POST','auth/sign-in/email',{email:'allowed@example.test',password});
 check('test mode never enforces email verification on existing users',!(await allowed.ok('GET','config')).emailVerificationRequired);
 const outside=await foreign.call('POST','auth/email-otp/send-verification-otp',{email:'other@example.test',type:'email-verification'});check('test OTP outside exact allowlist is rejected',outside.status===503&&mailRequests.length===0);
 await allowed.ok('POST','auth/email-otp/send-verification-otp',{email:'allowed@example.test',type:'email-verification'});await wait(()=>mailRequests.length===1);
 const otp=mailRequests[0].message.body.content.match(/\b\d{6}\b/)[0];
 check('OTP dispatch targets the requested approved recipient',mailRequests[0].message.toRecipients[0].emailAddress.address==='allowed@example.test');
 const row=await wait(async()=>{const row=await db.prepare("SELECT * FROM email_outbox WHERE purpose='verification' ORDER BY created_at DESC LIMIT 1").first();return row?.state==='accepted'?row:null;});check('accepted OTP is not reported delivered and its plaintext is removed',row.state==='accepted'&&row.body===''&&row.sent_at===null&&!!row.accepted_at);
 const wrong=otp==='000000'?'111111':'000000';check('wrong verification code is rejected',(await allowed.call('POST','auth/email-otp/verify-email',{email:'allowed@example.test',otp:wrong})).status>=400);
 await allowed.ok('POST','auth/email-otp/verify-email',{email:'allowed@example.test',otp});check('valid code verifies account',(await db.prepare('SELECT email_verified FROM auth_user WHERE email=?').bind('allowed@example.test').first()).email_verified===1);
 check('verification code cannot be reused',(await allowed.call('POST','auth/email-otp/verify-email',{email:'allowed@example.test',otp})).status>=400);
 const health=(await admin.ok('GET','admin/workflows')).mailHealth;check('health exposes no credentials or encrypted token values',health.authState==='active'&&!JSON.stringify(health).includes('refresh')&&!JSON.stringify(health).includes('access_cipher'));
 bindings.MAIL_DELIVERY_MODE='live';bindings.MAIL_REQUIRE_EMAIL_VERIFICATION='false';await reconfigure();await foreign.ok('POST','auth/sign-out',{});await foreign.ok('POST','auth/sign-in/email',{email:'other@example.test',password});check('live delivery alone does not change login requirement',!(await foreign.ok('GET','config')).emailVerificationRequired);
 bindings.MAIL_REQUIRE_EMAIL_VERIFICATION='true';await reconfigure();await foreign.ok('POST','auth/sign-out',{});const required=await foreign.call('POST','auth/sign-in/email',{email:'other@example.test',password});check('mandatory verification is an explicit independent opt-in',required.status===403&&required.value.code==='EMAIL_NOT_VERIFIED');
 await foreign.ok('POST','auth/email-otp/send-verification-otp',{email:'other@example.test',type:'email-verification'});await wait(()=>mailRequests.length===2);const second=mailRequests[1].message.body.content.match(/\b\d{6}\b/)[0];await foreign.ok('POST','auth/email-otp/verify-email',{email:'other@example.test',otp:second});await foreign.ok('POST','auth/sign-in/email',{email:'other@example.test',password});check('existing user can verify and resume login without recreating account',!!(await foreign.ok('GET','me')).user&&(await db.prepare('SELECT email_verified FROM auth_user WHERE email=?').bind('other@example.test').first()).email_verified===1);
 const countBeforeReset=mailRequests.length;
 await allowed.ok('POST','auth/email-otp/request-password-reset',{email:'allowed@example.test'});await wait(()=>mailRequests.length===countBeforeReset+1);
 const resetCode=mailRequests.at(-1).message.body.content.match(/\b\d{6}\b/)[0],newPassword='isolated-replacement-password-5678';
 await allowed.ok('POST','auth/email-otp/reset-password',{email:'allowed@example.test',otp:resetCode,password:newPassword});await allowed.ok('POST','auth/sign-out',{});
 check('old password stops working after OTP reset',(await allowed.call('POST','auth/sign-in/email',{email:'allowed@example.test',password})).status>=400);
 await allowed.ok('POST','auth/sign-in/email',{email:'allowed@example.test',password:newPassword});check('password reset resumes verified login',!!(await allowed.ok('GET','me')).user);
 check('recipient send limit prevents a third OTP in the same minute',(await allowed.call('POST','auth/email-otp/send-verification-otp',{email:'allowed@example.test',type:'email-verification'})).status===429);
 for(const kind of ['expired','attempts']){
   const testClient=client(),email=kind+'@example.test',before=mailRequests.length;
   await testClient.ok('POST','account/register',{name:'验证码边界验收',email,password});await wait(()=>mailRequests.length===before+1);const code=mailRequests.at(-1).message.body.content.match(/\b\d{6}\b/)[0];
   if(kind==='expired'){
     await db.prepare('UPDATE auth_verification SET expires_at=? WHERE identifier LIKE ?').bind(Date.now()-1,'%'+email+'%').run();
     check('expired verification code cannot verify an account',(await testClient.call('POST','auth/email-otp/verify-email',{email,otp:code})).status>=400);
   }else{
     const wrongCode=code==='000000'?'111111':'000000';for(let i=0;i<3;i++)await testClient.call('POST','auth/email-otp/verify-email',{email,otp:wrongCode});
     check('three wrong guesses invalidate that issued code',(await testClient.call('POST','auth/email-otp/verify-email',{email,otp:code})).status>=400);
   }
 }
 const failedId=crypto.randomUUID();await db.prepare("INSERT INTO email_outbox(id,event_key,recipient,subject,body,state,purpose,created_at) VALUES(?,?,?,?,?,'uncertain','notification',?)").bind(failedId,'retry-test','other@example.test','隔离重试','不会连接真实邮箱',Date.now()).run();
 check('non-admin cannot retry a mail',(await foreign.call('POST',`admin/mail/${failedId}/retry`,{confirmedNotSent:true})).status===403);
 check('manual retry requires explicit reconciliation acknowledgement',(await admin.call('POST',`admin/mail/${failedId}/retry`,{})).status>=400);
 bindings.MAIL_DELIVERY_MODE='off';await reconfigure();await admin.ok('POST',`admin/mail/${failedId}/retry`,{confirmedNotSent:true});check('manual retry remains paused when transport is off',(await db.prepare('SELECT state FROM email_outbox WHERE id=?').bind(failedId).first()).state==='queued');
 // Shared campus IP: more than the former six registrations per hour.
 const campusClients=[];
 for(let i=0;i<10;i++){const c=client(),email=`campus-register-${i}@example.test`;await c.ok('POST','account/register',{name:'校园网注册验收',email,password});campusClients.push(c);}
 check('ten different users can register behind one shared campus IP',campusClients.length===10);
 for(let i=0;i<2;i++)await client().call('POST','account/register',{name:'重复注册验收',email:'campus-register-0@example.test',password});
 check('repeated registration is limited per email rather than locking the campus',(await client().call('POST','account/register',{name:'重复注册验收',email:'campus-register-0@example.test',password})).status===429);
 const burst=Array.from({length:30},(_,i)=>`campus-burst-${i}@example.test`);
 for(const email of burst)await db.prepare('INSERT INTO auth_user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,0,?,?)').bind(crypto.randomUUID(),'校园验证码验收',email,Date.now(),Date.now()).run();
 bindings.MAIL_DELIVERY_MODE='live';bindings.MAIL_REQUIRE_EMAIL_VERIFICATION='false';await reconfigure();
 const responses=await Promise.all(burst.map(email=>client().call('POST','auth/email-otp/send-verification-otp',{email,type:'email-verification'})));
 check('thirty simultaneous OTP requests on one campus IP do not share one recipient allowance',responses.every(r=>r.status===200));
 await wait(async()=>{const row=await db.prepare("SELECT COUNT(*) n FROM email_outbox WHERE recipient LIKE 'campus-burst-%' AND state='accepted'").first();return row.n===30;});
 check('durable mail queue refills free slots without waiting for the five-minute cron',burst.every(email=>mailRequests.filter(m=>m.message.toRecipients[0].emailAddress.address===email).length===1));
 bindings.MAIL_DELIVERY_MODE='off';await reconfigure();
 check('disabled delivery cannot submit a self-test email',(await admin.call('POST','admin/mail/test',{})).status===503);
 bindings.MAIL_DELIVERY_MODE='test';bindings.MAIL_FROM='allowed@example.test';await reconfigure();
 check('ordinary users cannot submit admin connection tests',(await foreign.call('POST','admin/mail/test',{})).status===403);
 const beforeSelfTest=mailRequests.length;await admin.ok('POST','admin/mail/test',{});await wait(()=>mailRequests.length===beforeSelfTest+1);
 check('admin connection test targets only the configured sender and carries that alias',mailRequests.at(-1).message.toRecipients[0].emailAddress.address==='allowed@example.test'&&mailRequests.at(-1).message.from.emailAddress.address==='allowed@example.test');
 check('admin connection tests are limited to one per minute',(await admin.call('POST','admin/mail/test',{})).status===429);
 bindings.MAIL_DELIVERY_MODE='off';await reconfigure();
 writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:checks.length,checks,mockedMailSubmissions:mailRequests.length,realNetworkCalls:0,productionDataModified:false},null,2));console.log(JSON.stringify({passed:checks.length,report:path.join(out,'result.json'),realNetworkCalls:0}));
}catch(error){writeFileSync(path.join(out,'failure.json'),JSON.stringify({checks,error:String(error),stack:error.stack},null,2));throw error;}finally{await mf.dispose();}
