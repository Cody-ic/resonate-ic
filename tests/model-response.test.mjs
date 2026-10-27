import test from 'node:test';
import assert from 'node:assert/strict';
import {readModelResponse} from '../lib/model-response.ts';
const event=value=>'data: '+(typeof value==='string'?value:JSON.stringify(value))+'\r\n\r\n';
function stream(text,split=11){const bytes=new TextEncoder().encode(text);return new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=split)controller.enqueue(bytes.slice(i,i+split));controller.close();}}),{headers:{'Content-Type':'text/event-stream'}});}
test('SSE assembles split UTF-8, private reasoning, final usage and finish marker',async()=>{
 const progress=[],response=await readModelResponse(stream(': keep-alive\r\n\r\n'+event({choices:[{index:0,delta:{reasoning_content:'私有推理'}}]})+event({choices:[{index:0,delta:{content:'{"结论":'}}]})+event({choices:[{index:0,delta:{content:'"完成"}'}}]})+event({choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110}})+event('[DONE]'),1),{progress:async p=>progress.push(p)});
 assert.equal(response.streamComplete,true);assert.equal(response.finishReason,'stop');assert.equal(response.message.content,'{"结论":"完成"}');assert.equal(response.message.reasoning_content,'私有推理');assert.equal(response.usage.total_tokens,110);
 assert.ok(progress.length);assert.equal(JSON.stringify(progress).includes('私有推理'),false);
});
test('truncated stream cannot be accepted, but preserves any known usage',async()=>{
 const response=await readModelResponse(stream(event({choices:[{delta:{content:'partial'},finish_reason:'stop'}],usage:{prompt_tokens:2,completion_tokens:1}})));
 assert.equal(response.streamComplete,false);assert.equal(response.finishReason,'incomplete_stream');assert.equal(response.usage.prompt_tokens,2);
});
test('network error retains partial receipt without marking it complete',async()=>{
 let reads=0;const response=new Response(new ReadableStream({pull(c){if(reads++===0)c.enqueue(new TextEncoder().encode(event({choices:[{delta:{content:'partial'}}]})));else c.error(new Error('network interrupted'));}}),{headers:{'Content-Type':'text/event-stream'}});
 const result=await readModelResponse(response);assert.equal(result.message.content,'partial');assert.equal(result.streamComplete,false);assert.match(result.error,/network interrupted/);
});
test('oversized or malformed streams never produce a completed response',async()=>{
 const oversized=await readModelResponse(stream(event({choices:[{delta:{content:'x'.repeat(200)}}]})+event('[DONE]')),{maximumBytes:30});assert.equal(oversized.streamComplete,false);
 const malformed=await readModelResponse(stream('data: bad json\n\n'));assert.equal(malformed.streamComplete,false);
});
test('non-stream JSON remains compatible with ordinary reviews',async()=>{
 const result=await readModelResponse(Response.json({choices:[{message:{role:'assistant',content:'ok'},finish_reason:'stop'}],usage:{total_tokens:10}}));assert.equal(result.message.content,'ok');assert.equal(result.finishReason,'stop');
});
test('a broken progress sink cannot discard the paid answer',async()=>{
 const result=await readModelResponse(stream(event({choices:[{delta:{content:'ok'},finish_reason:'stop'}]})+event('[DONE]')),{progress:async()=>{throw Error('DB busy');}});assert.equal(result.streamComplete,true);assert.equal(result.message.content,'ok');
});
