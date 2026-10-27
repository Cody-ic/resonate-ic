// Reconcile the explicitly recorded October 26 capacity experiment receipts.
// No API calls. Unknown historical calls remain reserved. Backup precedes writes.
import {DatabaseSync,backup} from 'node:sqlite';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {usageCharge} from '../lib/ai-pricing.ts';
const dbPath=process.argv[2];if(!dbPath)throw Error('Pass the local SQLite path');
const db=new DatabaseSync(dbPath),apply=process.argv.includes('--apply');
const sources=['2026-10-26T04-44-09-091Z','2026-10-26T04-46-09-920Z','2026-10-26T04-48-36-738Z'];
const price={input:2,output:8,cachedInput:.04,offPeakDates:''},items=[];
for(const source of sources){
 const report=JSON.parse(readFileSync(path.join('outputs','course-capacity-'+source,'report.json'),'utf8'));
 if(report.model!=='deepseek-flash')throw Error('Unexpected model');
 for(const round of report.rounds){
  const row=db.prepare('SELECT * FROM ai_calls WHERE id=?').get(round.callId);
  if(!row||row.review_id!==report.reviewId||row.currency!=='CNY'||row.model!==report.model||row.tokens!==round.usage.total_tokens||row.reserved_micros!==Math.round(round.reservedCny*1e6))throw Error('Receipt does not match ledger: '+round.callId);
  const receivedAt=Math.ceil(row.created_at+round.wallMs),charge=usageCharge(round.usage,price,row.created_at,receivedAt);
  if(!charge)throw Error('Incomplete usage');
  items.push({id:row.id,reservedMicros:row.reserved_micros,chargedMicros:charge.micros,usage:round.usage,receivedAt,source});
 }
}
const output=path.join('outputs','usage-reconciliation-'+Date.now());mkdirSync(output,{recursive:true});
if(apply){
 await backup(db,path.join(output,'before.sqlite'));
 db.exec('BEGIN IMMEDIATE');
 try{const update=db.prepare("UPDATE ai_calls SET charged_micros=?,usage_json=?,pricing_json=?,settled_at=? WHERE id=? AND currency='CNY' AND charged_micros IS NULL");for(const item of items)update.run(item.chargedMicros,JSON.stringify(item.usage),JSON.stringify({...price,source:'Official rates verified for the recorded October 26 experiment'}),item.receivedAt,item.id);db.exec('COMMIT');}
 catch(error){db.exec('ROLLBACK');throw error;}
}
const result={applied:apply,calls:items.length,reservedMicros:items.reduce((s,i)=>s+i.reservedMicros,0),chargedMicros:items.reduce((s,i)=>s+i.chargedMicros,0),items};
writeFileSync(path.join(output,'report.json'),JSON.stringify(result,null,2));db.close();
console.log(JSON.stringify({output,applied:apply,calls:result.calls,reservedCny:result.reservedMicros/1e6,estimatedCny:result.chargedMicros/1e6,releasedCny:(result.reservedMicros-result.chargedMicros)/1e6}));
