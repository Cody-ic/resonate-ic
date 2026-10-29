// Real SQLite tables, mocked provider only. No real recipients or paid APIs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {build} from 'esbuild';
const bundle=await build({stdin:{contents:"export * from './lib/notifications';export {notificationPreferences,saveNotificationPreferences} from './lib/notification-policy';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'env',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'env'}));b.onLoad({filter:/.*/,namespace:'env'},()=>({contents:'export const env=globalThis.__notificationTestEnv;'}));}}]});
async function scenario(run){
 const db=new DatabaseSync(':memory:');for(const f of readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort())db.exec(readFileSync('drizzle/'+f,'utf8'));
 for(const id of ['admin','member','other']){db.prepare('INSERT INTO users(id,name,created_at) VALUES(?,?,1)').run(id,id);db.prepare('INSERT INTO auth_user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,1,1,1)').run(id,id,id+'@example.test');}
 const sql={prepare(query){const prepared=db.prepare(query);const withArgs=(args=[])=>({bind(...values){return withArgs(values);},async first(){return prepared.get(...args)??null;},async all(){return {results:prepared.all(...args),success:true};},async run(){return {meta:{changes:Number(prepared.run(...args).changes)}};}});return withArgs();}};
 const env={DB:sql,ADMIN_USER_IDS:'admin',ADMIN_EMAILS:'ADMIN@example.test',MAIL_PROVIDER:'graph',MAIL_GRAPH_CLIENT_ID:'test-client',MAIL_GRAPH_REFRESH_TOKEN:'test-seed',BETTER_AUTH_SECRET:'test-secret-for-notification-policy-only-12345',MAIL_DELIVERY_MODE:'live'};
 globalThis.__notificationTestEnv=env;const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text+'\n//'+crypto.randomUUID()).toString('base64'));
 const network=globalThis.fetch,calls=[];let status=202;
 globalThis.fetch=async(url,options)=>{calls.push(String(url));if(String(url).includes('/token'))return Response.json({access_token:'test-access'});return new Response(null,{status});};
 const notice={title:'隔离通知测试',body:'这是一条验证双渠道通知的测试文案。'};
 try{await run({api,db,env,calls,notice,status:value=>{status=value;}});}finally{globalThis.fetch=network;db.close();}
}
test('all new member notices default to inbox and email and retry does not duplicate',()=>scenario(async({api,db,notice})=>{
 assert.equal((await api.notificationPreferences('member')).emailEnabled,true);const id=await api.notify('member','reply-default',notice,{kind:'reply'});await api.notify('member','reply-default',notice,{kind:'reply'});
 assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM email_outbox WHERE notification_id=?').get(id).n,1);
}));
test('member opt out persists, cancels pending notifications and keeps verification mail',()=>scenario(async({api,db,notice,calls})=>{
 const id=await api.notify('member','pending',notice);await api.saveNotificationPreferences('member',false);assert.equal((await api.notificationPreferences('member')).emailEnabled,false);assert.equal(db.prepare('SELECT state FROM email_outbox WHERE notification_id=?').get(id).state,'cancelled');
 await api.notify('member','muted',notice);assert.equal(db.prepare('SELECT email_enabled FROM notifications WHERE event_key=?').get('muted').email_enabled,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM email_outbox').get().n,1);
 await api.queueEmail('verification-independent','member@example.test','验证码','123456',{purpose:'verification'});await api.dispatchMail();assert.equal(db.prepare("SELECT state FROM email_outbox WHERE event_key='verification-independent'").get().state,'accepted');assert.equal(calls.filter(x=>x.includes('/sendMail')).length,1);
 await api.saveNotificationPreferences('member',true);await api.notify('member','resumed',notice);assert.equal(db.prepare('SELECT COUNT(*) n FROM email_outbox').get().n,3);
}));
test('administrator notifications keep both channels and deduplicate configured email',()=>scenario(async({api,db,notice})=>{
 await api.saveNotificationPreferences('admin',false);assert.equal((await api.notificationPreferences('admin')).emailEnabled,true);await api.alertAdmins('admin-event',notice.title,notice.body);await api.alertAdmins('admin-event',notice.title,notice.body);
 const n=db.prepare("SELECT * FROM notifications WHERE kind='admin'").get();assert.equal(n.email_enabled,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM email_outbox').get().n,1);assert.equal(db.prepare('SELECT notification_id FROM email_outbox').get().notification_id,n.id);
}));
test('unambiguous local admin mapping still receives a linked email',()=>scenario(async({api,db,notice})=>{
 db.prepare("UPDATE auth_user SET email_verified=0 WHERE id='admin'").run();await api.alertAdmins('local-admin',notice.title,notice.body);assert.equal(db.prepare('SELECT recipient FROM email_outbox').get().recipient,'admin@example.test');assert.ok(db.prepare('SELECT notification_id FROM email_outbox').get().notification_id);
}));
test('draft approval checks the current email preference and sends only after approval',()=>scenario(async({api,db,notice})=>{
 const id=await api.notify('member','draft',notice,{draft:true});assert.equal(db.prepare('SELECT COUNT(*) n FROM email_outbox').get().n,0);await api.saveNotificationPreferences('member',false);await api.approveNotice(id,'admin');assert.equal(db.prepare('SELECT COUNT(*) n FROM email_outbox').get().n,0);
 await api.saveNotificationPreferences('member',true);const second=await api.notify('member','draft2',notice,{draft:true});await api.approveNotice(second,'admin');assert.equal(db.prepare('SELECT COUNT(*) n FROM email_outbox').get().n,1);
}));
test('revise explanation adds support contact to identical inbox and mail content',()=>scenario(async({api,db,notice})=>{
 const id=await api.notify('member','revise',notice,{revise:true});const n=db.prepare('SELECT body FROM notifications WHERE id=?').get(id),mail=db.prepare('SELECT body FROM email_outbox WHERE notification_id=?').get(id);assert.ok(n.body.includes('resonate_ic@outlook.com'));assert.ok(n.body.includes('不同意见'));assert.equal(n.body,mail.body);
}));
test('maximum length revise draft keeps the complete reason when approved',()=>scenario(async({api,db})=>{
 const reason='据'.repeat(6000),id=await api.notify('member','long-revise',{title:'修改要求',body:reason},{revise:true,draft:true});await api.approveNotice(id,'admin');const text=db.prepare('SELECT body FROM notifications WHERE id=?').get(id).body;assert.ok(text.startsWith(reason));assert.ok(text.includes('resonate_ic@outlook.com'));
}));
test('failed or uncertain member mail creates one private inbox reminder without recursive email',async()=>{
 for(const status of [400,503])await scenario(async({api,db,notice,status:setStatus,calls})=>{
  setStatus(status);await api.notify('member','failure',notice);await api.dispatchMail();await api.dispatchMail();const alerts=db.prepare("SELECT * FROM notifications WHERE kind='mail_delivery'").all();assert.equal(alerts.length,1);assert.equal(alerts[0].recipient_id,'member');assert.equal(alerts[0].email_enabled,0);assert.ok(alerts[0].body.includes('resonate_ic@outlook.com'));assert.ok(alerts[0].body.includes('关闭邮件通知'));assert.equal(db.prepare('SELECT COUNT(*) n FROM email_outbox').get().n,1);assert.equal(calls.filter(x=>x.includes('/sendMail')).length,1);
 });
});
