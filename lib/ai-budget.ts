export type Grant={month:string;amount_micros:number};
export function budgetPeriod(at=Date.now()){
  const d=new Date(at+8*3600000),y=d.getUTCFullYear(),m=d.getUTCMonth();
  return {month:d.toISOString().slice(0,7),start:Date.UTC(y,m,1)-8*3600000,end:Date.UTC(y,m+1,1)-8*3600000};
}
export function followingMonth(month:string){const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m,1)).toISOString().slice(0,7);}
// Applying cumulative committed usage to the oldest grants is FIFO. Uncertain
// requests occupy funds too; settlement releases the unused part automatically.
export function budgetBalance(grants:Grant[],committed:number,currentMonth:string){
  let spend=committed;
  const buckets=[...grants].sort((a,b)=>a.month.localeCompare(b.month)).map(g=>{
    const used=Math.min(g.amount_micros,Math.max(0,spend));spend-=used;
    return {month:g.month,grantedMicros:g.amount_micros,usedMicros:used,remainingMicros:g.amount_micros-used};
  });
  return {buckets,grantedMicros:buckets.reduce((s,g)=>s+g.grantedMicros,0),availableMicros:Math.max(0,buckets.reduce((s,g)=>s+g.remainingMicros,0)-Math.max(0,spend)),carryMicros:buckets.filter(g=>g.month<currentMonth).reduce((s,g)=>s+g.remainingMicros,0)};
}
export async function ensureBudgetGrants(db:D1Database,amounts:Record<string,number>,at=Date.now()){
  const {month}=budgetPeriod(at),statements:D1PreparedStatement[]=[];
  for(const [pool,amount] of Object.entries(amounts)){
    if(!Number.isSafeInteger(amount)||amount<=0)continue;
    const latest=await db.prepare('SELECT month,amount_micros FROM ai_budget_grants WHERE pool=? ORDER BY month DESC LIMIT 1').bind(pool).first<Grant>();
    let next=latest?followingMonth(latest.month):month;
    for(let count=0;next<=month&&count<1200;count++,next=followingMonth(next)){
      // Missed months retain the last configured grant; the current month uses
      // current configuration. Existing grants are immutable and never doubled.
      statements.push(db.prepare('INSERT INTO ai_budget_grants(pool,month,amount_micros,created_at) VALUES(?,?,?,?) ON CONFLICT(pool,month) DO NOTHING').bind(pool,next,next===month?amount:latest!.amount_micros,at));
    }
  }
  for(let i=0;i<statements.length;i+=50)await db.batch(statements.slice(i,i+50));
}
