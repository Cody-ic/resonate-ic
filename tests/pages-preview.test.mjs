import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const result=await build({entryPoints:['static-preview/data.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {previewResponse}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const call=async(path,method='GET')=>{const r=previewResponse(new URL('https://preview.example/api/'+path),method);return {status:r.status,value:await r.json()};};
test('public examples support real catalog filters and exclude runtime records',async()=>{
 const all=await call('projects?kind=project');assert.equal(all.value.items.length,3);assert.ok(all.value.items.every(p=>p.id.startsWith('example-')));
 const filtered=await call('projects?kind=project&category='+encodeURIComponent('嵌入式系统')+'&platform=ST&tag='+encodeURIComponent('屏幕显示'));assert.equal(filtered.value.items.length,1);assert.equal(filtered.value.items[0].id,'example-watch');
 const none=await call('projects?kind=project&q=unmatched-search');assert.equal(none.value.total,0);
});
test('course and resource details contain the fields their real components need',async()=>{
 const c=await call('courses/example-course');assert.equal(c.value.course.modules[0].lessons.length,3);
 const r=await call('projects/example-resource');assert.equal(typeof r.value.project.verification.scope,'string');assert.equal(r.value.attachments.length,0);
});
test('all writes, credentials and private reads are unavailable',async()=>{
 for(const path of ['account/register','auth/sign-in/email','topics','replies','reports','projects','admin/mail/test'])assert.equal((await call(path,'POST')).status,503);
 for(const path of ['notifications','admin/workflows','me/reviews','reports'])assert.equal((await call(path)).status,503);
 assert.equal((await call('me')).value.user,null);
});
