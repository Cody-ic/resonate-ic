import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync,existsSync} from 'node:fs';
import crypto from 'node:crypto';
const root=process.cwd();
const bundled=await build({stdin:{contents:'export {checkResourceReview} from "./lib/resource-review.ts";export {verificationSchema} from "./lib/resource-verification.ts";export {pcbReviewFiles} from "./lib/pcb-review-files.ts";export {textZip} from "./lib/text-zip.ts";',resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});
const {checkResourceReview,verificationSchema,pcbReviewFiles,textZip}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const code='export function add(a,b){return a+b;}\nthrow new Error("broken");';
const materials={readSources:[code],readRecords:[{path:'component.mjs',text:code}],readNames:new Set(['component.mjs']),fullyReadNames:new Set()};
const proof={source:'component.mjs',quote:'throw new Error("broken")',basisQuote:'export function add(a,b){return a+b;}',reasoning:'顶层无条件抛异常，模块无法加载，导出的加法函数无法正常导入。',impact:'模块无法加载，调用者无法正常导入。',affectedScope:'影响模块导入与调用加法函数的功能。',preconditionsConfirmed:true,uncertainties:[]};
const result={decision:'revise',findings:[{rule:'reliability',quote:proof.quote}],resourceReliability:{ready:false,checkedScope:'静态读取JavaScript模块的加载入口。',evidence:[],confirmedIssues:[proof]}};
test('confirmed blocking defect requires actual file, basis and resolved premises',()=>{
 assert.doesNotThrow(()=>checkResourceReview(result,materials,{}));
 for(const patch of [{preconditionsConfirmed:false},{uncertainties:['未确认扩展语义']},{source:'unknown.mjs'},{quote:'根本不存在'},{basisQuote:'虚构的手册要求'}]){
  const r=structuredClone(result);Object.assign(r.resourceReliability.confirmedIssues[0],patch);assert.throws(()=>checkResourceReview(r,materials,{}));
 }
});
test('a quote from another file cannot establish source location',()=>{
 const m={...materials,readNames:new Set(['component.mjs','other.mjs']),readRecords:[...materials.readRecords,{path:'other.mjs',text:'different content'}]};
 const r=structuredClone(result);r.resourceReliability.confirmedIssues[0].source='other.mjs';assert.throws(()=>checkResourceReview(r,m,{}));
});
test('honest limited checking does not require complete reading or board tests',()=>{
 const r={decision:'pass',findings:[],resourceReliability:{ready:true,checkedScope:'只检查加法函数静态实现，未运行。',evidence:[{quote:'return a+b;'}],confirmedIssues:[]}};
 assert.doesNotThrow(()=>checkResourceReview(r,materials,{verification:{steps:['none']}}));
 assert.throws(()=>checkResourceReview(r,{...materials,readRecords:[{path:'board.epro2/README-PCB-REVIEW.json',text:code}]},{}));
});
test('author may declare no testing but cannot combine none with measured steps',()=>{
 const v={steps:['none'],scope:'目前仅提供设计文件，尚未执行核验。',unverified:'编译和实测均未进行。'};
 assert.equal(verificationSchema.safeParse(v).success,true);
 assert.equal(verificationSchema.safeParse({...v,steps:['none','functional']}).success,false);
 assert.equal(verificationSchema.safeParse({...v,steps:[]}).success,false);
});
test('native parser retains geometry, document identities and review limitations',async()=>{
 const text=JSON.stringify({type:'DOCHEAD'})+'||'+JSON.stringify({docType:'FOOTPRINT',uuid:'test',user:{email:'not-needed@example.com'}})+'|\n'+JSON.stringify({type:'PAD',id:'pad9'})+'||'+JSON.stringify({topPasteExpansion:-3937,defaultPad:{width:100,height:125}});
 const zip=textZip([{name:'test.epru',content:text}]);const parsed=await pcbReviewFiles(zip,'board.epro2');
 const all=(await Promise.all(parsed.files.map(f=>f.read()))).join('\n');
 assert.ok(all.includes('"topPasteExpansion":-3937'));assert.ok(all.includes('FOOTPRINT-test'));assert.ok(!all.includes('not-needed@example.com'));assert.ok(parsed.limitations.length);
 await assert.rejects(()=>pcbReviewFiles(textZip([{name:'unrelated.txt',content:'not pcb'}]),'bad.epro2'));
});
const localPcbFixture=process.env.PCB_REVIEW_TEST_FILE||'D:/智能车/PCB/智能车_A6.5_评审候选_勿下单_20261015.epro2';
test('actual A6.5 candidate can be parsed without changing original file',{skip:!existsSync(localPcbFixture)&&'Optional private PCB fixture is not present; set PCB_REVIEW_TEST_FILE to run this integration check.'},async()=>{
 const file=localPcbFixture,bytes=readFileSync(file),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
 const parsed=await pcbReviewFiles(bytes,'candidate.epro2');
 const footprint=parsed.files.filter(f=>f.name.includes('FOOTPRINT-c4c3d3a69e744f3c'));
 assert.ok(footprint.length);const text=(await Promise.all(footprint.map(f=>f.read()))).join('\n');
 assert.ok(text.includes('"topPasteExpansion":-3937'));assert.ok(text.includes('"id":"pad9"'));assert.equal(hash(readFileSync(file)),hash(bytes));
 console.log(JSON.stringify({readOnlyPcbParts:parsed.files.length,footprintParts:footprint.length,originalSha256:hash(bytes)}));
});
