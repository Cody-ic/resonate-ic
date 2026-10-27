import test from 'node:test';
import assert from 'node:assert/strict';
import {discussionInput,discussionEvidence} from '../lib/discussion-context.ts';
test('reply review gets exact saved parent, separated from target',()=>{
 const snapshot={body:'请不要这样称呼别人。',topicTitle:'讨论用语',topicBody:'父评论里引用的攻击文字'};
 const input=discussionInput(snapshot,{type:'reply',id:'r1',row:{topic_id:'t1',title:'已修改标题',topic_body:'已修改正文'}});
 assert.equal(input.parentContext.id,'t1');assert.equal(input.parentContext.body,snapshot.topicBody);assert.equal(input.parentContext.title,snapshot.topicTitle);
 assert.deepEqual(input.target,{type:'reply',id:'r1',body:snapshot.body});
 assert.equal(discussionEvidence(snapshot),snapshot.body);assert.ok(!discussionEvidence(snapshot).includes(snapshot.topicBody));
});
test('top-level review has no unrelated parent context',()=>{
 const input=discussionInput({title:'调试问题',body:'烧录失败',board:'项目求助'},{type:'topic',id:'t1',row:{title:'其他标题'}});
 assert.equal(input.parentContext,undefined);assert.equal(input.target.title,'调试问题');
});
