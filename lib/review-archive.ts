import {inflateRawSync} from "node:zlib";
export type ReviewFile={name:string;size:number;read:()=>Promise<string>};
export const textFile=/\.(?:c|h|cpp|hpp|ino|py|md|txt|csv|json|ioc|ld|xml|html|htm|v|sv|vhd|vhdl|dart|js|mjs|cjs|ts|tsx|jsx|css|scss|sass|less|yaml|yml|toml|ini|cfg|conf|lock|sh|bat|ps1|rs|go|java|kt|lua|rb|s|asm|mk|xdc|qsf|qpf|tcl|prj|sln|vcxproj)$|(?:^|\/)(?:README(?:\.[\w-]+)?|LICENSE(?:\.[\w-]+)?|COPYING|Makefile|Dockerfile|Kconfig|CMakeLists.txt|\.gitignore|\.gitattributes|\.gitmodules|\.cproject|\.project)$/i;
export const safeName=(name:string)=>!name.startsWith("/")&&!name.includes("\\")&&!name.split("/").some(s=>s==="..")&&!/[\x00-\x1f]/.test(name);
export function decode(bytes:Uint8Array){return new TextDecoder("utf-8",{fatal:false}).decode(bytes);}
// No archive paths are written to disk. Decompression is bounded per requested entry.
export function zipInventory(bytes:Uint8Array,prefix:string,options:{accept?:(name:string)=>boolean;maxFileBytes?:number}={}){
  const maxFileBytes=options.maxFileBytes??300000;
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50){end=i;break;}
  if(end<0)throw new Error("ZIP 目录损坏或格式不支持");
  const count=view.getUint16(end+10,true),start=view.getUint32(end+16,true);
  if(count>2500)throw new Error("ZIP 文件条目超过2500，需拆分工程或人工审核");
  const result:ReviewFile[]=[],unreadable:string[]=[];let p=start,total=0;
  for(let i=0;i<count;i++){
    if(p+46>bytes.length||view.getUint32(p,true)!==0x02014b50)throw new Error("ZIP 条目无效");
    const flags=view.getUint16(p+8,true),method=view.getUint16(p+10,true),compressed=view.getUint32(p+20,true),size=view.getUint32(p+24,true),n=view.getUint16(p+28,true),extra=view.getUint16(p+30,true),comment=view.getUint16(p+32,true),offset=view.getUint32(p+42,true);
    const symlink=((view.getUint32(p+38,true)>>>16)&0xf000)===0xa000;
    const name=decode(bytes.subarray(p+46,p+46+n));p+=46+n+extra+comment;total+=size;
    if(total>60*1024*1024)throw new Error("ZIP 展开内容超过60MB，需拆分工程或人工审核");
    if(!safeName(name))throw new Error('ZIP包含不安全路径');
    if(name.endsWith('/'))continue;
    if(symlink||!(options.accept??(name=>textFile.test(name)))(name)){unreadable.push(prefix+'/'+name);continue;}
    if(flags&1)throw new Error("加密ZIP不能自动审阅");
    result.push({name:prefix+"/"+name,size,read:async()=>{
      if(size>maxFileBytes||compressed>10*1024*1024)throw new Error("该源文件超过单文件审阅上限");
      if(offset+30>bytes.length||view.getUint32(offset,true)!==0x04034b50)throw new Error("ZIP 数据无效");
      const dataStart=offset+30+view.getUint16(offset+26,true)+view.getUint16(offset+28,true);
      if(dataStart+compressed>bytes.length)throw new Error("ZIP 数据被截断");
      const data=bytes.subarray(dataStart,dataStart+compressed);
      const expanded=method===0?data:method===8?inflateRawSync(data,{maxOutputLength:maxFileBytes+1}):null;
      if(!expanded||expanded.length!==size)throw new Error("ZIP 压缩格式不支持或大小不符");
      return decode(expanded);
    }});
  }
  return {files:result,unreadable};
}
export function zipFiles(bytes:Uint8Array,prefix:string):ReviewFile[]{return zipInventory(bytes,prefix).files;}
