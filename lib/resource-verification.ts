import {z} from 'zod/v3';
export const verificationSteps={none:'尚未完成核验',source:'源码或设计自查',build:'编译或语法检查',simulation:'仿真或自动测试',erc:'原理图 ERC',drc:'PCB DRC',export:'制造文件核对',prototype:'已打样或完成装配',power:'上电检查',functional:'功能实测'} as const;
export const verificationSchema=z.object({
  steps:z.array(z.enum(['none','source','build','simulation','erc','drc','export','prototype','power','functional'])).min(1).max(10),
  scope:z.string().trim().min(10).max(2000),
  unverified:z.string().trim().min(2).max(2000),
  evidence:z.string().trim().max(4000).default(''),
}).superRefine((v,ctx)=>{if(new Set(v.steps).size!==v.steps.length||(v.steps.includes('none')&&v.steps.length>1))ctx.addIssue({code:'custom',path:['steps'],message:'尚未完成核验不能与其他步骤同时选择'});});
