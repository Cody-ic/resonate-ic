import test from 'node:test';import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';import {PassThrough,Writable} from 'node:stream';
import {curlMailRequest,pythonMailRequest,mailTransportFailure} from '../scripts/campus-mail-transport.mjs';
function fakeTransport({reply='HTTP/1.1 202 Accepted\r\nContent-Length: 0\r\n\r\n',exit=0}={}){
  const calls=[];return {calls,launch(command,args,options){
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};let input='';
    child.stdin=new Writable({write(chunk,encoding,done){input+=chunk;done();}});
    calls.push({command,args,options,input:()=>input});
    child.stdin.on('finish',()=>setImmediate(()=>{child.stdout.emit('data',Buffer.from(reply));child.emit('close',exit);}));return child;
  }};
}
test('local transport failures distinguish safe unsent requests from uncertain writes',()=>{
  const safe=mailTransportFailure({beforeRequest:true});
  assert.equal(safe.status,503);assert.equal(safe.headers.get('X-Resonate-Mail-Not-Started'),'1');
  const unknown=mailTransportFailure(new Error('timeout'));
  assert.equal(unknown.status,502);assert.equal(unknown.headers.get('X-Resonate-Mail-Transport'),'uncertain');
  assert.equal(unknown.headers.get('X-Resonate-Mail-Not-Started'),null);
});
test('segmented HTTPS transport keeps credentials off argv and preserves exact UTF-8 body',async()=>{
  const mock=fakeTransport({reply:JSON.stringify({status:429,headers:[['Retry-After','60']],body:Buffer.from('{"error":"limited"}').toString('base64')})});
  const body=JSON.stringify({text:'中文\n"$(not-a-shell)"'});
  const response=await pythonMailRequest(new Request('https://graph.microsoft.com/v1.0/me/sendMail',{method:'POST',headers:{Authorization:'Bearer private-token','Content-Type':'application/json','Content-Length':'999'},body}),mock.launch);
  assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'60');assert.deepEqual(await response.json(),{error:'limited'});
  const call=mock.calls[0],input=JSON.parse(call.input());assert.equal(call.command,'python3');assert.equal(call.options.shell,undefined);assert.equal(call.args.length,1);assert.match(call.args[0],/campus-mail-http.py$/);
  assert.doesNotMatch(JSON.stringify(call.args),/private-token|中文/);assert.ok(input.headers.some(([k,v])=>k==='authorization'&&v==='Bearer private-token'));
  assert.ok(!input.headers.some(([k])=>k==='content-length'));assert.equal(Buffer.from(input.body,'base64').toString(),body);
});
test('segmented HTTPS transport rejects other hosts or ports and never retries unknown writes',async()=>{
  const blocked=fakeTransport();for(const url of ['https://example.test/','https://graph.microsoft.com:444/'])assert.equal((await pythonMailRequest(new Request(url),blocked.launch)).status,403);assert.equal(blocked.calls.length,0);
  for(const safe of [true,false]){
    const mock=fakeTransport({reply:JSON.stringify({error:'TimeoutError',beforeRequest:safe,total:45}),exit:1});
    await assert.rejects(pythonMailRequest(new Request('https://graph.microsoft.com/v1.0/me/sendMail',{method:'POST',body:'{}'}),mock.launch),e=>e.beforeRequest===safe);assert.equal(mock.calls.length,1);
  }
});
test('mail credentials and JSON body travel only on stdin without a shell',async()=>{
  const mock=fakeTransport(),r=await curlMailRequest(new Request('https://graph.microsoft.com/v1.0/me/sendMail',{method:'POST',headers:{Authorization:'Bearer test-secret-token','Content-Type':'application/json'},body:JSON.stringify({message:'中文\n"$(not-a-shell)"'})}),mock.launch);
  assert.equal(r.status,202);assert.equal(mock.calls.length,1);const c=mock.calls[0];assert.deepEqual(c.args,['--disable','--config','-']);assert.equal(c.command,'curl');assert.equal(c.options.shell,undefined);assert.match(c.input(),/noproxy = "\*"/);assert.match(c.input(),/test-secret-token/);assert.match(c.input(),/data-binary/);assert.match(c.input(),/http1\.1/);assert.doesNotMatch(JSON.stringify(c.args),/test-secret-token/);
});
test('only Microsoft mail hosts are allowed and unknown writes are never retried',async()=>{
  const mock=fakeTransport({exit:7});assert.equal((await curlMailRequest(new Request('https://example.test/'),mock.launch)).status,403);assert.equal(mock.calls.length,0);
  await assert.rejects(curlMailRequest(new Request('https://graph.microsoft.com/v1.0/me/sendMail',{method:'POST',body:'{}'}),mock.launch));assert.equal(mock.calls.length,1);
});
test('response status and Retry-After survive while decoded body framing is removed',async()=>{
  const mock=fakeTransport({reply:'HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 429 Too Many Requests\r\nRetry-After: 60\r\nContent-Encoding: gzip\r\nContent-Length: 999\r\n\r\n{"error":"limited"}'});
  const r=await curlMailRequest(new Request('https://login.microsoftonline.com/consumers/oauth2/v2.0/token',{method:'POST',body:'grant_type=refresh_token'}),mock.launch);assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'60');assert.equal(r.headers.get('content-encoding'),null);assert.deepEqual(await r.json(),{error:'limited'});
});
test('only proven failures before any request can be retried',async()=>{
  for(const [pretransfer,upload,safe] of [[0,0,true],[1,128,false],[1,0,false]]){
    const stats={time_pretransfer:pretransfer,size_upload:upload,time_connect:0,time_appconnect:0,time_starttransfer:0,time_total:10};
    const mock=fakeTransport({reply:'\n__RESONATE_TRANSFER__'+JSON.stringify(stats),exit:28});
    await assert.rejects(curlMailRequest(new Request('https://graph.microsoft.com/v1.0/me/sendMail',{method:'POST',body:'{}'}),mock.launch),error=>error.beforeRequest===safe);
    assert.equal(mock.calls.length,1);
  }
});
