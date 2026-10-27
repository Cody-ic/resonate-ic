import test from 'node:test';
import assert from 'node:assert/strict';
import {builtinTerms,resolveClassification,normalizeSnapshot} from '../lib/classification.ts';
const sample={tags:['陌生技术术语','PWM'],platforms:[{name:'自研平台',family:'other'}],sources:[{name:'其他',proposedName:'新竞赛',proposedDivision:'新组别',year:2026,detail:'A题'}]};
test('新标签和平台默认放行，其他来源不会自动变成新类',()=>{
 const result=resolveClassification(sample,undefined,builtinTerms);
 assert.deepEqual(result.tags,sample.tags);assert.equal(result.platforms[0].name,'自研平台');assert.equal(result.sources[0].name,'其他');assert.ok(!result.sources[0].proposedName);
});
test('新来源需显式批准且不能发明作者没提交的类',()=>{
 const result=resolveClassification(sample,{sources:[{index:0,name:'新竞赛',division:'新组别',createSource:true,createDivision:true}]},builtinTerms);
 assert.equal(result.sources[0].name,'新竞赛');assert.equal(result.sources[0].division,'新组别');
 assert.throws(()=>resolveClassification(sample,{sources:[{index:0,name:'凭空新增',createSource:true}]},builtinTerms));
});
test('不能仅因标签陌生拒绝，必须有明显不合理依据',()=>{
 assert.throws(()=>resolveClassification(sample,{tags:[{label:'陌生技术术语',action:'reject',reason:'没有听说过这个术语'}]},builtinTerms));
 const result=resolveClassification(sample,{tags:[{label:'陌生技术术语',action:'reject',rule:'spam',reason:'这是完全无关的广告标签'}]},builtinTerms);
 assert.deepEqual(result.tags,['PWM']);
});
test('分类合并只接受已有目标',()=>{
 const terms=[...builtinTerms,{kind:'tag',name:'PWM',parent:'',family:''}];
 const result=resolveClassification({...sample,tags:['脉宽调制']},{tags:[{label:'脉宽调制',action:'merge',target:'PWM'}]},terms);
 assert.deepEqual(result.tags,['PWM']);assert.throws(()=>resolveClassification(sample,{tags:[{label:'PWM',action:'merge',target:'不存在'}]},terms));
});
test('旧方向保留含义并转入嵌入式主类',()=>{assert.equal(normalizeSnapshot({category:'智能车与控制',hardware:'RT1064',tags:[]}).category,'嵌入式系统');});

test('人工分类调整可以共用总体原因，AI仍须提供逐项依据',()=>{
 const plan={tags:[{label:'陌生技术术语',action:'reject'}],platforms:[{label:'自研平台',action:'replace',target:'ST'}]};
 assert.throws(()=>resolveClassification(sample,plan,builtinTerms));
 const result=resolveClassification(sample,plan,builtinTerms,{humanReason:'总体审核确认标签与工程无关，平台应当更正为ST。'});
 assert.deepEqual(result.tags,['PWM']);assert.equal(result.platforms[0].name,'ST');
});
