import test from 'node:test';
import assert from 'node:assert/strict';
import {trustedCampusLogin,loginAccountLimitKey,loginAccountMax,loginIpMax} from '../lib/login-policy.ts';

test('campus exemption requires configured, trusted IPv4/IPv6 peer ranges',()=>{
  const h=ip=>new Headers({'cf-connecting-ip':ip});
  assert.equal(trustedCampusLogin(h('198.18.1.5'),'198.18.1.0/24'),true);
  assert.equal(trustedCampusLogin(h('198.18.2.5'),'198.18.1.0/24'),false);
  assert.equal(trustedCampusLogin(h('2001:db8:1::ab'),'2001:db8:1::/48'),true);
  assert.equal(trustedCampusLogin(h('2001:db8:2::ab'),'2001:db8:1::/48'),false);
  assert.equal(trustedCampusLogin(h('::ffff:198.18.1.5'),'198.18.1.0/24'),true);
  assert.equal(trustedCampusLogin(h('198.18.1.5'),''),false);
  assert.equal(trustedCampusLogin(h('198.18.1.5'),'garbage,0.0.0.0/0,::/0'),false);
  assert.equal(trustedCampusLogin(new Headers({'x-forwarded-for':'198.18.1.5'}),'198.18.1.0/24'),false);
  assert.equal(trustedCampusLogin(h('198.18.1.5, 203.0.113.1'),'198.18.1.0/24'),false);
});
test('single-account protection is independent of IP and email capitalization',async()=>{
  const secret='a'.repeat(40),key=await loginAccountLimitKey('User@SEU.EDU.CN',secret);
  assert.equal(key,await loginAccountLimitKey(' user@seu.edu.cn ',secret));
  assert.notEqual(key,await loginAccountLimitKey('other@seu.edu.cn',secret));
  assert.notEqual(key,await loginAccountLimitKey('user@seu.edu.cn','b'.repeat(40)));
  assert.match(key,/^[a-f0-9]{64}$/);
  assert.equal(loginAccountMax,8);assert.ok(loginIpMax>=300);
});
