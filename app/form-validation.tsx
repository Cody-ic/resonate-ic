"use client";
import {useRef,useState} from 'react';
type Field=HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement;
type Issue={field:Field;label:string;message:string};
export function useFormValidation(){
  const [issues,setIssues]=useState<Issue[]>([]),attempted=useRef(false);
  function inspect(form:HTMLFormElement){
    const next:Issue[]=[];
    for(const field of Array.from(form.elements) as Field[]){
      if(!('validity' in field)||!field.willValidate)continue;
      field.setAttribute('aria-invalid',String(!field.validity.valid));
      if(!field.validity.valid){const label=field.getAttribute('aria-label')||field.labels?.[0]?.firstChild?.textContent?.trim()||field.name||'表单项';next.push({field,label,message:field.validity.valueMissing?'请填写':field.validity.typeMismatch?'请检查格式':field.validity.tooShort?`至少${'minLength' in field?field.minLength:0}个字符`:'请检查填写内容'});}
    }
    setIssues(next);
  }
  return {props:{onInvalidCapture:(e:React.FormEvent<HTMLFormElement>)=>{e.preventDefault();attempted.current=true;inspect(e.currentTarget);},onInputCapture:(e:React.FormEvent<HTMLFormElement>)=>{if(attempted.current)inspect(e.currentTarget);},onChangeCapture:(e:React.FormEvent<HTMLFormElement>)=>{if(attempted.current)inspect(e.currentTarget);}},summary:issues.length>0?<div className="validation-summary" role="alert"><strong>还有 {issues.length} 项需要填写或修改</strong><ul>{issues.map((issue,i)=><li key={i}><button type="button" onClick={()=>{issue.field.scrollIntoView({behavior:'smooth',block:'center'});issue.field.focus({preventScroll:true});}}>{issue.label}：{issue.message}</button></li>)}</ul></div>:null};
}
