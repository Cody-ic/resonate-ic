import test from 'node:test';
import assert from 'node:assert/strict';
import {repositoryFiles,githubSource} from '../lib/repository-review.ts';
import {scanFeatured,nextScanBatch,acknowledgeSegments,assertNegativeCoverage} from '../lib/featured-scan.ts';
import {deflateRawSync} from 'node:zlib';

function bucket(){const objects=new Map();return {async put(key,value){objects.set(key,typeof value==='string'?new TextEncoder().encode(value):new Uint8Array(value));},async get(key){const bytes=objects.get(key);return bytes?{async text(){return new TextDecoder().decode(bytes);},async json(){return JSON.parse(new TextDecoder().decode(bytes));},async arrayBuffer(){return new Uint8Array(bytes).buffer;}}:null;},objects};}
function zip(entries){let offset=0;const data=[],central=[];for(const [name,text] of entries){const filename=Buffer.from(name),plain=Buffer.from(text),compressed=deflateRawSync(plain),local=Buffer.alloc(30),header=Buffer.alloc(46);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(plain.length,22);local.writeUInt16LE(filename.length,26);header.writeUInt32LE(0x02014b50);header.writeUInt16LE(8,10);header.writeUInt32LE(compressed.length,20);header.writeUInt32LE(plain.length,24);header.writeUInt16LE(filename.length,28);header.writeUInt32LE(offset,42);data.push(local,filename,compressed);central.push(header,filename);offset+=local.length+filename.length+compressed.length;}const end=Buffer.alloc(22),directory=Buffer.concat(central);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...data,directory,end]);}

test('only canonical public GitHub origins can initiate repository fetches',()=>{
 assert.equal(githubSource('https://github.com/owner/repo.git').repo,'repo');
 assert.equal(githubSource('https://github.com/owner/repo/tree/main/src').prefix,'src');
 for(const url of ['http://github.com/a/b','https://github.com.evil.test/a/b','https://u:p@github.com/a/b','https://github.com:444/a/b','http://127.0.0.1/a/b','file:///etc/passwd','https://github.com/a/b/issues'])assert.equal(githubSource(url),null);
});
test('pin a commit, read actual raw source, reuse immutable manifest/content',async()=>{
 const storage=bucket(),calls=[],commit='1'.repeat(40);
 const fetcher=async(url,init)=>{calls.push(url);assert.equal(init.redirect,'manual');assert.equal(new Headers(init.headers).has('authorization'),false);
  if(url.includes('/commits/'))return Response.json({sha:commit});
  if(url.includes('/git/trees/'))return Response.json({truncated:false,tree:[{type:'blob',mode:'100644',path:'README.md',size:5},{type:'blob',mode:'100644',path:'main.js',size:6}]});
  assert.ok(url.includes('/'+commit+'/'));return new Response('source');
 };
 const links=[{type:'repository',url:'https://github.com/o/r'}],first=await repositoryFiles('r1',links,storage,fetcher);
 assert.equal(first.manifests[0].commit,commit);assert.equal(await first.files[1].read(),'source');const count=calls.length;
 const again=await repositoryFiles('r1',links,storage,()=>{throw Error('Must stay on cached snapshot');});assert.equal(await again.files[1].read(),'source');assert.equal(calls.length,count);
});
test('API rate limit falls back to content-hashed archive without inventing a commit',async()=>{
 const storage=bucket(),archive=zip([['repo-HEAD/README.md','README'],['repo-HEAD/js/a.js','actual implementation']]);let requests=0;
 const fetcher=async url=>{requests++;return url.includes('api.github.com')?new Response('limited',{status:403}):new Response(archive);};
 const files=await repositoryFiles('fallback',[{type:'repository',url:'https://github.com/o/r'}],storage,fetcher);
 assert.equal(files.manifests[0].commit,null);assert.match(files.manifests[0].snapshotDigest,/^[a-f0-9]{64}$/);assert.equal(files.files.length,2);assert.equal(await files.files[1].read(),'actual implementation');
 const repeated=await repositoryFiles('fallback',[{type:'repository',url:'https://github.com/o/r'}],storage,()=>{throw Error('HEAD must not be downloaded again');});assert.equal(await repeated.files[1].read(),'actual implementation');assert.equal(requests,2);
});
test('unsupported file types remain visible as unread coverage',async()=>{
 const files=await repositoryFiles('blocked',[{type:'repository',url:'https://github.com/o/r'}],bucket(),async url=>url.includes('/commits/')?Response.json({sha:'2'.repeat(40)}):Response.json({tree:[{path:'design.epro2',type:'blob',size:10}],truncated:false}));
 assert.equal(files.files.length,0);assert.equal(files.blocked.length,1);assert.throws(()=>assertNegativeCoverage({decision:'not_qualify'},{file:0,offset:0},0,files.blocked));
});
test('UTF-8 coverage includes entire large files, not just their first lines',async()=>{
 const text='中文内容\n'.repeat(8000),files=[{name:'long.js',size:Buffer.byteLength(text),read:async()=>text}];let cursor={file:0,offset:0},collected='';
 while(cursor.file<files.length){const batch=await nextScanBatch(files,cursor);collected+=batch.segments.map(s=>s.text).join('');cursor=batch.next;}
 assert.equal(collected,text);assert.equal(cursor.offset,0);assert.throws(()=>acknowledgeSegments([],[{id:'a#0-2'}]));
});
function harness(count,model){const storage=bucket(),notes=[],files=Array.from({length:count},(_,i)=>({name:`repo/file-${i}.js`,size:30,read:async()=>`实现正文第${i}段，包含具体机制。`}));const options={reviewId:'scan',files,blocked:[],manifestFingerprint:'same-snapshot',bucket:storage,snapshot:JSON.stringify({task:'featured',nomination:{criteria:['creativity']}}),project:{title:'测试工程'},system:'评估规则',repositories:[],perform:async(_name,operation)=>operation(),model,validate:raw=>JSON.parse(raw),saveBatch:async(...args)=>notes.push(args),progress:async()=>{}};return {options,storage,notes};}
function result(input,decision='not_qualify'){return {coveredSegments:input.segments.map(s=>s.id),decision,summary:'累计审阅判断',basics:{documentationClear:true,reproducible:true},assessments:[{meets:decision==='qualify',evidence:decision==='qualify'?[{quote:input.segments[0].text}]:[]}],investigation:{counterEvidence:[],unresolvedQuestions:[],limitations:[]}};}
test('negative outcome scans every file across persisted workflow windows',async()=>{
 let calls=0;const h=harness(100,async messages=>{calls++;return {content:JSON.stringify(result(JSON.parse(messages[1].content)))};});
 const first=await scanFeatured(h.options);assert.equal(first.continuation,true);assert.equal(first.state.cursor.file,96);assert.equal(first.result,undefined);
 const final=await scanFeatured(h.options);assert.equal(final.result.decision,'not_qualify');assert.equal(final.result.coverage.complete,true);assert.equal(final.state.cursor.file,100);assert.equal(calls,5);assert.equal(h.notes.length,5);
});
test('positive evidence may stop before all files are read',async()=>{
 const h=harness(100,async messages=>({content:JSON.stringify(result(JSON.parse(messages[1].content),'qualify'))}));const scan=await scanFeatured(h.options);
 assert.equal(scan.result.decision,'qualify');assert.equal(scan.result.coverage.complete,false);assert.equal(scan.state.cursor.file,24);
});

test('a grounded value dispute goes to humans without exhausting unread files',async()=>{
 let calls=0;const h=harness(100,async messages=>{calls++;const input=JSON.parse(messages[1].content),value=result(input,'disputed');value.investigation.unresolvedQuestions=['参与式创作的应用价值是否达到本站创意精选尺度？'];value.assessments[0].evidence=[{quote:input.segments[0].text}];return {content:JSON.stringify(value)};});h.options.blocked=['unread-resource.png'];
 const scan=await scanFeatured(h.options);assert.equal(scan.result.decision,'disputed');assert.equal(scan.state.cursor.file,24);assert.equal(scan.result.coverage.complete,false);assert.equal(calls,1);assert.equal(h.notes.length,1);
});

test('an unsupported request for human judgement cannot skip repository reading',async()=>{
 const h=harness(100,async messages=>({content:JSON.stringify(result(JSON.parse(messages[1].content),'disputed'))}));
 await assert.rejects(scanFeatured(h.options),/具体待裁量问题/);assert.equal(h.notes.length,0);assert.equal(await h.storage.get('review-private/featured-scans/scan/state.json'),null);
});
test('budget interruption preserves completed batches and resumes without repeating them',async()=>{
 let calls=0;const h=harness(60,async messages=>{calls++;if(calls===2)throw Error('Budget wait');return {content:JSON.stringify(result(JSON.parse(messages[1].content)))};});
 await assert.rejects(scanFeatured(h.options),/Budget wait/);assert.equal(h.notes.length,1);
 const final=await scanFeatured(h.options);assert.equal(final.result.coverage.filesCompleted,60);assert.equal(h.notes.length,3);assert.equal(calls,4);
});
test('unread binary material cannot become a completed negative decision',async()=>{
 const h=harness(1,async messages=>({content:JSON.stringify(result(JSON.parse(messages[1].content)))}));h.options.blocked=['hardware.epro2'];
 await assert.rejects(scanFeatured(h.options),/审阅未完成/);const saved=await (await h.storage.get('review-private/featured-scans/scan/state.json')).json();assert.equal(saved.outcome,undefined);
});


test('same workflow replay starts from its immutable window checkpoint',async()=>{
 let paid=0;const h=harness(100,async messages=>{paid++;return {content:JSON.stringify(result(JSON.parse(messages[1].content)))};});
 const steps=new Map();h.options.windowId='workflow-one';h.options.perform=async(name,operation)=>{if(steps.has(name))return steps.get(name);const value=await operation();steps.set(name,value);return value;};
 const first=await scanFeatured(h.options),replayed=await scanFeatured(h.options);
 assert.equal(first.state.cursor.file,96);assert.equal(replayed.state.cursor.file,96);assert.equal(replayed.state.batches,4);assert.equal(paid,4);
 const final=await scanFeatured({...h.options,windowId:'workflow-two',perform:async(_name,operation)=>operation()});assert.equal(final.result.coverage.filesCompleted,100);assert.equal(paid,5);
});

test('invalid completed output gets one repair before coverage advances',async()=>{
 let calls=0;const h=harness(1,async messages=>{calls++;const input=JSON.parse(messages[1].content);if(calls===1)return {content:JSON.stringify({...result(input),coveredSegments:[]})};assert.equal(h.notes.length,0);assert.equal(messages.length,4);return {content:JSON.stringify(result(input))};});
 const final=await scanFeatured(h.options);assert.equal(calls,2);assert.equal(final.result.coverage.complete,true);assert.equal(h.notes.length,1);
});
test('one repair identifies all unsupported quotes without weakening validation',async()=>{
 let calls=0;const h=harness(1,async messages=>{
  calls++;const input=JSON.parse(messages[1].content),value=result(input);
  if(calls===1){value.assessments[0].evidence=[{quote:'fabricated positive'}];value.investigation.counterEvidence=[{quote:'fabricated counterexample'}];}
  else {assert.match(messages[3].content,/fabricated positive/);assert.match(messages[3].content,/fabricated counterexample/);assert.equal(h.notes.length,0);}
  return {content:JSON.stringify(value)};
 });
 h.options.validate=(raw,source)=>{const value=JSON.parse(raw);for(const e of [...value.assessments.flatMap(a=>a.evidence),...value.investigation.counterEvidence])assert.ok(source.includes(e.quote),'unsupported citation');return value;};
 const final=await scanFeatured(h.options);assert.equal(calls,2);assert.equal(final.result.coverage.complete,true);assert.equal(h.notes.length,1);
});

test('a subdirectory link still reviews the entire repository',async()=>{
 const repo=await repositoryFiles('subdir',[{type:'repository',url:'https://github.com/o/r/tree/main/src'}],bucket(),async url=>url.includes('/commits/')?Response.json({sha:'3'.repeat(40)}):Response.json({tree:[{path:'src/a.js',type:'blob',size:1},{path:'other/b.js',type:'blob',size:1}],truncated:false}));assert.equal(repo.files.length,2);
});


test('redirects are explicitly rejected in the edge-compatible fetch mode',async()=>{
 const origins=[];await assert.rejects(repositoryFiles('redirect',[{type:'repository',url:'https://github.com/o/r'}],bucket(),async(url,init)=>{origins.push(new URL(url).hostname);assert.equal(init.redirect,'manual');return new Response(null,{status:302,headers:{Location:'http://127.0.0.1/private'}});}),/不允许跳转/);assert.deepEqual(origins,['api.github.com','codeload.github.com']);
});
