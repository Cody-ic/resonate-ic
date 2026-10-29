// Isolated production-bundle API load probe. No live data, keys, or paid network calls.
import {Miniflare} from 'miniflare';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {hashPassword} from 'better-auth/crypto';

const root=process.cwd(),state=path.join(root,'outputs','concurrency-'+new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(state,{recursive:true});
const wr=path.join(root,'dist/server'),cfg=JSON.parse(fs.readFileSync(path.join(wr,'wrangler.json'),'utf8')),entry=path.join(wr,'index.js');
const modules=[entry,...fs.readdirSync(wr,{recursive:true}).filter(p=>/\.(?:js|mjs)$/.test(p)&&!p.split(/[\\/]/).some(x=>x.startsWith('.'))).map(p=>path.join(wr,p)).filter(p=>p!==entry)].map(p=>({type:'ESModule',path:p}));
const base='http://127.0.0.1:5184',password=crypto.randomBytes(24).toString('hex'),ids=Array.from({length:106},()=>crypto.randomUUID());
const calls=[],report={startedAt:Date.now(),scope:'One local Miniflare/workerd production-bundle isolate, isolated D1/R2; no cloud CPU enforcement, no browser assets or production network',provider:'Mocked 1000 ms response, no paid network',scenarios:{},state};
const pause=ms=>new Promise(r=>setTimeout(r,ms));let active=0,maxActive=0,db;const activeByLane={discussion:0,project:0},maxByLane={discussion:0,project:0};const parentBodies=new Map(),replyCases=new Map();
function save(){fs.writeFileSync(path.join(state,'report.json'),JSON.stringify({...report,modelCalls:calls,maxActiveModelCalls:maxActive},null,2));}
const bindings={BETTER_AUTH_SECRET:crypto.randomBytes(32).toString('hex'),BETTER_AUTH_URL:base,PLATFORM_AUTH_ENABLED:'false',ADMIN_USER_IDS:ids[0],PROJECT_REVIEW_API_KEY:'test-project',DISCUSSION_REVIEW_API_KEY:'test-discussion',PROJECT_AI_MONTHLY_MAX_CALLS:'1000',DISCUSSION_AI_MONTHLY_MAX_CALLS:'1000',PROJECT_AI_MONTHLY_BUDGET_MICROS:'30000000',DISCUSSION_AI_MONTHLY_BUDGET_MICROS:'30000000',AI_TOTAL_MONTHLY_BUDGET_MICROS:'50000000',AI_OFFPEAK_DATES:new Date(Date.now()+8*3600000).toISOString().slice(0,10),MAIL_PROVIDER:'none'};
const mf=new Miniflare({name:'concurrency-probe',host:'127.0.0.1',port:5184,modules,modulesRoot:wr,modulesRules:[{type:'ESModule',include:['**/*.js','**/*.mjs'],fallthrough:true}],compatibilityDate:cfg.compatibility_date,compatibilityFlags:cfg.compatibility_flags,bindings,durableObjects:{REVIEW_COORDINATOR:{className:'ReviewCoordinator',useSQLite:true}},durableObjectsPersist:path.join(state,'do'),workflows:{REVIEW_WORKFLOW:{name:'review-workflow',className:'ReviewWorkflow'}},workflowsPersist:path.join(state,'workflows'),d1Databases:{DB:'concurrency-isolated'},d1Persist:path.join(state,'d1'),r2Buckets:{BUCKET:'concurrency-isolated'},r2Persist:path.join(state,'r2'),outboundService:async request=>{
 if(new URL(request.url).hostname!=='api.deepseek.com')throw Error('Unexpected external destination blocked');
 const data=await request.json(),content=data.messages.find(m=>m.role==='user').content,input=JSON.parse(content),label=input.submission?.title??(input.target?.type==='reply'?input.target.body:input.target?.title)??input.target?.body??'unknown';
 const lane=input.submission?'project':'discussion',reply=input.target?.type==='reply';
 if(reply){
  const sample=replyCases.get(input.target.body);if(!sample)throw Error('Unknown reply');
  if(input.parentContext?.id!==sample.topicId||input.parentContext.body!==parentBodies.get(sample.topicId)||input.parentContext.scope!=='context_only'||input.target.topicBody!==undefined)throw Error('Reply parent context missing or mixed into target');
 }
 const call={label,reply,lane,parentId:input.parentContext?.id,startedAt:Date.now()};calls.push(call);active++;activeByLane[lane]++;maxByLane[lane]=Math.max(maxByLane[lane],activeByLane[lane]);maxActive=Math.max(active,maxActive);await pause(300);active--;activeByLane[lane]--;call.finishedAt=Date.now();
 const blocked=reply&&replyCases.get(input.target.body).blocked;
 const result=input.submission?{decision:'pass',summary:'隔离压测作品审核通过。',findings:[],improvements:[],taxonomy:{},authorNotice:{title:'作品审核通过',body:'隔离压测通知，不会发往真实用户。'}}:{task:'publish',decision:blocked?'revise':'pass',summary:blocked?'回复包含针对个人的直接辱骂，当前不予发布。':'讨论审核通过。',findings:blocked?[{rule:'abuse',quote:'你就是个废物',explanation:'针对个人的直接辱骂，父评论中的技术讨论不构成许可。'}]:[],technicalIssues:[],commenterNotice:blocked?{title:'回复未通过审核',body:'请移除针对个人的辱骂，可保留具体的技术讨论内容。'}:null};
 return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(result)}}],usage:{prompt_tokens:500,completion_tokens:100,total_tokens:600}});
}});
function client(index,ip=`198.18.0.${index+1}`){let cookie='';return {index,async request(method,url,body){const start=performance.now();try{const response=await fetch(base+url,{method,headers:{Origin:base,'Content-Type':'application/json','CF-Connecting-IP':ip,...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(120000)});const set=response.headers.getSetCookie();if(set.length){const jar=new Map(cookie.split('; ').filter(Boolean).map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)];}));for(const c of set){const s=c.split(';')[0],i=s.indexOf('=');jar.set(s.slice(0,i),s.slice(i+1));}cookie=[...jar].map(x=>x.join('=')).join('; ');}const value=await response.json();return {status:response.status,ms:performance.now()-start,value};}catch(e){return {status:0,ms:performance.now()-start,value:{error:e.message}};}},async login(){return this.request('POST','/api/auth/sign-in/email',{email:`member${index}@example.test`,password});}};}
const clients=ids.map((_,i)=>client(i));
function summary(rows,start){const times=rows.map(r=>r.ms).sort((a,b)=>a-b);return {requests:rows.length,statuses:rows.reduce((s,r)=>(s[r.status]=(s[r.status]??0)+1,s),{}),wallMs:performance.now()-start,p50Ms:times[Math.floor(times.length*.5)],p95Ms:times[Math.floor(times.length*.95)],maxMs:times.at(-1),errors:rows.filter(r=>r.status<200||r.status>=300).slice(0,6).map(r=>({status:r.status,body:r.value}))};}
async function scenario(name,functions){console.log('START '+name);const t=performance.now(),rows=await Promise.all(functions.map(fn=>fn()));report.scenarios[name]=summary(rows,t);save();console.log(JSON.stringify({scenario:name,...report.scenarios[name]}));return rows;}
async function counts(){return {topics:(await db.prepare("SELECT status,COUNT(*) n FROM topics GROUP BY status").all()).results,reviews:(await db.prepare("SELECT lane,state,COUNT(*) n FROM reviews GROUP BY lane,state").all()).results,notifications:(await db.prepare('SELECT COUNT(*) n FROM notifications').first()).n};}
const draft=i=>({title:`LOAD-PROJECT-${i}`,summary:'隔离压力测试：检查多个同学同时提交嵌入式项目时的响应。',category:'嵌入式系统',hardware:'STM32F103开发板，STM32CubeIDE工具链，3.3V供电。',version:'v1',stage:'进行中',description:'这是一份隔离压测工程说明，用于核对并发提交、审核任务与通知的一致性。'.repeat(60),license:'MIT',links:[{type:'repository',label:'项目仓库',url:'https://example.com/load-project'}],tags:['屏幕显示'],platforms:[{name:'ST',family:'mcu'}],sources:[{name:'自主项目'}]});
try{
 await mf.ready;db=await mf.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort())for(const statement of fs.readFileSync(path.join('drizzle',file),'utf8').replace(/--> statement-breakpoint/g,'').split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(statement).run();
 const hashed=await hashPassword(password),now=Date.now(),statements=[];
 for(let i=0;i<ids.length;i++){
 statements.push(db.prepare('INSERT INTO users(id,name,created_at) VALUES(?,?,?)').bind(ids[i],`压测用户${i}`,now-7*86400000));
 statements.push(db.prepare('INSERT INTO auth_user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,1,?,?)').bind(ids[i],`压测用户${i}`,`member${i}@example.test`,now-7*86400000,now));
 statements.push(db.prepare("INSERT INTO auth_account(id,user_id,account_id,provider_id,password,created_at,updated_at) VALUES(?,?,?,'credential',?,?,?)").bind(crypto.randomUUID(),ids[i],ids[i],hashed,now,now));}
 for(let i=0;i<statements.length;i+=50)await db.batch(statements.slice(i,i+50));
 const warm=await clients[0].login();if(warm.status!==200)throw Error('Authentication setup failed: '+JSON.stringify(warm.value));
 const logins=await scenario('106-isolated-user-logins',clients.map(c=>()=>c.login()));if(logins.some(r=>r.status!==200))throw Error('Login fixture failed');
 const created=await clients[0].request('POST','/api/projects',draft('public'));if(created.status!==201)throw Error('Project seed failed '+JSON.stringify(created.value));
 const projectId=created.value.id,revisionId=created.value.revisionId;
 await db.batch([db.prepare("UPDATE revisions SET status='published' WHERE id=?").bind(revisionId),db.prepare('UPDATE projects SET published_id=? WHERE id=?').bind(revisionId,projectId)]);
 const comments=await scenario('50-users-submit-comments-at-once',clients.slice(1,51).map((c,i)=>()=>c.request('POST','/api/topics',{projectId,board:'项目求助',title:`LOAD-COMMENT-${i}`,body:i%5===2?`讨论用语：有人使用“rnm”，我认为不应将它当作正常技术交流。父评论编号${i}。`:`这是第${i}位同学的隔离压测评论，补好去耦电容后烧录稳定了，希望讨论显示驱动与开发环境。`})));if(comments.some(r=>r.status!==201))throw Error('Comment submit failed');
 report.commentReviewIds=comments.map(r=>r.value.reviewId);report.afterCommentResponses=await counts();save();
 const replySubmissions=await scenario('reply-immediately-as-each-parent-publishes',comments.map((comment,i)=>async()=>{
  let parent;
  for(let wait=0;wait<1200;wait++){parent=await db.prepare('SELECT status,body FROM topics WHERE id=?').bind(comment.value.id).first();if(parent?.status==='published')break;await pause(50);}
  if(parent?.status!=='published')throw Error('Parent did not publish');
  parentBodies.set(comment.value.id,parent.body);
  const blocked=i%5===0,body=blocked?`rnm，你就是个废物。回复编号${i}。`:i%5===1?`对，就是这个。我也会按这个办法试试。回复编号${i}。`:i%5===2?`同意，引用“rnm”讨论审核规则可以，但不能用来骂人。回复编号${i}。`:i%5===3?`卧槽，终于跑通了！谢谢你补充这个细节。回复编号${i}。`:`我不赞同这个参数，可以再看看供电与去耦。回复编号${i}。`;
  replyCases.set(body,{topicId:comment.value.id,blocked,index:i});
  return clients[51+i].request('POST',`/api/topics/${comment.value.id}/replies`,{body});
 }));if(replySubmissions.some(r=>r.status!==201))throw Error('Reply submit failed');
 report.replyReviewIds=replySubmissions.map(r=>r.value.reviewId);
 for(let i=0;i<1800;i++){const pending=await db.prepare("SELECT COUNT(*) n FROM reviews WHERE lane='discussion' AND state IN ('queued','running')").first();if(!pending.n)break;await pause(100);}
 report.afterCommentsSettled=await counts();report.replies=(await db.prepare('SELECT status,COUNT(*) n FROM replies GROUP BY status').all()).results;
 for(let i=0;i<50;i++){
  const review=await db.prepare('SELECT state FROM reviews WHERE id=?').bind(replySubmissions[i].value.reviewId).first();
  if(review.state!==(i%5===0?'needs_changes':'approved'))throw Error('Unexpected reply outcome '+i);
  const activity=await db.prepare("SELECT id,recipient_id,email_enabled,state FROM notifications WHERE review_id=? AND kind='reply'").bind(replySubmissions[i].value.reviewId).first();
  if(i%5===0){
   if(activity)throw Error('Rejected reply leaked as activity');
   const outcome=await db.prepare("SELECT recipient_id,email_enabled,state FROM notifications WHERE review_id=? AND kind='review'").bind(replySubmissions[i].value.reviewId).first();
   if(!outcome||outcome.recipient_id!==ids[51+i]||outcome.email_enabled!==1||outcome.state!=='ready')throw Error('Rejected reply notice missing');
  }else if(!activity||activity.recipient_id!==ids[1+i]||activity.email_enabled!==1||!await db.prepare('SELECT id FROM email_outbox WHERE notification_id=?').bind(activity.id).first())throw Error('Reply notification recipients or mail delivery missing');
 }
 report.contextChecks=50;report.expectedBlockedReplies=10;report.notificationChecks=50;save();
 const projects=await scenario('5-users-create-projects-at-once',clients.slice(101,106).map((c,i)=>()=>c.request('POST','/api/projects',draft(i))));
 await scenario('5-users-submit-projects-at-once',projects.map((r,i)=>()=>clients[101+i].request('POST',`/api/projects/${r.value.id}/submit`,{})));for(let i=0;i<600;i++){const pending=await db.prepare("SELECT COUNT(*) n FROM reviews WHERE lane='project' AND state IN ('queued','running')").first();if(!pending.n)break;await pause(100);}report.afterProjectsSettled=await counts();save();
 const sharedIp=Array.from({length:20},(_,i)=>client(i,'198.19.0.1'));
 await scenario('20-password-logins-shared-campus-ip',sharedIp.map(c=>()=>c.login()));
 report.beforeOneQueueTick=await counts();/* No manual queue tick: idle completion must drain everything. */await pause(2500);report.afterOneQueueTick=await counts();
 report.modelCallsByLabel=calls.reduce((s,c)=>(s[c.label]=(s[c.label]??0)+1,s),{});report.duplicateModelCalls=Object.entries(report.modelCallsByLabel).filter(([,n])=>n>1);report.final=await counts();report.finishedAt=Date.now();report.maxByLane=maxByLane;report.budget=(await clients[0].request('GET','/api/admin/workflows')).value;save();if(maxByLane.discussion>2||maxByLane.project>1||report.final.reviews.some(r=>['queued','running','disputed'].includes(r.state))||report.duplicateModelCalls.length)throw Error('Queue did not drain with bounded concurrency');console.log(JSON.stringify({state,final:report.final,afterCommentsSettled:report.afterCommentsSettled,maxActiveModelCalls:maxActive,duplicateModelCalls:report.duplicateModelCalls}));
}catch(e){report.error=e.stack;save();console.error(e.message);process.exitCode=1;}finally{await mf.dispose();}
