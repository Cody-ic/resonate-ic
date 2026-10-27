import { z } from "zod/v3";

export const categories = ["嵌入式系统", "FPGA", "创意软件"] as const;
export const categoryLabel = (value:string) => value === "嵌入式系统" ? "嵌入式" : value || "待分类";
export const sourceGroups = [
  {name:"电赛",divisions:["控制类","电源类","仪器仪表类","通信与信号处理类","高频类","综合类"]},
  {name:"嵌赛",divisions:["嵌入式赛道","FPGA赛道"]},
  {name:"智能车",divisions:[]}, {name:"课设",divisions:[]}, {name:"自主项目",divisions:[]}, {name:"其他",divisions:[]},
];
export const platformOptions = [
  {name:"ST",family:"mcu"},{name:"51",family:"mcu"},{name:"CH",family:"mcu"},{name:"ESP",family:"mcu"},
  {name:"NXP",family:"mcu"},{name:"TI",family:"mcu"},
  {name:"赛灵思",family:"fpga"},{name:"高云",family:"fpga"},
];
export const familyLabels:Record<string,string>={mcu:"单片机平台",fpga:"FPGA 平台",other:"其他平台"};
const name=z.string().trim().min(1).max(30).refine(v=>!/[\u0000-\u001f\u007f]/.test(v),"名称不能包含控制字符");
export const sourceSchema=z.object({
  name,division:z.string().trim().max(30).default(""),
  proposedName:z.string().trim().max(30).default(""),proposedDivision:z.string().trim().max(30).default(""),
  year:z.number().int().min(1990).max(2100).nullable().default(null),detail:z.string().trim().max(160).default(""),
}).superRefine((s,ctx)=>{if(s.proposedName&&s.name!=="其他")ctx.addIssue({code:z.ZodIssueCode.custom,path:["proposedName"],message:"新增来源请通过其他提出"});});
export const platformSchema=z.object({name,family:z.enum(["mcu","fpga","other"])});
export const classificationFields={
  sources:z.array(sourceSchema).max(8).default([]),
  platforms:z.array(platformSchema).max(12).refine(v=>new Set(v.map(x=>x.name)).size===v.length,"平台不能重复").default([]),
};
export type Term={kind:string;parent:string;name:string;family:string};
export const builtinTerms:Term[]=[
  ...sourceGroups.flatMap(s=>[{kind:"source",parent:"",name:s.name,family:""},...s.divisions.map(d=>({kind:"division",parent:s.name,name:d,family:""}))]),
  ...platformOptions.map(p=>({kind:"platform",parent:"",...p})),
];
export type Classification={sources:z.infer<typeof sourceSchema>[];platforms:z.infer<typeof platformSchema>[];tags:string[]};
export function normalizeSnapshot<T extends Record<string,any>>(snapshot:T):T&Classification {
  const value={...snapshot} as Record<string,any>;
  if(["智能车与控制","物联网"].includes(value.category))value.category="嵌入式系统";
  if(value.category==="电子设计")value.category="";
  value.tags=[...(value.tags??[])];value.sources=value.sources??[];
  if(!value.platforms){
    const hardware=`${value.hardware??""} ${(value.tags??[]).join(" ")}`;
    value.platforms=platformOptions.filter(p=>({ST:/\bSTM32/i,CH:/\bCH(?:32|58|59)/i,ESP:/\bESP(?:32|8266)/i,NXP:/\bRT10\d{2}|\bNXP/i,"51":/\b(?:8051|STC(?:8|12|15|89))/i,"赛灵思":/\bXilinx|\bZynq/i,"高云":/\bGOWIN|\bGW[12][AN]/i} as Record<string,RegExp>)[p.name]?.test(hardware));
  }
  return value as T&Classification;
}
const exceptions=z.object({
  label:name,action:z.enum(["allow","merge","reject","replace"]),target:z.string().trim().max(30).default(""),
  rule:z.enum(["spam","abuse","privacy","irrelevant"]).optional(),reason:z.string().trim().max(500).default(""),
});
export const taxonomyPlanSchema=z.object({
  tags:z.array(exceptions).max(20).default([]),platforms:z.array(exceptions).max(12).default([]),
  sources:z.array(z.object({index:z.number().int().min(0).max(7),name,division:z.string().trim().max(30).default(""),
    createSource:z.boolean().default(false),createDivision:z.boolean().default(false),reason:z.string().trim().max(500).default("")})).max(8).default([]),
});
export type TaxonomyPlan=z.infer<typeof taxonomyPlanSchema>;
export function resolveClassification(snapshot:Record<string,any>,rawPlan:unknown,terms:Term[],options:{humanReason?:string}={}):Classification {
  const input=normalizeSnapshot(snapshot),plan=taxonomyPlanSchema.parse(rawPlan??{}),known=[...builtinTerms,...terms];
  const has=(kind:string,label:string,parent="")=>known.some(t=>t.kind===kind&&t.name===label&&t.parent===parent);
  function labels(kind:"tag"|"platform",values:string[],rules:z.infer<typeof exceptions>[]){
    if(new Set(rules.map(r=>r.label)).size!==rules.length)throw new Error("重复的标签处理决定");
    for(const r of rules){
      if(!values.includes(r.label))throw new Error("审核处理了未投稿的标签或平台");
      if(r.action==="reject"&&(!r.rule||r.reason.length<5)&&!(options.humanReason&&options.humanReason.length>=10))throw new Error("拦截标签须说明明显不合理的具体理由");
      if(r.action==="merge"&&!has(kind,r.target))throw new Error("合并目标必须是已有标签或平台");
      if(r.action==="replace"&&(kind!=="platform"||!has("platform",r.target)||(r.reason.length<5&&!(options.humanReason&&options.humanReason.length>=10))))throw new Error("平台替换须有明确理由且目标必须已存在");
    }
    return [...new Set(values.flatMap(label=>{const r=rules.find(r=>r.label===label);return r?.action==="reject"?[]:[r&&(r.action==="merge"||r.action==="replace")?r.target:label];}))];
  }
  const tags=labels("tag",input.tags,plan.tags);
  const platformNames=labels("platform",input.platforms.map(p=>p.name),plan.platforms);
  const platforms=platformNames.map(label=>{
    const family=known.find(t=>t.kind==="platform"&&t.name===label)?.family??input.platforms.find(p=>p.name===label)?.family??"other";
    return {name:label,family:family as "mcu"|"fpga"|"other"};
  });
  if(new Set(plan.sources.map(s=>s.index)).size!==plan.sources.length||plan.sources.some(s=>!input.sources[s.index]))throw new Error("来源处理索引无效");
  const sources=input.sources.map((source,index)=>{
    const choice=plan.sources.find(s=>s.index===index);
    let label=has("source",source.name)?source.name:"其他",division=has("division",source.division,label)?source.division:"";
    if(choice){
      if(choice.createSource){if(!source.proposedName||choice.name!==source.proposedName||choice.name==="其他")throw new Error("新来源必须来自作者提出的名称");}
      else if(!has("source",choice.name))throw new Error("来源合并目标不存在");
      label=choice.name;
      if(choice.createDivision){if(!source.proposedDivision||choice.division!==source.proposedDivision)throw new Error("新细分类必须来自作者的建议");}
      else if(choice.division&&!has("division",choice.division,label))throw new Error("细分类不属于该来源");
      division=choice.division;
    }
    // Pending proposals stay in the private snapshot; public metadata is resolved.
    return {name:label,division,year:source.year??null,detail:source.detail??"",proposedName:"",proposedDivision:""};
  });
  return {sources,platforms,tags};
}
export function classificationTerms(data:Classification):Term[]{return [
  ...data.sources.flatMap(s=>[{kind:"source",parent:"",name:s.name,family:""},...(s.division?[{kind:"division",parent:s.name,name:s.division,family:""}]:[])]),
  ...data.platforms.map(p=>({kind:"platform",parent:"",...p})),...data.tags.map(name=>({kind:"tag",parent:"",name,family:""})),
];}
export function facetRows(category:string,data:Classification){return [
  {kind:"category",parent:"",value:category},
  ...classificationTerms(data).map(t=>({kind:t.kind,parent:t.parent,value:t.name})),
  ...data.sources.filter(s=>s.year).map(s=>({kind:"year",parent:s.name,value:String(s.year)})),
];}
