import {z} from "zod/v3";
import {taxonomyPlanSchema} from "./classification";
import {resourceDraftSchema,resourceReliabilitySchema} from './resource-draft-schema';
import {legalBases,appendLegalReferences} from './review-safety';
export const noticeSchema=z.object({title:z.string().trim().min(1).max(160),body:z.string().trim().min(1).max(6000)});
const findings=z.array(z.object({rule:z.enum(["spam","privacy","abuse","vulgarity","ownership","unfounded_demand","reliability","illegal","severe_safety","off_topic_politics","circumvention","irrelevant"]),quote:z.string().min(1).max(500),explanation:z.string().min(1).max(1200),legalBasis:z.array(z.string().refine(key=>Object.hasOwn(legalBases,key),'未经核验的法律依据')).max(4).default([])})).max(20);
const technicalIssues=z.array(z.object({claim:z.string().min(3).max(1000),quote:z.string().min(1).max(500),providedEvidence:z.array(z.string().max(1500)).max(12).default([]),missingEvidence:z.array(z.string().max(500)).max(12).default([])})).max(5).default([]);
const common={summary:z.string().min(1).max(2000),findings};
const resourceOutput={resourceDraft:resourceDraftSchema.nullable().default(null),resourceReliability:resourceReliabilitySchema.nullable().default(null)};
export const projectResultSchema=z.object({...common,...resourceOutput,featuredInvitation:z.object({criteria:z.array(z.enum(["competition","teaching","depth","creativity"])).min(1).max(4),quote:z.string().min(1).max(500),reason:z.string().min(10).max(700)}).nullable().default(null),decision:z.enum(["pass","revise","disputed"]),improvements:z.array(z.object({field:z.string().max(300),basis:z.string().min(1).max(1500),impact:z.string().min(1).max(1500),action:z.string().min(1).max(1500)})).max(8).default([]),taxonomy:taxonomyPlanSchema.default({}),authorNotice:noticeSchema});
export const discussionResultSchema=z.object({...common,task:z.literal("publish"),decision:z.enum(["pass","revise","disputed"]),technicalIssues,commenterNotice:noticeSchema.nullable()});
export const reportResultSchema=z.object({...common,task:z.literal("report"),decision:z.enum(["keep","take_down","disputed"]),issueConfirmed:z.boolean().nullable(),removalNecessary:z.boolean().nullable(),technicalIssues});
export const qualityResultSchema=z.object({...common,task:z.literal("quality"),decision:z.enum(["qualify","not_qualify","disputed"])});
export const technicalResultSchema=z.object({task:z.literal("technical_check"),status:z.enum(["confirmed","not_reproduced","insufficient_evidence","needs_manual"]),summary:z.string().min(1).max(2000),evidence:z.array(z.object({source:z.string().min(1).max(500),observation:z.string().min(1).max(2000),scope:z.string().min(1).max(1200)})).max(15),questions:z.array(z.string().max(800)).max(12),commenterNotice:noticeSchema.nullable(),authorNotice:noticeSchema.extend({kind:z.enum(["unverified_feedback","confirmed_defect"])}).nullable()});
export const featuredResultSchema=z.object({...resourceOutput,investigation:z.object({evidenceSufficient:z.boolean(),reason:z.string().min(10).max(2500),unresolvedQuestions:z.array(z.string().min(1).max(600)).max(12),counterEvidence:z.array(z.object({source:z.string().min(1).max(500),quote:z.string().min(1).max(600),explanation:z.string().min(1).max(1200)})).max(12),limitations:z.array(z.string().min(1).max(600)).max(12)}),basics:z.object({documentationClear:z.boolean(),reproducible:z.boolean(),reason:z.string().min(1).max(2000)}),task:z.literal("featured"),decision:z.enum(["qualify","not_qualify","disputed"]),summary:z.string().min(1).max(3000),criteriaConfirmed:z.array(z.enum(["competition","teaching","depth","creativity"])).max(4),assessments:z.array(z.object({criterion:z.enum(["competition","teaching","depth","creativity"]),meets:z.boolean(),reason:z.string().min(1).max(2000),evidence:z.array(z.object({source:z.string().min(1).max(500),quote:z.string().min(1).max(1200),explanation:z.string().min(1).max(2000)})).max(10)})).min(1).max(4),authorNotice:noticeSchema});
export function hasQuote(source:string,quote:string){
  if(source.includes(quote))return true;
  const normalize=(value:string)=>value.replace(/^\s*\d+: /gm,"").replace(/\s+/g," ").trim();
  if(normalize(source).includes(normalize(quote)))return true;
  const parts=quote.split(/…+|\.{3,}/).filter(Boolean);let offset=0;
  if(parts.length<2||parts.some(p=>p.trim().length<2))return false;
  return parts.every(p=>{const i=source.indexOf(p,offset);if(i<0)return false;offset=i+p.length;return true;});
}
export function parseReviewResult(raw:string,task:string,lane:string,source:string):any{
  const value=JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g,""));
  const schema=task==="featured"?featuredResultSchema:task==="technical_check"?technicalResultSchema:task==="report"?reportResultSchema:task==="quality"?qualityResultSchema:lane==="discussion"?discussionResultSchema:projectResultSchema;
  const result=schema.parse(value) as any;
  for(const finding of result.findings??[]){
    if(['illegal','circumvention'].includes(finding.rule)&&!finding.legalBasis.length)throw Error('违法或翻墙指导结论缺少已核验法条');
    if(finding.rule==='circumvention'&&!finding.legalBasis.includes('international-channel'))throw Error('翻墙指导缺少国际联网条款依据');
    if(['off_topic_politics','irrelevant'].includes(finding.rule)&&finding.legalBasis.length)throw Error('社区范围规则不能冒充法律定性');
  }
  const noticeText=[result.summary,...(result.findings??[]).map((f:any)=>f.explanation),result.authorNotice?.body,result.commenterNotice?.body].filter(Boolean).join('\n');
  for(const match of noticeText.matchAll(/《([^》]{1,100})》\s*(第[一二三四五六七八九十百零\d]+条(?:第[一二三四五六七八九十百零\d]+[款项])?)/g)){
    if(!Object.values(legalBases).some(b=>b.name===match[1]&&b.article===match[2]))throw Error('通知含未经核验的法条');
  }
  for(const key of ['authorNotice','commenterNotice'])if(result[key])result[key].body=appendLegalReferences(result[key].body,result);
  result.summary=appendLegalReferences(result.summary,result,task==='report'?1400:2000);
  if(result.resourceDraft&&!hasQuote(source,result.resourceDraft.quote))throw new Error('组件草稿缺少实际来源引文');
  for(const e of result.resourceReliability?.evidence??[])if(!hasQuote(source,e.quote))throw new Error('资源可靠性依据不在已读材料中');
  for(const f of [...(result.findings??[]),...(result.technicalIssues??[])])if(!hasQuote(source,f.quote))throw new Error("引用不在本次实际送审资料中");
  if(["pass","qualify"].includes(result.decision)&&(result.findings?.length??0))throw new Error("通过结论与问题冲突");
  if(task==="publish"&&lane==="project"&&result.featuredInvitation){if(result.decision!=="pass"||!hasQuote(source,result.featuredInvitation.quote))throw new Error("精选邀请缺少实际依据或作品尚未通过发布审核");}
  if(task==="publish"&&result.decision==='revise'&&!result.findings.length)throw new Error("阻止发布缺少证据");
  if(task==='publish'&&result.decision==='disputed'&&!result.findings.length&&!result.resourceReliability)throw new Error('争议核对缺少具体依据');
  if(task==="publish"&&lane==="discussion"&&result.decision!=="pass"&&!result.commenterNotice)throw new Error("缺少评论者通知");
  if(task==="report"&&result.decision==="take_down"&&(!result.issueConfirmed||!result.removalNecessary||!result.findings.length))throw new Error("下架条件不成立");
  if(task==="report"&&result.decision==="keep"&&result.removalNecessary!==false)throw new Error("保留条件冲突");
  if(task==="featured"){
    const sent=JSON.parse(source.split("\n")[0]),nomination=sent.nomination;
    const evidenceSource=JSON.stringify({...sent,nomination:undefined})+"\n"+source.split("\n").slice(1).join("\n");
    const expected=[...new Set(nomination.criteria)] as string[];
    if(result.assessments.length!==expected.length||new Set(result.assessments.map((a:any)=>a.criterion)).size!==expected.length||result.assessments.some((a:any)=>!expected.includes(a.criterion)))throw new Error("必须逐项评估提名指标");
    for(const a of result.assessments)for(const e of a.evidence)if(!hasQuote(evidenceSource,e.quote))throw new Error("精选证据未出现在实际审阅资料中");
    for(const e of result.investigation.counterEvidence)if(!hasQuote(evidenceSource,e.quote))throw new Error("反例查证引用不在实际材料中");
    if(result.decision==='qualify'&&(!result.investigation.evidenceSufficient||result.investigation.unresolvedQuestions.length))throw new Error("精选仍存在影响结论的关键证据缺口");
    const met=result.assessments.filter((a:any)=>a.meets).map((a:any)=>a.criterion);
    if(new Set(result.criteriaConfirmed).size!==result.criteriaConfirmed.length||result.criteriaConfirmed.length!==met.length||result.criteriaConfirmed.some((c:string)=>!met.includes(c)))throw new Error("确认指标与逐项评估不一致");
    if(result.decision==='qualify'&&(!result.basics.documentationClear||!result.basics.reproducible||!met.length||result.assessments.some((a:any)=>a.meets&&!a.evidence.length)))throw new Error("精选入选缺少正面证据");
    if(result.decision==='not_qualify'&&met.length)throw new Error("未入选结论与指标判断冲突");
  }
  if(task==="technical_check"){
    if(result.status==="confirmed"&&!result.evidence.length)throw new Error("缺陷确认缺少证据");
    if(result.authorNotice?.kind==="confirmed_defect"&&result.status!=="confirmed")throw new Error("待核实问题不能确认为缺陷");
    if(result.status!=="confirmed"&&!result.commenterNotice)throw new Error("缺少技术反馈进展通知");
  }
  return result;
}
export function cleanNotice(text:string){return text.replace(/sk-[A-Za-z0-9_-]{20,}/g,"[凭据已隐藏]").replace(/-----BEGIN [\s\S]*?PRIVATE KEY-----[\s\S]*?-----END [\s\S]*?PRIVATE KEY-----/g,"[私钥已隐藏]");}

