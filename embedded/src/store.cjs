'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function imageValue(value) { return typeof value === 'string' && value.length <= 160000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value) ? value : ''; }
function validate(accounts) {
  if (!Array.isArray(accounts)) throw new Error('账号记录格式异常，原文件已保留。');
  const seen = new Set();
  return accounts.map(a => {
    if (!a || !UUID.test(a.id) || seen.has(a.id.toLowerCase()) || typeof a.name !== 'string' || !a.name.trim() || a.name.length > 80) {
      throw new Error('账号记录包含无效名称或重复 ID，原文件已保留。');
    }
    seen.add(a.id.toLowerCase());
    return { id: a.id, name: a.name.trim(), note: typeof a.note === 'string' ? a.note.slice(0, 300) : '', archived: a.archived === true,
      useProfileName: typeof a.useProfileName === 'boolean' ? a.useProfileName : /^扣子账号 \d+$/.test(a.name.trim()),
      avatarMode: a.avatarMode === 'custom' ? 'custom' : 'sync', customAvatar: imageValue(a.customAvatar),
      profile: { name: typeof a.profile?.name === 'string' ? a.profile.name.trim().slice(0,80) : '', avatar: imageValue(a.profile?.avatar),
        syncedAt: Number.isFinite(a.profile?.syncedAt) ? a.profile.syncedAt : 0 } };
  });
}
class Store {
  constructor(root, legacyFile = null) {
    this.root = root;
    this.file = path.join(root, 'accounts.json');
    fs.mkdirSync(root, { recursive: true, mode: 0o700 }); fs.chmodSync(root, 0o700);
    this.uiFile = path.join(root, 'ui-state.json');
    try { this.sidebarCollapsed = JSON.parse(fs.readFileSync(this.uiFile, 'utf8')).sidebarCollapsed === true; }
    catch { this.sidebarCollapsed = false; }
    if (fs.existsSync(this.file)) this.accounts = validate(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    else {
      let legacy = null;
      if (legacyFile && fs.existsSync(legacyFile)) {
        try { legacy = validate(JSON.parse(fs.readFileSync(legacyFile, 'utf8'))); } catch { /* Leave old records untouched. */ }
      }
      this.accounts = legacy || Array.from({ length: 5 }, (_, i) => ({ id: randomUUID(), name: `扣子账号 ${i + 1}`, note: '', archived: false }));
      this.save(this.accounts);
    }
  }
  save(accounts) {
    const normalized = validate(accounts);
    const temp = this.file + `.tmp-${randomUUID()}`;
    fs.writeFileSync(temp, JSON.stringify(normalized, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(temp, this.file); fs.chmodSync(this.file, 0o600);
    this.accounts = normalized;
  }
  get(id) {
    const account = this.accounts.find(a => a.id === id);
    if (!account) throw new Error('没有找到这个账号，请刷新列表。');
    return account;
  }
  setSidebarCollapsed(value) {
    if (typeof value !== 'boolean') throw new Error('侧栏设置不正确。');
    const temp = this.uiFile + `.tmp-${randomUUID()}`;
    fs.writeFileSync(temp, JSON.stringify({ sidebarCollapsed: value }) + '\n', { mode: 0o600 });
    fs.renameSync(temp, this.uiFile); this.sidebarCollapsed = value;
  }
  add(name, note = '', useProfileName = true) {
    const a = { id: randomUUID(), name, note, archived: false, useProfileName: useProfileName === true };
    this.save([...this.accounts, a]); return this.accounts.at(-1);
  }
  edit(id, name, note, useProfileName = false, avatarMode, customAvatar) {
    this.get(id);
    if (avatarMode && !['sync','custom'].includes(avatarMode)) throw new Error('头像模式不正确。');
    if (avatarMode === 'custom' && !imageValue(customAvatar)) throw new Error('头像格式不正确。');
    this.save(this.accounts.map(a => a.id === id ? { ...a, name, note, useProfileName: useProfileName === true,
      ...(avatarMode ? { avatarMode, customAvatar: avatarMode === 'custom' ? customAvatar : a.customAvatar } : {}) } : a));
  }
  profile(id, name, avatar) {
    this.get(id);
    if (typeof name !== 'string' || !name.trim() || name.length > 80) throw new Error('没有识别到有效的扣子昵称。');
    this.save(this.accounts.map(a => a.id === id ? { ...a, profile: { name: name.trim(), avatar: imageValue(avatar), syncedAt: Date.now() } } : a));
  }
  toggleArchive(id) {
    this.get(id); this.save(this.accounts.map(a => a.id === id ? { ...a, archived: !a.archived } : a));
  }
  sessionPath(id) {
    this.get(id);
    return path.join(this.root, 'Sessions', id.toLowerCase());
  }
}
module.exports = { Store, validate };
