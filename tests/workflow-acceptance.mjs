// Compiled Worker acceptance. All provider calls are intercepted; no paid APIs or email.
import {Miniflare} from 'miniflare';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
const root=process.cwd(),stamp=Date.now().toString(36),state=path.join(root,'outputs','workflow-acceptance-'+stamp);
mkdirSync(state,{recursive:true});
const workerRoot=path.join(root,'dist/server'),cfg=JSON.parse(readFileSync(path.join(workerRoot,'wrangler.json'),'utf8'));
const entry=path.join(workerRoot,'index.js');
const modules=[entry,...readdirSync(workerRoot,{recursive:true}).filter(p=>/\.(?:js|mjs)$/.test(p)&&!p.split(/[\\/]/).some(x=>x.startsWith('.'))).map(p=>path.join(workerRoot,p)).filter(p=>p!==entry)].map(p=>({type:'ESModule',path:p}));
const base='http://127.0.0.1:5180',checks=[],modelCalls=[];
let failProvider=false,releaseFeatured,holdFeatured=false,materialCalls=0;
const notice=(title,body)=>({title,body});
function providerResult(input){
 if(input.task==='featured_material')return {task:'featured_material',covered:input.segments.map(s=>s.id),summary:'本批逐段讲解显示外设的原理、操作实验和练习，能回到工程中实践。',concerns:[],evidence:[{id:input.segments[0].id,quote:input.segments[0].text.slice(0,80),explanation:'实际正文包含原理、操作与实践内容。'}]};
 if(input.task==='featured'){
  const badGap=input.nomination.evidence.includes('关键缺口'),invalid=input.nomination.evidence.includes('伪造证据'),noEvidence=input.nomination.evidence.includes('缺少证据'),noBasics=input.nomination.evidence.includes('前提不符');
  const refused=input.nomination.evidence.includes('资料不足'),disputed=input.nomination.evidence.includes('需要人工');
  return {investigation:{evidenceSufficient:!refused&&!disputed&&!badGap,reason:'已读实际说明与章节足以支持本隔离用例中的判断；不按通读比例入选。',unresolvedQuestions:badGap?['关键实践主张尚未得到证实。']:[],counterEvidence:[],limitations:['本测试使用拦截模型，不代表真实课程的质量结论。']},basics:{documentationClear:true,reproducible:!refused&&!noBasics,reason:'本隔离用例具有明确硬件与工具链说明。'},task:'featured',decision:disputed?'disputed':refused?'not_qualify':'qualify',summary:disputed?'存在具体材料争议，需要人工核对。':refused?'当前材料不能支持所选指标，普通发布不受影响。':'实际内容支持所选指标，已有成果可复用。',criteriaConfirmed:refused||disputed?[]:input.nomination.criteria,assessments:input.nomination.criteria.map(criterion=>({criterion,meets:!refused&&!disputed,reason:refused?'目前仅有概述，未体现指标对应成果。':disputed?'材料存在待人工判断的具体冲突。':'实际项目介绍有相应教学实践内容。',evidence:refused||disputed||noEvidence?[]:[{source:'项目介绍',quote:invalid?input.nomination.evidence:input.reviewEvidence??input.project.description,explanation:'引用实际提交内容作为本隔离测试的正面依据。'}]})),authorNotice:notice('精选评估结果',refused?'暂未入选精选，普通发布状态不受影响。':disputed?'暂不入选，等待人工复核。':'恭喜，作品通过精选评估。')};
 }
 if(input.task==='technical_check')return {task:'technical_check',status:'insufficient_evidence',summary:'尚缺实际构建日志，不能确认或否定编译失败。',evidence:[],questions:['如果方便的话，能否补充完整报错日志？'],commenterNotice:notice('关于你反馈的编译问题','目前还没有定位到原因。如果方便的话，欢迎补充报错日志。'),authorNotice:{kind:'unverified_feedback',...notice('有同学反馈编译遇到困难','尚未确认工程存在缺陷。如果方便的话，欢迎协助查看。'+(input.technicalIssues?.[0]?.claim??''))}};
 if(input.task==='report')return {task:'report',decision:'take_down',issueConfirmed:true,removalNecessary:true,summary:'核验发现明确需要下架的骚扰内容。',findings:[{rule:'abuse',quote:input.target.body,explanation:'在本次测试材料中确认需要下架。'}],technicalIssues:[]};
 if(input.task==='quality')return {task:'quality',decision:'qualify',summary:'讨论包含具体技术问题和有参考价值的过程。',findings:[]};
 if(input.submission){
  if(input.submission.title==='严重风险待核验')return {decision:'disputed',summary:'存在需人工核对的严重风险线索，当前版本暂不公开。',findings:[{rule:'illegal',quote:'严重风险线索',explanation:'隔离测试的风险证据占位，须核对后才能公开。',legalBasis:['national-unity']}],improvements:[],taxonomy:{},authorNotice:notice('内容暂缓公开','存在需要人工核对的严重风险，当前版本暂不公开。')};
  if(input.cover&&input.submission.title.includes('画面违规'))return {decision:'revise',summary:'封面画面含有明确不适合发布的推广内容。',findings:[{rule:'spam',quote:input.cover.marker,explanation:'隔离图像审核用例模拟实际画面命中。'}],improvements:[],taxonomy:{},authorNotice:notice('作品未通过审核','请更换包含推广内容的封面，原公开版本不变。')};
  const disputed=input.submission.title.includes('争议');
  return {featuredInvitation:input.submission.title==='分类验收作品'?{criteria:['teaching'],quote:input.submission.description,reason:'已读说明体现了可供学习的显示工程结构，可以考虑申请精选评估。'}:null,decision:disputed?'disputed':'pass',summary:disputed?'存在署名争议，作品先发布，待人工复核。':'作品审核通过。',findings:disputed?[{rule:'ownership',quote:'署名待核对',explanation:'存在具体归属线索，待人工核对。'}]:[],improvements:[],taxonomy:{tags:(input.submission.tags??[]).includes('烘焙甜点')?[{label:'烘焙甜点',action:'reject',rule:'irrelevant',reason:'此标签与提供的显示工程完全无关'}]:[],platforms:input.submission.platforms?.some(x=>x.name==='CH')?[{label:'CH',action:'replace',target:'ST',reason:'STM32F103工程对应ST，纠正错选平台'}]:[],sources:[]},authorNotice:notice(disputed?'作品已发布，待人工复核':'作品审核通过',disputed?'存在署名待核对事项，作品先发布并交人工复核。':'作品通过本次审核，分类方案将CH更正为ST，剔除无关标签。')};
 }
 const text=input.target?.body??'';
 const scopeRule=text.includes('完全无关闲聊占位')?'irrelevant':text.includes('键政测试占位')?'off_topic_politics':text.includes('非法定信道翻墙教程占位')?'circumvention':null;
 if(scopeRule)return {task:'publish',decision:'revise',summary:'当前内容不在社区收录范围，暂不公开。',findings:[{rule:scopeRule,quote:text,explanation:'隔离测试的社区范围标记。',legalBasis:scopeRule==='circumvention'?['international-channel']:[]}],technicalIssues:[],commenterNotice:notice('评论未通过审核','请保留与项目相关的正常交流内容后重新提交。')};
 const disputed=text.includes('争议评论'),blocked=text.includes('纯谩骂');
 return {task:'publish',decision:blocked?'revise':disputed?'disputed':'pass',summary:blocked?'当前评论仅有粗鄙谩骂，不予发布。':disputed?'评论存在待核对事项，暂不公开。':'讨论审核通过。',findings:blocked?[{rule:'vulgarity',quote:'纯谩骂',explanation:'没有实质交流内容。'}]:disputed?[{rule:'ownership',quote:'争议评论',explanation:'需核对原始语境。'}]:[],technicalIssues:text.includes('编译失败')?[{claim:text.includes('链接器')?'反馈链接器编译失败，原因未核实。':'反馈工程编译失败，原因未核实。',quote:'编译失败',providedEvidence:[],missingEvidence:['完整构建报错日志']}]:[],commenterNotice:blocked||disputed?notice('评论审核结果',blocked?'请移除纯谩骂，保留具体交流内容。':'评论暂缓公开，等待人工核对。'):null};
}
const bindings={BETTER_AUTH_SECRET:crypto.randomBytes(32).toString('hex'),BETTER_AUTH_URL:base,PROJECT_REVIEW_API_KEY:'test-project-placeholder',DISCUSSION_REVIEW_API_KEY:'test-discussion-placeholder',PROJECT_AI_MONTHLY_MAX_CALLS:'1000',DISCUSSION_AI_MONTHLY_MAX_CALLS:'1000',PROJECT_AI_MONTHLY_BUDGET_MICROS:'100000000',DISCUSSION_AI_MONTHLY_BUDGET_MICROS:'100000000',AI_TOTAL_MONTHLY_BUDGET_MICROS:'150000000',AI_OFFPEAK_DATES:new Date(Date.now()+8*3600000).toISOString().slice(0,10),ADMIN_EMAILS:'admin@example.test',MAIL_PROVIDER:'none'};
const options={name:'workflows-acceptance',host:'127.0.0.1',port:5180,modules,modulesRoot:workerRoot,modulesRules:[{type:'ESModule',include:['**/*.js','**/*.mjs'],fallthrough:true}],compatibilityDate:cfg.compatibility_date,compatibilityFlags:cfg.compatibility_flags,bindings,durableObjects:{REVIEW_COORDINATOR:{className:'ReviewCoordinator',useSQLite:true}},durableObjectsPersist:path.join(state,'do'),workflows:{REVIEW_WORKFLOW:{name:'review-workflow',className:'ReviewWorkflow'}},workflowsPersist:path.join(state,'workflows'),d1Databases:{DB:'test-workflows'},d1Persist:path.join(state,'d1'),r2Buckets:{BUCKET:'test-uploads'},r2Persist:path.join(state,'r2'),outboundService:async req=>{
 const url=new URL(req.url);
 if(url.hostname==='api.github.com'){if(url.pathname.includes('/commits/'))return Response.json({sha:'1'.repeat(40)});if(url.pathname.includes('/git/trees/'))return Response.json({truncated:false,tree:Array.from({length:100},(_,i)=>({path:'src/file-'+i+'.js',type:'blob',mode:'100644',size:80}))});}
 if(url.hostname==='raw.githubusercontent.com')return new Response('export const value = 1; // 实际代码，用于完整仓库审阅验收。'+url.pathname);
 if(url.hostname!=='api.deepseek.com')throw new Error('Unexpected outbound host');
 const data=await req.json(),userContent=data.messages.find(m=>m.role==='user').content,input=JSON.parse(Array.isArray(userContent)?userContent.find(p=>p.type==='text').text:userContent);
 if(input.task==='featured_material')materialCalls++;
 if(input.scan)input.reviewEvidence=input.segments[0].text;
 if(input.task==='featured'&&holdFeatured)await new Promise(resolve=>{releaseFeatured=resolve;});
 modelCalls.push({image:Array.isArray(userContent)&&userContent.some(p=>p.type==='image_url'&&p.image_url.url.startsWith('data:image/png;base64,')),task:input.task,project:!!input.submission,key:req.headers.get('authorization')?.includes('test-project')?'project':'discussion'});
 if(failProvider)return new Response('unavailable',{status:503});
 if(input.attachments?.files?.length&&!input.submission?.title?.includes('跳过读取')){
  if(input.kind==='resource'&&!input.submission.title.includes('跳过读取')){
    const read=new Set(data.messages.filter(m=>m.role==='tool').map(m=>{try{return JSON.parse(m.content).path;}catch{return null;}}));
    const next=input.attachments.files.find(f=>!read.has(f.path));
    if(next)return Response.json({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'read-resource-'+read.size,type:'function',function:{name:'read_file',arguments:JSON.stringify({path:next.path,line_count:input.submission.title.includes('截断读取')?1:240})}}]}}],usage:{total_tokens:100}});
  }
  const read=data.messages.find(m=>m.role==='tool');
  if(!read)return Response.json({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'read-main',type:'function',function:{name:'read_file',arguments:JSON.stringify({path:input.attachments.files[0].path})}}]}}],usage:{total_tokens:100}});
  const source=JSON.parse(read.content).text??'';if(input.task==='featured')input.reviewEvidence=source.slice(0,250);
  if(source.includes('广告测试'))return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({decision:'revise',summary:'附件源码中存在广告测试内容。',findings:[{rule:'spam',quote:'广告测试',explanation:'读取到实际附件源码中的推广文字。'}],improvements:[],taxonomy:{},authorNotice:notice('作品未通过审核','请移除附件代码中的广告文字后重新提交。')})}}],usage:{total_tokens:100}});
 }
 const result=providerResult(input);if(input.scan){result.coveredSegments=input.segments.map(s=>s.id);if(result.decision==='disputed'){result.investigation.unresolvedQuestions=['已实现的参与式创作是否达到精选价值尺度，需要人工裁量。'];result.assessments[0].evidence=[{source:input.segments[0].path,quote:input.segments[0].text,explanation:'实际实现支持应用价值，但其精选程度存在具体分歧。'}];}}
 if(input.kind==='resource'){
   const code='export function add(a,b){return a+b;}';result.resourceReliability={ready:!input.submission.title.includes('争议'),reason:'隔离验收用例：检查接口与简单输入返回值，结论只针对该用例。',checkedScope:'仅静态读取加法接口和返回表达式，未执行程序或硬件测试。',confirmedIssues:[],evidence:[{quote:code,explanation:'读取到真实提交的简单加法实现；此为隔离流程测试。'}],limitations:['未执行外部代码或硬件实测']};
   if(input.submission.title.includes('无可靠性'))delete result.resourceReliability;
   if(input.submission.title.includes('关键故障')||input.submission.title.includes('猜测风险')){result.decision='revise';result.resourceReliability.ready=false;result.findings=[{rule:'reliability',quote:'throw new Error("broken")',explanation:'测试组件的核心入口明确无条件抛错，无法完成声明的功能。'}];result.resourceReliability.confirmedIssues=[{source:input.attachments.files.find(f=>f.path.endsWith('component.mjs')).path,quote:'throw new Error("broken")',basisQuote:'export function add(a,b){return a+b;}',reasoning:'模块顶层在导出声明后无条件抛错，加载模块会失败，无法完成所声明的独立导入功能。',impact:'导入模块会抛异常，调用者无法正常加载并调用函数。',affectedScope:'影响本组件在JavaScript模块环境中的正常导入使用。',preconditionsConfirmed:!input.submission.title.includes('猜测风险'),uncertainties:input.submission.title.includes('猜测风险')?['尚未确认关键前提']:[]}];result.authorNotice=notice('资源暂未通过审核','核心功能明确不能正常使用，请修复后重新送审。');}
 }
 if(input.submission?.title==='组件来源作品')result.resourceDraft={title:'加法组件',summary:'从来源工程提取的可独立复用加法组件。',category:'创意软件',tags:['算法组件'],description:'供隔离测试使用的简单加法组件，具有独立输入和返回值。',hardware:'JavaScript ES Modules 环境',instructions:'导入 add 函数并传入两个有限数；该示例仅用于审核流程验收。',limitations:'没有执行性能与浏览器兼容性测试。',sourcePath:input.attachments.files[0].path,quote:'export function add(a,b){return a+b;}',files:[{name:'add.js',content:'export function add(a,b){return a+b;}'}]};
 if(data.stream){const event=value=>'data: '+(typeof value==='string'?value:JSON.stringify(value))+'\n\n';const content=JSON.stringify(result),middle=Math.floor(content.length/2);return new Response(event({choices:[{index:0,delta:{reasoning_content:'私有模拟推理'}}]})+event({choices:[{index:0,delta:{content:content.slice(0,middle)}}]})+event({choices:[{index:0,delta:{content:content.slice(middle)}}]})+event({choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200,prompt_cache_hit_tokens:0,prompt_cache_miss_tokens:100}})+event('[DONE]'),{headers:{'Content-Type':'text/event-stream'}});}
 return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(result)}}],usage:{total_tokens:100}});
}};
const mf=new Miniflare(options);let db;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS',name);};
function client(){const cookies=new Map();return {async call(method,p,body){const response=await fetch(base+'/api/'+p,{method,headers:{Origin:base,...(body instanceof FormData?{}:{'Content-Type':'application/json'}),Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; ')},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});for(const cookie of response.headers.getSetCookie()){const first=cookie.split(';')[0],split=first.indexOf('=');cookies.set(first.slice(0,split),first.slice(split+1));}let value;try{value=await response.json();}catch{value={error:'Not JSON'};}return {status:response.status,value};},async raw(p){return fetch(base+'/api/'+p,{headers:{Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; ')}});},async ok(method,p,body){const r=await this.call(method,p,body);assert.ok(r.status>=200&&r.status<300,`${method} ${p}: ${r.status} ${JSON.stringify(r.value)}`);return r.value;}};}
async function waitReview(id){for(let i=0;i<1000;i++){const row=await db.prepare('SELECT * FROM reviews WHERE id=?').bind(id).first();if(row&&!['queued','running'].includes(row.state))return row;await pause(30);}throw new Error('Review did not settle '+id);}
async function waitFor(fn){for(let i=0;i<700;i++){const value=await fn();if(value)return value;await pause(30);}throw new Error('Expected asynchronous side effect missing');}
const admin=client(),member=client(),anon=client();
let adminId,memberId,projectId,topicId;
const draft={title:'分类验收作品',summary:'检查显示工程的分类、审核及通知流程。',category:'嵌入式系统',hardware:'STM32F103开发板与显示屏，工具链为STM32CubeIDE。',version:'v1',stage:'进行中',description:'用于本地隔离验收的显示项目，不会写入真实用户资料或执行实际硬件操作。',license:'MIT',links:[{type:'other',label:'项目资料',url:'https://example.com/source'}],tags:['屏幕显示','烘焙甜点'],platforms:[{name:'CH',family:'mcu'}],sources:[{name:'自主项目'}]};
try{
 await mf.ready;db=await mf.getD1Database('DB');
 for(const file of readdirSync(path.join(root,'drizzle')).filter(x=>x.endsWith('.sql')).sort())for(const statement of readFileSync(path.join(root,'drizzle',file),'utf8').replace(/--> statement-breakpoint/g,'').split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(statement).run();
 for(const [c,name] of [[admin,'管理员验收'],[member,'评论者验收']]){await c.ok('POST','account/register',{name,email:crypto.randomUUID()+'@example.com',password:crypto.randomBytes(20).toString('base64url')});await c.ok('GET','me');}
 adminId=(await admin.ok('GET','me')).user.id;memberId=(await member.ok('GET','me')).user.id;
 bindings.ADMIN_USER_IDS=adminId;await mf.setOptions({...options,bindings});await mf.ready;db=await mf.getD1Database('DB');
 await db.prepare('UPDATE auth_user SET email_verified=1').run();
 check('member email notifications start enabled',(await member.ok('GET','me/notification-preferences')).emailEnabled===true);
 await member.ok('PATCH','me/notification-preferences',{emailEnabled:false});
 check('member can save and reload disabled mail preference',(await member.ok('GET','me/notification-preferences')).emailEnabled===false);
 check('anonymous cannot change mail preferences',(await anon.call('PATCH','me/notification-preferences',{emailEnabled:false})).status===401);
 check('mail preference cannot target another member',(await member.call('PATCH','me/notification-preferences',{emailEnabled:false,userId:adminId})).status===422);
 check('administrator cannot suppress work notification email',(await admin.call('PATCH','me/notification-preferences',{emailEnabled:false})).status===422);
 await member.ok('PATCH','me/notification-preferences',{emailEnabled:true});
 check('anonymous cannot access admin or notifications',(await anon.call('GET','admin/workflows')).status===403&&(await anon.call('GET','notifications')).status===401);
 check('independent forum cannot accept new topics',(await member.call('POST','topics',{title:'独立论坛',body:'没有关联项目的内容应被拒绝',board:'经验交流'})).status===422);
 const p=await admin.ok('POST','projects',draft);projectId=p.id;
 let job=await admin.ok('POST',`projects/${projectId}/submit`,{});await waitReview(job.reviewId);
 const published=(await anon.ok('GET',`projects/${projectId}`)).project;
 check('platform CH replaced with ST; unrelated tag removed',published.platforms[0].name==='ST'&&!published.tags.includes('烘焙甜点')&&published.tags.includes('屏幕显示'));
 const filtered=await anon.ok('GET','projects?tag='+encodeURIComponent('屏幕显示')+'&platform=ST&source='+encodeURIComponent('自主项目'));
 check('batched catalog preserves combined filters and facet availability',filtered.items.some(p=>p.id===projectId)&&filtered.availability.tag['屏幕显示']===1);
 check('batched catalog keeps rejected tags out of search results',(await anon.ok('GET','projects?tag='+encodeURIComponent('烘焙甜点'))).total===0);
 check('project pass generated author notice',!!await db.prepare('SELECT id FROM notifications WHERE review_id=? AND recipient_id=?').bind(job.reviewId,adminId).first());
 const invitationNotice=await db.prepare("SELECT body FROM notifications WHERE review_id=? AND kind='review'").bind(job.reviewId).first();
 check('publish review may invite author without creating a nomination or selecting',invitationNotice.body.includes('申请精选评估')&&!(await anon.ok('GET',`projects/${projectId}`)).project.featured&&!(await db.prepare("SELECT id FROM reviews WHERE task='featured'").first()));

 const disputed=await admin.ok('POST','projects',{...draft,title:'争议作品验收',description:'该工程存在署名待核对的具体线索，需要人类进一步确认。'});job=await admin.ok('POST',`projects/${disputed.id}/submit`,{});await waitReview(job.reviewId);
 const disputedView=(await anon.ok('GET',`projects/${disputed.id}`)).project;
 check('disputed project is public and marked pending human review',disputedView.status==='published'&&disputedView.pendingHumanReview);
 const safety=await admin.ok('POST','projects',{...draft,title:'严重风险待核验',description:'本材料含有严重风险线索，需要由人工核对具体事实与适用依据。'});
 const safetyJob=await admin.ok('POST',`projects/${safety.id}/submit`,{}),safetyReview=await waitReview(safetyJob.reviewId);
 check('serious legal dispute does not inherit ordinary disputed-project publication',(await anon.call('GET',`projects/${safety.id}`)).status===404&&JSON.parse(safetyReview.result).publicationHeld===true);
 const safetyNotice=await waitFor(()=>db.prepare("SELECT title,body FROM notifications WHERE review_id=? AND state='ready' AND event_key LIKE 'safety-review-status:%'").bind(safetyJob.reviewId).first());
 check('held author receives neutral status and verified statute without a published claim',!!safetyNotice&&safetyNotice.title.includes('暂缓')&&safetyNotice.body.includes('第六条第二项')&&!safetyNotice.body.includes('作品已先行发布'));
 await admin.ok('POST',`admin/reviews/${safetyJob.reviewId}/decision`,{decision:'pass',reason:'此处仅为隔离测试的风险占位标记，人工核对确认可以公开。'});
 check('human can resolve a false-positive safety hold',(await anon.call('GET',`projects/${safety.id}`)).status===200);
 await db.prepare('DELETE FROM limits WHERE key LIKE ?').bind(memberId+':%').run();
 const t=await member.ok('POST','topics',{title:'正常项目评论',body:'我觉得这个显示工程的结构很清晰，想讨论一下显示刷新。',board:'经验交流',projectId});topicId=t.id;await waitReview(t.reviewId);
 const activity=await waitFor(()=>db.prepare("SELECT * FROM notifications WHERE review_id=? AND kind='comment'").bind(t.reviewId).first());
 check('normal approved comment notifies project author',activity.recipient_id===adminId);
 check('normal comment creates email for verified project author',!!await db.prepare('SELECT id FROM email_outbox WHERE notification_id=?').bind(activity.id).first());
 const reply=await admin.ok('POST',`topics/${topicId}/replies`,{body:'感谢反馈，我们可以进一步讨论显示刷新的实现方式。'});await waitReview(reply.reviewId);
 const replyNotice=await waitFor(()=>db.prepare("SELECT * FROM notifications WHERE review_id=? AND kind='reply'").bind(reply.reviewId).first());
 check('reply notifies the comment author through inbox and email',replyNotice.recipient_id===memberId&&replyNotice.email_enabled===1&&!!await db.prepare('SELECT id FROM email_outbox WHERE notification_id=?').bind(replyNotice.id).first());
 await db.prepare('DELETE FROM limits WHERE key LIKE ?').bind(memberId+':%').run();
 const d=await member.ok('POST','topics',{title:'争议评论',body:'这是一条争议评论，现有语境需要进一步核对。',board:'经验交流',projectId});await waitReview(d.reviewId);
 check('disputed comment remains hidden from visitors',(await anon.call('GET',`topics/${d.id}`)).status===404);
 for(const [label,body,allowed] of [['纯夸赞验收','赞',true],['无关内容验收','完全无关闲聊占位',false],['键政范围验收','键政测试占位',false],['翻墙范围验收','非法定信道翻墙教程占位',false]]){
  await db.prepare('DELETE FROM limits WHERE key LIKE ?').bind(memberId+':%').run();
  const item=await member.ok('POST','topics',{title:label,body,board:'经验交流',projectId});await waitReview(item.reviewId);
  check(label+' respects publication boundary',(await anon.call('GET',`topics/${item.id}`)).status===(allowed?200:404));
  if(!allowed){const record=await admin.ok('GET',`reviews/${item.reviewId}`);check(label+' is retained for administrator inspection',JSON.stringify(record.snapshot).includes(body)&&record.result.findings.length>0&&(await admin.call('GET',`topics/${item.id}`)).status===200&&(await member.call('GET',`reviews/${item.reviewId}`)).status===403);}
  if(body.includes('翻墙')){const notice=await waitFor(()=>db.prepare("SELECT body FROM notifications WHERE review_id=? AND recipient_id=? AND state='ready' ORDER BY created_at LIMIT 1").bind(item.reviewId,memberId).first());check('circumvention refusal contains the specific verified international-network article',notice.body.includes('中华人民共和国计算机信息网络国际联网管理暂行规定')&&notice.body.includes('第六条'));}
 }
 const ownerBefore=(await member.ok('GET',`topics/${topicId}/edit`));
 await db.prepare('DELETE FROM limits WHERE key LIKE ?').bind(memberId+':%').run();
 const edited=await member.ok('PATCH',`topics/${topicId}`,{title:'修改后标题',board:'经验交流',body:'纯谩骂，审核不通过，旧公开正文必须保留。',editToken:ownerBefore.editToken});
 await waitFor(()=>db.prepare("SELECT id FROM reviews WHERE entity_id=? AND state='needs_changes'").bind(edited.editId).first());
 check('rejected edit keeps the old public comment',(await anon.ok('GET',`topics/${topicId}`)).topic.body.includes('结构很清晰'));
 const rejectedNotice=await db.prepare("SELECT n.* FROM notifications n JOIN reviews r ON r.id=n.review_id WHERE r.entity_id=? AND n.kind='review'").bind(edited.editId).first();
 check('revise result invites member to contact maintainer through both channels',rejectedNotice.body.includes('resonate_ic@outlook.com')&&!!await db.prepare('SELECT id FROM email_outbox WHERE notification_id=?').bind(rejectedNotice.id).first());
 await db.prepare('DELETE FROM limits WHERE key LIKE ?').bind(memberId+':%').run();
 const tech=await member.ok('POST','topics',{title:'反馈编译问题',body:'这个工程在我的环境中编译失败，暂时无法提供完整日志。',board:'项目求助',projectId});await waitReview(tech.reviewId);
 const feedback=await waitFor(()=>db.prepare('SELECT * FROM technical_feedback WHERE source_review_id=?').bind(tech.reviewId).first());await waitReview(feedback.review_id);
 check('technical issue transfers to project channel',!!feedback.review_id&&modelCalls.some(x=>x.task==='technical_check'&&x.key==='project'));
 check('unconfirmed technical issue drafts an author notice',!!await db.prepare("SELECT id FROM notifications WHERE review_id=? AND kind='unverified_feedback' AND state='draft'").bind(feedback.review_id).first());
 check('commenter receives follow-up request for evidence',!!await db.prepare("SELECT id FROM notifications WHERE review_id=? AND recipient_id=? AND kind='technical' AND state='ready'").bind(feedback.review_id,memberId).first());
 check('feedback details are private',(await anon.call('GET','technical-feedback/'+feedback.id)).status===401);
 const work=await admin.ok('GET','admin/workflows'),n=work.drafts.find(x=>x.kind==='unverified_feedback');
 check('draft is hidden before approval',!(await admin.ok('GET','notifications')).items.some(x=>x.id===n.id));
 await admin.ok('POST',`admin/notices/${n.id}/approve`,{title:n.title,body:n.body});
 check('human-approved draft becomes visible',(await admin.ok('GET','notifications')).items.some(x=>x.id===n.id));
 await db.prepare('DELETE FROM limits WHERE key LIKE ?').bind(adminId+':%').run();
 const techReply=await admin.ok('POST',`topics/${topicId}/replies`,{body:'我也遇到了编译失败，链接器提示找不到符号。'});await waitReview(techReply.reviewId);
 const rf=await waitFor(()=>db.prepare('SELECT * FROM technical_feedback WHERE source_review_id=?').bind(techReply.reviewId).first());await waitReview(rf.review_id);
 const rn=await waitFor(()=>db.prepare("SELECT * FROM notifications WHERE review_id=? AND kind='unverified_feedback'").bind(rf.review_id).first());
 await admin.ok('POST',`admin/notices/${rn.id}/approve`,{title:rn.title,body:rn.body});
 check('reply-origin author feedback creates email after human approval',rn.email_enabled===1&&!!await db.prepare('SELECT id FROM email_outbox WHERE notification_id=?').bind(rn.id).first());
 const votes=[];for(let i=0;i<20;i++){const uid='vote-'+i+'-'+stamp;await db.prepare('INSERT INTO users(id,name,created_at,bio) VALUES(?,?,?,?)').bind(uid,'验收投票'+i,Date.now(),'').run();await db.prepare('INSERT INTO quality_votes(topic_id,user_id,created_at) VALUES(?,?,?)').bind(topicId,uid,Date.now()).run();votes.push(uid);}
 check('exactly 20 recommendations do not qualify discussion',(await db.prepare('SELECT quality_status FROM topics WHERE id=?').bind(topicId).first()).quality_status==='none');
 await member.ok('POST',`topics/${topicId}/recommend`,{});
 await waitFor(async()=>{const v=await db.prepare('SELECT quality_status FROM topics WHERE id=?').bind(topicId).first();return v?.quality_status==='qualified';});
 check('21 unique votes including self trigger quality check',true);
 await member.ok('POST',`topics/${topicId}/recommend`,{});const count=await db.prepare('SELECT COUNT(*) n FROM quality_votes WHERE topic_id=?').bind(topicId).first();check('repeat recommendation does not add votes',count.n===21);
 const report=await admin.ok('POST','reports',{entityType:'topic',entityId:tech.id,reason:'需要核验并下架的骚扰风险'});
 await waitFor(()=>db.prepare('SELECT admin_lock_at FROM topics WHERE id=? AND admin_lock_at IS NOT NULL').bind(tech.id).first());
 check('verified report removes only reported content',(await anon.call('GET',`topics/${tech.id}`)).status===404&&(await anon.call('GET',`projects/${projectId}`)).status===200);
 check('author cannot restore an AI/admin-locked comment',(await member.call('POST',`topics/${tech.id}/restore`,{})).status===423);
 check('admin takedown requires a reason',(await admin.call('POST',`admin/content/project/${projectId}/take-down`,{reason:''})).status===422);
 await admin.ok('POST',`admin/content/project/${projectId}/take-down`,{reason:'隔离验收：核验管理员下架锁'});
 check('admin-locked project is invisible to visitor',(await anon.call('GET',`projects/${projectId}`)).status===404);
 const memberTopics=await anon.ok('GET',`users/${memberId}/content?kind=topic`),memberReplies=await anon.ok('GET',`users/${memberId}/content?kind=reply`);
 check('public profiles hide comments and replies under a locked project',!memberTopics.items.some(x=>x.id===topicId)&&!memberReplies.items.length);
 check('owner cannot resubmit admin-locked project',(await admin.call('POST',`projects/${projectId}/submit`,{})).status===423);
 check('owner cannot undo admin lock through recycle restore',(await admin.call('POST',`projects/${projectId}/restore`,{})).status===423);
 await admin.ok('POST',`admin/content/project/${projectId}/unlock`,{reason:'隔离验收结束，管理员解除限制'});
 check('only explicit admin unlock restores project visibility',(await anon.call('GET',`projects/${projectId}`)).status===200);
 check('member cannot call administrator action',(await member.call('POST',`admin/content/project/${projectId}/take-down`,{reason:'不应有权限'})).status===403);
 check('non-admin cannot read audit details including own review',(await member.call('GET',`reviews/${(await db.prepare("SELECT id FROM reviews WHERE owner_id=? LIMIT 1").bind(memberId).first()).id}`)).status===403&&(await member.call('GET','me/reviews')).status===403);

 // Under a direct administrator takedown the owner receives an appeal control.
 await admin.ok('POST',`admin/content/topic/${topicId}/take-down`,{reason:'隔离验收申诉入口和人工恢复权限。'});
 const memberNotices=(await member.ok('GET','notifications')).items;const downNotice=memberNotices.find(n=>n.kind==='moderation'&&n.appealTarget?.entityId===topicId);
 check('takedown notice exposes owner appeal without internal audit link',!!downNotice&&!downNotice.reviewHref&&downNotice.href.startsWith('/projects/'));
 const appealBody={entityType:'topic',entityId:topicId,reason:'这条讨论包含具体工程问题，希望管理员核对后恢复。'};
 const appeal=await member.ok('POST','appeals',appealBody),sameAppeal=await member.ok('POST','appeals',appealBody);
 check('owner can appeal takedown once without AI restoring content',appeal.appealId===sameAppeal.appealId&&(await anon.call('GET',`topics/${topicId}`)).status===404);
 check('another account cannot appeal this content',(await admin.call('POST','appeals',appealBody)).status===403);
 await admin.ok('POST',`admin/reviews/${appeal.appealId}/resolve-task`,{decision:'restore',reason:'已核对具体工程交流内容，原下架处理不再需要，确认恢复。'});
 check('appeal is restored only by explicit human decision',(await anon.call('GET',`topics/${topicId}`)).status===200);
 await db.prepare('DELETE FROM limits WHERE key LIKE ?').bind(memberId+':%').run();
 const ownReply=await member.ok('POST',`topics/${topicId}/replies`,{body:'我自己的评论会显示在个人主页，并能回到当前工程楼层。'});await waitReview(ownReply.reviewId);
 const ownReplies=await member.ok('GET','me/content?kind=reply');
 check('private comments include project and floor identifiers',ownReplies.items.length>0&&ownReplies.items.every(r=>r.projectId&&r.topicId&&r.id));
 check('email verification disabled honestly until transport configured',(await member.call('POST','auth/email-otp/send-verification-otp',{email:'someone@example.com',type:'email-verification'})).status===503);
 const lastCalls=modelCalls.length;failProvider=true;await db.prepare('DELETE FROM limits WHERE key LIKE ?').bind(memberId+':%').run();
 const failed=await member.ok('POST','topics',{title:'模型失败验收',body:'模拟审核服务不可用时，内容应保持不公开。',board:'经验交流',projectId});await waitReview(failed.reviewId);failProvider=false;
 check('provider failure never publishes comment',(await anon.call('GET',`topics/${failed.id}`)).status===404);
 await anon.ok('GET','health');await pause(100);check('failed paid request is not automatically retried',modelCalls.length===lastCalls+1);
 check('credentials route correctly; project and discussion are separated',modelCalls.some(x=>x.project&&x.key==='project')&&modelCalls.some(x=>!x.project&&x.task==='publish'&&x.key==='discussion'));
 const disputedJob=await db.prepare("SELECT id FROM reviews WHERE entity_id=? AND task='publish'").bind(disputed.revisionId).first();
 await admin.ok('POST',`admin/reviews/${disputedJob.id}/decision`,{decision:'revise',reason:'人工复核确认暂不适合公开，需进一步补充原始资料。'});
 check('human rejection of an already-published disputed project creates lock',(await anon.call('GET',`projects/${disputed.id}`)).status===404&&(await admin.call('POST',`projects/${disputed.id}/submit`,{})).status===423);
 // Generate a small, ordinary DEFLATE ZIP in memory to exercise R2 extraction.
 const filename=Buffer.from('Core/Src/main.c'),source=Buffer.from('/* 广告测试：与工程无关的商业推广 */\nint main(void){return 0;}\n'),compressed=deflateRawSync(source);
 let crc=0xffffffff;for(const byte of source){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
 const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(source.length,22);local.writeUInt16LE(filename.length,26);
 const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt16LE(8,10);central.writeUInt32LE(crc,16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(source.length,24);central.writeUInt16LE(filename.length,28);
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+filename.length,12);end.writeUInt32LE(local.length+filename.length+compressed.length,16);
 const archive=Buffer.concat([local,filename,compressed,central,filename,end]);const fileId=crypto.randomUUID(),hash=crypto.createHash('sha256').update(archive).digest('hex');
 const bucket=await mf.getR2Bucket('BUCKET');await bucket.put(fileId,archive);await db.prepare('INSERT INTO files(id,owner_id,name,size,digest,created_at) VALUES(?,?,?,?,?,?)').bind(fileId,adminId,'source.zip',archive.length,hash,Date.now()).run();
 const zipped=await admin.ok('POST','projects',{...draft,title:'附件源码审核验收',fileIds:[fileId]});const zipJob=await admin.ok('POST',`projects/${zipped.id}/submit`,{});const zipReview=await waitReview(zipJob.reviewId);
 check('ZIP source is actually read via tools and blocks advertising',zipReview.state==='needs_changes'&&JSON.parse(zipReview.result).filesRead.some(x=>x.endsWith('Core/Src/main.c')));
 // Author consent, private generated files and the independent resource quality gate.
 {
 await db.prepare('DELETE FROM limits').run();
 const componentId=crypto.randomUUID(),componentText='export function add(a,b){return a+b;}\nthrow new Error("broken");\n';
 await bucket.put(componentId,componentText);await db.prepare('INSERT INTO files(id,owner_id,name,size,digest,created_at) VALUES(?,?,?,?,?,?)').bind(componentId,adminId,'component.mjs',Buffer.byteLength(componentText),crypto.createHash('sha256').update(componentText).digest('hex'),Date.now()).run();
 const sourceProject=await admin.ok('POST','projects',{...draft,title:'组件来源作品',fileIds:[componentId]});const sourceJob=await admin.ok('POST',`projects/${sourceProject.id}/submit`,{});await waitReview(sourceJob.reviewId);
 const offer=await waitFor(()=>db.prepare('SELECT * FROM resource_offers WHERE source_review_id=?').bind(sourceJob.reviewId).first());
 const privateResource=(await admin.ok('GET',`projects/${offer.project_id}`)).project;
 check('review prepares a complete private resource draft and author notification',privateResource.kind==='resource'&&privateResource.status==='draft'&&!!await db.prepare("SELECT id FROM notifications WHERE event_key=? AND kind='resource_offer'").bind('resource-offer:'+sourceJob.reviewId).first());
 check('generated resource and package are hidden before author consent',(await anon.call('GET',`projects/${offer.project_id}`)).status===404&&(await anon.raw('files/'+privateResource.fileIds[0])).status===404);
 check('another user cannot accept, edit or download the resource offer',(await member.call('POST',`resource-offers/${offer.project_id}/accept`,{})).status===404&&(await member.call('PATCH',`resource-offers/${offer.project_id}`,{})).status===404&&(await member.raw('files/'+privateResource.fileIds[0])).status===404);
 const pendingOffer=(await admin.ok('GET','resource-offers')).items.find(o=>o.project_id===offer.project_id);
 await admin.ok('PATCH',`resource-offers/${offer.project_id}`,{headId:pendingOffer.head_id,license:'MIT',draft:{...pendingOffer.payload,summary:'作者当场确认并修改过的可复用加法组件。'}});
 check('author can edit prepared files and metadata before consent',(await admin.ok('GET',`projects/${offer.project_id}`)).project.summary.includes('作者当场'));
 const accepted=await admin.ok('POST',`resource-offers/${offer.project_id}/accept`,{}),repeated=await admin.ok('POST',`resource-offers/${offer.project_id}/accept`,{});const resourceReview=await waitReview(accepted.reviewId);
 check('consent queues exactly one independent resource review',accepted.reviewId===repeated.reviewId&&accepted.reviewId!==sourceJob.reviewId&&resourceReview.entity_type==='revision');
 check('resource is published only after source reading and reliability assessment',resourceReview.state==='approved'&&JSON.parse(resourceReview.result).resourceReliability.ready&&(await anon.call('GET',`projects/${offer.project_id}`)).status===200);
 const declaration={steps:['none'],scope:'本版本仅提供可阅读源码，尚未执行编译运行或硬件实测。',unverified:'运行结果与硬件表现均未实测。',evidence:''};
 const undeclared=await admin.ok('POST','projects',{...draft,kind:'resource',title:'未填声明资源',fileIds:[componentId]});
 check('resource submission requires author verification declaration',(await admin.call('POST',`projects/${undeclared.id}/submit`,{})).status===422);
 for(const title of ['关键故障资源','争议资源','无可靠性依据资源','猜测风险资源','跳过读取资源']){
   const item=await admin.ok('POST','projects',{...draft,kind:'resource',title,verification:declaration,fileIds:[componentId]});const submission=await admin.ok('POST',`projects/${item.id}/submit`,{});const review=await waitReview(submission.reviewId);
   check(title+' cannot auto-publish',(await anon.call('GET',`projects/${item.id}`)).status===404&&(title==='关键故障资源'?review.state==='needs_changes':review.state==='disputed'));
 }
 for(const title of ['未实测资源','截断读取资源']){
   await db.prepare('DELETE FROM limits').run();
   const item=await admin.ok('POST','projects',{...draft,kind:'resource',title,verification:declaration,fileIds:[componentId]});const submission=await admin.ok('POST',`projects/${item.id}/submit`,{});const row=await waitReview(submission.reviewId);
   const publicItem=(await anon.ok('GET',`projects/${item.id}`)).project;
   check(title+' may publish with honest scope and without private audit details',row.state==='approved'&&publicItem.verification.steps[0]==='none'&&publicItem.resourceReview.checkedScope&&!publicItem.resourceReview.evidence&&!publicItem.resourceReview.confirmedIssues&&!publicItem.resourceReview.filesRead);
   if(title==='截断读取资源')check('partial inspection is disclosed instead of treating unread material as a defect',publicItem.resourceReview.limitations.some(x=>x.includes('未完整读取')));
   const statusNotice=await waitFor(()=>db.prepare("SELECT * FROM notifications WHERE review_id=? AND state='ready' AND kind='review'").bind(submission.reviewId).first());
   check(title+' review notification includes actual scope and queues email',statusNotice.body.includes('本次AI检查范围')&&!!await db.prepare('SELECT id FROM email_outbox WHERE notification_id=?').bind(statusNotice.id).first());
 }
 // A failed resource update preserves the previously reviewed public version.
 await db.prepare('DELETE FROM limits').run();
 await admin.ok('PATCH',`projects/${offer.project_id}`,{...privateResource,title:'关键故障资源更新',fileIds:[componentId]});const badUpdate=await admin.ok('POST',`projects/${offer.project_id}/submit`,{});await waitReview(badUpdate.reviewId);
 check('resource update is independently reviewed while old public version remains',(await anon.ok('GET',`projects/${offer.project_id}`)).project.title==='加法组件');
 const declinedSource=await admin.ok('POST','projects',{...draft,title:'组件来源作品',fileIds:[componentId]});const declinedJob=await admin.ok('POST',`projects/${declinedSource.id}/submit`,{});await waitReview(declinedJob.reviewId);
 const declinedOffer=await waitFor(()=>db.prepare('SELECT * FROM resource_offers WHERE source_review_id=?').bind(declinedJob.reviewId).first());
 const callsAtDecline=modelCalls.length;await admin.ok('POST',`resource-offers/${declinedOffer.project_id}/decline`,{});
 check('declining a resource keeps it private and performs no resource AI call',modelCalls.length===callsAtDecline&&(await anon.call('GET',`projects/${declinedOffer.project_id}`)).status===404&&(await db.prepare('SELECT state FROM resource_offers WHERE project_id=?').bind(declinedOffer.project_id).first()).state==='declined');
 await admin.ok('POST',`projects/${declinedOffer.project_id}/restore`,{});
 check('author can restore a declined private draft for later editing',(await admin.ok('GET',`projects/${declinedOffer.project_id}`)).project.status==='draft');

 await db.prepare('UPDATE projects SET admin_lock_at=?,admin_reason=? WHERE id=?').bind(Date.now(),'来源下架测试',sourceProject.id).run();
 check('source administrator lock also blocks generated resource resubmission',(await admin.call('POST',`projects/${offer.project_id}/submit`,{})).status===409);
 await db.prepare('DELETE FROM limits').run();
 await db.prepare('DELETE FROM limits').run();
 }
 bindings.PROJECT_AI_MONTHLY_MAX_CALLS='0';await mf.setOptions({...options,bindings});await mf.ready;db=await mf.getD1Database('DB');
 const featuredBody={projectId,criteria:['teaching'],evidence:'配套课程提供了完整的学习主线，已有教学内容具备实践条件。'};
 const nomination=await admin.ok('POST','admin/featured',featuredBody),duplicate=await admin.ok('POST','admin/featured',featuredBody);
 check('featured nomination queues and duplicate clicks reuse task without direct selection',nomination.reviewId===duplicate.reviewId&&!(await anon.ok('GET',`projects/${projectId}`)).project.featured);
 check('non-admin cannot nominate featured works',(await member.call('POST','admin/featured',featuredBody)).status===403);
 await admin.ok('DELETE',`admin/featured/${projectId}`);
 check('cancelling nomination cancels queued evaluation',(await db.prepare('SELECT state FROM reviews WHERE id=?').bind(nomination.reviewId).first()).state==='cancelled');
 bindings.PROJECT_AI_MONTHLY_MAX_CALLS='1000';await mf.setOptions({...options,bindings});await mf.ready;db=await mf.getD1Database('DB');
 const accepted=await admin.ok('POST','admin/featured',featuredBody);await waitReview(accepted.reviewId);
 check('in-progress work is selected only after positive evaluation',(await anon.ok('GET',`projects/${projectId}`)).project.stage==='进行中'&&!!(await anon.ok('GET',`projects/${projectId}`)).project.featured);
 await admin.ok('DELETE',`admin/featured/${projectId}`);
 const refused=await admin.ok('POST','admin/featured',{...featuredBody,evidence:'资料不足，尚不能支持教学方面的突出成果。'});await waitReview(refused.reviewId);
 check('ordinary published work stays public when featured evidence is insufficient',!(await anon.ok('GET',`projects/${projectId}`)).project.featured&&JSON.parse((await db.prepare('SELECT result FROM reviews WHERE id=?').bind(refused.reviewId).first()).result).decision==='not_qualify');
 for(const evidence of ['伪造证据，仅重复这段推荐语不能证明实际成果。','缺少证据却返回通过结论，应当被证据校验阻止。','前提不符，即使声称某一指标满足也不应该入选。','关键缺口尚未解决却返回通过，不应当入选。']){
  const invalidJob=await admin.ok('POST','admin/featured',{...featuredBody,evidence});const invalidReview=await waitReview(invalidJob.reviewId);
  check(evidence+' validation blocks selection',invalidReview.state==='disputed'&&!(await anon.ok('GET',`projects/${projectId}`)).project.featured);
  await admin.ok('DELETE',`admin/featured/${projectId}`);
 }
 const contested=await admin.ok('POST','admin/featured',{...featuredBody,evidence:'需要人工核对的具体教学材料归属存在争议。'});await waitReview(contested.reviewId);
 check('disputed featured evaluation waits and does not select',(await db.prepare('SELECT state FROM reviews WHERE id=?').bind(contested.reviewId).first()).state==='disputed'&&!(await anon.ok('GET',`projects/${projectId}`)).project.featured);
 await admin.ok('POST',`admin/reviews/${contested.reviewId}/resolve-task`,{decision:'qualify',reason:'已核对实际教学内容及实践安排，确认具备明确教学意义。'});
 check('human resolves disputed nomination with one overall reason',!!(await anon.ok('GET',`projects/${projectId}`)).project.featured);
 await admin.ok('DELETE',`admin/featured/${projectId}`);
 holdFeatured=true;releaseFeatured=undefined;const inFlight=await admin.ok('POST','admin/featured',featuredBody);await waitFor(()=>releaseFeatured);await admin.ok('DELETE',`admin/featured/${projectId}`);holdFeatured=false;releaseFeatured();await pause(150);
 check('in-flight evaluation cannot restore cancelled selection',(await db.prepare('SELECT state FROM reviews WHERE id=?').bind(inFlight.reviewId).first()).state==='cancelled'&&!(await anon.ok('GET',`projects/${projectId}`)).project.featured);
 const courseId=crypto.randomUUID(),courseRevision=crypto.randomUUID(),courseSnapshot={title:'完整课程审核验收',projectId,prerequisites:'具备C语言基础并能够使用工具链。',outcomes:'掌握显示外设原理、独立实验与项目实践。',modules:[{title:'从原理到实践',lessons:Array.from({length:14},(_,i)=>({id:'chapter-'+i,title:'第'+i+'章',summary:'摘要不能代替正文',body:('原理解释、独立操作步骤和项目实践。'+i+'\n').repeat(260)}))}]};
 await db.prepare("INSERT INTO projects(id,owner_id,kind,head_id,published_id,created_at,updated_at) VALUES(?,?,'course',?,?,?,?)").bind(courseId,adminId,courseRevision,courseRevision,Date.now(),Date.now()).run();
 const courseJson=JSON.stringify(courseSnapshot);await db.prepare("INSERT INTO revisions(id,project_id,number,snapshot,digest,status,created_at) VALUES(?,?,1,?,?,'published',?)").bind(courseRevision,courseId,courseJson,crypto.createHash('sha256').update(courseJson).digest('hex'),Date.now()).run();
 const fullNomination=await admin.ok('POST','admin/featured',featuredBody);
 for(let i=0;i<30;i++){const row=await db.prepare('SELECT state FROM reviews WHERE id=?').bind(fullNomination.reviewId).first();if(!['running','queued'].includes(row.state))break;if(row.state==='queued')await admin.call('POST',`admin/reviews/${fullNomination.reviewId}/run`,{});await pause(60);}
 const fullReview=await waitReview(fullNomination.reviewId),fullResult=JSON.parse(fullReview.result);
 check('sufficient grounded evidence can qualify before reading the whole course',fullResult.coverage?.chaptersTotal===14&&fullResult.coverage.chaptersConsulted>0&&fullResult.coverage.chaptersConsulted<14&&fullResult.investigation.evidenceSufficient&&materialCalls===0&&!!(await anon.ok('GET',`projects/${projectId}`)).project.featured);
 check('only admins can inspect evidence sufficiency and reasoning',(await member.call('GET',`reviews/${fullNomination.reviewId}`)).status===403&&(await admin.ok('GET',`reviews/${fullNomination.reviewId}`)).result.investigation.evidenceSufficient);
 await admin.ok('DELETE',`admin/featured/${projectId}`);
 // Remove only this isolated course fixture from later unrelated nominations.
 await db.prepare('UPDATE projects SET deleted_at=? WHERE id=?').bind(Date.now(),courseId).run();
 // Real native Workflows, repository fetch boundaries and SSE assembly; all network is mocked.
 const repoProject=await admin.ok('POST','projects',{...draft,title:'完整仓库精选验收',links:[{type:'repository',label:'GitHub仓库',url:'https://github.com/test/fixture'}]});const repoPublish=await admin.ok('POST',`projects/${repoProject.id}/submit`,{});await waitReview(repoPublish.reviewId);
 const negativeRepo=await admin.ok('POST','admin/featured',{projectId:repoProject.id,criteria:['creativity'],evidence:'资料不足，评估必须先读完固定仓库的全部源文件。'});const negativeReview=await waitReview(negativeRepo.reviewId),negativeResult=JSON.parse(negativeReview.result);
 check('native workflows resume repository batches and only reject after all 100 files',negativeReview.state==='approved'&&negativeResult.decision==='not_qualify'&&negativeResult.coverage.complete&&negativeResult.coverage.filesCompleted===100&&(await db.prepare('SELECT COUNT(*) n FROM review_material_batches WHERE review_id=?').bind(negativeRepo.reviewId).first()).n===5);
 const positiveRepo=await admin.ok('POST','admin/featured',{projectId:repoProject.id,criteria:['creativity'],evidence:'根据实际源码中可核验的实现评价创意，不用读完才肯定。'});const positiveReview=await waitReview(positiveRepo.reviewId),positiveResult=JSON.parse(positiveReview.result);
 check('native SSE review can qualify early using real source evidence',positiveReview.state==='approved'&&positiveResult.decision==='qualify'&&!positiveResult.coverage.complete&&positiveResult.coverage.filesCompleted===24&&!!(await anon.ok('GET',`projects/${repoProject.id}`)).project.featured);
 check('stream usage is settled and private reasoning never leaks into notices',!!(await db.prepare('SELECT id FROM ai_calls WHERE review_id=? AND charged_micros IS NOT NULL').bind(positiveRepo.reviewId).first())&&!(await db.prepare("SELECT id FROM notifications WHERE body LIKE '%私有模拟推理%' LIMIT 1").first()));
 await admin.ok('DELETE',`admin/featured/${repoProject.id}`);
 const disputedRepo=await admin.ok('POST','admin/featured',{projectId:repoProject.id,criteria:['depth','creativity'],evidence:'需要人工裁量已实现的参与式创作价值是否达到精选标准。'});const disputedRepoReview=await waitReview(disputedRepo.reviewId),disputedRepoResult=JSON.parse(disputedRepoReview.result);
 check('grounded repository value dispute enters human queue before full coverage',disputedRepoReview.state==='disputed'&&disputedRepoResult.decision==='disputed'&&disputedRepoResult.coverage.filesCompleted===24&&!disputedRepoResult.coverage.complete&&!(await anon.ok('GET',`projects/${repoProject.id}`)).project.featured);
 const reproducible=await admin.ok('POST','projects',{...draft,title:'可复现精选验收',stage:'可复现'});const reproducibleJob=await admin.ok('POST',`projects/${reproducible.id}/submit`,{});await waitReview(reproducibleJob.reviewId);
 holdFeatured=true;releaseFeatured=undefined;const stale=await admin.ok('POST','admin/featured',{...featuredBody,projectId:reproducible.id});await waitFor(()=>releaseFeatured);
 await admin.ok('POST','admin/content/project/'+reproducible.id+'/take-down',{reason:'检查下架后在途精选审核不得恢复推荐。'});holdFeatured=false;releaseFeatured();await waitReview(stale.reviewId);
 check('admin takedown prevents in-flight featured approval',!(await admin.ok('GET',`projects/${reproducible.id}`)).project.featured);
 await admin.ok('POST','admin/content/project/'+reproducible.id+'/unlock',{reason:'隔离验收完成，解除本次测试下架。'});
 // Actual binary upload and version-bound visual review with intercepted model.
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV2kAAAAASUVORK5CYII=','base64');
 const form=new FormData();form.append('purpose','cover');form.append('file',new Blob([png],{type:'image/png'}),'cover.png');const uploaded=await admin.ok('POST','files',form);
 check('cover preview is private before publication',(await admin.raw('covers/'+uploaded.id)).headers.get('content-type')==='image/png'&&(await anon.raw('covers/'+uploaded.id)).status===404);
 const pictureCourse=await admin.ok('POST','courses',{...draft,title:'课程图片在线阅读验收',stage:'连载中',tags:[],platforms:[],fileIds:[uploaded.id],prerequisites:'掌握基础C语言',outcomes:'理解图片在线展示',modules:[{title:'课程模块',lessons:[{id:'image-reading',title:'在线阅读',body:'课程插图在线展示。'}]}]});
 check('draft course image is visible only to its owner and administrators',(await admin.raw('course-images/'+uploaded.id)).status===200&&(await member.raw('course-images/'+uploaded.id)).status===404&&(await anon.raw('course-images/'+uploaded.id)).status===404);
 await db.prepare("UPDATE revisions SET status='published' WHERE id=(SELECT head_id FROM projects WHERE id=?)").bind(pictureCourse.id).run();
 await db.prepare('UPDATE projects SET published_id=head_id WHERE id=?').bind(pictureCourse.id).run();
 const inlinePicture=await anon.raw('course-images/'+uploaded.id);
 check('published course image is inline with inspected MIME and isolated content policy',inlinePicture.status===200&&inlinePicture.headers.get('content-type')==='image/png'&&inlinePicture.headers.get('content-disposition')==='inline'&&inlinePicture.headers.get('content-security-policy').includes('sandbox'));
 await db.prepare('UPDATE projects SET admin_lock_at=? WHERE id=?').bind(Date.now(),pictureCourse.id).run();
 check('administrator lock also hides course image data',(await anon.raw('course-images/'+uploaded.id)).status===404);
 await db.prepare('UPDATE projects SET deleted_at=? WHERE id=?').bind(Date.now(),pictureCourse.id).run();

 const badImage=new FormData();badImage.append('purpose','cover');badImage.append('file',new Blob(['<html>not an image</html>'],{type:'image/png'}),'bad.png');
 check('HTML disguised as cover is rejected',(await admin.call('POST','files',badImage)).status===422);
 const foreign=await member.ok('POST','projects',{...draft,title:'封面归属检查'});
 check('cannot attach another author cover',(await member.call('PATCH',`projects/${foreign.id}`,{...draft,coverFileId:uploaded.id})).status===422);
 const memberPublication=await member.ok('POST',`projects/${foreign.id}/submit`,{});await waitReview(memberPublication.reviewId);
 const selfNomination=await member.ok('POST',`projects/${foreign.id}/featured-nomination`,{criteria:['teaching'],evidence:'资料不足，只希望检查作者本人申请权限与结果隐私。'});await waitReview(selfNomination.reviewId);
 const creatorView=(await member.ok('GET',`projects/${foreign.id}`)).project;
 check('authors can nominate their published version and see only outcome',creatorView.featuredReview.result.decision==='not_qualify'&&!creatorView.featuredReview.result.assessments&&!creatorView.featuredReview.result.filesRead&&(await member.call('GET',`reviews/${selfNomination.reviewId}`)).status===403);

 const withCover=await admin.ok('POST','projects',{...draft,title:'封面图片验收',coverFileId:uploaded.id});const coverJob=await admin.ok('POST',`projects/${withCover.id}/submit`,{});await waitReview(coverJob.reviewId);
 check('native image is delivered to reviewer and published with exact version',modelCalls.some(c=>c.image)&&JSON.parse((await db.prepare('SELECT result FROM reviews WHERE id=?').bind(coverJob.reviewId).first()).result).filesRead.includes('封面图片 '+uploaded.id)&&(await anon.raw('covers/'+uploaded.id)).status===200);
 check('project cover cannot bypass course-image publication scope',(await anon.raw('course-images/'+uploaded.id)).status===404);
 await admin.ok('PATCH',`projects/${withCover.id}`,{...draft,title:'封面图片验收',coverFileId:null});
 check('draft removal preserves original public cover',(await anon.ok('GET',`projects/${withCover.id}`)).project.coverFileId===uploaded.id);
 const replacement=new FormData();replacement.append('purpose','cover');replacement.append('file',new Blob([png],{type:'image/png'}),'replacement.png');const nextCover=await admin.ok('POST','files',replacement);
 await admin.ok('PATCH',`projects/${withCover.id}`,{...draft,title:'画面违规封面隔离验收',coverFileId:nextCover.id});const blockedCover=await admin.ok('POST',`projects/${withCover.id}/submit`,{});await waitReview(blockedCover.reviewId);
 check('rejected cover keeps old published image and replacement stays private',(await anon.ok('GET',`projects/${withCover.id}`)).project.coverFileId===uploaded.id&&(await anon.raw('covers/'+nextCover.id)).status===404);
 const oldRevision=await db.prepare('SELECT * FROM revisions WHERE id=?').bind(withCover.revisionId).first();const obsoleteId=crypto.randomUUID();
 await db.prepare("INSERT INTO reviews(id,entity_type,entity_id,owner_id,snapshot,digest,state,created_at,updated_at,task,lane) VALUES(?,'revision',?,?,?,?,'queued',?,?,'publish','project')").bind(obsoleteId,oldRevision.id,adminId,oldRevision.snapshot,oldRevision.digest,Date.now(),Date.now()).run();
 const callsBeforeObsolete=modelCalls.length;const obsoleteResult=await admin.ok('POST',`admin/reviews/${obsoleteId}/run`,{});
 check('superseded submission ends without model charge or human escalation',obsoleteResult.decision==='superseded'&&modelCalls.length===callsBeforeObsolete&&(await db.prepare('SELECT state FROM reviews WHERE id=?').bind(obsoleteId).first()).state==='superseded'&&!(await db.prepare('SELECT id FROM notifications WHERE review_id=?').bind(obsoleteId).first()));
 bindings.PROJECT_PUBLICATION_ENABLED='false';await mf.setOptions({...options,bindings});await mf.ready;db=await mf.getD1Database('DB');
 const previewProject=await admin.ok('POST','projects',{...draft,title:'仅试审不应上架'});
 const audit=await admin.ok('POST',`admin/projects/${previewProject.id}/audit`,{});const auditReview=await waitReview(audit.reviewId);
 await waitFor(()=>db.prepare("SELECT id FROM notifications WHERE review_id=? AND kind='review' AND state='ready'").bind(audit.reviewId).first());
 check('normal review delivers notification while publication is paused',auditReview.state==='approved'&&(await anon.call('GET',`projects/${previewProject.id}`)).status===404&&JSON.parse(auditReview.result).publicationHeld===true);
 await db.prepare("UPDATE notifications SET href='/dashboard' WHERE review_id=? AND kind='review'").bind(audit.reviewId).run();
 const legacyNotice=(await admin.ok('GET','notifications')).items.find(n=>n.review_id===audit.reviewId&&n.kind==='review');
 check('legacy audit notification opens its work and offers exact review record',legacyNotice.href===`/projects/${previewProject.id}`&&legacyNotice.reviewHref===`/reviews/${audit.reviewId}`);
 const adminWorkflows=await admin.ok('GET','admin/workflows');
 check('completed reviews appear only in history and not administrator pending tasks',adminWorkflows.history.some(r=>r.id===audit.reviewId)&&!adminWorkflows.pending.some(r=>r.state==='approved'||r.state==='queued'||r.state==='running'));
 await admin.ok('POST',`admin/reviews/${audit.reviewId}/decision`,{decision:'pass',reason:'总体原因：工程与屏幕显示相关，甜点标签无关，平台改为ST。',taxonomy:{tags:[{label:'烘焙甜点',action:'reject'}],platforms:[{label:'CH',action:'replace',target:'ST'}]}});
 check('human review accepts one overall reason and keeps unpublished work hidden',(await anon.call('GET',`projects/${previewProject.id}`)).status===404&&JSON.parse((await db.prepare('SELECT result FROM reviews WHERE id=?').bind(audit.reviewId).first()).result).proposedClassification.platforms[0].name==='ST');
 const pausedDraft=await admin.ok('POST','projects',{...draft,title:'暂停上架仍正常审核'});const waitingPublication=await admin.ok('POST',`projects/${pausedDraft.id}/submit`,{});await waitReview(waitingPublication.reviewId);
 check('publication pause continues formal AI review instead of disabling the workflow',(await db.prepare('SELECT state FROM reviews WHERE id=?').bind(waitingPublication.reviewId).first()).state==='approved'&&(await anon.call('GET',`projects/${pausedDraft.id}`)).status===404);
 const callsBeforeBudget=modelCalls.length;bindings.DISCUSSION_AI_MONTHLY_MAX_CALLS='1';await mf.setOptions({...options,bindings});await mf.ready;db=await mf.getD1Database('DB');await db.prepare('DELETE FROM limits WHERE key LIKE ?').bind(memberId+':%').run();
 const exhausted=await member.ok('POST','topics',{title:'额度用完时的评论',body:'额度耗尽也不应该直接公开这条评论。',board:'经验交流',projectId});await pause(150);
 check('budget exhaustion keeps queue and never calls provider or publishes',(await db.prepare('SELECT state FROM reviews WHERE id=?').bind(exhausted.reviewId).first()).state==='queued'&&modelCalls.length===callsBeforeBudget&&(await anon.call('GET',`topics/${exhausted.id}`)).status===404);
 const used=await db.prepare("SELECT COALESCE(SUM(COALESCE(charged_micros,reserved_micros)),0) n FROM ai_calls WHERE currency='CNY'").first();bindings.DISCUSSION_AI_MONTHLY_MAX_CALLS='1000';bindings.AI_TOTAL_MONTHLY_BUDGET_MICROS=String(used.n+1);
 await mf.setOptions({...options,bindings});await mf.ready;db=await mf.getD1Database('DB');await db.prepare('DELETE FROM limits WHERE key LIKE ?').bind(memberId+':%').run();
 await db.prepare("UPDATE ai_budget_grants SET amount_micros=? WHERE pool='shared'").bind(used.n+1).run();
 const secondDraft=await admin.ok('POST','projects',{...draft,title:'共享人民币预算试审'});
 const concurrent=await Promise.all([admin.ok('POST',`admin/projects/${secondDraft.id}/audit`,{}),member.ok('POST','topics',{title:'共享额度不足的评论',body:'两把密钥应当共同受总预算约束。',board:'经验交流',projectId})]);await pause(200);
 check('shared CNY budget blocks both credentials without overshoot',modelCalls.length===callsBeforeBudget&&(await db.prepare('SELECT state FROM reviews WHERE id=?').bind(concurrent[0].reviewId).first()).state==='queued'&&(await db.prepare('SELECT state FROM reviews WHERE id=?').bind(concurrent[1].reviewId).first()).state==='queued');
 bindings.AI_TOTAL_MONTHLY_BUDGET_MICROS='150000000';bindings.PROJECT_AI_MONTHLY_BUDGET_MICROS='1';await mf.setOptions({...options,bindings});await mf.ready;db=await mf.getD1Database('DB');await db.prepare("UPDATE ai_budget_grants SET amount_micros=150000000 WHERE pool='shared'").run();await db.prepare("UPDATE ai_budget_grants SET amount_micros=1 WHERE pool='project'").run();await admin.ok('POST','admin/queue',{});
 check('per-lane CNY budget also stops project calls when shared allowance remains',modelCalls.filter(x=>x.key==='project').length===modelCalls.slice(0,callsBeforeBudget).filter(x=>x.key==='project').length&&(await db.prepare('SELECT state FROM reviews WHERE id=?').bind(concurrent[0].reviewId).first()).state==='queued');
 const reportData={passed:checks.length,checks,modelCalls:modelCalls.length,realNetworkCalls:0,productionDataModified:false};writeFileSync(path.join(state,'result.json'),JSON.stringify(reportData,null,2));console.log(JSON.stringify({report:path.join(state,'result.json'),...reportData}));
}catch(error){writeFileSync(path.join(state,'failure.json'),JSON.stringify({checks,error:String(error),stack:error.stack},null,2));throw error;}
finally{await mf.dispose();}

