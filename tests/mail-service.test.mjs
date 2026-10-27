// All HTTP is intercepted. No real mail, identities or production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
const bundled=await build({entryPoints:['lib/mail-service.ts'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'env',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'env'}));b.onLoad({filter:/.*/,namespace:'env'},()=>({contents:'export const env=globalThis.__mailServiceTestEnv;'}));}}]});
async function scenario(run,{mode='live',outbound,failPersistence=false}={}){
 const db=new DatabaseSync(':memory:');
 db.exec("CREATE TABLE email_outbox(id TEXT PRIMARY KEY,event_key TEXT UNIQUE,recipient TEXT,subject TEXT,body TEXT,state TEXT,purpose TEXT,notification_id TEXT,created_at INTEGER,sent_at INTEGER,error TEXT,expires_at INTEGER);CREATE TABLE users(id TEXT PRIMARY KEY);INSERT INTO users VALUES('admin');CREATE TABLE notifications(id TEXT,event_key TEXT UNIQUE,recipient_id TEXT,title TEXT,body TEXT,href TEXT,state TEXT,kind TEXT,created_at INTEGER,email_enabled INTEGER);");
 db.exec(readFileSync('drizzle/0010_mail_delivery.sql','utf8'));
 const sql={prepare(query){return {bind(...args){return {async first(){if(failPersistence&&query.startsWith('UPDATE mail_credentials SET refresh_cipher='))throw Error('simulated persistence failure');return db.prepare(query).get(...args)??null;},async all(){return {results:db.prepare(query).all(...args)};},async run(){return {meta:{changes:Number(db.prepare(query).run(...args).changes)}};}};}};}};
 const env={DB:sql,MAIL_PROVIDER:'graph',MAIL_GRAPH_CLIENT_ID:'test-client',MAIL_GRAPH_REFRESH_TOKEN:'test-refresh-seed',BETTER_AUTH_SECRET:'test-encryption-key-for-isolated-tests-only',ADMIN_USER_IDS:'admin',MAIL_DELIVERY_MODE:mode,MAIL_TEST_RECIPIENTS:'allowed@example.test'};
 globalThis.__mailServiceTestEnv=env;
 const api=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text+'\n//'+crypto.randomUUID()).toString('base64'));
 let now=1793080000000;const clock=Date.now,network=globalThis.fetch,calls=[];Date.now=()=>now;
 globalThis.fetch=async(url,options)=>{assert.ok(['https://login.microsoftonline.com/consumers/oauth2/v2.0/token','https://graph.microsoft.com/v1.0/me/sendMail'].includes(String(url)));const call={url:String(url),options};calls.push(call);if(outbound)return outbound(call,{api,db,env,calls});return String(url).includes('/token')?Response.json({access_token:'test-access',refresh_token:'rotated-test-refresh',expires_in:3600}):new Response(null,{status:202});};
 const queue=(key,to='allowed@example.test',options={})=>api.queueEmail(key,to,'审核结果','隔离邮件，不会连接真实服务。',options);
 try{await run({api,db,env,calls,queue,advance:ms=>{now+=ms;},now:()=>now});}finally{globalThis.fetch=network;Date.now=clock;db.close();}
}
test('configured credentials do not enable delivery or mandatory verification',()=>scenario(async({api,env,calls,queue})=>{
 assert.equal(api.mailConfigured(),true);assert.equal(api.mailDeliveryEnabled(),false);env.MAIL_REQUIRE_EMAIL_VERIFICATION='true';assert.equal(api.mailVerificationRequired(),false);await queue('paused');await api.dispatchMail();assert.equal(calls.length,0);
 env.MAIL_DELIVERY_MODE='test';assert.equal(api.mailVerificationRequired(),false);env.MAIL_DELIVERY_MODE='live';assert.equal(api.mailVerificationRequired(),true);
},{mode:'off'}));
test('test mode only sends to exact allowed recipients, including onlyId requests',()=>scenario(async({api,db,queue})=>{
 const allowed=await queue('allowed','ALLOWED@example.test'),blocked=await queue('blocked','other@example.test');
 await api.dispatchMail(1,{onlyId:blocked});assert.equal(db.prepare('SELECT state FROM email_outbox WHERE id=?').get(blocked).state,'queued');
 assert.equal((await api.dispatchMail()).accepted,1);assert.equal(db.prepare('SELECT state FROM email_outbox WHERE id=?').get(allowed).state,'accepted');
},{mode:'test'}));

test('configured sender alias is included and invalid sender pauses delivery',()=>scenario(async({api,env,queue,calls})=>{
 env.MAIL_FROM='sender-alias@outlook.com';await queue('alias');assert.equal((await api.dispatchMail()).accepted,1);
 assert.equal(JSON.parse(calls.find(c=>c.url.includes('/sendMail')).options.body).message.from.emailAddress.address,'sender-alias@outlook.com');
 assert.equal(JSON.parse(calls.find(c=>c.url.includes('/sendMail')).options.body).message.from.emailAddress.name,'共振');
 env.MAIL_FROM='sender@outlook.com\r\nInjected: value';await queue('invalid-alias');assert.equal(api.mailConfigured(),false);await api.dispatchMail();assert.equal(calls.filter(c=>c.url.includes('/sendMail')).length,1);
}));

test('Microsoft account suspension pauses the provider until an explicit recovery',()=>scenario(async({api,db,queue,calls,env})=>{
 await queue('suspended');await api.dispatchMail();
 assert.equal((await api.mailHealth()).authState,'account_verification_required');
 assert.equal(await api.nextMailWake(),null);
 await queue('later');await api.dispatchMail();assert.equal(calls.filter(c=>c.url.includes('/sendMail')).length,1);
 assert.equal(db.prepare("SELECT state FROM email_outbox WHERE event_key='later'").get().state,'queued');
 env.MAIL_FROM_NAME='共振通知';assert.equal(api.mailSenderName(),'共振通知');env.MAIL_FROM_NAME='bad\r\nheader';assert.equal(api.mailConfigured(),false);
},{outbound:async(call)=>call.url.includes('/token')?Response.json({access_token:'access'}):Response.json({error:{code:'ErrorAccountSuspend',message:'sensitive-provider-text'}},{status:403})}));

test('AADSTS70000 service-abuse refresh failure requires account verification rather than repeated OAuth consent',()=>scenario(async({api,queue,calls})=>{
 await queue('account-refresh-block');await api.dispatchMail();assert.equal((await api.mailHealth()).authState,'account_verification_required');
 await api.dispatchMail();assert.equal(calls.length,1);assert.equal(await api.nextMailWake(),null);
},{outbound:async()=>Response.json({error:'invalid_grant',error_codes:[70000],error_description:'AADSTS70000: User account is found to be in service abuse mode.'},{status:400})}));
test('old creation time cannot mark a fresh sending attempt as uncertain; concurrent dispatch is serialized',()=>scenario(async({api,db,queue,now})=>{
 const id=await queue('old');db.prepare('UPDATE email_outbox SET created_at=? WHERE id=?').run(now()-86400000,id);await api.dispatchMail();assert.equal(db.prepare('SELECT state FROM email_outbox WHERE id=?').get(id).state,'accepted');
},{outbound:async(call,{api,db})=>{if(call.url.includes('/token'))return Response.json({access_token:'access'});const row=db.prepare("SELECT * FROM email_outbox WHERE state='sending'").get();assert.equal(row.started_at,Date.now());assert.notEqual(row.created_at,row.started_at);assert.equal((await api.dispatchMail()).busy,true);assert.equal(db.prepare('SELECT state FROM email_outbox WHERE id=?').get(row.id).state,'sending');return new Response(null,{status:202});}}));
test('genuinely stale attempts become uncertain and are never automatically replayed',()=>scenario(async({api,db,queue,now,calls})=>{
 const id=await queue('stale');db.prepare("UPDATE email_outbox SET state='sending',started_at=?,execution_owner='crashed' WHERE id=?").run(now()-600001,id);await api.dispatchMail();assert.equal(db.prepare('SELECT state FROM email_outbox WHERE id=?').get(id).state,'uncertain');assert.equal(calls.length,0);
}));
test('rotated token is encrypted before sending and used for the next refresh',()=>scenario(async({api,db,queue,advance,calls})=>{
 await queue('one');await api.dispatchMail();const stored=db.prepare('SELECT * FROM mail_credentials').get();assert.ok(stored.refresh_cipher.startsWith('encrypted:'));assert.ok(!stored.refresh_cipher.includes('rotated-test-refresh'));assert.ok(!stored.access_cipher.includes('test-access'));
 await queue('two');await api.dispatchMail();assert.equal(calls.filter(c=>c.url.includes('/token')).length,1);
 advance(3600001);await queue('three');await api.dispatchMail();const requests=calls.filter(c=>c.url.includes('/token'));assert.equal(requests[1].options.body.get('refresh_token'),'rotated-test-refresh');assert.equal((await api.mailHealth()).authState,'active');
}));
test('failed credential persistence stops sending',()=>scenario(async({api,db,queue,calls})=>{
 await queue('persist');assert.ok((await api.dispatchMail()).error);assert.equal(calls.filter(c=>c.url.includes('/sendMail')).length,0);assert.equal(db.prepare('SELECT state FROM email_outbox').get().state,'queued');assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications').get().n,1);
},{failPersistence:true}));
test('invalid grant pauses delivery and alerts admins once without credential payload leakage',()=>scenario(async({api,db,queue,calls})=>{
 await queue('auth');await api.dispatchMail();await api.dispatchMail();assert.equal(calls.length,1);assert.equal((await api.mailHealth()).authState,'auth_required');assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications').get().n,1);assert.ok(!JSON.stringify(db.prepare('SELECT * FROM notifications').all()).includes('secret-provider-payload'));
},{outbound:async()=>Response.json({error:'invalid_grant',error_description:'secret-provider-payload'},{status:400})}));
test('429 obeys Retry-After and does not hammer other messages',()=>scenario(async({api,db,queue,calls,advance})=>{
 await queue('rate-one');await queue('rate-two');await api.dispatchMail();assert.equal(db.prepare('SELECT attempts FROM email_outbox WHERE event_key=?').get('rate-one').attempts,1);await api.dispatchMail();assert.equal(calls.filter(c=>c.url.includes('/sendMail')).length,1);
 advance(120001);await api.dispatchMail();assert.equal(db.prepare("SELECT COUNT(*) n FROM email_outbox WHERE state='accepted'").get().n,2);
},{outbound:async(call,{calls})=>call.url.includes('/token')?Response.json({access_token:'access'}):calls.filter(c=>c.url.includes('/sendMail')).length===1?new Response(null,{status:429,headers:{'Retry-After':'120'}}):new Response(null,{status:202})}));
test('repeated throttling stops after five attempts',()=>scenario(async({api,db,queue,advance,calls})=>{
 await queue('bounded');for(let i=0;i<6;i++){await api.dispatchMail();advance(60001);}assert.equal(db.prepare('SELECT state FROM email_outbox').get().state,'failed');assert.equal(calls.filter(c=>c.url.includes('/sendMail')).length,5);
},{outbound:async(call)=>call.url.includes('/token')?Response.json({access_token:'access'}):new Response(null,{status:429,headers:{'Retry-After':'1'}})}));
test('unknown network outcomes and server errors never auto resend',()=>scenario(async({api,db,queue,calls})=>{
 await queue('network');await api.dispatchMail();await api.dispatchMail();assert.equal(db.prepare('SELECT state FROM email_outbox').get().state,'uncertain');assert.equal(calls.filter(c=>c.url.includes('/sendMail')).length,1);
},{outbound:async(call)=>{if(call.url.includes('/token'))return Response.json({access_token:'access'});throw Error('timeout with secret payload');}}));
test('5xx needs reconciliation, 400 is permanent failure',async()=>{
 for(const status of [503,400])await scenario(async({api,db,queue,calls})=>{await queue('status');await api.dispatchMail();await api.dispatchMail();assert.equal(db.prepare('SELECT state FROM email_outbox').get().state,status===503?'uncertain':'failed');assert.equal(calls.filter(c=>c.url.includes('/sendMail')).length,1);},{outbound:async(call)=>call.url.includes('/token')?Response.json({access_token:'access'}):new Response(null,{status})});
});
test('401 refreshes cached access and retries later; 403 requires reauthorization',async()=>{
 for(const status of [401,403])await scenario(async({api,db,queue,advance,calls})=>{await queue('permissions');await api.dispatchMail();advance(60001);await api.dispatchMail();assert.equal(db.prepare('SELECT state FROM email_outbox').get().state,status===401?'accepted':'failed');assert.equal(calls.filter(c=>c.url.includes('/token')).length,status===401?2:1);},{outbound:async(call,{calls})=>call.url.includes('/token')?Response.json({access_token:'access',refresh_token:'rotated'}):calls.filter(c=>c.url.includes('/sendMail')).length===1?new Response(null,{status}):new Response(null,{status:202})});
});
test('verification bodies are encrypted and removed after acceptance or expiration',()=>scenario(async({api,db,queue,now,calls})=>{
 const expired=await queue('expired','allowed@example.test',{purpose:'verification',expiresAt:now()-1});assert.ok(db.prepare('SELECT body FROM email_outbox WHERE id=?').get(expired).body.startsWith('encrypted:'));await api.dispatchMail();assert.equal(calls.length,0);assert.equal(db.prepare('SELECT body FROM email_outbox WHERE id=?').get(expired).body,'');
 const fresh=await queue('fresh','allowed@example.test',{purpose:'verification',expiresAt:now()+300000});await api.dispatchMail(1,{onlyId:fresh});const row=db.prepare('SELECT * FROM email_outbox WHERE id=?').get(fresh);assert.equal(row.state,'accepted');assert.equal(row.body,'');assert.ok(row.accepted_at);assert.equal(row.sent_at,null);
}));
test('retry timing supports seconds, HTTP dates and bounded fallbacks',()=>scenario(async({api,now})=>{
 assert.equal(api.retryDelay('10',1,now()),10000);assert.equal(api.retryDelay(new Date(now()+90000).toUTCString(),1,now()),90000);assert.equal(api.retryDelay(null,1,now()),60000);assert.equal(api.retryDelay('99999999999',1,now()),86400000);
}));
