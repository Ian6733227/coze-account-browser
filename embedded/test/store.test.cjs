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
  fs.writeFileSync(path.join(root, 'accounts.json'), JSON.stringify([{ id, name: '安耐康', note: '', archived: false }]));
  const s = new Store(root); assert.equal(s.get(id).useProfileName, false); assert.equal(s.get(id).avatarMode, 'sync');
  s.profile(id, '扣子昵称', ''); assert.equal(s.get(id).name, '安耐康');
});
test('restart restores the last account and safe path while preserving sidebar and metadata', t => {
  const root = temporary(t), store = new Store(root), id = store.accounts[2].id;
  const metadata = fs.readFileSync(store.file, 'utf8');
  store.setResume(id, 'https://www.coze.cn/project/901?view=example#section');
  store.setSidebarCollapsed(true);
  let next = new Store(root);
  assert.deepEqual(next.startupSelection(), { accountId: id, url: 'https://www.coze.cn/project/901' });
  assert.equal(next.sidebarCollapsed, true);
  next.setResume(next.accounts[4].id, 'https://www.coze.cn/session/900');
  next = new Store(root); assert.equal(next.sidebarCollapsed, true);
  assert.equal(next.startupSelection().accountId, next.accounts[4].id);
  assert.equal(fs.readFileSync(store.file, 'utf8'), metadata);
  assert.equal(fs.statSync(store.uiFile).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(store.uiFile, 'utf8').includes('view=example'), false);
});
test('clearing synced identity keeps custom metadata, other accounts and fixed session paths across restart', t => {
  const root=temporary(t),store=new Store(root),[a,b]=store.accounts;
  store.edit(a.id,'Personal label','Keep note',false,'custom','data:image/png;base64,YQ==');
  store.profile(a.id,'Old website identity','data:image/png;base64,Yg==');
  store.profile(b.id,'Other identity','');const other=JSON.stringify(store.get(b.id)),sessionPath=store.sessionPath(a.id);
  store.setResume(a.id,'https://www.coze.cn/project/123');store.clearProfile(a.id);
  const next=new Store(root),account=next.get(a.id);
  assert.equal(account.name,'Personal label');assert.equal(account.note,'Keep note');assert.equal(account.customAvatar,'data:image/png;base64,YQ==');
  assert.equal(account.profile.name,'');assert.equal(account.profile.avatar,'');assert.equal(account.profile.syncedAt,0);
  assert.equal(next.sessionPath(a.id),sessionPath);assert.equal(JSON.stringify(next.get(b.id)),other);assert.equal(next.resume.url,null);
});
test('unsafe URLs never persist; archived, missing and malformed startup state falls back safely', t => {
  const root = temporary(t), store = new Store(root), id = store.accounts[2].id;
  for (const url of ['https://other.example/home', 'https://www.coze.cn/passport/login',
    'https://www.coze.cn/home?code=synthetic', 'https://www.coze.cn/home?token=synthetic',
    'https://user:synthetic@www.coze.cn/home', 'javascript:alert(1)', 'file:///tmp/example']) {
    store.setResume(id, url);
    assert.deepEqual(new Store(root).startupSelection(), { accountId: id, url: null });
    assert.equal(fs.readFileSync(store.uiFile, 'utf8').includes('synthetic'), false);
  }
  store.toggleArchive(id);
  assert.deepEqual(new Store(root).startupSelection(), { accountId: store.accounts[0].id, url: null });
  fs.writeFileSync(store.uiFile, JSON.stringify({ sidebarCollapsed: true, resume: { accountId: 'missing', url: 'https://www.coze.cn/home' } }));
  assert.equal(new Store(root).startupSelection().accountId, store.accounts[0].id);
  fs.writeFileSync(store.uiFile, 'bad json'); assert.equal(new Store(root).sidebarCollapsed, false);
  for (const account of store.accounts.filter(a => !a.archived)) store.toggleArchive(account.id);
  assert.equal(new Store(root).startupSelection(), null);
});
