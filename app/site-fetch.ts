import {timeouts} from '../lib/timeouts';
export async function siteFetch(input:RequestInfo|URL,options:RequestInit={}){
  const deadline=AbortSignal.timeout(options.body instanceof FormData?timeouts.upload:timeouts.page);
  try{return await fetch(input,{...options,signal:options.signal?AbortSignal.any([options.signal,deadline]):deadline});}
  catch(error){if((error as Error).name==='TimeoutError')throw new Error('请求等待超时，操作结果尚未确认。请先刷新相关内容，确认状态后再决定是否重试。');throw error;}
}
