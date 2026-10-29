import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const quote=value=>'"'+value.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('\r','\\r').replaceAll('\n','\\n')+'"';
// This campus host reliably reaches Microsoft with curl IPv4/HTTP1.1, while
// direct workerd and Node sockets intermittently time out. Credentials and body
// go only through child stdin, never argv, shell commands, files or logs.
export async function curlMailRequest(request,launch=spawn,options={}){
  const url=new URL(request.url);
  if(url.protocol!=='https:'||url.username||url.password||!['graph.microsoft.com','login.microsoftonline.com'].includes(url.hostname))return new Response(null,{status:403});
  const lines=['silent','show-error','ipv4','http1.1','compressed','include','noproxy = "*"','connect-timeout = 10','max-time = 45','write-out = "\\n__RESONATE_TRANSFER__%{json}"','url = '+quote(url.href),'request = '+quote(request.method)];
  if(options.ip){if(!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(options.ip))throw Error('Invalid mail route');lines.push('resolve = '+quote(url.hostname+':443:'+options.ip));}
  if(options.probe)lines.push('connect-timeout = 2','max-time = 4');
  for(const [name,value] of request.headers)if(!/^(host|content-length|transfer-encoding|connection|accept-encoding)$/i.test(name))lines.push('header = '+quote(name+': '+value));
  if(!['GET','HEAD'].includes(request.method))lines.push('data-binary = '+quote(await request.text()));
  const bytes=await new Promise((resolve,reject)=>{
    const child=launch('curl',['--disable','--config','-'],{stdio:['pipe','pipe','pipe'],signal:request.signal});
    const chunks=[];let size=0;
    child.stdout.on('data',data=>{size+=data.length;if(size>2*1024*1024){child.kill();reject(Error('Mail response too large'));}else chunks.push(data);});
    // Provider stderr can contain request context; never forward it to logs.
    child.stderr.on('data',()=>{});
    child.on('error',()=>reject(Error('Mail HTTPS transport unavailable')));
    child.on('close',code=>{
      const output=Buffer.concat(chunks),text=output.toString('utf8'),marker='\n__RESONATE_TRANSFER__',at=text.lastIndexOf(marker);let stats;
      try{if(at>=0)stats=JSON.parse(text.slice(at+marker.length));}catch{}
      if(code===0)return resolve(at>=0?Buffer.from(text.slice(0,at)):output);
      const beforeRequest=!!stats&&Number(stats.time_pretransfer)===0&&Number(stats.size_upload)===0&&[6,7,28,35].includes(code);
      if(!options.probe)console.error('Mail connection result',JSON.stringify({exit:code,beforeRequest,ip:stats?.remote_ip,connect:stats?.time_connect,tls:stats?.time_appconnect,pretransfer:stats?.time_pretransfer,uploaded:stats?.size_upload,requestBytes:stats?.request_size,firstByte:stats?.time_starttransfer,total:stats?.time_total}));
      reject(Object.assign(Error('Mail HTTPS transport failed'),{beforeRequest}));
    });
    child.stdin.on('error',()=>{});child.stdin.end(lines.join('\n')+'\n');
  });
  let text=bytes.toString('utf8'),status,headers;
  do{
    const split=text.indexOf('\r\n\r\n');if(split<0)throw Error('Invalid mail HTTPS response');
    const head=text.slice(0,split).split('\r\n');text=text.slice(split+4);
    status=Number(head.shift()?.match(/^HTTP\/\S+ (\d{3})/)?.[1]);headers=new Headers();
    for(const line of head){const at=line.indexOf(':');if(at>0&&!/^(content-length|transfer-encoding|connection|content-encoding)$/i.test(line.slice(0,at)))headers.append(line.slice(0,at),line.slice(at+1).trim());}
  }while(status<200||text.startsWith('HTTP/'));
  if(!Number.isInteger(status)||status<200||status>599)throw Error('Invalid mail HTTPS status');
  return new Response([204,205,304].includes(status)?null:text,{status,headers});
}
export async function pythonMailRequest(request,launch=spawn){
  const url=new URL(request.url);
  if(url.protocol!=='https:'||url.username||url.password||url.port&&!['443'].includes(url.port)||!['graph.microsoft.com','login.microsoftonline.com'].includes(url.hostname))return new Response(null,{status:403});
  const headers=[...request.headers].filter(([name])=>!/^(host|content-length|transfer-encoding|connection|accept-encoding)$/i.test(name));
  const input={url:url.href,method:request.method,headers,body:Buffer.from(await request.arrayBuffer()).toString('base64')};
  const result=await new Promise((resolve,reject)=>{
    const child=launch('python3',[fileURLToPath(new URL('./campus-mail-http.py',import.meta.url))],{stdio:['pipe','pipe','pipe'],signal:request.signal});
    const chunks=[];let size=0;
    child.stdout.on('data',data=>{size+=data.length;if(size>4*1024*1024){child.kill();reject(Error('Mail response too large'));}else chunks.push(data);});
    child.stderr.on('data',()=>{});
    child.on('error',()=>reject(Error('Mail HTTPS transport unavailable')));
    child.on('close',code=>{
      let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return reject(Error('Invalid mail transport response'));}
      if(code!==0||value.error){console.error('Mail connection result',JSON.stringify({error:value.error,beforeRequest:value.beforeRequest===true,total:value.total}));return reject(Object.assign(Error('Mail HTTPS transport failed'),{beforeRequest:value.beforeRequest===true}));}
      resolve(value);
    });
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(input));
  });
  if(!Number.isInteger(result.status)||result.status<200||result.status>599)throw Error('Invalid mail HTTPS status');
  return new Response([204,205,304].includes(result.status)?null:Buffer.from(result.body,'base64'),{status:result.status,headers:result.headers});
}
export function mailTransportFailure(error){
  // This response is generated locally, not by Microsoft. A request that may
  // have reached the provider remains uncertain and must never be replayed.
  return error?.beforeRequest
    ?new Response(null,{status:503,headers:{'X-Resonate-Mail-Not-Started':'1'}})
    :new Response(null,{status:502,headers:{'X-Resonate-Mail-Transport':'uncertain'}});
}
export function campusMailTransport(){
return {
  worker:{name:'campus-mail-router',modules:true,compatibilityDate:'2026-05-15',
    script:`export default {fetch(request,env){const url=new URL(request.url);return url.protocol==='https:'&&['graph.microsoft.com','login.microsoftonline.com'].includes(url.hostname)?env.MAIL_HTTP.fetch(request):fetch(request);}}`,
    serviceBindings:{MAIL_HTTP:async request=>{
      try{return await pythonMailRequest(request);}catch(error){console.error('Mail HTTPS transport failed',error?.name);return mailTransportFailure(error);}
    }}},
  close:async()=>{},
};}
