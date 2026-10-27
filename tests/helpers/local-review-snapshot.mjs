import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const ignored=new Set(['node_modules','.work','backups','artifacts','output','tmp','.gradle','build','.idea','.git']);
const text=/\.(?:c|h|cpp|hpp|py|md|txt|csv|json|xml|html|v|sv|dart|js|mjs|cjs|ts|tsx|jsx|css|scss|yaml|yml|toml|ini|cfg|conf|lock|sh|bat|ps1|rs|go|java|kt|lua|rb|s|asm|mk|xdc|qsf|qpf|tcl|prj|sln|vcxproj|gradle|properties|pro)$|(?:^|\/)(?:\.gitignore|\.gitkeep|gradlew|LICENSE|README)$/i;
export function localReviewSnapshot(source,output){
  const sourcePath=path.resolve(source),singleFile=fs.statSync(sourcePath).isFile(),root=singleFile?path.dirname(sourcePath):sourcePath,folder=path.join(output,'local-source'),manifestPath=path.join(output,'local-source-manifest.json');
  let manifest;
  if(fs.existsSync(manifestPath))manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  else{
    const entries=[],excluded=[];
    function visit(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
      if(singleFile&&entry.name!==path.basename(sourcePath))continue;
      const absolute=path.join(dir,entry.name),relative=path.relative(root,absolute).split(path.sep).join('/');
      if(ignored.has(entry.name)||relative==='android/app/src/main/assets/public'){excluded.push({path:relative,reason:'依赖、缓存、备份、构建输出或生成的重复资源'});continue;}
      if(entry.isSymbolicLink()){entries.push({path:relative,kind:'unread',reason:'符号链接未跟随'});continue;}
      if(entry.isDirectory()){visit(absolute);continue;}if(!entry.isFile())continue;
      if(/\.(?:keystore|jks|pem|p12)$/i.test(entry.name)||['keystore.properties','local.properties'].includes(entry.name)||entry.name.startsWith('.env')){excluded.push({path:relative,reason:'本地凭据或机器配置，不送往模型'});continue;}
      const data=fs.readFileSync(absolute),isText=text.test(relative),content=isText?new TextDecoder('utf-8',{fatal:true}).decode(data):null;
      if(content&&/\bsk-[A-Za-z0-9_-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(content))throw Error('发现疑似真实凭据，停止外发：'+relative);
      const destination=path.join(folder,relative);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,data);
      entries.push({path:relative,size:data.length,sha256:digest(data),kind:isText?'text':'unread',...(isText?{}:{reason:'二进制图像、资源或工具文件，尚未核验'})});
    }}
    visit(root);manifest={source:sourcePath,createdAt:Date.now(),entries,excluded};manifest.sha256=digest(JSON.stringify(entries));
    fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
  }
  if(manifest.source!==sourcePath)throw Error('续审路径与原始本地快照不一致');
  const files=manifest.entries.filter(e=>e.kind==='text').map(entry=>({name:'local-source/'+entry.path,size:entry.size,read:async()=>{const data=fs.readFileSync(path.join(folder,entry.path));if(digest(data)!==entry.sha256)throw Error('本地快照摘要不符：'+entry.path);return new TextDecoder('utf-8',{fatal:true}).decode(data);}}));
  const priority=name=>/\/docs\//.test(name)?0:/\/(?:package.json|index.html)$/.test(name)?1:/\/(?:ai-client|creation|local-store|guide)\.js$/.test(name)?2:/\.java$/.test(name)?3:/\/app.js$/.test(name)?4:/\/(?:leaflet.js|leaflet.css|package-lock.json)$/.test(name)?9:5;
  files.sort((a,b)=>priority(a.name)-priority(b.name)||a.name.localeCompare(b.name));
  return {files,blocked:manifest.entries.filter(e=>e.kind==='unread').map(e=>'local-source/'+e.path+'（'+e.reason+'）'),manifests:[{source:{url:'local-source:'+sourcePath},commit:null,snapshotDigest:manifest.sha256,limitations:['用户授权使用本地提交快照；未与远程仓库核对版本。','仅检查实际提供的源码，未构建、运行或核验社会影响力。','本地凭据、依赖、缓存、构建输出及备份不属于此次提交快照。']}],manifest};
}
