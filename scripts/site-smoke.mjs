// Public, read-only checks. No account creation, mail or paid model requests.
const base=new URL(process.argv[2]??'http://127.0.0.1:5173');
if(!['http:','https:'].includes(base.protocol)||base.username||base.password)throw Error('Use a site origin without credentials');
const results=[];
for(const [path,expected] of [['/api/health',200],['/api/config',200],['/api/me',200],['/api/admin/workflows',403],['/api/notifications',401],['/api/reports',401],['/privacy',200],['/contact',200]]){
  try{const r=await fetch(new URL(path,base),{redirect:'error',signal:AbortSignal.timeout(60000)});let valid=r.status===expected;
    if(path==='/api/health'){const v=await r.json();valid&&=v.ok===true&&v.database===true&&v.uploads===true;}
    if(path==='/api/me'){const v=await r.json();valid&&=!v.user;}
    if(path==='/api/config'){const v=await r.json();if(base.protocol==='https:')valid&&=v.platformLoginEnabled===false&&typeof v.emailVerificationRequired==='boolean';}
    results.push({path,status:r.status,passed:valid});
  }catch{results.push({path,passed:false,error:'request failed; details suppressed'});}
}
console.log(JSON.stringify({scope:'anonymous read-only smoke; no capacity or delivery claim',results},null,2));
if(results.some(x=>!x.passed))process.exitCode=1;
