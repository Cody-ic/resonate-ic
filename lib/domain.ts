import { z } from "zod/v3";
import { categories, classificationFields, taxonomyPlanSchema } from "./classification.ts";
import {verificationSchema} from './resource-verification.ts';
export { categories } from "./classification.ts";

export const criteriaLabels = { competition: "促进学院竞赛", teaching: "明确教学意义", depth: "技术深度", creativity: "创意" } as const;
export const boards = ["项目求助", "复现记录", "经验交流", "组队合作", "站务建议"] as const;
export function safeURL(value: string) {
  try {
    const u = new URL(value), host = u.hostname.toLowerCase();
    return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password &&
      !host.includes(":") && !/^\d+(\.\d+){3}$/.test(host) &&
      host.includes(".") && !/(^|\.)(localhost|local|internal|test)$/.test(host);
  } catch { return false; }
}
export const linkSchema = z.object({
  label: z.string().trim().min(1).max(60),
  type: z.enum(["repository", "eda", "drive", "video", "demo", "other"]),
  url: z.string().max(2000).refine(safeURL, "请提供公开的 HTTP(S) 资料链接"),
});
export const projectSchema = z.object({
  title: z.string().trim().min(2).max(80), summary: z.string().trim().min(10).max(400),
  category: z.enum(categories), tags: z.array(z.string().trim().min(1).max(24)).max(20).default([]),
  ...classificationFields,
  version: z.string().trim().min(1).max(40),
  stage: z.enum(["进行中", "可体验", "可复现", "参赛完成"]),
  description: z.string().trim().min(20).max(18000),
  sections:z.array(z.object({title:z.string().trim().min(1).max(80),body:z.string().trim().max(12000).default("")})).max(20).default([]),
  instructions: z.string().trim().max(12000).default(""),
  hardware: z.string().trim().min(2,"请填写硬件与环境").max(4000),
  evidence: z.string().trim().max(6000).default(""),
  limitations: z.string().trim().max(4000).default(""),
  license: z.string().trim().min(2).max(100),
  links: z.array(linkSchema).max(12).default([]),
  fileIds: z.array(z.string().uuid()).max(12).default([]),
  coverFileId:z.string().uuid().nullable().default(null),
});
export type ProjectInput = z.infer<typeof projectSchema>;
export const resourceSchema=projectSchema.extend({hardware:z.string().trim().max(4000).default(""),verification:verificationSchema.nullable().default(null)});
export const lessonSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "章节标识使用小写字母、数字和短横线"),
  title: z.string().trim().min(1).max(100), summary: z.string().trim().max(500).default(""),
  body: z.string().trim().max(24000).default(""),
  practice: z.enum(["computer", "board", "project"]).default("computer"),
  links: z.array(linkSchema).max(8).default([]),
});
export const courseSchema = projectSchema.extend({
  hardware:z.string().trim().max(4000).default(""),
  stage: z.enum(["连载中", "已完结"]),
  prerequisites: z.string().trim().max(3000).default(""),
  outcomes: z.string().trim().max(4000).default(""),
  projectId: z.string().uuid().nullable().default(null),
  projectRevisionId: z.string().uuid().nullable().default(null),
  modules: z.array(z.object({title:z.string().trim().min(1).max(100),
    description:z.string().trim().max(1000).default(""),lessons:z.array(lessonSchema).max(80)})).max(30).default([]),
}).superRefine((course,ctx)=>{
  const ids=course.modules.flatMap(m=>m.lessons.map(l=>l.id));
  if(ids.length>200)ctx.addIssue({code:z.ZodIssueCode.custom,path:["modules"],message:"单套课程最多200章"});
  if(new Set(ids).size!==ids.length)ctx.addIssue({code:z.ZodIssueCode.custom,path:["modules"],message:"章节标识不能重复"});
  if(!course.projectId && course.projectRevisionId)ctx.addIssue({code:z.ZodIssueCode.custom,path:["projectId"],message:"请先选择关联项目"});
});
export type CourseInput = z.infer<typeof courseSchema>;
export const aiResultSchema = z.object({
  decision: z.enum(["pass", "revise", "disputed"]),
  summary: z.string().min(1).max(1200),
  findings: z.array(z.object({
    rule: z.enum(["spam", "privacy", "abuse", "claims", "missing", "ownership"]),
    quote: z.string().min(1).max(500), explanation: z.string().min(1).max(800),
  })).max(12),
  taxonomy: taxonomyPlanSchema.optional(),
});
export function validateAIResult(value: unknown, source: string) {
  const result = aiResultSchema.parse(value);
  if (result.findings.some(f => !source.includes(f.quote))) throw new Error("审核引用不存在于送审资料");
  if (result.decision === "pass" && result.findings.length) throw new Error("通过结论与问题列表冲突");
  if (result.decision !== "pass" && !result.findings.length) throw new Error("问题结论缺少原文证据");
  return result;
}
export function forumDecision(body: string, fresh: boolean): "published" | "queued" {
  // Every new comment and edit is reviewed before becoming public.
  return "queued";
}
export async function digest(text: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}
export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
export class HTTPError extends Error { constructor(public status: number, message: string) { super(message); } }
