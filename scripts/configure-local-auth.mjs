import {existsSync,readFileSync,appendFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
const filename='.dev.vars',current=existsSync(filename)?readFileSync(filename,'utf8'):'';
if(/^BETTER_AUTH_SECRET=\S{32,}/m.test(current)){console.log('站内账号密钥已配置，保留原值。');}
else if(/^BETTER_AUTH_SECRET=/m.test(current)){throw new Error('请先检查 .dev.vars 中已有的 BETTER_AUTH_SECRET；不会自动覆盖。');}
else{appendFileSync(filename,(current&&!current.endsWith('\n')?'\n':'')+'BETTER_AUTH_SECRET='+randomBytes(48).toString('base64url')+'\n',{mode:0o600});console.log('已生成本地站内账号密钥，未显示密钥内容。');}
