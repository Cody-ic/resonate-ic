import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {localReviewSnapshot} from './helpers/local-review-snapshot.mjs';
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'local-review-')),source=path.join(root,'source'),output=path.join(root,'output');fs.mkdirSync(source);fs.mkdirSync(output);return {root,source,output,write(name,value){const p=path.join(source,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,value);}};}
test('freeze real sources and keep credentials, caches and duplicate build outputs out',async()=>{
 const h=fixture();h.write('www/js/app.js','actual source');h.write('android/build.gradle','plugins {}');h.write('cangcheng.keystore','secret');h.write('android/keystore.properties','private');h.write('node_modules/a.js','dependency');h.write('android/app/src/main/assets/public/app.js','generated');h.write('www/img/a.png',Buffer.from([1,2,3]));
 const snapshot=localReviewSnapshot(h.source,h.output);assert.equal(snapshot.files.length,2);assert.equal(snapshot.blocked.length,1);assert.equal(fs.existsSync(path.join(h.output,'local-source/cangcheng.keystore')),false);
 h.write('www/js/app.js','changed after freeze');const resumed=localReviewSnapshot(h.source,h.output);assert.equal(await resumed.files.find(f=>f.name.endsWith('/app.js')).read(),'actual source');assert.equal(resumed.manifest.sha256,snapshot.manifest.sha256);
});
test('refuse external submission when a text source contains a credential',()=>{
 const h=fixture();h.write('www/js/app.js','const token = "sk-'+ 'a'.repeat(24)+'";');assert.throws(()=>localReviewSnapshot(h.source,h.output),/疑似真实凭据/);
});
test('tampering with the frozen bytes stops reading',async()=>{
 const h=fixture();h.write('main.js','original');const snapshot=localReviewSnapshot(h.source,h.output);fs.writeFileSync(path.join(h.output,'local-source/main.js'),'tampered');await assert.rejects(snapshot.files[0].read(),/摘要不符/);
});
test('a single-file submission excludes neighbouring files and preserves its frozen bytes',async()=>{
 const h=fixture();h.write('index.html','<main>submitted</main>');h.write('neighbour.js','not submitted');
 const source=path.join(h.source,'index.html'),snapshot=localReviewSnapshot(source,h.output);
 assert.equal(snapshot.files.length,1);assert.equal(await snapshot.files[0].read(),'<main>submitted</main>');
 h.write('index.html','changed');const resumed=localReviewSnapshot(source,h.output);
 assert.equal(await resumed.files[0].read(),'<main>submitted</main>');
 assert.equal(fs.existsSync(path.join(h.output,'local-source/neighbour.js')),false);
});
