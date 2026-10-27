// Read-only preflight. It never prints configuration values or calls providers.
import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
export function checkProduction(c){
  const issues=[];
  for(const k of ['BETTER_AUTH_SECRET','BETTER_AUTH_URL','ADMIN_USER_IDS','ADMIN_EMAILS','MAIL_FROM','MAIL_GRAPH_CLIENT_ID','MAIL_GRAPH_REFRESH_TOKEN','PROJECT_REVIEW_API_KEY','DISCUSSION_REVIEW_API_KEY'])if(!c[k]?.trim())issues.push(k+': missing');
  try{const u=new URL(c.BETTER_AUTH_URL);if(u.protocol!=='https:'||/localhost|127\.0\.0\.1|YOUR-DOMAIN|example\./i.test(u.hostname)||u.username||u.password||u.pathname!=='/')issues.push('BETTER_AUTH_URL: actual HTTPS origin required');}catch{issues.push('BETTER_AUTH_URL: invalid');}
  if((c.BETTER_AUTH_SECRET??'').length<32)issues.push('BETTER_AUTH_SECRET: at least 32 characters required');
  if(c.PLATFORM_AUTH_ENABLED!=='false')issues.push('PLATFORM_AUTH_ENABLED: disable independent-host platform login');
  if((c.ADMIN_USER_IDS??'').split(',').some(v=>/^local_|YOUR|example/i.test(v.trim())))issues.push('ADMIN_USER_IDS: use verified production profile IDs');
  if(c.MAIL_PROVIDER!=='graph'||c.MAIL_DELIVERY_MODE!=='live'||c.MAIL_REQUIRE_EMAIL_VERIFICATION!=='true')issues.push('MAIL: verified live delivery must be configured');
  for(const k of ['MAIL_FROM','ADMIN_EMAILS'])if(!(c[k]??'').split(',').every(v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())))issues.push(k+': valid address required');
  for(const k of ['PROJECT_AI_MONTHLY_BUDGET_MICROS','DISCUSSION_AI_MONTHLY_BUDGET_MICROS','AI_TOTAL_MONTHLY_BUDGET_MICROS','PROJECT_AI_MONTHLY_MAX_CALLS','DISCUSSION_AI_MONTHLY_MAX_CALLS'])if(!/^\d+$/.test(c[k]??'')||Number(c[k])<=0)issues.push(k+': positive integer required');
  return issues;
}
if(process.argv[1]?.endsWith('check-production.mjs')){
  const filename=process.argv[2];if(!filename){console.error('Usage: node scripts/check-production.mjs <private-env-file>');process.exitCode=2;}else{
    try{const issues=checkProduction(parseEnv(readFileSync(filename,'utf8')));console.log(JSON.stringify({configurationReady:issues.length===0,issues,notVerified:['real hosting bindings','administrator identity ownership','mail delivery','HTTPS reachability','backup restore','cloud concurrency']},null,2));if(issues.length)process.exitCode=1;}catch{console.error('Unable to read or parse private configuration; no values printed.');process.exitCode=2;}
  }
}
