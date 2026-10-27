import {env} from "cloudflare:workers";
import {HTTPError} from "./domain";

export function inspectCover(bytes:Uint8Array){
  return inspectRaster(bytes,2,4096,12000000,'封面');
}
export function inspectCourseImage(bytes:Uint8Array){
  return inspectRaster(bytes,10,16384,40000000,'课程插图');
}
function inspectRaster(bytes:Uint8Array,maxMB:number,maxDimension:number,maxPixels:number,label:string){
  if(bytes.length<16||bytes.length>maxMB*1024*1024)throw new HTTPError(422,`${label}须为${maxMB}MB以内的PNG、JPEG或WebP图片`);
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let mime='',width=0,height=0;
  if(bytes.length>=24&&v.getUint32(0)===0x89504e47&&v.getUint32(4)===0x0d0a1a0a&&v.getUint32(12)===0x49484452){mime='image/png';width=v.getUint32(16);height=v.getUint32(20);}
  else if(bytes[0]===255&&bytes[1]===216){
    mime='image/jpeg';let p=2;
    while(p+4<bytes.length){if(bytes[p++]!==255)continue;while(bytes[p]===255)p++;const marker=bytes[p++];if(marker===0xda||marker===0xd9)break;if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;if(p+2>bytes.length)break;const length=v.getUint16(p);if(length<2||p+length>bytes.length)break;if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&length>=7){height=v.getUint16(p+3);width=v.getUint16(p+5);break;}p+=length;}
  }else if(bytes.length>=30&&v.getUint32(0)===0x52494646&&v.getUint32(8)===0x57454250){
    mime='image/webp';const type=v.getUint32(12);
    if(type===0x56503858){width=1+bytes[24]+(bytes[25]<<8)+(bytes[26]<<16);height=1+bytes[27]+(bytes[28]<<8)+(bytes[29]<<16);}
    else if(type===0x56503820&&bytes[23]===0x9d&&bytes[24]===0x01&&bytes[25]===0x2a){width=v.getUint16(26,true)&0x3fff;height=v.getUint16(28,true)&0x3fff;}
    else if(type===0x5650384c&&bytes[20]===0x2f){const bits=v.getUint32(21,true);width=(bits&0x3fff)+1;height=((bits>>>14)&0x3fff)+1;}
  }
  if(!mime||width<1||height<1||width>maxDimension||height>maxDimension||width*height>maxPixels)throw new HTTPError(422,`无法识别${label}，或尺寸超过${maxDimension}像素／${maxPixels/10000}万像素`);
  return {mime,width,height};
}
export async function readCover(fileId:string,ownerId:string){
  const meta=await env.DB!.prepare("SELECT * FROM files WHERE id=? AND owner_id=?").bind(fileId,ownerId).first<any>();
  if(!meta)throw new HTTPError(422,"封面不存在或不属于当前作者");
  const object=await env.BUCKET?.get(fileId);if(!object)throw new HTTPError(422,"封面文件不可用");
  const bytes=new Uint8Array(await object.arrayBuffer()),image=inspectCover(bytes);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(hash!==meta.digest)throw new HTTPError(422,"封面文件摘要不匹配");
  return {meta,bytes,...image};
}
export async function coverForReview(fileId:string|undefined|null,ownerId:string){
  if(!fileId)return null;
  const cover=await readCover(fileId,ownerId);let binary='';for(let i=0;i<cover.bytes.length;i+=8192)binary+=String.fromCharCode(...cover.bytes.subarray(i,i+8192));
  return {marker:`封面图片 ${fileId}`,fileId,mime:cover.mime,width:cover.width,height:cover.height,url:`data:${cover.mime};base64,${btoa(binary)}`};
}
