import {spawn} from 'node:child_process';
const quote=value=>'"'+value.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('\r','\\r').replaceAll('\n','\\n')+'"';
// This campus host reliably reaches Microsoft with curl IPv4/HTTP1.1, while
// direct workerd and Node sockets intermittently time out. Credentials and body
// go only through child stdin, never argv, shell commands, files or logs.
export async function curlMailRequest(request,launch=spawn){
  const url=new URL(request.url);
  if(url.protocol!=='https:'||url.username||url.password||!['graph.microsoft.com','login.microsoftonline.com'].includes(url.hostname))return new Response(null,{status:403});
  const lines=['silent','show-error','ipv4','http1.1','compressed','include','connect-timeout = 20','max-time = 55','url = '+quote(url.href),'request = '+quote(request.method)];
  for(const [name,value] of request.headers)if(!/^(host|content-length|transfer-encoding|connection|accept-encoding)$/i.test(name))lines.push('header = '+quote(name+': '+value));
  if(!['GET','HEAD'].includes(request.method))lines.push('data-binary = '+quote(await request.text()));
  const bytes=await new Promise((resolve,reject)=>{
    const child=launch('curl',['--config','-'],{stdio:['pipe','pipe','pipe'],signal:request.signal});
    const chunks=[];let size=0;
    child.stdout.on('data',data=>{size+=data.length;if(size>2*1024*1024){child.kill();reject(Error('Mail response too large'));}else chunks.push(data);});
    // Provider stderr can contain request context; never forward it to logs.
    child.stderr.on('data',()=>{});
    child.on('error',()=>reject(Error('Mail HTTPS transport unavailable')));
    child.on('close',code=>code===0?resolve(Buffer.concat(chunks)):reject(Error('Mail HTTPS transport failed')));
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
export function campusMailTransport(){return {
  worker:{name:'campus-mail-router',modules:true,compatibilityDate:'2026-05-15',
    script:`export default {fetch(request,env){const url=new URL(request.url);return url.protocol==='https:'&&['graph.microsoft.com','login.microsoftonline.com'].includes(url.hostname)?env.MAIL_HTTP.fetch(request):fetch(request);}}`,
    serviceBindings:{MAIL_HTTP:async request=>{try{return await curlMailRequest(request);}catch(error){console.error('Mail HTTPS transport failed',error?.name);throw Error('Mail transport unavailable');}}}},
  close:async()=>{},
};}
