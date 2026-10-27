import test from 'node:test';
import assert from 'node:assert/strict';
import {checkProduction} from '../scripts/check-production.mjs';
test('production preflight rejects local identities and missing credentials without echoing values',()=>{
 const secret='SENSITIVE_TEST_CREDENTIAL_1234567890123456',c={BETTER_AUTH_SECRET:secret,BETTER_AUTH_URL:'http://localhost:5173',PLATFORM_AUTH_ENABLED:'true',ADMIN_USER_IDS:'local_seedy'};
 const issues=checkProduction(c);assert.ok(issues.some(x=>x.startsWith('ADMIN_USER_IDS')));assert.ok(issues.some(x=>x.startsWith('BETTER_AUTH_URL')));assert.ok(!JSON.stringify(issues).includes(secret));
});
