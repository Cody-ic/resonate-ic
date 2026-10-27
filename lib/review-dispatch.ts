import {env} from "cloudflare:workers";
import {HTTPError} from "./domain";
export type ReviewLane="discussion"|"project";
export function reviewConcurrency(lane:ReviewLane,settings:Record<string,unknown>=env as any){
  const value=Number(settings[lane==='discussion'?'REVIEW_DISCUSSION_CONCURRENCY':'REVIEW_PROJECT_CONCURRENCY']);
  return Number.isSafeInteger(value)&&value>0?Math.min(value,lane==='discussion'?4:2):lane==='discussion'?2:1;
}
export async function kickReviewQueue(){
  if(!env.REVIEW_COORDINATOR||!env.REVIEW_WORKFLOW)throw new HTTPError(503,"持久化审核调度器尚未配置，送审内容已保存，等待维护者处理");
  const stub=env.REVIEW_COORDINATOR.get(env.REVIEW_COORDINATOR.idFromName('review-pool'));
  const response=await stub.fetch('https://review.internal/kick',{method:'POST'});
  if(!response.ok)throw new HTTPError(503,"审核调度器暂不可用，内容已保留在队列");
}
