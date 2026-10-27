import test from 'node:test';
import assert from 'node:assert/strict';
import { safeURL, forumDecision, validateAIResult, projectSchema, courseSchema } from '../lib/domain.ts';
import { readFileSync } from 'node:fs';
test('外部资料支持多种来源，拒绝脚本和本机链接', () => {
  for(const url of ['https://github.com/Cody-ic/smart-car-pcb','https://oshwhub.com/a/b','https://pan.baidu.com/s/test']) assert.equal(safeURL(url),true);
  for(const url of ['javascript:alert(1)','file:///D:/secret','http://127.0.0.1/a','http://localhost/a','https://u:p@example.com','http://[::1]']) assert.equal(safeURL(url),false);
});
test('全部项目讨论先进入审核队列', () => {
  assert.equal(forumDecision('我认为这个PID参数不对，可能导致振荡。',true),'queued');
  assert.equal(forumDecision('资料在 https://example.com',true),'queued');
  assert.equal(forumDecision('资料在 https://example.com',false),'queued');
  assert.equal(forumDecision('我的密钥 sk-abcdefghijklmnopqrstuvwx',false),'queued');
});
test('AI必须引用真实资料，不接受矛盾结论和编造证据', () => {
  const good={decision:'revise',summary:'请补充',findings:[{rule:'claims',quote:'已实测',explanation:'报告没有相应记录'}]};
  assert.equal(validateAIResult(good,'项目说已实测').decision,'revise');
  assert.throws(()=>validateAIResult(good,'只做了仿真'));
  assert.throws(()=>validateAIResult({...good,decision:'pass'},'已实测'));
  assert.throws(()=>validateAIResult({...good,findings:[]},'已实测'));
});
test('项目资料有长度和分类约束',()=>{
  assert.equal(projectSchema.safeParse({title:'test'}).success,false);
});
test('导入课程有完整结构，重复章节标识和危险链接不能投稿',()=>{
  const imported=JSON.parse(readFileSync(new URL('../content/smartwatch-import.json',import.meta.url),'utf8'));
  const course=courseSchema.parse(imported.course);
  assert.equal(course.modules.flatMap(m=>m.lessons).length,79);
  assert.deepEqual(course.modules.map(m=>m.lessons.length),[20,9,7,8,10,12,7,6]);
  const duplicate=structuredClone(course);duplicate.modules[1].lessons[0].id=duplicate.modules[0].lessons[0].id;
  assert.equal(courseSchema.safeParse(duplicate).success,false);
  const unsafe=structuredClone(course);unsafe.modules[0].lessons[0].links[0].url='javascript:alert(1)';
  assert.equal(courseSchema.safeParse(unsafe).success,false);
  assert.equal(courseSchema.safeParse({...course,projectId:null,projectRevisionId:course.projectRevisionId}).success,false);
});
