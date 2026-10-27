import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
async function load(entry){const result=await build({entryPoints:[entry],bundle:true,platform:'node',format:'esm',write:false});return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));}
const {readiness}=await load('lib/readiness.ts');
const {requestErrorMessage}=await load('lib/request-error.ts');
const healthy=()=>({DB:{prepare(sql){assert.equal(sql,'SELECT id FROM projects LIMIT 1');return {all:async()=>({success:true,results:[]})};}},BUCKET:{head:async key=>{assert.equal(key,'__resonate_readiness__');return null;}}});
test('empty database and absent sentinel are healthy, never cached',async()=>{
 const r=await readiness(healthy());assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.deepEqual(await r.json(),{ok:true,service:'relay-api',version:'0.1.0',database:true,uploads:true});
});
test('database read failure is degraded even when bindings exist',async()=>{
 const env=healthy();env.DB.prepare=()=>({all:async()=>{throw Error('private database error');}});
 const r=await readiness(env);assert.equal(r.status,503);assert.deepEqual(await r.json(),{ok:false,service:'relay-api',version:'0.1.0',database:false,uploads:true});
});
test('unsuccessful database response is degraded',async()=>{
 const env=healthy();env.DB.prepare=()=>({all:async()=>({success:false})});const r=await readiness(env);assert.equal(r.status,503);assert.equal((await r.json()).database,false);
});
test('storage read failure is degraded and omits private exception details',async()=>{
 const env=healthy();env.BUCKET.head=async()=>{throw Error('SENSITIVE provider payload');};const r=await readiness(env);assert.equal(r.status,503);const value=await r.json();assert.equal(value.database,true);assert.equal(value.uploads,false);assert.ok(!JSON.stringify(value).includes('SENSITIVE'));
});
test('missing bindings produce an explicit unavailable response',async()=>{
 const r=await readiness({});assert.equal(r.status,503);const value=await r.json();assert.equal(value.database,false);assert.equal(value.uploads,false);
});
test('API support ID is included without stringifying private response data',()=>{
 const requestId='55bc8ef0-ab10-4cdc-83ff-12ff76c9aac0';const text=requestErrorMessage({error:'服务暂时不可用',requestId,token:'SENSITIVE'});assert.ok(text.includes(requestId));assert.ok(!text.includes('SENSITIVE'));
});
test('malformed support ID is omitted and validation errors remain useful',()=>{
 assert.equal(requestErrorMessage({error:'输入有误',requestId:'SENSITIVE\nnot-an-id',fields:{fieldErrors:{title:['必填']}}}),'输入有误：title 必填');assert.equal(requestErrorMessage({error:{private:'SENSITIVE'}}),'操作失败，请稍后重试');
});
