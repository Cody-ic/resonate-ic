import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const built=await build({stdin:{contents:"export {parseReviewResult} from './lib/review-results';export {holdsUnsafePublication} from './lib/review-safety';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const api=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const source='这是本次待核验的严重风险线索。';
function result(rule='illegal',legalBasis=['national-unity']){return {decision:'revise',summary:'当前版本不予公开。',findings:[{rule,quote:source,explanation:'本次提供的目标原文存在需阻断的问题。',legalBasis}],improvements:[],taxonomy:{},authorNotice:{title:'内容暂未通过审核',body:'请移除对应内容，正常技术部分可以保留并重新提交。'}};}
const parse=value=>api.parseReviewResult(JSON.stringify(value),'publish','project',source);
test('legal decisions include verified article and official source in author notice',()=>{
 const value=parse(result());assert.match(value.authorNotice.body,/《网络信息内容生态治理规定》第六条第二项/);assert.match(value.authorNotice.body,/https:\/\/www.cac.gov.cn\//);
});
test('missing, invented, mismatched and community-only legal bases are rejected',()=>{
 assert.throws(()=>parse(result('illegal',[])));assert.throws(()=>parse(result('illegal',['invented-article'])));
 assert.throws(()=>parse(result('circumvention',['terrorism'])));assert.throws(()=>parse(result('off_topic_politics',['national-unity'])));
 const invented=result();invented.authorNotice.body='依据《中华人民共和国刑法》第九百九十九条予以处理。';assert.throws(()=>parse(invented));
});
test('serious disputes hold publication while ordinary ownership disputes retain existing policy',()=>{
 for(const rule of ['illegal','severe_safety','circumvention'])assert.equal(api.holdsUnsafePublication({decision:'disputed',findings:[{rule}]}),true);
  assert.equal(api.holdsUnsafePublication({decision:'disputed',findings:[{rule:'privacy',legalBasis:['personal-rights']}]}),true);
 assert.equal(api.holdsUnsafePublication({decision:'disputed',findings:[{rule:'ownership'}]}),false);
 assert.equal(api.holdsUnsafePublication({decision:'pass',findings:[]}),false);
});
test('community scope refusal has no fabricated legal claim; source evidence is still required',()=>{
 const value=parse(result('irrelevant',[]));assert.doesNotMatch(value.authorNotice.body,/相关法律依据/);
 const noEvidence=result();noEvidence.findings[0].quote='原文不存在的攻击';assert.throws(()=>parse(noEvidence));
});
test('report notices include legal references for both reporter and content owner',()=>{
 const value=api.parseReviewResult(JSON.stringify({task:'report',decision:'take_down',summary:'目标内容存在明确阻断问题。',findings:result().findings,issueConfirmed:true,removalNecessary:true,technicalIssues:[]}),'report','discussion',source);
 assert.match(value.summary,/第六条第二项/);assert.match(value.summary,/https:\/\/www.cac.gov.cn\//);
});
