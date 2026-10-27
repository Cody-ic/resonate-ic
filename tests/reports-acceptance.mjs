// Isolated production bundle; published fixtures, no model/mail HTTP allowed.
import {Miniflare} from 'miniflare';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const out=path.resolve('outputs/reports-'+Date.now());mkdirSync(out,{recursive:true});
const root=path.resolve('dist/server'),cfg=JSON.parse(readFileSync(path.join(root,'wrangler.json'),'utf8')),entry=path.join(root,'index.js');
const modules=[entry,...readdirSync(root,{recursive:true}).filter(p=>/\.(js|mjs)$/.test(p)&&!p.split(/[\\/]/).some(x=>x.startsWith('.'))).map(p=>path.join(root,p)).filter(p=>p!==entry)].map(p=>({type:'ESModule',path:p}));
const base='http://127.0.0.1:5191',bindings={BETTER_AUTH_SECRET:crypto.randomBytes(32).toString('hex'),BETTER_AUTH_URL:base,PLATFORM_AUTH_ENABLED:'false',MAIL_DELIVERY_MODE:'off',PROJECT_AI_MONTHLY_MAX_CALLS:'0',DISCUSSION_AI_MONTHLY_MAX_CALLS:'0'};
let externalCalls=0;const options={name:'reports-acceptance',host:'127.0.0.1',port:5191,modules,modulesRoot:root,modulesRules:[{type:'ESModule',include:['**/*.js','**/*.mjs'],fallthrough:true}],compatibilityDate:cfg.compatibility_date,compatibilityFlags:cfg.compatibility_flags,bindings,d1Databases:{DB:'reports'},d1Persist:path.join(out,'d1'),r2Buckets:{BUCKET:'reports'},r2Persist:path.join(out,'r2'),durableObjects:{REVIEW_COORDINATOR:{className:'ReviewCoordinator',useSQLite:true}},durableObjectsPersist:path.join(out,'do'),workflows:{REVIEW_WORKFLOW:{name:'reports',className:'ReviewWorkflow'}},workflowsPersist:path.join(out,'workflows'),outboundService:()=>{externalCalls++;throw Error('External HTTP forbidden');}};
const mf=new Miniflare(options),checks=[];let db;
const check=(name,pass)=>{assert.ok(pass,name);checks.push(name);console.log('PASS',name);};
function client(){let cookies=new Map();return {async call(method,p,body){const r=await fetch(base+'/api/'+p,{method,headers:{Origin:base,'Content-Type':'application/json','CF-Connecting-IP':'203.0.113.55',Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; ')},body:body===undefined?undefined:JSON.stringify(body)});for(const c of r.headers.getSetCookie()){const v=c.split(';')[0],i=v.indexOf('=');cookies.set(v.slice(0,i),v.slice(i+1));}return {status:r.status,value:await r.json()};},async ok(method,p,body){const r=await this.call(method,p,body);assert.ok(r.status>=200&&r.status<300,JSON.stringify(r));return r.value;}};}
const admin=client(),reporter=client(),stranger=client(),anon=client();
try{
 await mf.ready;db=await mf.getD1Database('DB');for(const f of readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+f,'utf8').replace(/--> statement-breakpoint/g,'').split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();
 const ids=[];for(const [c,name] of [[admin,'管理员'],[reporter,'举报人'],[stranger,'其他用户']]){await c.ok('POST','account/register',{name,email:crypto.randomUUID()+'@example.test',password:crypto.randomBytes(20).toString('hex')});ids.push((await c.ok('GET','me')).user.id);}
 bindings.ADMIN_USER_IDS=ids[0];await mf.setOptions({...options,bindings});await mf.ready;db=await mf.getD1Database('DB');
 check('anonymous cannot submit or read reports',(await anon.call('POST','reports',{})).status===401&&(await anon.call('GET','reports')).status===401);
 for(const kind of ['project','resource','course']){
  const pid=crypto.randomUUID(),rid=crypto.randomUUID(),now=Date.now(),hash='fixture-'+rid;
  await db.prepare('INSERT INTO projects(id,owner_id,kind,head_id,published_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(pid,ids[2],kind,rid,rid,now,now).run();
  await db.prepare('INSERT INTO revisions(id,project_id,number,snapshot,digest,status,created_at) VALUES(?,?,1,?,?,?,?)').bind(rid,pid,JSON.stringify({title:kind+'已公开样例',kind}),hash,'published',now).run();
  await reporter.ok('POST','reports',{entityType:'revision',entityId:rid,reason:'请核对指定段落的隐私泄露问题。'});
  const job=await db.prepare('SELECT r.* FROM reviews r JOIN reports p ON p.review_id=r.id WHERE p.entity_id=?').bind(rid).first();
  check(kind+' report enters human report queue with reason',job.task==='report'&&job.state==='disputed'&&JSON.parse(job.context).reportReason.includes('隐私泄露'));
  if(kind==='project'){
    await db.prepare("UPDATE reviews SET task='publish',context=NULL WHERE id=?").bind(job.id).run();
    await db.prepare(readFileSync('drizzle/0011_report_task.sql','utf8')).run();
    const legacy=await db.prepare('SELECT task,state,context FROM reviews WHERE id=?').bind(job.id).first();
    check('legacy revision reports are repaired without changing decisions',legacy.task==='report'&&legacy.state==='disputed'&&JSON.parse(legacy.context).reportReason.includes('隐私泄露'));
  }
  check(kind+' is not removed on submission',!(await db.prepare('SELECT admin_lock_at FROM projects WHERE id=?').bind(pid).first()).admin_lock_at);
  check(kind+' duplicate rejected',(await reporter.call('POST','reports',{entityType:'revision',entityId:rid,reason:'重复举报'})).status===409);
  check(kind+' non-admin cannot resolve',(await reporter.call('POST',`admin/reviews/${job.id}/resolve-task`,{decision:'take_down',reason:'已确认涉及个人隐私，需要移除。'})).status===403);
  await admin.ok('POST',`admin/reviews/${job.id}/resolve-task`,{decision:'take_down',reason:'已逐字核对隐私信息，确认需要下架。'});
  check(kind+' human removal targets project rather than revision',!!(await db.prepare('SELECT admin_lock_at FROM projects WHERE id=?').bind(pid).first()).admin_lock_at);
  const result=await reporter.ok('GET','reports');check(kind+' reporter sees conclusion without private review data',result.items.some(x=>x.id&&x.resolved&&x.summary.includes('逐字核对'))&&!JSON.stringify(result).includes('reportReason')&&!JSON.stringify(result).includes('snapshot'));
 }
 check('other users cannot see reporter history',(await stranger.ok('GET','reports')).items.length===0);
 const receipt=await reporter.ok('GET','notifications');check('report submission and decisions generate site messages',receipt.items.some(x=>x.title==='举报已受理')&&receipt.items.some(x=>x.title==='举报人工复核结果'));
 // Stale revisions must not remove a newer public version.
 const pid=crypto.randomUUID(),rid=crypto.randomUUID(),next=crypto.randomUUID(),now=Date.now();
 await db.prepare('INSERT INTO projects(id,owner_id,kind,head_id,published_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(pid,ids[2],'project',rid,rid,now,now).run();
 await db.prepare('INSERT INTO revisions(id,project_id,number,snapshot,digest,status,created_at) VALUES(?,?,1,?,?,?,?)').bind(rid,pid,'{"title":"旧版"}','old','published',now).run();
 await reporter.ok('POST','reports',{entityType:'revision',entityId:rid,reason:'对旧版内容的具体举报'});
 const job=await db.prepare('SELECT review_id FROM reports WHERE entity_id=?').bind(rid).first();
 await db.prepare('INSERT INTO revisions(id,project_id,number,snapshot,digest,status,created_at) VALUES(?,?,2,?,?,?,?)').bind(next,pid,'{"title":"新版"}','new','published',now).run();await db.prepare('UPDATE projects SET published_id=?,head_id=? WHERE id=?').bind(next,next,pid).run();
 check('stale report cannot remove new public revision',(await admin.call('POST',`admin/reviews/${job.review_id}/resolve-task`,{decision:'take_down',reason:'旧版的处理不能影响更新后的公开版本'})).status===409);
 const tid=crypto.randomUUID(),reply=crypto.randomUUID();
 await db.prepare('INSERT INTO topics(id,owner_id,project_id,board,title,body,status,digest,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(tid,ids[2],pid,'项目求助','公开评论','用于举报流程验证的评论正文','published','topic-digest',now).run();
 await db.prepare('INSERT INTO replies(id,topic_id,owner_id,body,status,digest,created_at) VALUES(?,?,?,?,?,?,?)').bind(reply,tid,ids[2],'用于验证回复举报的正文','published','reply-digest',now).run();
 for(const [type,id] of [['topic',tid],['reply',reply]]){await reporter.ok('POST','reports',{entityType:type,entityId:id,reason:'请核验这条内容是否存在隐私问题'});check(type+' report persists',!!await db.prepare('SELECT id FROM reports WHERE entity_type=? AND entity_id=?').bind(type,id).first());}
 await db.prepare('UPDATE projects SET admin_lock_at=? WHERE id=?').bind(now,pid).run();
 check('hidden parent blocks further reply reporting',(await stranger.call('POST','reports',{entityType:'reply',entityId:reply,reason:'隐藏内容不应可被访问举报'})).status===404);
 check('no paid provider or real mail calls',externalCalls===0);
 writeFileSync(path.join(out,'result.json'),JSON.stringify({checks,passed:checks.length,externalCalls,productionDataModified:false},null,2));console.log(JSON.stringify({report:path.join(out,'result.json'),passed:checks.length}));
}finally{await mf.dispose();}
