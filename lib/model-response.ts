// Server-only transport assembly. Reasoning stays in the private receipt and is
// never included in progress updates or public notices.
export type ModelProgress={receivedBytes:number;contentChars:number;phase:'thinking'|'answer';lastChunkAt:number};
type Options={progress?:(value:ModelProgress)=>Promise<void>;maximumBytes?:number};
export async function readModelResponse(response:Response,options:Options={}){
  if(!response.headers.get('content-type')?.includes('text/event-stream')){
    const raw=await response.json() as any,choice=raw.choices?.[0];
    return {message:choice?.message??null,finishReason:choice?.finish_reason??null,usage:raw.usage??null,streamComplete:true,receivedBytes:0};
  }
  const reader=response.body?.getReader();if(!reader)throw new Error('模型返回空事件流');
  const decoder=new TextDecoder('utf-8',{fatal:true}),message:any={role:'assistant',content:'',reasoning_content:''};
  let buffer='',eventLines:string[]=[],finishReason:string|null=null,usage:any=null,done=false,receivedBytes=0,lastProgress=0,error:string|undefined;
  const emit=()=>{
    const data=eventLines.filter(line=>line.startsWith('data:')).map(line=>line.slice(5).replace(/^ /,'')).join('\n');eventLines=[];
    if(!data)return;
    if(data==='[DONE]'){done=true;return;}
    const chunk=JSON.parse(data);if(chunk.error)throw new Error('模型事件流返回错误');
    if(chunk.usage)usage=chunk.usage;
    const choice=chunk.choices?.find((c:any)=>(c.index??0)===0);if(!choice)return;
    const delta=choice.delta??{};
    if(typeof delta.content==='string')message.content+=delta.content;
    if(typeof delta.reasoning_content==='string')message.reasoning_content+=delta.reasoning_content;
    if(delta.tool_calls?.length)throw new Error('精选正文审阅不接受工具事件');
    if(message.content.length+message.reasoning_content.length>2*1024*1024)throw new Error('模型正文超过接收上限');
    if(choice.finish_reason)finishReason=choice.finish_reason;
  };
  const lines=(final=false)=>{
    let index:number;
    while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index).replace(/\r$/,'');buffer=buffer.slice(index+1);if(line==='')emit();else if(!line.startsWith(':'))eventLines.push(line);}
    if(final){if(buffer)eventLines.push(buffer.replace(/\r$/,''));buffer='';if(eventLines.length)emit();}
  };
  try{
    while(!done){
      const next=await reader.read();
      if(next.done){buffer+=decoder.decode();lines(true);break;}
      receivedBytes+=next.value.byteLength;
      if(receivedBytes>(options.maximumBytes??16*1024*1024))throw new Error('模型事件流超过接收上限');
      buffer+=decoder.decode(next.value,{stream:true});lines();
      const now=Date.now();if(options.progress&&now-lastProgress>=5000){lastProgress=now;try{await options.progress({receivedBytes,contentChars:message.content.length,phase:message.content?'answer':'thinking',lastChunkAt:now});}catch{/* Progress failure must not discard a paid response. */}}
    }
  }catch(cause){error=cause instanceof Error?cause.message:'模型事件流读取中断';}
  finally{try{await reader.cancel();}catch{}reader.releaseLock();}
  return {message,finishReason:done&&!error?finishReason:'incomplete_stream',usage,streamComplete:done&&!error,receivedBytes,...(error?{error}:{})};
}
