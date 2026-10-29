import test from 'node:test';
import assert from 'node:assert/strict';
import {checkProduction} from '../scripts/check-production.mjs';

test('production mail delivery is independent from the optional verification gate',()=>{
 const c={BETTER_AUTH_SECRET:'isolated-production-check-secret-1234567890',BETTER_AUTH_URL:'https://community.test',PLATFORM_AUTH_ENABLED:'false',ADMIN_USER_IDS:'production-admin',ADMIN_EMAILS:'admin@community.test',MAIL_FROM:'sender@community.test',MAIL_GRAPH_CLIENT_ID:'test-client',MAIL_GRAPH_REFRESH_TOKEN:'test-seed',MAIL_PROVIDER:'graph',MAIL_DELIVERY_MODE:'live',PROJECT_REVIEW_API_KEY:'test-project',DISCUSSION_REVIEW_API_KEY:'test-discussion'};
 for(const key of ['PROJECT_AI_MONTHLY_BUDGET_MICROS','DISCUSSION_AI_MONTHLY_BUDGET_MICROS','AI_TOTAL_MONTHLY_BUDGET_MICROS','PROJECT_AI_MONTHLY_MAX_CALLS','DISCUSSION_AI_MONTHLY_MAX_CALLS'])c[key]='1';
 for(const required of ['true','false'])assert.deepEqual(checkProduction({...c,MAIL_REQUIRE_EMAIL_VERIFICATION:required}),[]);
 assert.ok(checkProduction({...c,MAIL_REQUIRE_EMAIL_VERIFICATION:'flase'}).some(x=>x.startsWith('MAIL_REQUIRE_EMAIL_VERIFICATION')));
});
test('production preflight rejects local identities and missing credentials without echoing values',()=>{
 const secret='SENSITIVE_TEST_CREDENTIAL_1234567890123456',c={BETTER_AUTH_SECRET:secret,BETTER_AUTH_URL:'http://localhost:5173',PLATFORM_AUTH_ENABLED:'true',ADMIN_USER_IDS:'local_seedy'};
 const issues=checkProduction(c);assert.ok(issues.some(x=>x.startsWith('ADMIN_USER_IDS')));assert.ok(issues.some(x=>x.startsWith('BETTER_AUTH_URL')));assert.ok(!JSON.stringify(issues).includes(secret));
});
