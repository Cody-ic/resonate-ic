"use client";
import {useState} from "react";
import {request} from "./accounts";
export function AppealControl({target}:{target:{entityType?:string;entityId?:string;reviewId?:string}}){
  const [open,setOpen]=useState(false),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  return <div className="appeal-control"><button className="button outline" disabled={busy} onClick={()=>setOpen(v=>!v)}>提交申诉</button>{open&&<form className="inline-edit" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{const r=target.reviewId?await request(`reviews/${target.reviewId}/appeal`,'POST',{reason}):await request('appeals','POST',{...target,reason});setMessage(r.message);setOpen(false);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}><label>申诉说明<textarea autoFocus required minLength={10} maxLength={3000} rows={4} value={reason} onChange={e=>setReason(e.target.value)} placeholder="说明你认为处理有误的原因，可补充相关事实（至少10字）"/></label><p>由管理员核对；处理前保持当前状态。</p><button className="button dark" disabled={busy}>{busy?'正在提交…':'确认提交申诉'}</button></form>}{error&&<p className="control-error" role="alert">{error}</p>}{message&&<p className="control-notice" role="status">{message}</p>}</div>;
}
