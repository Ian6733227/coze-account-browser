'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/store.cjs');
function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coze-store-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root;
}
test('sidebar preference persists independently and invalid values leave accounts untouched', t => {
  const root = temporary(t), store = new Store(root), accounts = fs.readFileSync(store.file, 'utf8');
  assert.equal(store.sidebarCollapsed, false);
  store.setSidebarCollapsed(true); assert.equal(new Store(root).sidebarCollapsed, true);
  assert.throws(() => store.setSidebarCollapsed('false'));
  assert.equal(new Store(root).sidebarCollapsed, true); assert.equal(fs.readFileSync(store.file, 'utf8'), accounts);
  store.setSidebarCollapsed(false); assert.equal(new Store(root).sidebarCollapsed, false);
});
test('seven distinct accounts persist; rename keeps session identity', t => {
  const root = temporary(t); const s = new Store(root);
  s.add('第六账号'); s.add('第七账号');
  assert.equal(s.accounts.length, 7);
  assert.equal(new Set(s.accounts.map(a => s.sessionPath(a.id))).size, 7);
  const id = s.accounts[0].id; const original = s.sessionPath(id);
  s.edit(id, '../改名 中文', '备注');
  const reloaded = new Store(root);
  assert.equal(reloaded.sessionPath(id), original);
  assert.equal(reloaded.accounts[0].name, '../改名 中文');
});
test('archive is reversible and retains session directory', t => {
  const s = new Store(temporary(t)); const id = s.accounts[0].id; const original = s.sessionPath(id);
  s.toggleArchive(id); assert.equal(s.get(id).archived, true);
  s.toggleArchive(id); assert.equal(s.get(id).archived, false); assert.equal(s.sessionPath(id), original);
});
test('duplicate ID and empty name cannot overwrite existing metadata', t => {
  const s = new Store(temporary(t)); const before = fs.readFileSync(s.file, 'utf8');
  assert.throws(() => s.save([...s.accounts, s.accounts[0]]));
  assert.throws(() => s.edit(s.accounts[0].id, '  ', ''));
  assert.equal(fs.readFileSync(s.file, 'utf8'), before);
});
test('corrupt config is preserved', t => {
  const root = temporary(t); fs.writeFileSync(path.join(root, 'accounts.json'), 'bad json');
  assert.throws(() => new Store(root));
  assert.equal(fs.readFileSync(path.join(root, 'accounts.json'), 'utf8'), 'bad json');
});
test('imports legacy labels only; never copies legacy browser data', t => {
  const base = temporary(t); const old = new Store(path.join(base, 'old'));
  old.edit(old.accounts[0].id, '已有工作号', '已有备注');
  fs.mkdirSync(path.join(old.root, 'Profiles')); fs.writeFileSync(path.join(old.root, 'Profiles', 'private-fixture'), 'not imported');
  const next = new Store(path.join(base, 'new'), old.file);
  assert.equal(next.accounts[0].name, '已有工作号'); assert.equal(next.accounts[0].id, old.accounts[0].id);
  assert.equal(fs.existsSync(path.join(next.root, 'Profiles')), false);
  assert.equal(fs.existsSync(path.join(next.root, 'Sessions')), false);
});
test('synced identities and custom appearance survive restart without changing account session', t => {
  const root = temporary(t), s = new Store(root), id = s.accounts[0].id, other = s.accounts[1].id, session = s.sessionPath(id);
  const image = 'data:image/png;base64,c3ludGhldGlj';
  s.profile(id, '同步昵称', image);
  assert.equal(s.get(other).profile.name, '');
  s.edit(id, '本机别名', '用途', false, 'custom', image);
  s.profile(id, '新同步昵称', '');
  const next = new Store(root);
  assert.equal(next.get(id).name, '本机别名'); assert.equal(next.get(id).useProfileName, false);
  assert.equal(next.get(id).customAvatar, image); assert.equal(next.get(id).avatarMode, 'custom');
  assert.equal(next.get(id).profile.name, '新同步昵称'); assert.equal(next.sessionPath(id), session);
  const before = fs.readFileSync(next.file, 'utf8');
  assert.throws(() => next.edit(id, '别名', '', false, 'custom', 'data:image/svg+xml,<script>'));
  assert.equal(fs.readFileSync(next.file, 'utf8'), before);
});
test('old metadata migrates labels without overriding meaningful custom names', t => {
  const root = temporary(t), id = '12345678-1234-1234-1234-123456789012';
  fs.writeFileSync(path.join(root, 'accounts.json'), JSON.stringify([{ id, name: '示例账号', note: '', archived: false }]));
  const s = new Store(root); assert.equal(s.get(id).useProfileName, false); assert.equal(s.get(id).avatarMode, 'sync');
  s.profile(id, '扣子昵称', ''); assert.equal(s.get(id).name, '示例账号');
});
