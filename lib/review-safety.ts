import legalBases from '../skills/community-review/references/legal-bases.json';
export {legalBases};
export function holdsUnsafePublication(result:any){
  return result?.decision==='disputed'&&(result.findings??[]).some((f:any)=>['illegal','severe_safety','circumvention'].includes(f.rule));
}
export function legalReferenceText(result:any){
  const keys=[...new Set<string>((result.findings??[]).flatMap((f:any)=>f.legalBasis??[]))];
  return keys.map(key=>{const basis=legalBases[key as keyof typeof legalBases];if(!basis)throw Error('未经核验的法律依据');return `《${basis.name}》${basis.article}：${basis.scope}\n${basis.url}`;}).join('\n\n');
}
export function appendLegalReferences(text:string,result:any,max=6000){
  const refs=legalReferenceText(result);if(!refs)return text;
  const suffix='\n\n相关法律依据：\n'+refs;
  return text.slice(0,Math.max(0,max-suffix.length))+suffix;
}
