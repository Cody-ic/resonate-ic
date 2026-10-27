// Prices are CNY / million tokens. Results are usage-based estimates, not invoices.
export type AIPrice={input:number;output:number;cachedInput:number;offPeakDates:string};
export function isOffPeak(at:number,dates=""){
  const time=new Date(at+8*3600000),date=time.toISOString().slice(0,10),day=time.getUTCDay(),minute=time.getUTCHours()*60+time.getUTCMinutes();
  return dates.split(',').includes(date)||day===0||day===6||!((minute>=540&&minute<720)||(minute>=840&&minute<1080));
}
export function nextOffPeak(at:number,dates=""){
  if(isOffPeak(at,dates))return at;
  const local=new Date(at+8*3600000),minute=local.getUTCHours()*60+local.getUTCMinutes();
  local.setUTCHours(minute<720?12:18,0,0,0);return local.getTime()-8*3600000;
}
export function usageCharge(usage:any,price:AIPrice,startedAt:number,receivedAt:number){
  const integer=(x:unknown):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;
  if(!integer(usage?.prompt_tokens)||!integer(usage?.completion_tokens))return null;
  const input=usage.prompt_tokens,output=usage.completion_tokens;
  if(integer(usage.total_tokens)&&usage.total_tokens!==input+output)return null;
  const hit=usage.prompt_cache_hit_tokens??usage.prompt_tokens_details?.cached_tokens??0;
  if(!integer(hit)||hit>input)return null;
  const miss=usage.prompt_cache_miss_tokens??input-hit;
  if(!integer(miss)||miss+hit!==input)return null;
  if(![price.input,price.output,price.cachedInput].every(x=>Number.isFinite(x)&&x>=0)||!price.input||!price.output)return null;
  // A boundary-spanning request uses the higher rate until the provider exposes
  // an authoritative billed amount. Reasoning tokens are already in completion.
  const factor=isOffPeak(startedAt,price.offPeakDates)&&isOffPeak(receivedAt,price.offPeakDates)?0.5:1;
  return {micros:Math.ceil((miss*price.input+hit*price.cachedInput+output*price.output)*factor),input,output,cacheHit:hit,cacheMiss:miss,factor};
}
