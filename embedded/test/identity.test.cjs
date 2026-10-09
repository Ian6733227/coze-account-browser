'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { trustedPage, trustedAvatar, PROFILE_SCRIPT, isDefaultAvatar } = require('../src/identity.cjs');
const fs = require('node:fs');
const path = require('node:path');
test('shared anonymous site avatar is recognized without suppressing other pictures', () => {
  const data = fs.readFileSync(path.join(__dirname, 'fixtures/site-default-avatar.png'));
  assert.equal(isDefaultAvatar('data:image/png;base64,' + data.toString('base64')), true);
  assert.equal(isDefaultAvatar('data:image/png;base64,c3ludGhldGlj'), false);
  assert.equal(isDefaultAvatar(''), false);
});
test('identity sync is restricted to trusted HTTPS account pages and public avatar CDN', () => {
  assert.equal(trustedPage('https://www.coze.cn/task/example'), true);
  for (const value of ['http://www.coze.cn/', 'https://www.coze.cn.attacker.example/', 'https://www.coze.cn:9443/', 'file:///tmp/coze.html']) assert.equal(trustedPage(value), false);
  assert.equal(trustedAvatar('https://p3-passport.byteacctimg.com/avatar.png'), true);
  for (const value of ['https://localhost/avatar.png', 'http://p3-passport.byteacctimg.com/avatar.png', 'https://byteacctimg.com.attacker.example/a', 'https://secret@byteacctimg.com/a', 'data:image/svg+xml,x']) assert.equal(trustedAvatar(value), false);
});
test('page-side profile extraction returns only own nickname and avatar URL', async () => {
  const context = { setTimeout, clearTimeout, AbortController, fetch: async (url, options) => {
    assert.equal(url, '/passport/account/info/v2/?aid=510023'); assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'same-origin');
    return { ok: true, json: async () => ({ message: 'success', data: { user_id_str: 'synthetic-1', name: '测试昵称', avatar_url: 'https://p3-passport.byteacctimg.com/a.png', mobile: 'synthetic-do-not-export', session_key: 'synthetic-do-not-export' } }) };
  } };
  const result = await vm.runInNewContext(PROFILE_SCRIPT, context);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { name: '测试昵称', avatarURL: 'https://p3-passport.byteacctimg.com/a.png' });
  context.fetch = async () => ({ ok: true, json: async () => ({ message: 'error', data: { name: '不能同步' } }) });
  assert.equal(await vm.runInNewContext(PROFILE_SCRIPT, context), null);
});
