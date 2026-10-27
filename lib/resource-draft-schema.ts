import {z} from 'zod/v3';
import {categories} from './classification';
export const resourceDraftSchema=z.object({
  title:z.string().trim().min(2).max(80),summary:z.string().trim().min(10).max(400),
  description:z.string().trim().min(20).max(4000),hardware:z.string().trim().min(2).max(2000),
  instructions:z.string().trim().min(10).max(4000),limitations:z.string().trim().max(2000).default(''),
  category:z.enum(categories),tags:z.array(z.string().trim().min(1).max(24)).max(10).default([]),
  sourcePath:z.string().min(1).max(500),quote:z.string().min(1).max(500),
  files:z.array(z.object({name:z.string().min(1).max(100).regex(/^[\p{L}\p{N}_. -]+\.(?:js|mjs|ts|c|h|cpp|py|v|sv|md|txt|json|html|css)$/u).refine(n=>!n.startsWith('.')&&!n.includes('..'),'文件名无效'),content:z.string().min(1).max(20000)})).min(1).max(8)
}).superRefine((draft,ctx)=>{if(new Set(draft.files.map(f=>f.name.toLowerCase())).size!==draft.files.length)ctx.addIssue({code:'custom',message:'文件名重复'});if(new TextEncoder().encode(JSON.stringify(draft)).length>40000)ctx.addIssue({code:'custom',message:'资源草稿超过40KB'});});
export const resourceReliabilitySchema=z.object({ready:z.boolean(),reason:z.string().min(10).max(2000),checkedScope:z.string().trim().min(10).max(2000),evidence:z.array(z.object({quote:z.string().min(1).max(800),explanation:z.string().min(5).max(1200)})).max(10),limitations:z.array(z.string().max(500)).max(20),confirmedIssues:z.array(z.object({source:z.string().min(1).max(500),quote:z.string().min(1).max(500),basisQuote:z.string().min(1).max(1500),reasoning:z.string().min(20).max(2000),impact:z.string().min(10).max(1000),affectedScope:z.string().min(10).max(1000),preconditionsConfirmed:z.boolean(),uncertainties:z.array(z.string().max(500)).max(10)})).max(10).default([])});
