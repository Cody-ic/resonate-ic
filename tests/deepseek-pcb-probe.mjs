// Authorized single-call comparison. Same fixture; no publication or notices.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync,backup} from 'node:sqlite';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
const root=process.cwd(),source=path.join(root,'outputs/sonnet-pcb-probe-1793076499828022600/pcb-payload.json');
const bytes=fs.readFileSync(source),payload=JSON.parse(bytes),reviewId=crypto.randomUUID();
const out=path.join(root,'outputs','deepseek-pcb-probe-'+Date.now());fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'pcb-payload.json'),bytes);
const config={};for(const line of fs.readFileSync('.dev.vars','utf8').split(/\r?\n/)){const m=line.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);if(!m)continue;const v=m[2].trim();config[m[1]]=v.startsWith('"')?JSON.parse(v):v.startsWith("'")?v.slice(1,-1):v;}
const db=new DatabaseSync(path.join(root,'.wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite'));db.exec('PRAGMA busy_timeout=10000');
await backup(db,path.join(out,'before.sqlite'));
const adapter={prepare(sql){return {bind(...args){const s=db.prepare(sql);return {async first(){return s.get(...args)??null;},async all(){return {results:s.all(...args)};},async run(){const r=s.run(...args);return {meta:{changes:Number(r.changes)}};}};}};},async batch(items){db.exec('BEGIN IMMEDIATE');try{const r=[];for(const item of items)r.push(await item.run());db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}};
const bucketRoot=path.join(out,'private-bucket');fs.mkdirSync(bucketRoot);
const filename=key=>{const p=path.resolve(bucketRoot,key);if(!p.startsWith(bucketRoot+path.sep))throw Error('Invalid object path');return p;};
const bucket={async put(key,value){const p=filename(key);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,value);},async get(key){const p=filename(key);return fs.existsSync(p)?{async json(){return JSON.parse(fs.readFileSync(p,'utf8'));}}:null;}};
globalThis.__pcbProbeEnv={...config,DB:adapter,BUCKET:bucket};
await build({stdin:{contents:'export {modelRequest,laneConfig} from "./lib/moderation.ts";',resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile:path.join(out,'functions.mjs'),plugins:[{name:'probe-runtime',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'cloudflare',namespace:'env'}));b.onLoad({filter:/.*/,namespace:'env'},()=>({contents:'export const env=globalThis.__pcbProbeEnv;'}));b.onResolve({filter:/\?raw$/},a=>({path:path.resolve(path.dirname(a.importer),a.path.slice(0,-4)),namespace:'raw'}));b.onLoad({filter:/.*/,namespace:'raw'},a=>({contents:fs.readFileSync(a.path,'utf8'),loader:'text'}));}}]});
const mod=await import(pathToFileURL(path.join(out,'functions.mjs')));
const output=Number(process.argv[2]??8192);if(![8192,24576].includes(output))throw Error('Unsupported output limit');
const report={reviewId,model:mod.laneConfig('project').model,thinking:'enabled',reasoningEffort:'high',maxOutputTokens:output,tools:false,sameFixtureSha256:crypto.createHash('sha256').update(bytes).digest('hex'),noPublication:true,noNotifications:true,timeoutSeconds:240};
const cfg=mod.laneConfig('project'),reserve=Math.ceil((Buffer.byteLength(JSON.stringify([{role:'system',content:payload.system},...payload.messages]))+2050)*cfg.inputPrice+output*cfg.outputPrice);if(reserve>1000000)throw Error('Diagnostic one-yuan cap exceeded');
// Only extend this diagnostic's transport deadline. Body, accounting, and
// response parsing use production code. No retries and no response-format hint.
const originalFetch=globalThis.fetch;globalThis.fetch=(url,options)=>originalFetch(url,{...options,signal:AbortSignal.timeout(240000)});
const now=Date.now();db.prepare("INSERT INTO reviews(id,entity_type,entity_id,owner_id,snapshot,digest,state,task,lane,context,created_at,updated_at) VALUES(?,?,?,?,?,?,'cancelled','technical_check','project',?,?,?)").run(reviewId,'pcb_probe',reviewId,'local_seedy','{}',report.sameFixtureSha256,JSON.stringify({simulation:true,noPublication:true,noNotifications:true}),now,now);
console.log(JSON.stringify({started:true,model:report.model,output:out,maximumReservedCny:reserve/1000000}));
try{
 const answer=await mod.modelRequest({id:reviewId,lane:'project',task:'technical_check',context:'{}'},[{role:'system',content:payload.system},...payload.messages],undefined,output,512000);
 fs.writeFileSync(path.join(out,'answer.txt'),answer.content??'');report.success=true;
}catch(e){report.error=String(e.message).replaceAll(cfg.key??'__no_key__','[redacted]');process.exitCode=1;}
finally{
 globalThis.fetch=originalFetch;report.elapsedSeconds=(Date.now()-now)/1000;
 report.calls=db.prepare('SELECT model,status,tokens,reserved_micros,charged_micros,usage_json FROM ai_calls WHERE review_id=?').all(reviewId).map(r=>({...r,usage:r.usage_json?JSON.parse(r.usage_json):null,usage_json:undefined}));
 db.prepare('UPDATE reviews SET result=?,updated_at=? WHERE id=?').run(JSON.stringify({simulation:true,summary:'同样例PCB模型比较，未执行发布或通知',reportPath:path.relative(root,out),success:report.success??false}),Date.now(),reviewId);
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));db.close();console.log(JSON.stringify(report));
}
