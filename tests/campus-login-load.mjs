// Real password/session endpoints against the production bundle, isolated D1.
// Synthetic IP labels simulate group membership, not geographical routing.
import {Miniflare} from 'miniflare';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {hashPassword} from 'better-auth/crypto';
import {createRateLimitKey} from '@better-auth/core/utils/ip';

const root=process.cwd(),state=path.join(root,'outputs','campus-login-'+new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(state,{recursive:true});
const wr=path.join(root,'dist/server'),cfg=JSON.parse(fs.readFileSync(path.join(wr,'wrangler.json'),'utf8')),entry=path.join(wr,'index.js');
const modules=[entry,...fs.readdirSync(wr,{recursive:true}).filter(p=>/\.(?:js|mjs)$/.test(p)&&!p.split(/[\\/]/).some(x=>x.startsWith('.'))).map(p=>path.join(wr,p)).filter(p=>p!==entry)].map(p=>({type:'ESModule',path:p}));
const base='http://127.0.0.1:5185',password=crypto.randomBytes(24).toString('hex'),ids=Array.from({length:503},()=>crypto.randomUUID());
const report={startedAt:Date.now(),scope:'Local production-bundle API test. No cloud CPU limits, actual campus WAN traffic or geoIP lookup.',testIPs:'Reserved benchmarking/documentation addresses only; no real-campus allowlist enabled.',groups:{campusSharedExit:300,nanjingSeparateIPs:100,wuxiSeparateIPs:80,otherSeparateIPs:20},scenarios:{},checks:[],realProviderCalls:0,state};
const bindings={BETTER_AUTH_SECRET:crypto.randomBytes(32).toString('hex'),BETTER_AUTH_URL:base,PLATFORM_AUTH_ENABLED:'false',SEU_LOGIN_TRUSTED_CIDRS:'',MAIL_PROVIDER:'none'};
const options={name:'campus-login-load',host:'127.0.0.1',port:5185,modules,modulesRoot:wr,modulesRules:[{type:'ESModule',include:['**/*.js','**/*.mjs'],fallthrough:true}],compatibilityDate:cfg.compatibility_date,compatibilityFlags:cfg.compatibility_flags,bindings,d1Databases:{DB:'campus-login-isolated'},d1Persist:path.join(state,'d1'),r2Buckets:{BUCKET:'campus-login-isolated'},r2Persist:path.join(state,'r2'),outboundService:()=>{throw Error('External network calls are prohibited in this test');}};
const mf=new Miniflare(options);let db;
const save=()=>fs.writeFileSync(path.join(state,'report.json'),JSON.stringify(report,null,2));
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);save();console.log('PASS '+name);};
function client(index,ip,extraHeaders={}){let cookie='';return {index,ip,async request(method,url,body){const t=performance.now();try{const response=await fetch(base+url,{method,headers:{Origin:base,'Content-Type':'application/json','CF-Connecting-IP':ip,...extraHeaders,...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(120000)});const set=response.headers.getSetCookie();if(set.length)cookie=set.map(x=>x.split(';')[0]).join('; ');const value=await response.json();return {status:response.status,ms:performance.now()-t,value,retryAfter:response.headers.get('retry-after')};}catch(e){return {status:0,ms:performance.now()-t,value:{error:e.message}};}},async login(overrides={}){return this.request('POST','/api/auth/sign-in/email',{email:`member${index}@example.test`,password,...overrides});}};}
const clients=ids.slice(0,500).map((_,i)=>client(i,i<300?'198.18.0.1':`198.19.0.${i-299}`));
const stats=rows=>{const times=rows.map(r=>r.ms).sort((a,b)=>a-b);return {requests:rows.length,statuses:rows.reduce((s,r)=>(s[r.status]=(s[r.status]??0)+1,s),{}),p50Ms:times[Math.floor(times.length*.5)],p95Ms:times[Math.floor(times.length*.95)],maxMs:times.at(-1)};};
async function run(name,fns){console.log('START '+name);const t=performance.now(),rows=await Promise.all(fns.map(fn=>fn()));report.scenarios[name]={...stats(rows),wallMs:performance.now()-t,errors:rows.filter(r=>r.status>=400||r.status===0).slice(0,4).map(r=>({status:r.status,value:r.value}))};save();console.log(JSON.stringify({scenario:name,...report.scenarios[name]}));return rows;}
async function exhaustIp(ip){const bucket=Math.floor(Date.now()/60000);await db.prepare('INSERT INTO limits(key,count,expires_at) VALUES(?,600,?) ON CONFLICT(key) DO UPDATE SET count=600,expires_at=excluded.expires_at').bind(`auth:${createRateLimitKey(ip,'/sign-in/email')}:${bucket}`,(bucket+1)*60000).run();}
try{
 await mf.ready;db=await mf.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort())for(const statement of fs.readFileSync(path.join('drizzle',file),'utf8').replace(/--> statement-breakpoint/g,'').split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(statement).run();
 const hash=await hashPassword(password),now=Date.now(),statements=[];
 for(let i=0;i<ids.length;i++){
  statements.push(db.prepare('INSERT INTO users(id,name,created_at) VALUES(?,?,?)').bind(ids[i],`压测用户${i}`,now-604800000));
  statements.push(db.prepare('INSERT INTO auth_user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,1,?,?)').bind(ids[i],`压测用户${i}`,`member${i}@example.test`,now-604800000,now));
  statements.push(db.prepare("INSERT INTO auth_account(id,user_id,account_id,provider_id,password,created_at,updated_at) VALUES(?,?,?,'credential',?,?,?)").bind(crypto.randomUUID(),ids[i],ids[i],hash,now,now));
 }
 for(let i=0;i<statements.length;i+=50)await db.batch(statements.slice(i,i+50));
 const rows=await run('500-password-logins-without-campus-exemption',clients.map(c=>()=>c.login()));
 for(const [name,start,end] of [['campus',0,300],['nanjing',300,400],['wuxi',400,480],['other',480,500]])report.scenarios[name]=stats(rows.slice(start,end));save();
 check('all 500 distinct accounts sign in; 300 share one ordinary, unprivileged IP',rows.every(r=>r.status===200));
 const sessions=await run('500-authenticated-session-reads',clients.map(c=>()=>c.request('GET','/api/me')));
 check('all 500 session identities match their own accounts',sessions.every((r,i)=>r.status===200&&r.value.user?.id===ids[i]));
 // Change only a test binding; no real SEU prefix is inferred from this test.
 bindings.SEU_LOGIN_TRUSTED_CIDRS='198.18.0.1/32,2001:db8:abcd::/48';await mf.setOptions({...options,bindings});await mf.ready;db=await mf.getD1Database('DB');
 if(Date.now()%60000>58000)await new Promise(r=>setTimeout(r,2100));
 const attempts=await run('same-account-20-ips-including-trusted-campus',Array.from({length:20},(_,i)=>()=>client(500,i%2?'198.18.0.1':`203.0.113.${i+1}`).login({email:i%2?'MEMBER500@EXAMPLE.TEST':' member500@example.test ',password:'wrong-password-for-limit-test'})));
 check('one account still permits only 8 attempts across IPs and email variants',attempts.filter(r=>r.status===401).length===8&&attempts.filter(r=>r.status===429&&r.value.code==='LOGIN_ACCOUNT_RATE_LIMITED').length===12);
 check('account throttles provide a retry delay',attempts.filter(r=>r.status===429).every(r=>Number(r.retryAfter)>0));
 await exhaustIp('198.18.0.1');const campus=await client(501,'198.18.0.1').login();check('verified campus IPv4 bypasses only the exhausted IP aggregate cap',campus.status===200);
 await exhaustIp('2001:db8:abcd:23::9');const v6=await client(502,'2001:db8:abcd:23::9').login();check('verified campus IPv6 supports subnet matching',v6.status===200);
 await exhaustIp('198.51.100.7');const other=await client(501,'198.51.100.7',{'X-Forwarded-For':'198.18.0.1'}).login();check('untrusted client cannot claim campus through X-Forwarded-For',other.status===429);
 const keys=(await db.prepare("SELECT key FROM limits WHERE key LIKE 'auth:login-account:%'").all()).results;check('account counters never store plaintext email addresses',keys.length>0&&keys.every(r=>!r.key.includes('@')));
 report.finishedAt=Date.now();report.sessions=(await db.prepare('SELECT COUNT(*) n FROM auth_session').first()).n;save();console.log(JSON.stringify({report:path.join(state,'report.json'),checks:report.checks.length,realProviderCalls:0}));
}catch(e){report.error=e.stack;save();console.error(e.stack);process.exitCode=1;}finally{await mf.dispose();}
