// One-time private migration. No tokens or password hashes are printed.
import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {parseEnv,parseArgs} from 'node:util';
import path from 'node:path';
import crypto from 'node:crypto';
const {values}=parseArgs({options:{'owner-email':{type:'string'},origin:{type:'string'},'source-env':{type:'string'},output:{type:'string'}}});
if(!values['owner-email']||!values.origin||!values['source-env']||!values.output)throw Error('Required: --owner-email --origin --source-env --output (private directory)');
const origin=new URL(values.origin);if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/')throw Error('Use an HTTPS origin');
const out=path.resolve(values.output);mkdirSync(out,{recursive:true});
const local=parseEnv(readFileSync(values['source-env'],'utf8'));
const dir='.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const filename=readdirSync(dir).find(x=>x.endsWith('.sqlite')&&x!=='metadata.sqlite');
const db=new DatabaseSync(path.join(dir,filename),{readOnly:true});
const owner=db.prepare('SELECT * FROM auth_user WHERE lower(email)=?').get(values['owner-email'].toLowerCase());
if(!owner)throw Error('Owner account must exist; no administrator is fabricated');
const cfg={...parseEnv(readFileSync('config/production.env.example','utf8')),...local,
  BETTER_AUTH_URL:origin.origin,BETTER_AUTH_SECRET:crypto.randomBytes(48).toString('base64url'),
  PLATFORM_AUTH_ENABLED:'false',ADMIN_USER_IDS:owner.id,ADMIN_EMAILS:owner.email,
  MAIL_DELIVERY_MODE:'live',MAIL_REQUIRE_EMAIL_VERIFICATION:'false',SEU_LOGIN_TRUSTED_CIDRS:'',
  PROJECT_PUBLICATION_ENABLED:'true'};
delete cfg.MAIL_TEST_RECIPIENTS;
const sha=s=>crypto.createHash('sha256').update(s).digest();
function decrypt(s){const [,iv,data]=s.split(':');const bytes=Buffer.from(data,'base64');const d=crypto.createDecipheriv('aes-256-gcm',sha(local.BETTER_AUTH_SECRET),Buffer.from(iv,'base64'));d.setAuthTag(bytes.subarray(-16));return Buffer.concat([d.update(bytes.subarray(0,-16)),d.final()]).toString();}
function encrypt(s){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',sha(cfg.BETTER_AUTH_SECRET),iv);return 'encrypted:'+iv.toString('base64')+':'+Buffer.concat([c.update(s),c.final(),c.getAuthTag()]).toString('base64');}
const mail=db.prepare('SELECT * FROM mail_credentials WHERE id=?').get('graph:'+cfg.MAIL_GRAPH_CLIENT_ID);
if(!mail||mail.auth_state!=='active')throw Error('Current mail authorization must be healthy before migration');
const refresh=decrypt(mail.refresh_cipher);cfg.MAIL_GRAPH_REFRESH_TOKEN=refresh;
const now=Date.now(),tables={
  users:[{id:owner.id,name:owner.name,created_at:owner.created_at,bio:''}],
  auth_user:[owner],
  auth_account:db.prepare("SELECT * FROM auth_account WHERE user_id=? AND provider_id='credential'").all(owner.id),
  mail_credentials:[{...mail,seed_digest:sha(refresh).toString('hex'),refresh_cipher:encrypt(refresh),access_cipher:null,access_expires_at:0,retry_after_at:0,error:null}],
  ai_budget_grants:db.prepare('SELECT * FROM ai_budget_grants').all(),reviews:[],ai_calls:[],
};
if(tables.auth_account.length!==1)throw Error('Owner password account must be unique');
const calls=db.prepare('SELECT * FROM ai_calls').all(),map=new Map();
for(const call of calls){
  if(!map.has(call.review_id)){
    const id='budget-history:'+crypto.createHash('sha256').update(call.review_id).digest('hex').slice(0,24);map.set(call.review_id,id);
    tables.reviews.push({id,entity_type:'budget_history',entity_id:id,owner_id:owner.id,snapshot:'{}',digest:'migrated-budget-only',state:'archived',result:null,appeal:null,task:'history',lane:call.lane,context:null,created_at:call.created_at,updated_at:now});
  }
  tables.ai_calls.push({...call,review_id:map.get(call.review_id)});
}
writeFileSync(path.join(out,'app.env'),Object.entries(cfg).map(([k,v])=>`${k}=${JSON.stringify(String(v))}`).join('\n')+'\n',{mode:0o600,flag:'wx'});
writeFileSync(path.join(out,'bootstrap.json'),JSON.stringify({tables}),{mode:0o600,flag:'wx'});
writeFileSync(path.join(out,'migration-summary.json'),JSON.stringify({ownerId:owner.id,emailVerified:Boolean(owner.email_verified),accounts:tables.auth_account.length,budgetCalls:calls.length,budgetGrants:tables.ai_budget_grants.length,importedProjects:0,importedSessions:0},null,2));
console.log('Private beta migration prepared; owner must complete normal email verification. Existing calls and carried budgets preserved. No projects, local identities or sessions imported.');
db.close();
