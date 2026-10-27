import {DurableObject,WorkflowEntrypoint} from 'cloudflare:workers';
import type {WorkflowEvent,WorkflowStep} from 'cloudflare:workers';
import {runReview,laneConfig,projectOffPeak,refreshBudgetGrants,config} from '../lib/moderation';
import {reviewConcurrency} from '../lib/review-dispatch';
import {nextOffPeak} from '../lib/ai-pricing';
import {HTTPError} from '../lib/domain';
import {budgetPeriod} from '../lib/ai-budget';
import {reviewStepTimeout} from '../lib/timeouts';
import {alertAdmins,dispatchMail,kickMailQueue,nextMailWake} from '../lib/notifications';

type Job={reviewId:string;runId:string;lane:'discussion'|'project'};
export class ReviewWorkflow extends WorkflowEntrypoint<Cloudflare.Env,{reviewId:string}>{
  async run(event:WorkflowEvent<{reviewId:string}>,step:WorkflowStep){
    const perform=async(name:string,operation:()=>Promise<any>)=>{
      const result=await step.do(name,{retries:{limit:0,delay:'1 second'},timeout:reviewStepTimeout},async()=>{
        try{return {ok:true,value:await operation()};}
        catch(error){return {ok:false,status:error instanceof HTTPError?error.status:502,message:error instanceof Error?error.message:'审核处理失败',superseded:!!(error as any)?.reviewSuperseded};}
      });
      if(!result.ok){const error=new HTTPError(result.status!,result.message!);Object.assign(error,{reviewSuperseded:result.superseded});throw error;}
      return result.value;
    };
    try{
      await runReview(event.payload.reviewId,{executionOwner:event.instanceId,step:perform});
    }catch(error){
      // runReview handles model/content failures. This additionally catches a
      // workflow infrastructure failure outside its inner model loop.
      await step.do('finalize-failure',async()=>{
        const changed=await this.env.DB!.prepare("UPDATE reviews SET state='disputed',updated_at=?,result=? WHERE id=? AND state='running' AND execution_owner=? RETURNING owner_id")
          .bind(Date.now(),JSON.stringify({summary:'审核执行中断，需核对调用记录后处理；未自动重复付费。',failureKind:'workflow'}),event.payload.reviewId,event.instanceId).first();
        if(changed)await alertAdmins(`workflow-failure:${event.instanceId}`,'审核执行需要检查',`审核编号：${event.payload.reviewId}`,event.payload.reviewId);
      });
    }finally{
      await step.do('notify-dispatcher',async()=>{
        const stub=this.env.REVIEW_COORDINATOR!.get(this.env.REVIEW_COORDINATOR!.idFromName('review-pool'));
        const response=await stub.fetch('https://review.internal/done',{method:'POST',body:JSON.stringify({runId:event.instanceId})});
        if(!response.ok)throw new Error('审核调度器暂不可用');
        return true;
      });
      await step.do('dispatch-mail',{retries:{limit:0,delay:'1 second'},timeout:'2 minutes'},async()=>{await kickMailQueue();return true;});
    }
    return {reviewId:event.payload.reviewId};
  }
}

export class ReviewCoordinator extends DurableObject<Cloudflare.Env>{
  private serial:Promise<unknown>=Promise.resolve();
  private locked<T>(operation:()=>Promise<T>){const next=this.serial.then(operation,operation);this.serial=next.catch(()=>{});return next;}
  async fetch(request:Request){
    if(request.method!=='POST')return new Response(null,{status:405});
    return this.locked(async()=>{
      if(new URL(request.url).pathname==='/mail/kick'){
        await this.ctx.storage.put('purpose','mail');
        const alarm=await this.ctx.storage.getAlarm();if(alarm===null||alarm>Date.now()+1000)await this.ctx.storage.setAlarm(Date.now()+1);
        return Response.json({queued:true});
      }
      if(await this.ctx.storage.get('purpose')==='mail')return new Response(null,{status:404});
      const done=new URL(request.url).pathname==='/done'?await request.json() as {runId:string}:null;
      await this.pump(done?.runId);return Response.json({queued:true});
    });
  }
  async alarm(){await this.locked(async()=>{
    if(await this.ctx.storage.get('purpose')!=='mail')return this.pump();
    // A mail-specific object uses the existing durable binding. Finish one
    // attempt, then immediately refill the next free slot via an alarm.
    await this.ctx.storage.setAlarm(Date.now()+30000);
    await dispatchMail(1);
    const wake=await nextMailWake();
    if(wake===null)await this.ctx.storage.deleteAlarm();else await this.ctx.storage.setAlarm(wake);
  });}
  private async pump(doneId?:string){
    const db=this.env.DB!,now=Date.now();
    // Reconciliation alarm remains armed even if creation or a DB operation
    // interrupts this short scheduling transaction.
    await this.ctx.storage.setAlarm(now+30000);
    await refreshBudgetGrants();
    const funds=await db.prepare("SELECT (SELECT COUNT(*) FROM ai_calls WHERE charged_micros IS NOT NULL) settled,(SELECT COALESCE(SUM(amount_micros),0) FROM ai_budget_grants) granted").first<any>();
    const fundsKey=JSON.stringify([funds,config().PROJECT_AI_MONTHLY_MAX_CALLS,config().DISCUSSION_AI_MONTHLY_MAX_CALLS]);
    const previousFunds=await this.ctx.storage.get<string>('funds');
    if(previousFunds&&previousFunds!==fundsKey)await db.prepare("UPDATE reviews SET next_attempt_at=0 WHERE state='queued' AND json_extract(result,'$.failureKind')='budget_wait'").run();
    await this.ctx.storage.put('funds',fundsKey);
    const saved=await this.ctx.storage.get<Job[]>('active')??[],active:Job[]=[];
    for(const job of saved){
      if(job.runId===doneId)continue;
      const row=await db.prepare('SELECT state FROM reviews WHERE id=?').bind(job.reviewId).first<{state:string}>();
      if(!row||!['queued','running'].includes(row.state))continue;
      try{
        const instance=await this.env.REVIEW_WORKFLOW!.get(job.runId),status=await instance.status();
        if(['complete','errored','terminated'].includes(status.status)){
          await db.prepare("UPDATE reviews SET state='disputed',result=?,updated_at=? WHERE id=? AND state='running' AND execution_owner=?").bind(JSON.stringify({summary:'持久化审核执行中断，请核对记录后处理。',failureKind:'workflow'}),now,job.reviewId,job.runId).run();
          continue;
        }
      }catch{/* Keep uncertain live slots occupied until a later reconciliation. */}
      active.push(job);
    }
    for(const lane of ['discussion','project'] as const){
      const cfg=laneConfig(lane);if(!cfg.key||cfg.maxCalls<=0||cfg.maxBudget<=0||cfg.maxTotal<=0||lane==='project'&&!projectOffPeak())continue;
      const period=budgetPeriod(now),budget=await db.prepare("SELECT (SELECT COUNT(*) FROM ai_calls WHERE currency='CNY' AND lane=? AND created_at>=? AND created_at<?) calls,(SELECT COALESCE(SUM(amount_micros),0) FROM ai_budget_grants WHERE pool=? AND month<=?)-(SELECT COALESCE(SUM(COALESCE(charged_micros,reserved_micros)),0) FROM ai_calls WHERE currency='CNY' AND lane=?) lane_remaining,(SELECT COALESCE(SUM(amount_micros),0) FROM ai_budget_grants WHERE pool='shared' AND month<=?)-(SELECT COALESCE(SUM(COALESCE(charged_micros,reserved_micros)),0) FROM ai_calls WHERE currency='CNY') shared_remaining").bind(lane,period.start,period.end,lane,period.month,lane,period.month).first<any>();
      const minimum=2048*cfg.inputPrice+8192*cfg.outputPrice;
      if(budget.calls>=cfg.maxCalls||budget.lane_remaining<minimum||budget.shared_remaining<minimum){
        await db.prepare("UPDATE reviews SET next_attempt_at=?,result=json_set(COALESCE(result,'{}'),'$.failureKind','budget_wait','$.summary','可用额度不足，等待用量结算释放余额或下月额度。') WHERE state='queued' AND lane=? AND next_attempt_at<=?").bind(period.end,lane,now).run();
        continue;
      }
      const running=await db.prepare("SELECT id FROM reviews WHERE state='running' AND lane=?").bind(lane).all<{id:string}>();
      const manual=running.results.filter(r=>!active.some(j=>j.reviewId===r.id)).length;
      while(active.filter(j=>j.lane===lane).length+manual<reviewConcurrency(lane)){
        const candidates=await db.prepare("SELECT id FROM reviews WHERE state='queued' AND lane=? AND next_attempt_at<=? ORDER BY updated_at,created_at,id LIMIT 20").bind(lane,now).all<{id:string}>();
        const candidate=candidates.results.find(r=>!active.some(j=>j.reviewId===r.id));if(!candidate)break;
        const job:Job={reviewId:candidate.id,runId:crypto.randomUUID(),lane};active.push(job);
        await this.ctx.storage.put('active',active);
        try{await this.env.REVIEW_WORKFLOW!.create({id:job.runId,params:{reviewId:job.reviewId}});}
        catch{
          // Creation can have succeeded even when its reply is lost. Preserve
          // that workflow identity and slot; never blindly create a second one.
          try{await (await this.env.REVIEW_WORKFLOW!.get(job.runId)).status();}
          catch{active.splice(active.indexOf(job),1);await db.prepare("UPDATE reviews SET next_attempt_at=? WHERE id=? AND state='queued'").bind(now+60000,job.reviewId).run();}
          break;
        }
      }
    }
    await this.ctx.storage.put('active',active);
    if(active.length)return;
    const waiting=await db.prepare("SELECT lane,MIN(next_attempt_at) retry_at FROM reviews WHERE state='queued' AND lane IN ('discussion','project') GROUP BY lane").all<{lane:string;retry_at:number}>();
    let wake=Infinity;
    for(const row of waiting.results){const cfg=laneConfig(row.lane);if(!cfg.key||cfg.maxCalls<=0||cfg.maxBudget<=0||cfg.maxTotal<=0)continue;const at=Math.max(now+30000,row.retry_at);wake=Math.min(wake,row.lane==='project'?nextOffPeak(at,config().AI_OFFPEAK_DATES??''):at);}
    if(Number.isFinite(wake))await this.ctx.storage.setAlarm(wake);else await this.ctx.storage.deleteAlarm();
  }
}
