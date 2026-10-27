import {zipInventory,textFile,safeName} from './review-archive.ts';
import type {ReviewFile} from './review-archive.ts';
import {timeouts} from './timeouts.ts';

export type RepositorySource={owner:string;repo:string;ref:string;prefix:string;url:string};
type Entry={path:string;size:number;sha?:string;type:string;mode?:string};
export type RepositoryManifest={source:RepositorySource;commit:string|null;snapshotDigest:string;archiveKey?:string;entries:Entry[];retrievedAt:number;limitations:string[]};
export function githubSource(value:string):RepositorySource|null{
  let url:URL;try{url=new URL(value);}catch{return null;}
  if(url.protocol!=='https:'||url.hostname!=='github.com'||url.port||url.username||url.password||url.search||url.hash)return null;
  let parts:string[];try{parts=url.pathname.replace(/\/$/,'').split('/').slice(1).map(decodeURIComponent);}catch{return null;}
  const owner=parts[0],repo=parts[1]?.replace(/\.git$/,'');
  if(!owner||!repo||![owner,repo].every(x=>/^[\w.-]{1,100}$/.test(x)&&x!=='.'&&x!=='..'))return null;
  if(parts.length>2&&!(parts[2]==='tree'&&parts[3]))return null;
  const ref=parts[3]??'HEAD',prefix=parts.slice(4).join('/');
  if(!/^[\w./-]{1,200}$/.test(ref)||ref.split('/').some(x=>x==='..'||x==='.')||prefix&&!safeName(prefix))return null;
  return {owner,repo,ref,prefix,url:value};
}
async function hash(bytes:Uint8Array|string){const data=typeof bytes==='string'?new TextEncoder().encode(bytes):bytes;return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(data).buffer)),x=>x.toString(16).padStart(2,'0')).join('');}
async function limitedFetch(url:string,maximum:number,fetcher:typeof fetch){
  const response=await fetcher(url,{redirect:'manual',signal:AbortSignal.timeout(timeouts.repository),headers:{Accept:'application/vnd.github+json','User-Agent':'Resonate-Repository-Review'}});
  if(response.status>=300&&response.status<400){await response.body?.cancel();throw new Error('仓库读取不允许跳转');}
  if(!response.ok){await response.body?.cancel();throw new Error(`仓库读取响应 ${response.status}`);}
  if(Number(response.headers.get('content-length')??0)>maximum){await response.body?.cancel();throw new Error('仓库资料超出单次读取上限');}
  const reader=response.body?.getReader();if(!reader)throw new Error('仓库返回空响应');
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maximum){await reader.cancel();throw new Error('仓库资料超出单次读取上限');}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
}
const encoder=(path:string)=>path.split('/').map(encodeURIComponent).join('/');
export async function repositoryFiles(reviewId:string,links:{type:string;url:string}[],bucket:R2Bucket,fetcher:typeof fetch=fetch){
  const files:ReviewFile[]=[],manifests:RepositoryManifest[]=[],blocked:string[]=[];
  const urls=[...new Set(links.filter(l=>l.type==='repository').map(l=>l.url))];
  for(const [index,url] of urls.entries()){
    const source=githubSource(url);
    if(!source){blocked.push(`仓库尚未读取：${url}（当前自动读取支持公开GitHub仓库；其他来源需人工或提供附件）`);continue;}
    const base=`review-private/repositories/${reviewId}/${index}`,manifestKey=base+'/manifest.json';
    const cached=await bucket.get(manifestKey);let manifest:RepositoryManifest;
    let archiveFiles:ReviewFile[]|undefined;
    if(cached)manifest=await cached.json<RepositoryManifest>();
    else{
      const api=`https://api.github.com/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}`;
      let commit:string|null=null,entries:Entry[]=[],snapshotDigest='',archiveKey:string|undefined;const limitations:string[]=[];
      try{
        const resolved=JSON.parse(new TextDecoder().decode(await limitedFetch(api+'/commits/'+encodeURIComponent(source.ref),256000,fetcher)));
        if(!/^[a-f\d]{40}$/.test(resolved.sha))throw new Error('仓库未返回有效提交号');commit=resolved.sha;
        const tree=JSON.parse(new TextDecoder().decode(await limitedFetch(api+'/git/trees/'+commit+'?recursive=1',2000000,fetcher)));
        if(tree.truncated)throw new Error('仓库目录被截断');
        if(!Array.isArray(tree.tree)||tree.tree.length>12000)throw new Error('仓库目录超出自动读取上限');
        entries=tree.tree.filter((e:Entry)=>e.type!=='tree');
        if(entries.some(e=>!safeName(e.path)))throw new Error('仓库包含不安全路径');
        snapshotDigest=await hash(JSON.stringify({commit,entries}));
      }catch(error){
        limitations.push(`目录API未完成，改用固定归档快照：${error instanceof Error?error.message:'读取失败'}`);
        const ref=commit??source.ref;
        const bytes=await limitedFetch(`https://codeload.github.com/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/zip/${encodeURIComponent(ref)}`,10*1024*1024,fetcher);
        snapshotDigest=await hash(bytes);archiveKey=base+'/archive-'+snapshotDigest+'.zip';
        const inventory=zipInventory(bytes,'snapshot');
        const strip=(name:string)=>name.split('/').slice(2).join('/');
        const selected=(_name:string)=>true;
        archiveFiles=inventory.files.map(f=>({...f,name:strip(f.name)})).filter(f=>selected(f.name));
        entries=[...archiveFiles.map(f=>({path:f.name,size:f.size,type:'blob'})),...inventory.unreadable.map(name=>({path:strip(name),size:0,type:'unsupported'})).filter(e=>selected(e.path))];
        await bucket.put(archiveKey,bytes);
        if(!commit)limitations.push('GitHub未返回提交号；本次以归档SHA-256固定实际内容，续读不会切换到最新HEAD。');
      }
      manifest={source,commit,snapshotDigest,archiveKey,entries,retrievedAt:Date.now(),limitations};
      await bucket.put(manifestKey,JSON.stringify(manifest));
    }
    manifests.push(manifest);
    if(manifest.source.url!==url)throw new Error('仓库快照与送审链接不匹配');
    if(manifest.archiveKey&&!archiveFiles){
      const object=await bucket.get(manifest.archiveKey);if(!object)throw new Error('仓库归档断点丢失');
      const bytes=new Uint8Array(await object.arrayBuffer());if(await hash(bytes)!==manifest.snapshotDigest)throw new Error('仓库归档摘要不匹配');
      archiveFiles=zipInventory(bytes,'snapshot').files.map(f=>({...f,name:f.name.split('/').slice(2).join('/')}));
    }
    const prefix=`repositories/github/${source.owner}/${source.repo}@${manifest.commit??manifest.snapshotDigest.slice(0,16)}`;
    for(const entry of manifest.entries){
      const path=prefix+'/'+entry.path;
      if(entry.type!=='blob'||entry.mode==='120000'||entry.mode==='160000'||!textFile.test(entry.path)){blocked.push(path+'（非文本、符号链接或子模块，尚未核验）');continue;}
      if(entry.size>300000){blocked.push(path+'（单文件超过300KB，尚未核验）');continue;}
      const archiveFile=archiveFiles?.find(f=>f.name===entry.path);
      files.push({name:path,size:entry.size,read:async()=>{
        const contentKey=base+'/files/'+await hash(entry.path)+'.txt';
        const content=await bucket.get(contentKey);if(content)return content.text();
        const text=archiveFile?await archiveFile.read():new TextDecoder('utf-8',{fatal:true}).decode(await limitedFetch(`https://raw.githubusercontent.com/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/${manifest.commit}/${encoder(entry.path)}`,300000,fetcher));
        if(text.includes('\0')||text.includes('\ufffd'))throw new Error('文件含二进制内容，尚未核验：'+path);
        await bucket.put(contentKey,text);return text;
      }});
    }
  }
  const priority=(name:string)=>/\/README(?:\.|$)/i.test(name)?0:/\/(?:index\.(?:html|js|ts)|main\.[ch]|CMakeLists.txt)$/i.test(name)?1:/\.(?:c|cpp|v|sv|js|ts|py|rs)$/i.test(name)?2:3;
  files.sort((a,b)=>priority(a.name)-priority(b.name)||a.name.localeCompare(b.name));
  return {files,manifests,blocked};
}
