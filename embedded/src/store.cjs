'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { safeResumeURL } = require('./resume.cjs');
const { atomicWrite } = require('./atomic-write.cjs');
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
    let ui = {};
    try { ui = JSON.parse(fs.readFileSync(this.uiFile, 'utf8')) || {}; } catch { /* Old or malformed UI state is optional. */ }
    this.sidebarCollapsed = ui.sidebarCollapsed === true;
    if (fs.existsSync(this.file)) {
      try { this.accounts = validate(JSON.parse(fs.readFileSync(this.file, 'utf8'))); }
      catch { throw new Error(`账号列表无法读取，原文件和登录资料已保留。资料目录：${this.root}。请截图此提示联系维护者；不要删除资料目录、移走账号列表后重启，或重新生成账号列表。`); }
    }
    else {
      let legacy = null;
      if (legacyFile && fs.existsSync(legacyFile)) {
        try { legacy = validate(JSON.parse(fs.readFileSync(legacyFile, 'utf8'))); } catch { /* Leave old records untouched. */ }
      }
      this.accounts = legacy || Array.from({ length: 5 }, (_, i) => ({ id: randomUUID(), name: `扣子账号 ${i + 1}`, note: '', archived: false }));
      this.save(this.accounts);
    }
    const ids = new Set(this.accounts.map(a => a.id));
    this.sidebarOrder = Array.isArray(ui.sidebarOrder) ? [...new Set(ui.sidebarOrder.filter(id => ids.has(id)))] : [];
    const resume = ui.resume;
    this.resume = resume && this.accounts.some(a => a.id === resume.accountId) ?
      { accountId: resume.accountId, url: safeResumeURL(resume.url) } : null;
  }
  save(accounts) {
    const normalized = validate(accounts);
    atomicWrite(this.file, JSON.stringify(normalized, null, 2) + '\n');
    this.accounts = normalized;
  }
  get(id) {
    const account = this.accounts.find(a => a.id === id);
    if (!account) throw new Error('没有找到这个账号，请刷新列表。');
    return account;
  }
  setSidebarCollapsed(value) {
    if (typeof value !== 'boolean') throw new Error('侧栏设置不正确。');
    this.writeUI(value, this.resume); this.sidebarCollapsed = value;
  }
  writeUI(sidebarCollapsed, resume, sidebarOrder = this.sidebarOrder) {
    atomicWrite(this.uiFile, JSON.stringify({ sidebarCollapsed, resume, sidebarOrder }) + '\n');
  }
  orderedAccounts() {
    const accounts = new Map(this.accounts.map(account => [account.id, account]));
    const order = new Set([...this.sidebarOrder, ...accounts.keys()]);
    return [...order].filter(id => accounts.has(id)).map(id => accounts.get(id));
  }
  sidebarNeighbors(id, showArchived, selected) {
    const visible = this.orderedAccounts().filter(a => !a.archived || showArchived || a.id === selected);
    const index = visible.findIndex(a => a.id === id);
    return index < 0 ? {} : { up: visible[index - 1]?.id, down: visible[index + 1]?.id };
  }
  moveSidebarAccount(id, direction, showArchived, selected) {
    this.get(id);
    if (direction !== 'up' && direction !== 'down') throw new Error('移动方向不正确。');
    const neighbor = this.sidebarNeighbors(id, showArchived, selected)[direction];
    if (!neighbor) return;
    const order = this.orderedAccounts().map(a => a.id);
    const from = order.indexOf(id), to = order.indexOf(neighbor);
    [order[from], order[to]] = [order[to], order[from]];
    this.writeUI(this.sidebarCollapsed, this.resume, order);
    this.sidebarOrder = order;
  }
  setResume(accountId, url) {
    this.get(accountId);
    const resume = { accountId, url: safeResumeURL(url) };
    if (this.resume?.accountId === resume.accountId && this.resume.url === resume.url) return;
    this.writeUI(this.sidebarCollapsed, resume); this.resume = resume;
  }
  startupSelection() {
    const account = this.accounts.find(a => a.id === this.resume?.accountId && !a.archived) || this.accounts.find(a => !a.archived);
    return account ? { accountId: account.id, url: account.id === this.resume?.accountId ? this.resume.url : null } : null;
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
  remove(id) {
    this.get(id);
    this.save(this.accounts.filter(a => a.id !== id));
    // An old UI resume reference is ignored at startup if its ID no longer
    // exists. Do not introduce a second fallible write after list commit.
    if (this.resume?.accountId === id) this.resume = null;
    this.sidebarOrder = this.sidebarOrder.filter(orderedId => orderedId !== id);
  }
  clearProfile(id) {
    this.get(id);
    this.save(this.accounts.map(a => a.id === id ? { ...a, profile: { name: '', avatar: '', syncedAt: 0 } } : a));
    if (this.resume?.accountId === id) this.setResume(id, null);
  }
  sessionPath(id) {
    this.get(id);
    return path.join(this.root, 'Sessions', id.toLowerCase());
  }
}
module.exports = { Store, validate };
