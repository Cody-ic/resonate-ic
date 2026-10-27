// Isolated production-bundle API load probe. No live data, keys, or paid network calls.
import {Miniflare} from 'miniflare';
import {Pool} from 'undici';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {hashPassword} from 'better-auth/crypto';

const root=process.cwd(),state=path.join(root,'outputs','catalog-read-'+new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(state,{recursive:true});
const wr=path.join(root,'dist/server'),cfg=JSON.parse(fs.readFileSync(path.join(wr,'wrangler.json'),'utf8')),entry=path.join(wr,'index.js');
const modules=[entry,...fs.readdirSync(wr,{recursive:true}).filter(p=>/\.(?:js|mjs)$/.test(p)&&!p.split(/[\\/]/).some(x=>x.startsWith('.'))).map(p=>path.join(wr,p)).filter(p=>p!==entry)].map(p=>({type:'ESModule',path:p}));
const direct=process.argv.includes('--direct'),unbounded=process.argv.includes('--unbounded'),base='http://127.0.0.1:5184',password=crypto.randomBytes(24).toString('hex'),ids=Array.from({length:200},()=>crypto.randomUUID());
const connections=new Pool(base,{connections:200,pipelining:1});
const report={startedAt:Date.now(),scope:'One local Miniflare/workerd production-bundle isolate, isolated D1/R2; no cloud CPU enforcement, no browser assets or production network',provider:'No model calls',transport:direct?'Miniflare.dispatchFetch':unbounded?'unbounded new loopback sockets (diagnostic)':'HTTP keep-alive pool, 200 connections; simultaneous requests may queue for a connection',retries:0,scenarios:{},state};
let db;
function save(){fs.writeFileSync(path.join(state,'report.json'),JSON.stringify(report,null,2));}
const bindings={BETTER_AUTH_SECRET:crypto.randomBytes(32).toString('hex'),BETTER_AUTH_URL:base,PLATFORM_AUTH_ENABLED:'false',ADMIN_USER_IDS:ids[0],MAIL_PROVIDER:'none'};
const mf=new Miniflare({name:'catalog-read-load',host:'127.0.0.1',port:5184,modules,modulesRoot:wr,modulesRules:[{type:'ESModule',include:['**/*.js','**/*.mjs'],fallthrough:true}],compatibilityDate:cfg.compatibility_date,compatibilityFlags:cfg.compatibility_flags,bindings,durableObjects:{REVIEW_COORDINATOR:{className:'ReviewCoordinator',useSQLite:true}},durableObjectsPersist:path.join(state,'do'),workflows:{REVIEW_WORKFLOW:{name:'review-workflow',className:'ReviewWorkflow'}},workflowsPersist:path.join(state,'workflows'),d1Databases:{DB:'concurrency-isolated'},d1Persist:path.join(state,'d1'),r2Buckets:{BUCKET:'concurrency-isolated'},r2Persist:path.join(state,'r2'),outboundService:()=>{throw Error('External network calls are prohibited in this test');}});
function client(index,ip=`198.18.0.${index+1}`){let cookie='';return {index,async request(method,url,body){const start=performance.now();try{const response=await (direct?mf.dispatchFetch.bind(mf):fetch)(base+url,{method,headers:{Origin:base,'Content-Type':'application/json','CF-Connecting-IP':ip,...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body),...(!direct&&!unbounded?{dispatcher:connections}:{}),signal:AbortSignal.timeout(120000)});const set=response.headers.getSetCookie();if(set.length){const jar=new Map(cookie.split('; ').filter(Boolean).map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)];}));for(const c of set){const s=c.split(';')[0],i=s.indexOf('=');jar.set(s.slice(0,i),s.slice(i+1));}cookie=[...jar].map(x=>x.join('=')).join('; ');}const text=await response.text();let value;try{value=JSON.parse(text);}catch(error){return {status:response.status,ms:performance.now()-start,value:{error:'INVALID_JSON',message:error.message,bytes:Buffer.byteLength(text),preview:text.slice(0,800),contentType:response.headers.get('content-type')},invalidBody:true};}return {status:response.status,ms:performance.now()-start,value};}catch(e){return {status:0,ms:performance.now()-start,value:{error:e.message,stack:e.stack,cause:e.cause?{message:e.cause.message,code:e.cause.code,name:e.cause.name}:null}};}},async login(){return this.request('POST','/api/auth/sign-in/email',{email:`member${index}@example.test`,password});}};}
const clients=ids.map((_,i)=>client(i));
function summary(rows,start){const times=rows.map(r=>r.ms).sort((a,b)=>a-b);return {requests:rows.length,statuses:rows.reduce((s,r)=>(s[r.status]=(s[r.status]??0)+1,s),{}),wallMs:performance.now()-start,p50Ms:times[Math.floor(times.length*.5)],p95Ms:times[Math.floor(times.length*.95)],maxMs:times.at(-1),errors:rows.filter(r=>r.status<200||r.status>=300||r.invalidBody).map(r=>({status:r.status,body:r.value}))};}
async function scenario(name,functions){console.log('START '+name);const t=performance.now(),rows=await Promise.all(functions.map(fn=>fn()));report.scenarios[name]=summary(rows,t);save();console.log(JSON.stringify({scenario:name,...report.scenarios[name],errors:report.scenarios[name].errors.slice(0,3)}));return rows;}
const draft=i=>({title:`LOAD-PROJECT-${i}`,summary:'隔离压力测试：检查多个同学同时提交嵌入式项目时的响应。',category:'嵌入式系统',hardware:'STM32F103开发板，STM32CubeIDE工具链，3.3V供电。',version:'v1',stage:'进行中',description:'这是一份隔离压测工程说明，用于核对并发提交、审核任务与通知的一致性。'.repeat(60),license:'MIT',links:[{type:'repository',label:'项目仓库',url:'https://example.com/load-project'}],tags:['屏幕显示'],platforms:[{name:'ST',family:'mcu'}],sources:[{name:'自主项目'}]});
try{
 await mf.ready;db=await mf.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort())for(const statement of fs.readFileSync(path.join('drizzle',file),'utf8').replace(/--> statement-breakpoint/g,'').split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(statement).run();
 const hashed=await hashPassword(password),now=Date.now(),statements=[];
 for(let i=0;i<ids.length;i++){
 statements.push(db.prepare('INSERT INTO users(id,name,created_at) VALUES(?,?,?)').bind(ids[i],`压测用户${i}`,now-7*86400000));
 statements.push(db.prepare('INSERT INTO auth_user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,1,?,?)').bind(ids[i],`压测用户${i}`,`member${i}@example.test`,now-7*86400000,now));
 statements.push(db.prepare("INSERT INTO auth_account(id,user_id,account_id,provider_id,password,created_at,updated_at) VALUES(?,?,?,'credential',?,?,?)").bind(crypto.randomUUID(),ids[i],ids[i],hashed,now,now));statements.push(db.prepare("INSERT INTO notifications(id,event_key,recipient_id,title,body,state,kind,created_at) VALUES(?,?,?,?,?,'ready','load-test',?)").bind(crypto.randomUUID(),'private-fixture:'+i,ids[i],'仅属于当前用户',`private-member-${i}`,now));}
 for(let i=0;i<statements.length;i+=50)await db.batch(statements.slice(i,i+50));
 const warm=await clients[0].login();if(warm.status!==200)throw Error('Authentication setup failed: '+JSON.stringify(warm.value));
 await scenario('200-simultaneous-password-logins-distinct-ips',clients.map(c=>()=>c.login()));
 const me=await scenario('200-simultaneous-authenticated-me-requests',clients.map(c=>()=>c.request('GET','/api/me')));report.scenarios['200-simultaneous-authenticated-me-requests'].authenticatedUsers=me.filter(r=>r.value.user).length;save();if(me.some((r,i)=>r.status!==200||r.value.user?.id!==ids[i]))throw Error('Session identity mismatch');
 const created=await clients[0].request('POST','/api/projects',draft('public'));if(created.status!==201)throw Error('Project seed failed '+JSON.stringify(created.value));
 const projectId=created.value.id,revisionId=created.value.revisionId;
 await db.batch([db.prepare("UPDATE revisions SET status='published' WHERE id=?").bind(revisionId),db.prepare('UPDATE projects SET published_id=? WHERE id=?').bind(revisionId,projectId)]);
 const endpoints=['/api/projects',`/api/projects/${projectId}`,'/api/notifications'];
 async function readAll(c,parallel=false){const started=performance.now();const rows=parallel?await Promise.all(endpoints.map(url=>c.request('GET',url))):[];if(!parallel)for(const url of endpoints)rows.push(await c.request('GET',url));if(rows[0].status===200&&!rows[0].value.items?.some(p=>p.id===projectId))rows[0].invalidBody=true;if(rows[1].status===200&&rows[1].value.project?.id!==projectId)rows[1].invalidBody=true;if(rows[2].status===200&&(rows[2].value.items?.length!==1||rows[2].value.items[0].recipient_id!==ids[c.index]||rows[2].value.items[0].body!==`private-member-${c.index}`))rows[2].invalidBody=true;return {status:rows.every(r=>r.status===200&&!r.invalidBody)?200:(rows.find(r=>r.status!==200||r.invalidBody).invalidBody?599:rows.find(r=>r.status!==200||r.invalidBody).status||0),ms:performance.now()-started,value:{requests:rows.length,errors:rows.map((r,i)=>({...r,endpoint:endpoints[i]})).filter(r=>r.status!==200||r.invalidBody)}};}
 for(let round=1;round<=4;round++)await scenario(`200-users-three-api-reads-each-round-${round}`,clients.map(c=>()=>readAll(c)));
 await scenario('600-concurrent-health-requests',Array.from({length:600},(_,i)=>()=>clients[i%200].request('GET','/api/health')));
 await scenario('200-users-three-parallel-api-reads-each',clients.map(c=>()=>readAll(c,true)));
 report.finishedAt=Date.now();save();const failures=Object.values(report.scenarios).some(s=>s.errors?.length);console.log(JSON.stringify({state,failures}));if(failures)process.exitCode=1;
}catch(e){report.error=e.stack;save();console.error(e.message);process.exitCode=1;}finally{await connections.close();await mf.dispose();}
