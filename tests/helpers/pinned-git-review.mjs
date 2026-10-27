import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const text=/\.(?:c|h|cpp|hpp|py|md|txt|csv|json|xml|html|v|sv|dart|js|mjs|cjs|ts|tsx|jsx|css|scss|yaml|yml|toml|ini|cfg|conf|lock|sh|bat|ps1|rs|go|java|kt|lua|rb|s|asm|mk|xdc|qsf|qpf|tcl|prj|sln|vcxproj|cmake)$|(?:^|\/)(?:README|LICENSE|CMakeLists.txt|\.gitignore|\.gitattributes|\.gitmodules)$/i;
export function pinnedGitReview(repo,commit,url,output,{remoteContent=false}={}){
  if(!/^[a-f0-9]{40}$/.test(commit))throw Error('Review needs a fixed commit');
  const git=args=>execFileSync('git',['-C',repo,...args],{maxBuffer:32*1024*1024,env:{...process.env,GIT_NO_LAZY_FETCH:'1'}});
  if(git(['cat-file','-t',commit]).toString().trim()!=='commit')throw Error('Commit unavailable');
  const entries=git(['ls-tree','-r','-l','-z',commit]).toString('utf8').split('\0').filter(Boolean).map(record=>{
    const tab=record.indexOf('\t'),[mode,type,oid,size]=record.slice(0,tab).trim().split(/\s+/),name=record.slice(tab+1);
    if(!name||name.startsWith('/')||name.split('/').includes('..')||name.includes('\\'))throw Error('Unsafe repository path');
    return {mode,type,oid,size:Number(size),path:name};
  });
  const origin=new URL(url);if(origin.protocol!=='https:'||origin.hostname!=='github.com'||origin.username||origin.password||!/^\/[\w.-]+\/[\w.-]+\/?$/.test(origin.pathname))throw Error('Expected canonical public GitHub source');
  const manifest={source:{url},commit,snapshotDigest:sha(JSON.stringify({commit,entries})),retrievedAt:Date.now(),limitations:[remoteContent?'从GitHub新建独立只读副本获取提交与目录；正文从GitHub固定提交下载，未使用旧工作区。':'远程HEAD提交号已核对；从本机现有Git对象库读取同一不可变提交，未使用工作区改动。','未运行构建、训练或实机验证。'],entries};
  const manifestPath=path.join(output,'pinned-git-manifest.json');
  if(fs.existsSync(manifestPath)){const old=JSON.parse(fs.readFileSync(manifestPath));if(old.commit!==commit||old.snapshotDigest!==manifest.snapshotDigest)throw Error('Pinned repository changed');}else fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
  const blocked=[],files=[];
  for(const entry of entries){
    const name='repositories/github/Cody-ic/siege-rts-rl@'+commit+'/'+entry.path;
    if(entry.mode==='120000'||entry.mode==='160000'||entry.type!=='blob'||!text.test(entry.path)||entry.size>8*1024*1024){blocked.push(name+'（二进制资源、符号链接、超限或未支持文件，尚未核验）');continue;}
    files.push({name,size:entry.size,read:async()=>{
      const destination=path.join(output,'git-source',entry.path);let data;
      if(fs.existsSync(destination))data=fs.readFileSync(destination);else{
        if(remoteContent){
          const response=await fetch('https://raw.githubusercontent.com'+origin.pathname.replace(/\/$/,'')+'/'+commit+'/'+entry.path.split('/').map(encodeURIComponent).join('/'),{redirect:'manual',signal:AbortSignal.timeout(60000)});
          if(!response.ok)throw Error('GitHub source read failed: '+response.status+' '+entry.path);
          const reader=response.body.getReader(),chunks=[];let size=0;
          try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>8*1024*1024)throw Error('Source exceeds read limit');chunks.push(Buffer.from(next.value));}}finally{try{await reader.cancel();}catch{}reader.releaseLock();}
          data=Buffer.concat(chunks);
        }else data=git(['cat-file','blob',entry.oid]);
        fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,data);
      }
      if(crypto.createHash('sha1').update(Buffer.from('blob '+data.length+'\0')).update(data).digest('hex')!==entry.oid)throw Error('Git object mismatch');
      const value=new TextDecoder('utf-8',{fatal:true}).decode(data);if(value.includes('\0'))throw Error('Binary data in source');return value;
    }});
  }
  const priority=name=>name.endsWith('@'+commit+'/README.md')?0:/\/(?:世界观与剧情设定.md|chronicle\.(?:cpp|hpp))$/.test(name)?1:/\/(?:flow.cpp|mechanics.cpp|world.cpp|ppo.py|policy.py)$/.test(name)?2:/\.(?:c|cpp|h|hpp|py)$/.test(name)?3:4;
  files.sort((a,b)=>priority(a.name)-priority(b.name)||a.name.localeCompare(b.name));
  return {files,blocked,manifests:[manifest]};
}
