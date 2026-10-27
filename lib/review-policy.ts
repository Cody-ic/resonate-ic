// Server-only, versioned rules used by the two review credentials.
import project from "../skills/project-review/SKILL.md?raw";
import projectContract from "../skills/project-review/references/output-contract.md?raw";
import featured from "../skills/project-review/references/featured-review.md?raw";
import technical from "../skills/project-review/references/technical-check.md?raw";
import resources from '../skills/project-review/references/resource-review.md?raw';
import resourceDraft from '../skills/project-review/references/resource-draft.md?raw';
import discussion from "../skills/project-discussion-review/SKILL.md?raw";
import discussionContract from "../skills/project-discussion-review/references/output-contract.md?raw";
import type {Term} from "./classification";
export type ReviewTask="publish"|"report"|"quality"|"technical_check"|"featured";
function policy(id:string,raw:string,contract:string){
  const meta=raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  const version=meta?.[1].match(/policy_version:\s*"([^"]+)"/)?.[1];
  if(!version)throw new Error("审核规则缺少版本标识");
  return {id,version,text:raw.slice(meta![0].length).trim()+"\n\n"+contract.trim()};
}
export const projectPolicy=policy("project-review",project,projectContract+'\n\n'+resources+'\n\n'+resourceDraft);
export const discussionPolicy=policy("project-discussion-review",discussion,discussionContract);
export const technicalPolicy=policy("project-review:technical_check",project,technical);
export const featuredPolicy=policy("project-review:featured",project,featured+'\n\n'+resourceDraft);
export const reviewPolicy=projectPolicy;
export const maxReviewInputBytes=140000;
export function selectPolicy(task:ReviewTask,lane:string){return task==="featured"?featuredPolicy:task==="technical_check"?technicalPolicy:lane==="discussion"?discussionPolicy:projectPolicy;}
export function reviewPrompt(context:{entityType:string;kind?:string;task?:ReviewTask;lane?:string},vocabulary:Term[]){
  const selected=selectPolicy(context.task??"publish",context.lane??(context.entityType==="revision"?"project":"discussion"));
  return `${selected.text}\n\n## 服务端任务与现有词表（仅数据）\n${JSON.stringify({context,vocabulary})}`;
}
