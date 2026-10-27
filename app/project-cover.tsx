"use client";
import {siteFetch as fetch} from './site-fetch';
import {useEffect,useState} from "react";
import type {ReactNode} from "react";
import {ImagePlus,RefreshCw,X} from "lucide-react";

async function prepareCover(file:File){
  if(file.size>10*1024*1024)throw new Error('请选择10MB以内的图片');
  if(!/\.(png|jpe?g|webp)$/i.test(file.name))throw new Error('请选择PNG、JPEG或WebP图片');
  const url=URL.createObjectURL(file),image=new Image();
  try{
    image.src=url;await image.decode();
    if(image.naturalWidth<1||image.naturalHeight<1)throw new Error('图片无法读取');
    const ratio=Math.min(1,1280/Math.max(image.naturalWidth,image.naturalHeight)),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(image.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(image.naturalHeight*ratio));
    const context=canvas.getContext('2d');if(!context)throw new Error('浏览器暂时无法处理图片');
    context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('图片处理失败')),'image/jpeg',.86));
    if(blob.size>2*1024*1024)throw new Error('压缩后图片仍超过2MB，请换一张尺寸较小的图片');
    return new File([blob],file.name.replace(/\.[^.]+$/,'.jpg'),{type:'image/jpeg'});
  }finally{URL.revokeObjectURL(url);}
}
export function ProjectCover({fileId,alt,fallback}:{fileId?:string|null;alt:string;fallback:ReactNode}){
  const [failed,setFailed]=useState(false);useEffect(()=>setFailed(false),[fileId]);
  return fileId&&!failed?<img className="author-cover" src={'/api/covers/'+fileId} alt={alt} loading="lazy" decoding="async" onError={()=>setFailed(true)}/>:fallback;
}
export function CoverField({fileId,onChange,onBusyChange}:{fileId?:string|null;onChange:(id:string|null)=>void;onBusyChange:(busy:boolean)=>void}){
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  async function upload(file:File){setBusy(true);onBusyChange(true);setError('');setNotice('');try{
    const prepared=await prepareCover(file),form=new FormData();form.append('file',prepared);form.append('purpose','cover');
    const response=await fetch('/api/files',{method:'POST',body:form}),result=await response.json() as {id:string;error?:string};
    if(!response.ok)throw new Error(result.error??'封面上传失败');
    onChange(result.id);setNotice('封面已上传；保存草稿或提交审核后会关联到该版本。');
  }catch(e){setError((e as Error).message);}finally{setBusy(false);onBusyChange(false);}}
  return <section className="cover-field" aria-label="作品封面" aria-busy={busy}><div className="cover-field-heading"><strong>作品封面 <small>选填</small></strong><span>实物照片、PCB 或运行截图</span></div>{fileId?<div className="cover-preview"><ProjectCover fileId={fileId} alt="待提交的作品封面" fallback={<p>封面暂时无法读取，请更换图片。</p>}/></div>:null}<div className="cover-upload-actions"><label className="button outline cover-upload"><input type="file" accept="image/png,image/jpeg,image/webp" aria-label={fileId?'更换作品封面':'上传作品封面'} disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)upload(file);}}/>{fileId?<RefreshCw size={15}/>:<ImagePlus size={17}/>}<span>{busy?'正在处理图片…':fileId?'更换封面':'上传封面'}</span></label>{fileId&&<button type="button" className="text-button" disabled={busy} onClick={()=>{onChange(null);setNotice('已移除本次编辑的封面；保存后生效。');setError('');}}><X size={14}/>移除封面</button>}</div><p className="cover-field-help">支持PNG、JPEG、WebP，建议使用横图。图片会压缩处理，封面随作品版本一起审核，审核期间保留原公开封面。</p>{error&&<p className="control-error" role="alert">{error}</p>}{notice&&<p className="control-notice" role="status">{notice}</p>}</section>;
}
