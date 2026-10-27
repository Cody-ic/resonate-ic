import {env} from "cloudflare:workers";
import {zipInventory,textFile,decode} from "./review-archive.ts";
import type {ReviewFile} from "./review-archive.ts";
import {pcbReviewFiles} from './pcb-review-files';
export {zipFiles} from "./review-archive.ts";
export type {ReviewFile} from "./review-archive.ts";
export async function reviewFiles(fileIds:string[],ownerId:string){
  const files:ReviewFile[]=[],limitations:string[]=[];
  for(const id of fileIds.slice(0,12)){
    const meta=await env.DB!.prepare("SELECT * FROM files WHERE id=? AND owner_id=?").bind(id,ownerId).first<any>();
    if(!meta)throw new Error("送审附件不存在或归属不匹配");
    const object=await env.BUCKET?.get(id);if(!object)throw new Error("附件数据暂不可用");
    if(meta.size>10*1024*1024)throw new Error("附件超过允许大小");
    const bytes=new Uint8Array(await object.arrayBuffer());
    const actual=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("");
    if(actual!==meta.digest)throw new Error("附件摘要与送审记录不匹配");
    if(/\.(epro2|epro)$/i.test(meta.name)){try{const parsed=await pcbReviewFiles(bytes,id+'/'+meta.name);files.push(...parsed.files);limitations.push(...parsed.limitations);}catch(error){limitations.push(`${meta.name} 解析未完成：${error instanceof Error?error.message:'格式暂不支持'}`);}}
    else if(/\.zip$/i.test(meta.name)){const archive=zipInventory(bytes,id+'/'+meta.name);files.push(...archive.files);limitations.push(...archive.unreadable.map(name=>name+' 尚未解析或核验'));}
    else if(textFile.test(meta.name))files.push({name:id+"/"+meta.name,size:bytes.length,read:async()=>{if(bytes.length>300000)throw new Error("源文件过长");return decode(bytes);}});
    else limitations.push(`${meta.name} 为二进制资料，本次未执行或自动解析其内部内容`);
  }
  const priority=(name:string)=>/(?:^|\/)(?:Drivers|Middlewares|node_modules|vendor)\//i.test(name)?3:/README|\/main\.[ch]$|\.ioc$|\.cproject$/.test(name)?0:1;
  files.sort((a,b)=>priority(a.name)-priority(b.name)||a.name.localeCompare(b.name));
  return {files,limitations};
}
export const fileToolDefinitions=[
  {type:"function",function:{name:"list_files",description:"列出本次附件的可读文本与源码文件，可按目录前缀过滤。",parameters:{type:"object",properties:{prefix:{type:"string"}},required:[]}}},
  {type:"function",function:{name:"read_file",description:"读取指定附件文件的部分行。",parameters:{type:"object",properties:{path:{type:"string"},start_line:{type:"integer"},line_count:{type:"integer"}},required:["path"]}}},
  {type:"function",function:{name:"search_text",description:"在附件源码中搜索字面文本，可按前缀过滤。",parameters:{type:"object",properties:{text:{type:"string"},prefix:{type:"string"}},required:["text"]}}},
];
export function fileTools(files:ReviewFile[],options:{maxBytes?:number;chunkBytes?:number}={}){
  const maxBytes=options.maxBytes??60000,chunkBytes=options.chunkBytes??10000;
  const bytes=(text:string)=>new TextEncoder().encode(text).length;
  const bounded=(text:string,limit:number)=>{const encoded=new TextEncoder().encode(text);return encoded.length<=limit?text:new TextDecoder().decode(encoded.subarray(0,limit)).replace(/\uFFFD$/,"");};
  let used=0;const readSources:string[]=[],readRecords:{path:string;text:string}[]=[];const readNames=new Set<string>(),fullyReadNames=new Set<string>(),ranges:Record<string,{total:number;lines:number[]}>= {};
  return {readSources,readRecords,readNames,fullyReadNames,snapshot(){return {used,readSources:[...readSources],readRecords:[...readRecords],readNames:[...readNames],fullyReadNames:[...fullyReadNames],ranges};},restore(state:{used:number;readSources:string[];readRecords?:typeof readRecords;readNames:string[];fullyReadNames?:string[];ranges?:typeof ranges}){used=state.used;readSources.splice(0,readSources.length,...state.readSources);readRecords.splice(0,readRecords.length,...state.readRecords??[]);readNames.clear();for(const name of state.readNames)readNames.add(name);fullyReadNames.clear();for(const name of state.fullyReadNames??[])fullyReadNames.add(name);Object.assign(ranges,state.ranges??{});},async invoke(name:string,args:any){
    if(name==="list_files")return files.filter(f=>f.name.startsWith(String(args.prefix??""))).slice(0,140).map(({name,size})=>({path:name,bytes:size}));
    if(name==="read_file"){
      const file=files.find(f=>f.name===args.path);if(!file)throw new Error("只能读取本次附件文件");
      const all=await file.read(),lines=all.split(/\r?\n/),start=Math.max(1,Math.trunc(Number(args.start_line)||1)),count=Math.min(240,Math.max(1,Math.trunc(Number(args.line_count)||160)));
      if(maxBytes-used<300)throw new Error("本次只读资料预算已用完，请依据已读资料输出结论并说明范围");
      const raw=lines.slice(start-1,start-1+count).map((v,i)=>`${start+i}: ${v}`).join("\n"),selected=bounded(raw,Math.min(chunkBytes,maxBytes-used));
      const completeLines=selected===raw?Math.min(count,Math.max(0,lines.length-start+1)):Math.max(0,selected.split('\n').length-1),range=ranges[file.name]??={total:lines.length,lines:[]};
      const covered=new Set(range.lines);for(let line=start;line<start+completeLines;line++)covered.add(line);range.lines=[...covered];if(covered.size>=lines.length)fullyReadNames.add(file.name);
      used+=bytes(selected);
      readSources.push(selected);readRecords.push({path:file.name,text:selected});readNames.add(file.name);return {path:file.name,totalLines:lines.length,startLine:start,text:selected};
    }
    if(name==="search_text"){
      const needle=String(args.text??"");if(!needle||needle.length>100)throw new Error("搜索词长度无效");
      const result:any[]=[];let scanned=0;
      for(const file of files.filter(f=>f.name.startsWith(String(args.prefix??"")))){
        if(scanned+file.size>1500000)break;scanned+=file.size;
        let text:string;try{text=await file.read();}catch{continue;}
        for(const [i,line] of text.split(/\r?\n/).entries())if(line.toLowerCase().includes(needle.toLowerCase())){
          const matched=bounded(line.slice(0,600),Math.min(1800,maxBytes-used));
          if(!matched||maxBytes-used<300)return result;
          used+=bytes(matched);result.push({path:file.name,line:i+1,text:matched});readSources.push(matched);readRecords.push({path:file.name,text:matched});readNames.add(file.name);if(result.length>=30)return result;
        }
      }
      return result;
    }
    throw new Error("未提供该工具");
  }};
}
