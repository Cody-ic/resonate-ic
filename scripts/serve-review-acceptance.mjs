// Test-only local runtime. Never import this from the application worker.
import {Miniflare} from 'miniflare';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
const context=JSON.parse(readFileSync('outputs/review-test-context.json','utf8'));
const workerRoot=path.join(context.runtime,'dist/server');
const cfg=JSON.parse(readFileSync(path.join(workerRoot,'wrangler.json'),'utf8'));
const secret=readFileSync('.dev.vars','utf8').split(/\r?\n/).find(line=>line.startsWith('BETTER_AUTH_SECRET='))?.slice('BETTER_AUTH_SECRET='.length);
if(!secret)throw new Error('Configure local authentication first.');
const entry=path.join(workerRoot,'index.js');
const modules=[entry,...readdirSync(workerRoot,{recursive:true}).filter(p=>/\.(js|mjs)$/.test(p)&&!p.split(/[\\/]/).some(x=>x.startsWith('.'))).map(p=>path.join(workerRoot,p)).filter(p=>p!==entry)].map(p=>({type:'ESModule',path:p}));
const mf=new Miniflare({name:cfg.name,host:'127.0.0.1',port:5174,modules,modulesRoot:workerRoot,
  modulesRules:[{type:'ESModule',include:['**/*.js','**/*.mjs'],fallthrough:true}],compatibilityDate:cfg.compatibility_date,compatibilityFlags:cfg.compatibility_flags,
  bindings:{BETTER_AUTH_SECRET:secret,BETTER_AUTH_URL:'http://127.0.0.1:5174',ADMIN_USER_IDS:context.uid},
  d1Databases:{DB:'00000000-0000-4000-8000-000000000000'},d1Persist:path.join(context.state,'v3/d1'),r2Buckets:{BUCKET:'site-creator-r2'},r2Persist:path.join(context.state,'v3/r2'),
});
console.log('Acceptance runtime:',String(await mf.ready));
process.on('SIGINT',async()=>{await mf.dispose();process.exit(0);});
process.on('SIGTERM',async()=>{await mf.dispose();process.exit(0);});
