// Read-only LOCAL rehearsal. Never imports restored production env values.
import {Miniflare} from 'miniflare';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const restored=path.resolve(process.argv[2]??'');if(!process.argv[2])throw Error('Pass isolated restore directory');
const root=path.resolve('dist/server'),cfg=JSON.parse(readFileSync(path.join(root,'wrangler.json'),'utf8')),entry=path.join(root,'index.js');
const modules=[entry,...readdirSync(root,{recursive:true}).filter(p=>/\.(js|mjs)$/.test(p)&&!p.split(/[\\/]/).some(x=>x.startsWith('.'))).map(p=>path.join(root,p)).filter(p=>p!==entry)].map(p=>({type:'ESModule',path:p}));
let outboundCalls=0;
const mf=new Miniflare({name:cfg.name,modules,modulesRoot:root,modulesRules:[{type:'ESModule',include:['**/*.js','**/*.mjs'],fallthrough:true}],compatibilityDate:cfg.compatibility_date,compatibilityFlags:cfg.compatibility_flags,bindings:{BETTER_AUTH_URL:'http://localhost',BETTER_AUTH_SECRET:crypto.randomBytes(32).toString('hex'),PLATFORM_AUTH_ENABLED:'false',MAIL_DELIVERY_MODE:'off',PROJECT_AI_MONTHLY_MAX_CALLS:'0',DISCUSSION_AI_MONTHLY_MAX_CALLS:'0',PROJECT_PUBLICATION_ENABLED:'false'},d1Databases:{DB:'00000000-0000-4000-8000-000000000000'},d1Persist:path.join(restored,'.wrangler/state/v3/d1'),r2Buckets:{BUCKET:'site-creator-r2'},r2Persist:path.join(restored,'.wrangler/state/v3/r2'),outboundService:()=>{outboundCalls++;throw Error('Rehearsal outbound request blocked');}});
try{
 await mf.ready;const db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('BUCKET');
 const checks=[];for(const url of ['/api/health','/api/projects','/api/config']){const r=await mf.dispatchFetch('http://localhost'+url);assert.equal(r.status,200);const v=await r.json();if(url.endsWith('projects'))assert.ok(v.items.length>0);if(url.endsWith('config'))assert.equal(v.emailVerificationEnabled,false);checks.push(url);}
 const files=(await db.prepare('SELECT id,digest FROM files').all()).results;let verifiedAttachments=0;
 for(const f of files){const object=await bucket.get(f.id);assert.ok(object,'Restored attachment missing');assert.equal(crypto.createHash('sha256').update(Buffer.from(await object.arrayBuffer())).digest('hex'),f.digest);verifiedAttachments++;}
 const objects=await bucket.list();
 const manifest=JSON.parse(readFileSync(path.join(restored,'.backup-manifest.json'),'utf8'));
 const blobHashes=new Set(Object.entries(manifest.files).filter(([name])=>name.includes('/r2/')&&!name.endsWith('.sqlite')).map(([,v])=>v.sha256));
 for(const listed of objects.objects){const object=await bucket.get(listed.key);assert.ok(object);const bytes=Buffer.from(await object.arrayBuffer());assert.equal(bytes.length,object.size);assert.ok(blobHashes.has(crypto.createHash('sha256').update(bytes).digest('hex')),'R2 API bytes differ from archived blobs');}
 assert.equal(outboundCalls,0);
 const result={apiChecks:checks,verifiedR2Objects:objects.objects.length,verifiedAttachments,outboundCalls,realMailSent:false,scope:'restored D1/R2 read-only application boot; restored credentials separately verified offline'};
 writeFileSync(path.join(restored,'runtime-check.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await mf.dispose();}
