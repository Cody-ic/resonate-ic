import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const rows=new Map();
globalThis.__deliveryEnv={BETTER_AUTH_SECRET:'isolated-delivery-status-secret-at-least-32-characters',DB:{prepare(){return {bind(id){return {async first(){return rows.get(id)??null;}};}};}}};
const bundle=await build({entryPoints:['lib/mail-delivery.ts'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'env',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'env'}));b.onLoad({filter:/.*/,namespace:'env'},()=>({contents:'export const env=globalThis.__deliveryEnv;'}));}}]});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const status=ticket=>api.deliveryStatus(new Request('https://example.test/api/auth/email-otp/delivery-status?ticket='+encodeURIComponent(ticket)));
test('concurrent requests receive only their own delivery receipt',async()=>{
  rows.set('one',{state:'queued',expires_at:Date.now()+300000});rows.set('two',{state:'uncertain',expires_at:Date.now()+300000});
  const issue=(id,delay)=>api.withDeliveryReceipt(async()=>{await new Promise(r=>setTimeout(r,delay));api.trackVerificationMail(id);return Response.json({success:true});});
  const [one,two]=await Promise.all([issue('one',20),issue('two',1)]);
  const a=await one.json(),b=await two.json();
  assert.equal((await(await status(a.deliveryTicket)).json()).state,'queued');
  const failed=await(await status(b.deliveryTicket)).json();assert.equal(failed.state,'uncertain');assert.match(failed.message,/未确认/);
  assert.deepEqual(Object.keys(failed).sort(),['message','state']);
  assert.equal((await status(a.deliveryTicket+'tampered')).status,401);
  assert.equal((await status('')).status,401);
});
test('provider acceptance is distinct from inbox delivery and expired OTPs',async()=>{
  rows.set('accepted',{state:'accepted',expires_at:Date.now()+300000});
  const response=await api.withDeliveryReceipt(async()=>{api.trackVerificationMail('accepted');return Response.json({success:true});});
  const {deliveryTicket}=await response.json();let r=await status(deliveryTicket),v=await r.json();
  assert.equal(v.state,'accepted');assert.match(v.message,/已接受/);assert.doesNotMatch(v.message,/已送达/);assert.equal(r.headers.get('cache-control'),'no-store');
  rows.set('accepted',{state:'accepted',expires_at:Date.now()-1});assert.equal((await(await status(deliveryTicket)).json()).state,'expired');
  const original=Date.now;Date.now=()=>original()+700000;try{assert.equal((await status(deliveryTicket)).status,401);}finally{Date.now=original;}
});
test('empty or rejected requests do not reveal whether an address exists',async()=>{
  const plain=await api.withDeliveryReceipt(async()=>Response.json({success:true}));assert.deepEqual(await plain.json(),{success:true});
  const rejected=await api.withDeliveryReceipt(async()=>{api.trackVerificationMail('none');return Response.json({error:'rejected'},{status:400});});assert.equal(rejected.status,400);assert.deepEqual(await rejected.json(),{error:'rejected'});
});
