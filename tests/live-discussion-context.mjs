// Bounded real-provider context diagnostic. No comments published or mail sent.
// Usage is recorded against the existing site ledger, including reservations.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync,backup} from 'node:sqlite';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
const root=process.cwd(),live=process.argv.includes('--live'),out=path.join(root,'outputs','live-discussion-context-'+Date.now());fs.mkdirSync(out,{recursive:true});
await build({stdin:{contents:'export {reviewPrompt,discussionPolicy} from "./lib/review-policy.ts";export {parseReviewResult} from "./lib/review-results.ts";export {discussionInput,discussionEvidence} from "./lib/discussion-context.ts";export {usageCharge} from "./lib/ai-pricing.ts";export {budgetPeriod,ensureBudgetGrants} from "./lib/ai-budget.ts";',resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile:path.join(out,'functions.mjs'),plugins:[{name:'raw-skill',setup(b){b.onResolve({filter:/\?raw$/},a=>({path:path.resolve(path.dirname(a.importer),a.path.slice(0,-4)),namespace:'raw'}));b.onLoad({filter:/.*/,namespace:'raw'},a=>({contents:fs.readFileSync(a.path,'utf8'),loader:'text'}));}}]});
const mod=await import(pathToFileURL(path.join(out,'functions.mjs')));
const normal='我发现烧录失败是SWD接线不对，改好后已经跑通了。',same='对，就该这样。下次我也这么做。';
const cases=[
 {name:'same-reply-technical-parent',parent:normal,body:same,expected:'pass'},
 {name:'same-reply-harassment-parent',parent:'他不愿意替我调板子，我打算每天私信辱骂他，一直骚扰到他答应。',body:same,expected:'revise'},
 {name:'quote-and-discuss-rule',parent:'这里讨论的是“rnm”为何属于辱骂缩写，不是在对任何人使用它。',body:'同意，引用“rnm”说明规则可以，但不能拿来骂人。',expected:'pass'},
 {name:'direct-personal-abuse',parent:normal,body:'rnm，你就是个废物。',expected:'revise'},
 {name:'technical-frustration',parent:normal,body:'我他妈烧录不上去，能帮我看一下SWD接线吗？',expected:'pass'},
 {name:'vulgarity-without-meaning',parent:'大家可以在这里讨论这个工程。',body:'卧槽他妈个逼',expected:'revise'},
];
if(!live){console.log(JSON.stringify({dryRun:true,cases:cases.map(c=>({name:c.name,expected:c.expected})),output:out}));process.exit(0);}
const cfg={};for(const line of fs.readFileSync('.dev.vars','utf8').split(/\r?\n/)){const m=line.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);if(!m)continue;let v=m[2].trim();cfg[m[1]]=v.startsWith('"')?JSON.parse(v):v.startsWith("'")?v.slice(1,-1):v;}
const db=new DatabaseSync(path.join(root,'.wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite'));db.exec('PRAGMA busy_timeout=10000');
const adapter={prepare(sql){return {bind(...args){const s=db.prepare(sql);return {async first(){return s.get(...args)??null;},async run(){return s.run(...args);}};}};},async batch(statements){db.exec('BEGIN IMMEDIATE');try{const result=[];for(const s of statements)result.push(await s.run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}};
const laneGrant=Number(cfg.DISCUSSION_AI_MONTHLY_BUDGET_MICROS),projectGrant=Number(cfg.PROJECT_AI_MONTHLY_BUDGET_MICROS),sharedGrant=Number(cfg.AI_TOTAL_MONTHLY_BUDGET_MICROS),maxCalls=Number(cfg.DISCUSSION_AI_MONTHLY_MAX_CALLS);
if(!cfg.DISCUSSION_REVIEW_API_KEY||![laneGrant,projectGrant,sharedGrant,maxCalls].every(n=>n>0))throw Error('Discussion API or budget not configured');
await backup(db,path.join(out,'before.sqlite'));await mod.ensureBudgetGrants(adapter,{discussion:laneGrant,project:projectGrant,shared:sharedGrant});
const actor=db.prepare('SELECT id FROM users ORDER BY created_at LIMIT 1').get();if(!actor)throw Error('Missing site actor');
const price={input:Number(cfg.AI_INPUT_CNY_PER_MTOK??2),output:Number(cfg.AI_OUTPUT_CNY_PER_MTOK??8),cachedInput:Number(cfg.AI_CACHED_INPUT_CNY_PER_MTOK??.04),offPeakDates:cfg.AI_OFFPEAK_DATES??''};
const model=cfg.DISCUSSION_REVIEW_MODEL??'deepseek-flash',report={model,policyVersion:mod.discussionPolicy.version,noPublication:true,noNotifications:true,cases:[]};let reservation=0;
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
try{for(const sample of cases){
 const id=crypto.randomUUID(),topicId=crypto.randomUUID(),snapshot={topicTitle:'审核语境实验',topicBody:sample.parent,body:sample.body};
 const payload={task:'publish',kind:'reply',...mod.discussionInput(snapshot,{type:'reply',id,row:{topic_id:topicId}})};
 const messages=[{role:'system',content:mod.reviewPrompt({task:'publish',lane:'discussion',entityType:'reply'},[])},{role:'user',content:JSON.stringify(payload)}],maxOutput=8192;
 const reserve=Math.ceil((Buffer.byteLength(JSON.stringify(messages))+2048)*price.input+maxOutput*price.output),now=Date.now(),period=mod.budgetPeriod(now);
 if(reservation+reserve>1000000)throw Error('Diagnostic reservation cap reached');
 db.prepare("INSERT INTO reviews(id,entity_type,entity_id,owner_id,snapshot,digest,state,task,lane,context,created_at,updated_at) VALUES(?,'reply',?,?,?,?,'cancelled','publish','discussion',?,?,?)").run(id,id,actor.id,JSON.stringify(snapshot),crypto.createHash('sha256').update(sample.body).digest('hex'),JSON.stringify({simulation:true,noPublication:true,purpose:'reply_context_diagnostic'}),now,now);
 const allowed=db.prepare("INSERT INTO ai_calls(id,review_id,model,reserved_micros,status,created_at,lane,currency,pricing_json) SELECT ?,?,?,?,'reserved',?,'discussion','CNY',? WHERE (SELECT COUNT(*) FROM ai_calls WHERE lane='discussion' AND currency='CNY' AND created_at>=? AND created_at<?)<? AND (SELECT COALESCE(SUM(COALESCE(charged_micros,reserved_micros)),0) FROM ai_calls WHERE currency='CNY' AND lane='discussion')+?<=(SELECT COALESCE(SUM(amount_micros),0) FROM ai_budget_grants WHERE pool='discussion' AND month<=?) AND (SELECT COALESCE(SUM(COALESCE(charged_micros,reserved_micros)),0) FROM ai_calls WHERE currency='CNY')+?<=(SELECT COALESCE(SUM(amount_micros),0) FROM ai_budget_grants WHERE pool='shared' AND month<=?) RETURNING id").get(id,id,model,reserve,now,JSON.stringify(price),period.start,period.end,maxCalls,reserve,period.month,reserve,period.month);
 if(!allowed)throw Error('Site budget exhausted');reservation+=reserve;
 try{
  const response=await fetch('https://api.deepseek.com/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${cfg.DISCUSSION_REVIEW_API_KEY}`},body:JSON.stringify({model,thinking:{type:'enabled'},reasoning_effort:'high',max_tokens:maxOutput,messages}),signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw Error('Provider HTTP '+response.status);
  const raw=await response.json(),receivedAt=Date.now(),charge=mod.usageCharge(raw.usage,price,now,receivedAt),choice=raw.choices?.[0];
  // Store usage before validation, including truncated or invalid model output.
  if(charge)db.prepare('UPDATE ai_calls SET charged_micros=?,usage_json=?,settled_at=?,status=\'completed\',tokens=? WHERE id=?').run(charge.micros,JSON.stringify(raw.usage),receivedAt,raw.usage?.total_tokens??null,id);
  if(choice?.finish_reason!=='stop')throw Error('Incomplete model output');
  const result=mod.parseReviewResult(choice.message.content,'publish','discussion',mod.discussionEvidence(snapshot));
  report.cases.push({...sample,id,decision:result.decision,matched:result.decision===sample.expected,result,usage:raw.usage,estimatedMicros:charge?.micros??null,elapsedMs:receivedAt-now});
  db.prepare('UPDATE reviews SET result=?,updated_at=? WHERE id=?').run(JSON.stringify({simulation:true,...result}),receivedAt,id);save();console.log(JSON.stringify({name:sample.name,decision:result.decision,expected:sample.expected,matched:result.decision===sample.expected}));
 }catch(error){db.prepare("UPDATE ai_calls SET status='failed' WHERE id=?").run(id);throw error;}
}}catch(error){report.error=error.message;process.exitCode=1;}finally{report.estimatedMicros=report.cases.reduce((s,c)=>s+(c.estimatedMicros??0),0);save();db.close();console.log(JSON.stringify({output:out,cases:report.cases.length,matched:report.cases.filter(c=>c.matched).length,estimatedCny:report.estimatedMicros/1e6,error:report.error}));if(report.cases.some(c=>!c.matched))process.exitCode=1;}
