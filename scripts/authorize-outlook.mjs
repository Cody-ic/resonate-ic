// One-time, local-only Outlook authorization. Never prints or commits tokens.
// Register a public/native client with http://localhost:53682/oauth/callback.
import {createServer} from 'node:http';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';

const args=process.argv.slice(2);
function option(name){const i=args.indexOf(name);return i<0?undefined:args[i+1];}
const clientId=option('--client-id'),mailbox=option('--mailbox')?.toLowerCase();
// Only use after checking this exact primary account and the requested alias
// together on Microsoft's account-alias page. Never accept an arbitrary login.
const verifiedPrimary=option('--verified-primary-account')?.toLowerCase();
if(!/^[a-f0-9-]{36}$/i.test(clientId??'')||!mailbox||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mailbox)){
  console.error('Usage: node scripts/authorize-outlook.mjs --client-id <application-id> --mailbox <sender-address>');process.exit(1);
}
const root=process.cwd(),envPath=join(root,'.dev.vars'),runtime=join(root,'.sites-runtime','mail-authorization');
try{execFileSync('git',['check-ignore','--quiet','--no-index',envPath],{stdio:'ignore'});}catch{throw Error('.dev.vars must be Git-ignored before authorization.');}
mkdirSync(runtime,{recursive:true});
const state=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url');
const redirect='http://localhost:53682/oauth/callback',scope='https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/User.Read offline_access';
const authorization=new URL('https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize');
authorization.search=new URLSearchParams({client_id:clientId,response_type:'code',redirect_uri:redirect,response_mode:'query',scope,state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',login_hint:mailbox,prompt:'select_account'}).toString();
const statusPath=join(runtime,'status.json');
function status(value){writeFileSync(statusPath,JSON.stringify(value,null,2)+'\n',{mode:0o600});}
function matches(a,b){const x=Buffer.from(a??''),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
function saveEnvironment(values){
  let text=existsSync(envPath)?readFileSync(envPath,'utf8'):'';
  if(!/^BETTER_AUTH_SECRET\s*=\s*\S{32,}/m.test(text))throw Error('Configure the existing site authentication secret first.');
  if(existsSync(envPath))copyFileSync(envPath,join(runtime,`before-${Date.now()}.dev.vars`));
  for(const [key,value] of Object.entries(values)){
    const line=key+'='+JSON.stringify(value),pattern=new RegExp('^'+key+'\\s*=.*$','m');
    text=pattern.test(text)?text.replace(pattern,()=>line):text+(text.endsWith('\n')||!text?'':'\n')+line+'\n';
  }
  const temporary=envPath+'.oauth-tmp';writeFileSync(temporary,text,{mode:0o600});renameSync(temporary,envPath);
}
let processing=false,completed=false;
const server=createServer(async(request,response)=>{
  response.setHeader('Cache-Control','no-store');response.setHeader('Content-Type','text/html; charset=utf-8');response.setHeader('Referrer-Policy','no-referrer');response.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
  const url=new URL(request.url??'/',redirect);
  if(request.headers.host!=='localhost:53682'||request.method!=='GET'){response.writeHead(404).end('Not found');return;}
  if(url.pathname==='/complete'&&completed){response.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>共振邮箱授权完成</title><h1>邮箱授权完成</h1><p>授权已安全保存到本机，接下来验证实际发信。此页面可以关闭，无需再次填写验证码。</p></html>');return;}
  if(url.pathname!=='/oauth/callback'){response.writeHead(404).end('Not found');return;}
  if(!matches(url.searchParams.get('state'),state)){response.writeHead(400).end('Invalid authorization state');return;}
  if(completed){response.writeHead(303,{Location:'/complete'}).end();return;}
  if(processing){response.writeHead(409).end('Authorization is already being processed.');return;}
  processing=true;
  try{
    if(url.searchParams.has('error'))throw Error('Microsoft authorization was not completed.');
    const code=url.searchParams.get('code');if(!code)throw Error('No authorization code was returned.');
    const tokenResponse=await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token',{method:'POST',body:new URLSearchParams({client_id:clientId,grant_type:'authorization_code',code,redirect_uri:redirect,scope,code_verifier:verifier}),signal:AbortSignal.timeout(120000)});
    const tokens=await tokenResponse.json();
    if(!tokenResponse.ok||!tokens.access_token||!tokens.refresh_token)throw Error('Microsoft token exchange failed ('+String(tokens.error??tokenResponse.status).replace(/[^a-zA-Z0-9_]/g,'')+').');
    const granted=new Set((tokens.scope??'').split(' ').map(s=>s.toLowerCase().replace('https://graph.microsoft.com/','')));
    if(!granted.has('mail.send')||!granted.has('user.read'))throw Error('Required mail permission was not granted.');
    const profileResponse=await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,proxyAddresses',{headers:{Authorization:'Bearer '+tokens.access_token},signal:AbortSignal.timeout(120000)});
    if(!profileResponse.ok)throw Error('Unable to verify the authorized sender account.');
    const profile=await profileResponse.json();
    const addresses=[profile.mail,profile.userPrincipalName,...(profile.proxyAddresses??[]).map(x=>x.replace(/^smtp:/i,''))].filter(Boolean).map(x=>x.toLowerCase());
    if(!addresses.includes(mailbox)&&!(verifiedPrimary&&addresses.includes(verifiedPrimary))){
      status({state:'wrong_account',requestedMailbox:mailbox,authorizedAddresses:addresses});
      throw Error('The authorized account does not match the requested sender. No credentials were saved.');
    }
    saveEnvironment({MAIL_PROVIDER:'graph',MAIL_FROM:mailbox,MAIL_GRAPH_CLIENT_ID:clientId,MAIL_GRAPH_REFRESH_TOKEN:tokens.refresh_token,MAIL_DELIVERY_MODE:'test',MAIL_TEST_RECIPIENTS:mailbox,MAIL_REQUIRE_EMAIL_VERIFICATION:'false'});
    status({state:'authorized',mailbox,clientId,verifiedPrimary:verifiedPrimary??null,deliveryMode:'test',authorizedAt:new Date().toISOString()});
    completed=true;
    response.writeHead(303,{Location:'/complete'}).end();
    console.log('Outlook authorization saved locally. Delivery is limited to the sender mailbox for verification.');
  }catch(error){
    const message=error instanceof Error?error.message:'Authorization failed';
    if(!existsSync(statusPath)||JSON.parse(readFileSync(statusPath,'utf8')).state==='waiting')status({state:'failed',message});
    response.writeHead(400).end('<!doctype html><meta charset="utf-8"><title>邮箱授权未完成</title><h1>邮箱授权未完成</h1><p>请返回终端查看不含密钥的状态说明。</p>');
    console.error(message);process.exitCode=1;
  }finally{clearTimeout(timer);if(completed)setTimeout(()=>server.close(),120000);else server.close();}
});
const timer=setTimeout(()=>{status({state:'expired'});server.close();console.error('Authorization timed out; rerun the helper to start a fresh session.');process.exitCode=1;},30*60*1000);
server.listen(53682,'127.0.0.1',()=>{
  status({state:'waiting',mailbox,authorizationUrl:authorization.href});
  console.log('Open the authorizationUrl in .sites-runtime/mail-authorization/status.json. The listener expires in 30 minutes.');
});
server.on('error',error=>{clearTimeout(timer);console.error('Local authorization listener failed: '+error.code);process.exitCode=1;});
