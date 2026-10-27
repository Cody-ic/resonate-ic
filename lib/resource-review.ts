import {hasQuote} from './review-results';
export function checkResourceReview(result:any,materials:{readSources:string[];readRecords:{path:string;text:string}[];readNames:Set<string>;fullyReadNames:Set<string>},snapshot:any){
  const reliability=result.resourceReliability,read=materials.readSources.join('\n');
  if(result.decision==='pass'&&(!reliability?.ready||!reliability.checkedScope?.trim()||!reliability.evidence.length||!materials.readNames.size||!reliability.evidence.some((e:any)=>materials.readRecords.some(r=>!r.path.endsWith('/README-PCB-REVIEW.json')&&hasQuote(r.text,e.quote)))))throw Error('资源检查未完成：需要实际读取资源材料并明确本次检查范围');
  if(reliability?.confirmedIssues?.some((p:any)=>result.decision!=='revise'||!result.findings.some((f:any)=>f.rule==='reliability'&&f.quote===p.quote)))throw Error('已确认缺陷必须对应本次可靠性打回证据，不能用于未确认通知');
  for(const finding of result.findings.filter((f:any)=>f.rule==='reliability')){
    const proof=reliability?.confirmedIssues?.find((p:any)=>p.quote===finding.quote);
    if(!proof||!materials.readNames.has(proof.source)||!materials.readRecords.some(r=>r.path===proof.source&&hasQuote(r.text,proof.quote))||!hasQuote(read+'\n'+JSON.stringify(snapshot),proof.basisQuote)||!proof.preconditionsConfirmed||proof.uncertainties.length)throw Error('可靠性打回证据不足：需有实际文件定位、成立的判断依据、已确认前提和实质影响，不能以疑似风险打回');
  }
}
