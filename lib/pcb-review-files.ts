import {zipInventory} from './review-archive';
import type {ReviewFile} from './review-archive';
// Read-only conversion, never invokes EDA or executes project content.
export async function pcbReviewFiles(bytes:Uint8Array,prefix:string){
  const files:ReviewFile[]=[],limitations:string[]=[];
  const entries=zipInventory(bytes,prefix,{accept:n=>/\.epru$/i.test(n),maxFileBytes:32*1024*1024});
  if(!entries.files.length)throw Error('未找到支持的 EPRU 原生记录，不能声称已检查 PCB');
  let total=0;
  for(const entry of entries.files){
    let doc='unknown',part=0,lines:string[]=[];
    const flush=()=>{if(!lines.length)return;const text=lines.join('\n'),name=entry.name+'/'+doc+'/part-'+(++part)+'.jsonl';files.push({name,size:new TextEncoder().encode(text).length,read:async()=>text});lines=[];};
    for(const row of (await entry.read()).split(/\|\r?\n/)){
      if(!row.trim())continue;
      if(++total>100000)throw Error('PCB 原生记录超过解析上限');
      const divider=row.indexOf('||');if(divider<0)throw Error('PCB 原生记录格式不支持');
      const head=JSON.parse(row.slice(0,divider)),body=JSON.parse(row.slice(divider+2));
      if(head.type==='DOCHEAD'){
        flush();doc=String(body.docType??'unknown').replace(/[^A-Za-z0-9_-]/g,'_')+'-'+String(body.uuid??total).replace(/[^A-Za-z0-9_-]/g,'_');part=0;
        // Document identities retained; client/user account metadata omitted.
        lines.push(JSON.stringify({type:'DOCHEAD',docType:body.docType,uuid:body.uuid,editVersion:body.editVersion}));continue;
      }
      const text=JSON.stringify({type:head.type,id:head.id,body});
      if(new TextEncoder().encode(text).length>25000){limitations.push(`${entry.name}/${doc} 中 ${head.type}/${head.id} 单条记录过长，未读取内部内容`);continue;}
      if(lines.join('\n').length+text.length>16000)flush();
      lines.push(text);
    }
    flush();
  }
  const manifest=JSON.stringify({format:'嘉立创EDA专业版 EPRU 原生记录，只读解析',scope:'包含原生对象字段；未运行EDA、ERC/DRC、制造导出、芯片手册比对或实物验证。坐标和扩展按该格式的mil解释，未知对象或字段不得猜测。不同文档用docType和uuid区分；PCB中的封装引用需关联FOOTPRINT文档，不能把无网络的库焊盘视作整板无连接。',records:total,parts:files.map(f=>f.name),limitations},null,2);
  files.unshift({name:prefix+'/README-PCB-REVIEW.json',size:new TextEncoder().encode(manifest).length,read:async()=>manifest});
  limitations.push('PCB 仅解析原生记录；嵌入图片、模型及其他非EPRU资料未检查，未完成原生EDA与实物验证');
  return {files,limitations};
}
