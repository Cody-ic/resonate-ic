// Campus beta host: compiled Worker and real durable bindings, no Vite server.
import {Miniflare} from 'miniflare';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {parseEnv} from 'node:util';
import https from 'node:https';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

process.umask(0o077);
const root=fileURLToPath(new URL('../',import.meta.url)),shared=path.resolve(process.env.CAMPUS_SHARED||'campus-private');
const bindings=parseEnv(readFileSync(path.join(shared,'app.env'),'utf8'));
const origin=new URL(bindings.BETTER_AUTH_URL);
if(origin.protocol!=='https:'||bindings.PLATFORM_AUTH_ENABLED!=='false')throw Error('Explicit HTTPS origin and disabled platform login required');
const workerRoot=path.join(root,'dist/server');
const cfg=JSON.parse(readFileSync(path.join(workerRoot,'wrangler.json'),'utf8'));
const entry=path.join(workerRoot,'index.js');
const modules=[entry,...readdirSync(workerRoot,{recursive:true}).filter(p=>/\.(js|mjs)$/.test(p)&&!p.split(/[\\/]/).some(x=>x.startsWith('.'))).map(p=>path.join(workerRoot,p)).filter(p=>p!==entry)].map(p=>({type:'ESModule',path:p}));
const state=path.join(shared,'state');mkdirSync(state,{recursive:true});
const mf=new Miniflare({name:'resonate-campus',host:'127.0.0.1',port:0,cf:false,
  modules,modulesRoot:workerRoot,modulesRules:[{type:'ESModule',include:['**/*.js','**/*.mjs'],fallthrough:true}],
  compatibilityDate:cfg.compatibility_date,compatibilityFlags:cfg.compatibility_flags,bindings,
  assets:{directory:path.join(root,'dist/client'),routerConfig:{has_user_worker:true}},
  d1Databases:{DB:'resonate-campus-db'},d1Persist:path.join(state,'d1'),
  r2Buckets:{BUCKET:'resonate-campus-files'},r2Persist:path.join(state,'r2'),
  durableObjects:{REVIEW_COORDINATOR:{className:'ReviewCoordinator',useSQLite:true}},durableObjectsPersist:path.join(state,'do'),
  workflows:{REVIEW_WORKFLOW:{name:'review-workflow',className:'ReviewWorkflow'}},workflowsPersist:path.join(state,'workflows'),
});
await mf.ready;
const db=await mf.getD1Database('DB');
await db.prepare('CREATE TABLE IF NOT EXISTS campus_migrations(name TEXT PRIMARY KEY, digest TEXT NOT NULL, applied_at INTEGER NOT NULL)').run();
for(const name of readdirSync(path.join(root,'drizzle')).filter(x=>x.endsWith('.sql')).sort()){
  const sql=readFileSync(path.join(root,'drizzle',name),'utf8'),digest=crypto.createHash('sha256').update(sql).digest('hex');
  const applied=await db.prepare('SELECT digest FROM campus_migrations WHERE name=?').bind(name).first();
  if(applied){if(applied.digest!==digest)throw Error('Applied migration changed: '+name);continue;}
  const statements=sql.replace(/--> statement-breakpoint/g,'').split(';').map(x=>x.trim()).filter(Boolean);
  await db.batch([...statements.map(x=>db.prepare(x)),db.prepare('INSERT INTO campus_migrations VALUES(?,?,?)').bind(name,digest,Date.now())]);
  console.log('Applied migration',name);
}
if(process.argv.includes('--bootstrap')){
  if((await db.prepare('SELECT COUNT(*) AS n FROM users').first()).n>0)throw Error('Bootstrap requires an empty database; never re-import into a running beta');
  const source=JSON.parse(readFileSync(path.join(shared,'bootstrap.json'),'utf8'));
  for(const [table,rows] of Object.entries(source.tables)){
    if(!['users','auth_user','auth_account','mail_credentials','ai_budget_grants','reviews','ai_calls'].includes(table))throw Error('Unknown bootstrap table');
    for(const row of rows){const keys=Object.keys(row);await db.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')}) ON CONFLICT DO NOTHING`).bind(...keys.map(k=>row[k])).run();}
    console.log('Imported',table,rows.length);
  }
  console.log('Bootstrap complete');await mf.dispose();process.exit(0);
}
if(process.argv.includes('--db-status')){
  for(const table of ['users','auth_user','projects','reviews','ai_calls','mail_credentials','notifications','email_outbox'])console.log(table,await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first());
  console.log('mail',await db.prepare('SELECT auth_state,error FROM mail_credentials').all());
  await mf.dispose();process.exit(0);
}
const server=https.createServer({key:readFileSync(path.join(shared,'tls/server.key')),cert:readFileSync(path.join(shared,'tls/server.crt')),minVersion:'TLSv1.2'},async(req,res)=>{
  try{
    if(req.headers.host!==origin.host){res.writeHead(421);res.end('Unknown host');return;}
    const url=new URL(req.url,origin);
    if(url.origin!==origin.origin||/^\/(?:cdn-cgi|__vite|@vite|__admin)(?:\/|$)/.test(url.pathname)){res.writeHead(404);res.end();return;}
    const headers=new Headers();
    const excluded=/^(host|connection|transfer-encoding|upgrade|proxy-.*|forwarded|x-forwarded-.*|cf-.*|x-real-ip|x-openai-.*|openai-.*|oai-.*|x-chatgpt-.*)$/i;
    for(const [key,value] of Object.entries(req.headers))if(value&&!excluded.test(key)){for(const v of Array.isArray(value)?value:[value])headers.append(key,v);}
    headers.set('cf-connecting-ip',req.socket.remoteAddress?.replace(/^::ffff:/,'')||'unknown');
    headers.set('x-forwarded-proto','https');
    const hasBody=!['GET','HEAD'].includes(req.method);
    const response=await mf.dispatchFetch(url.href,{method:req.method,headers,...(hasBody?{body:Readable.toWeb(req),duplex:'half'}:{})});
    res.statusCode=response.status;
    for(const [key,value] of response.headers)if(!['set-cookie','transfer-encoding','connection','content-encoding','content-length'].includes(key)&&!key.startsWith('mf-'))res.setHeader(key,value);
    // Miniflare dispatchFetch returns decoded bodies. Node controls framing.
    const cookies=response.headers.getSetCookie();if(cookies.length)res.setHeader('set-cookie',cookies);
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
    if(response.body&&req.method!=='HEAD')await pipeline(Readable.fromWeb(response.body),res);else res.end();
  }catch(error){console.error('Request failed',error?.name);if(!res.headersSent)res.writeHead(502,{'Content-Type':'text/plain; charset=utf-8'});res.end('服务暂时不可用，请稍后重试');}
});
server.requestTimeout=300000;server.headersTimeout=65000;server.keepAliveTimeout=60000;
let scheduled=false;
async function tick(){if(scheduled)return;scheduled=true;try{await(await mf.getWorker()).scheduled({cron:'*/5 * * * *'});}catch(error){console.error('Scheduled dispatch failed',error?.name);}finally{scheduled=false;}}
const timer=setInterval(tick,60000);
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(Number(origin.port||443),process.env.CAMPUS_BIND||origin.hostname,resolve);});
console.log('Campus beta listening',origin.origin);void tick();
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{clearInterval(timer);server.close();server.closeIdleConnections();await mf.dispose();process.exit(0);});
