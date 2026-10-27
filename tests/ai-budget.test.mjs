import test from 'node:test';
import assert from 'node:assert/strict';
import {usageCharge,isOffPeak,nextOffPeak} from '../lib/ai-pricing.ts';
import {budgetBalance,budgetPeriod,followingMonth,ensureBudgetGrants} from '../lib/ai-budget.ts';
import {DatabaseSync} from 'node:sqlite';
const off=Date.parse('2026-10-26T00:00:00Z'),peak=Date.parse('2026-10-26T02:00:00Z');
const price={input:2,output:8,cachedInput:.04,offPeakDates:''};
test('usage settles cache hits and output once, including reasoning',()=>{
 assert.equal(usageCharge({prompt_tokens:1000,completion_tokens:100,total_tokens:1100,prompt_cache_hit_tokens:800,prompt_cache_miss_tokens:200,completion_tokens_details:{reasoning_tokens:80}},price,off,off).micros,616);
});
test('incomplete or contradictory usage retains reservation',()=>{
 for(const usage of [{total_tokens:100},{prompt_tokens:2,completion_tokens:-1},{prompt_tokens:2,completion_tokens:1,total_tokens:99},{prompt_tokens:2,completion_tokens:1,prompt_cache_hit_tokens:3}])assert.equal(usageCharge(usage,price,off,off),null);
});
test('boundary crossing uses conservative price',()=>assert.equal(usageCharge({prompt_tokens:1000,completion_tokens:100},price,off,peak).micros,2800));
test('off peak scheduling respects Beijing time',()=>{
 assert.equal(isOffPeak(peak),false);assert.equal(new Date(nextOffPeak(peak)).toISOString(),'2026-10-26T04:00:00.000Z');
 assert.equal(isOffPeak(peak,'2026-10-26'),true);
});
test('rollover consumes oldest balance first, then current grant',()=>{
 const grants=[{month:'2026-10',amount_micros:30000000},{month:'2026-11',amount_micros:30000000}];
 const first=budgetBalance(grants,10000000,'2026-11');assert.equal(first.availableMicros,50000000);assert.equal(first.carryMicros,20000000);assert.equal(first.buckets[1].usedMicros,0);
 const next=budgetBalance(grants,35000000,'2026-11');assert.equal(next.buckets[0].remainingMicros,0);assert.equal(next.buckets[1].usedMicros,5000000);
 const released=budgetBalance(grants,5000000,'2026-11');assert.equal(released.carryMicros,25000000);
});
test('shared grant independently limits combined lanes',()=>{
 assert.equal(budgetBalance([{month:'2026-10',amount_micros:50000000},{month:'2026-11',amount_micros:50000000}],60000000,'2026-11').availableMicros,40000000);
});
test('month rollover follows Beijing time and year boundary',()=>{
 assert.equal(budgetPeriod(Date.parse('2026-10-31T16:00:00Z')).month,'2026-11');assert.equal(followingMonth('2026-12'),'2027-01');
});
test('monthly grants are idempotent, survive missing scheduler months, preserve history',async()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE ai_budget_grants(pool TEXT,month TEXT,amount_micros INTEGER,created_at INTEGER,UNIQUE(pool,month))');
 const adapter={prepare(sql){return {bind(...args){const stmt=db.prepare(sql);return {async first(){return stmt.get(...args)??null;},async run(){return stmt.run(...args);}};}};},async batch(items){for(const item of items)await item.run();}};
 await Promise.all([ensureBudgetGrants(adapter,{project:30000000,discussion:30000000,shared:50000000},off),ensureBudgetGrants(adapter,{project:30000000,discussion:30000000,shared:50000000},off)]);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM ai_budget_grants').get().n,3);
 await ensureBudgetGrants(adapter,{project:40000000,discussion:30000000,shared:50000000},Date.parse('2026-12-01T00:00:00Z'));
 assert.deepEqual(db.prepare("SELECT month,amount_micros FROM ai_budget_grants WHERE pool='project' ORDER BY month").all().map(r=>({...r})),[{month:'2026-10',amount_micros:30000000},{month:'2026-11',amount_micros:30000000},{month:'2026-12',amount_micros:40000000}]);
 await ensureBudgetGrants(adapter,{project:90000000},Date.parse('2026-12-02T00:00:00Z'));
 assert.equal(db.prepare("SELECT amount_micros FROM ai_budget_grants WHERE pool='project' AND month='2026-12'").get().amount_micros,40000000);db.close();
});
