"use client";
import {useRef} from 'react';
export const isCoursePicture=(name:string)=>/\.(?:png|jpe?g|webp|gif|svg|bmp)(?:[?#]|$)/i.test(name);
export function CoursePicture({src,name}:{src:string;name:string}){
  const dialog=useRef<HTMLDialogElement>(null),opener=useRef<HTMLButtonElement>(null);
  const protect=(event:React.SyntheticEvent)=>event.preventDefault();
  return <figure className="course-picture"><button ref={opener} type="button" className="course-picture-open" aria-label={'放大查看：'+name} onClick={()=>dialog.current?.showModal()}><img src={src} alt={name} loading="lazy" decoding="async" draggable={false} onContextMenu={protect} onDragStart={protect}/></button><figcaption>{name}</figcaption><dialog ref={dialog} className="course-picture-dialog" onClose={()=>opener.current?.focus()} onClick={event=>{if(event.target===dialog.current)dialog.current?.close();}}><button type="button" onClick={()=>dialog.current?.close()}>关闭</button><img src={src} alt={name} draggable={false} onContextMenu={protect} onDragStart={protect}/><p>课程插图仅供在线阅读；需要留存时可自行截图。</p></dialog></figure>;
}
