// Real built worker, isolated storage; no account, mail or model requests.
import {Miniflare} from 'miniflare';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const out=path.resolve('outputs/readiness-'+Date.now());mkdirSync(out,{recursive:true});
const root=path.resolve('dist/server'),cfg=JSON.parse(readFileSync(path.join(root,'wrangler.json'),'utf8')),entry=path.join(root,'index.js');
const modules=[entry,...readdirSync(root,{recursive:true}).filter(p=>/\.(js|mjs)$/.test(p)&&!p.split(/[\\/]/).some(x=>x.startsWith('.'))).map(p=>path.join(root,p)).filter(p=>p!==entry)].map(p=>({type:'ESModule',path:p}));
let outboundCalls=0;
const options={name:'readiness-acceptance',modules,modulesRoot:root,modulesRules:[{type:'ESModule',include:['**/*.js','**/*.mjs'],fallthrough:true}],compatibilityDate:cfg.compatibility_date,compatibilityFlags:cfg.compatibility_flags,bindings:{MAIL_DELIVERY_MODE:'off',PROJECT_AI_MONTHLY_MAX_CALLS:'0',DISCUSSION_AI_MONTHLY_MAX_CALLS:'0'},d1Databases:{DB:'readiness'},d1Persist:path.join(out,'d1'),r2Buckets:{BUCKET:'readiness'},r2Persist:path.join(out,'r2'),outboundService:()=>{outboundCalls++;throw Error('Outbound forbidden');}};
const mf=new Miniflare(options),checks=[];
async function check(name,status,database,uploads){const r=await mf.dispatchFetch('http://localhost/api/health');assert.equal(r.status,status,name);const v=await r.json();assert.equal(v.database,database);assert.equal(v.uploads,uploads);assert.equal(v.ok,status===200);assert.equal(r.headers.get('cache-control'),'no-store');checks.push(name);}
try{
 await mf.ready;
 await check('missing application schema returns 503',503,false,true);
 const db=await mf.getD1Database('DB');await db.prepare('CREATE TABLE projects(id TEXT PRIMARY KEY)').run();
 await check('working empty database and bucket return 200',200,true,true);
 await mf.setOptions({...options,r2Buckets:{}});await mf.ready;
 await check('missing object-store binding returns 503',503,true,false);
 await mf.setOptions({...options,d1Databases:{}});await mf.ready;
 await check('missing database binding returns 503',503,false,true);
 assert.equal(outboundCalls,0);
 writeFileSync(path.join(out,'result.json'),JSON.stringify({checks,outboundCalls,productionDataModified:false},null,2));console.log(JSON.stringify({report:path.join(out,'result.json'),passed:checks.length,outboundCalls}));
}finally{await mf.dispose();}
