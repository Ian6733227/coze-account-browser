'use strict';
const { WebContentsView, session } = require('electron');
const { randomUUID } = require('node:crypto');
const { trustedPage, PROFILE_SCRIPT, fetchAvatar, isDefaultAvatar } = require('./identity.cjs');
const LEFT = 232, COMPACT_LEFT = 76, TOP = 43, FOOT = 26;
const safeURL = value => { try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } };
function closeContents(wc) {
  if (wc.isDestroyed()) return Promise.resolve();
  return new Promise(resolve => { wc.once('destroyed', resolve); wc.close({ waitForBeforeUnload: false }); });
}
class AccountBrowser {
  constructor(win, store, home = 'https://www.coze.cn/') {
    this.win = win; this.store = store; this.home = home; this.entries = new Map();
    this.selected = null; this.attached = null; this.overlay = false; this.onUpdate = () => {};
    this.profileChecks = new Map(); this.profileErrors = new Map();
    this.profileTimer = setInterval(() => { if (this.selected) this.syncProfile(this.selected).catch(() => {}); }, 30000);
    this.profileTimer.unref();
    win.on('resize', () => this.layout());
  }
  entry(id) {
    this.store.get(id);
    if (!this.entries.has(id)) {
      const ses = session.fromPath(this.store.sessionPath(id));
      // Remote pages never receive desktop privileges, even in nested frames.
      ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
      ses.setPermissionCheckHandler(() => false);
      ses.on('will-download', (_event, item) => item.setSaveDialogOptions({ title: '保存下载文件', defaultPath: item.getFilename() }));
      this.entries.set(id, { id, session: ses, tabs: [], active: null });
    }
    return this.entries.get(id);
  }
  shortcuts(wc) {
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || !(input.meta || input.control) || input.alt || input.shift || !/^[1-9]$/.test(input.key)) return;
      if (this.overlay) { event.preventDefault(); return; }
      const account = this.store.accounts.filter(a => !a.archived)[Number(input.key) - 1];
      if (account) { event.preventDefault(); this.select(account.id); }
    });
  }
  makeTab(entry, options = {}, primary = false) {
    const view = new WebContentsView({ ...options, webPreferences: {
      ...options.webPreferences, session: entry.session, nodeIntegration: false,
      nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true,
      webSecurity: true, backgroundThrottling: false, preload: undefined
    } });
    // Keep the native view parent stable. Detaching and reattaching on macOS can
    // leave its compositor blank until the window is resized.
    view.setVisible(false);
    this.win.contentView.addChildView(view);
    const tab = { id: randomUUID(), view, primary, error: '', crashed: false };
    entry.tabs.push(tab); entry.active = tab.id;
    const wc = view.webContents;
    this.shortcuts(wc);
    wc.setZoomMode('isolated');
    wc.on('will-navigate', event => { if (!safeURL(event.url) && event.url !== 'about:blank') event.preventDefault(); });
    wc.on('will-redirect', event => { if (!safeURL(event.url)) event.preventDefault(); });
    wc.on('will-frame-navigate', event => { if (!safeURL(event.url) && event.url !== 'about:blank') event.preventDefault(); });
    wc.setWindowOpenHandler(details => {
      if (!safeURL(details.url) && details.url !== 'about:blank') return { action: 'deny' };
      return { action: 'allow', createWindow: opts => {
        const child = this.makeTab(entry, opts);
        if (details.disposition === 'background-tab') child.view.webContents.loadURL(details.url).catch(() => {});
        if (this.selected === entry.id) this.display();
        this.onUpdate(); return child.view.webContents;
      } };
    });
    wc.on('did-start-loading', () => { tab.error = ''; this.onUpdate(); });
    wc.on('did-stop-loading', () => { this.onUpdate(); if (primary) this.syncProfile(entry.id).catch(() => {}); });
    wc.on('did-navigate', () => this.onUpdate());
    wc.on('did-navigate-in-page', () => this.onUpdate());
    wc.on('page-title-updated', () => this.onUpdate());
    wc.on('did-fail-load', (_e, code, _description, _url, mainFrame) => {
      if (mainFrame && code !== -3) { tab.error = `网页加载失败（${code}），请点击刷新重试。`; this.onUpdate(); }
    });
    wc.on('render-process-gone', () => { tab.crashed = true; tab.error = '网页进程退出，点击刷新恢复。'; this.onUpdate(); });
    wc.on('destroyed', () => {
      if (!this.win.isDestroyed() && this.win.contentView.children.includes(view)) this.win.contentView.removeChildView(view);
      entry.tabs = entry.tabs.filter(t => t !== tab);
      if (entry.active === tab.id) entry.active = entry.tabs[0]?.id || null;
      if (this.attached === view) this.attached = null;
      if (!this.win.isDestroyed()) { this.display(); this.onUpdate(); }
    });
    return tab;
  }
  ensure(id) {
    const entry = this.entry(id);
    if (!entry.tabs.some(t => t.primary && !t.view.webContents.isDestroyed())) {
      entry.paused = false;
      const tab = this.makeTab(entry, {}, true);
      tab.requestedURL = this.home;
      tab.view.webContents.loadURL(this.home).catch(() => {});
    }
    return entry;
  }
  select(id) { this.ensure(id); this.selected = id; this.display(); this.onUpdate(); this.syncProfile(id).catch(() => {}); }
  openPage(id,url) {
    const entry = this.ensure(id);
    let tab = entry.tabs.find(t => (t.requestedURL === url && t.view.webContents.isLoading()) || t.view.webContents.getURL() === url);
    const created = !tab;
    if (!tab) {
      if (entry.tabs.length >= 32) throw new Error('该账号页面过多，请先关闭不用的页面。');
      tab = this.makeTab(entry); tab.requestedURL = url;
      tab.view.webContents.loadURL(url).catch(() => {});
    }
    entry.active = tab.id; this.selected = id; this.display(); this.onUpdate();
    return {tab,created};
  }
  async syncProfile(id, force = false) {
    this.store.get(id);
    const entry = this.entries.get(id), tab = entry?.tabs.find(t => t.primary), wc = tab?.view.webContents;
    if (!wc || wc.isDestroyed() || wc.isLoading() || !trustedPage(wc.getURL())) {
      if (force) throw new Error('先在这个账号中打开并登录扣子，再同步头像与昵称。');
      return;
    }
    const prior = this.profileChecks.get(id);
    if (prior?.busy || (!force && prior && Date.now() - prior.at < 30000)) return;
    const check = { busy: true, at: Date.now() }; this.profileChecks.set(id, check);
    this.onUpdate();
    try {
      const url = wc.getURL(), profile = await wc.executeJavaScript(PROFILE_SCRIPT);
      if (wc.isDestroyed() || wc.getURL() !== url) return;
      if (!profile?.name || typeof profile.name !== 'string' || profile.name.length > 80) throw new Error('暂未获取到扣子账号信息；请确认已登录后重试。');
      const avatar = await fetchAvatar(entry.session, profile.avatarURL);
      if (wc.isDestroyed() || wc.getURL() !== url) return;
      const account = this.store.get(id);
      const picture = avatar;
      if (account.profile.name !== profile.name || account.profile.avatar !== picture || force) this.store.profile(id, profile.name, picture);
      this.profileErrors.delete(id);
      if (force && !picture) this.profileErrors.set(id, '昵称已同步，头像暂未获取到；稍后可以重试或自定义。');
    } catch (err) {
      if (force) { this.profileErrors.set(id, err.message); throw err; }
    } finally { check.busy = false; this.onUpdate(); }
  }
  openAll() {
    const accounts = this.store.accounts.filter(a => !a.archived);
    for (const a of accounts) this.ensure(a.id);
    if (!this.selected && accounts.length) this.selected = accounts[0].id;
    this.display(); this.onUpdate();
  }
  activeTab() { const entry = this.entries.get(this.selected); return entry?.tabs.find(t => t.id === entry.active); }
  detach() {
    if (this.attached && !this.win.isDestroyed()) this.attached.setVisible(false);
    this.attached = null;
  }
  display() {
    if (this.win.isDestroyed()) return;
    const view = this.activeTab()?.view;
    if (!this.overlay && this.attached === view && view && !view.webContents.isDestroyed()) { this.layout(); return; }
    this.detach();
    if (!this.overlay && view && !view.webContents.isDestroyed()) {
      this.attached = view; this.layout(); view.setVisible(true);
    }
  }
  layout() {
    if (!this.attached || this.win.isDestroyed()) return;
    const [width, height] = this.win.getContentSize();
    const top = TOP + ((this.entries.get(this.selected)?.tabs.length || 0) > 1 ? 33 : 0);
    const left = this.store.sidebarCollapsed ? COMPACT_LEFT : LEFT;
    this.attached.setBounds({ x: left, y: top, width: Math.max(1, width - left), height: Math.max(1, height - top - FOOT) });
  }
  setSidebarCollapsed(value) { this.store.setSidebarCollapsed(value); this.layout(); this.onUpdate(); }
  setOverlay(value) { this.overlay = value; this.display(); }
  switchTab(id) {
    const entry = this.entries.get(this.selected);
    if (!entry?.tabs.some(t => t.id === id)) throw new Error('页面不存在。');
    entry.active = id; this.display(); this.onUpdate();
  }
  closeTab() {
    const tab = this.activeTab(); if (tab && !tab.primary) tab.view.webContents.close();
  }
  navigate(action) {
    if (this.overlay) return;
    const tab = this.activeTab(); if (!tab) { if (this.selected) this.select(this.selected); return; }
    const wc = tab.view.webContents;
    if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else if (action === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    else if (action === 'reload') { tab.crashed = false; wc.reload(); }
    else if (action === 'home') wc.loadURL(this.home).catch(() => {});
    else if (action === 'zoom-in') wc.setZoomFactor(Math.min(2, wc.getZoomFactor() + .1));
    else if (action === 'zoom-out') wc.setZoomFactor(Math.max(.5, wc.getZoomFactor() - .1));
    else if (action === 'zoom-reset') wc.setZoomFactor(1);
  }
  async pause(id) {
    const entry = this.entries.get(id); if (!entry) return;
    entry.paused = true;
    if (this.selected === id) this.detach();
    // flush, then dispose renderers. Session remains on disk for next opening.
    await entry.session.cookies.flushStore();
    entry.session.flushStorageData();
    await Promise.all(entry.tabs.map(tab => closeContents(tab.view.webContents)));
    this.onUpdate();
  }
  state() {
    return { selected: this.selected, sidebarCollapsed: this.store.sidebarCollapsed, accounts: this.store.accounts.map(a => {
      const entry = this.entries.get(a.id), tabs = entry?.tabs || [];
      return { ...a, displayName: a.useProfileName && a.profile.name ? a.profile.name : a.name,
        displayAvatar: a.avatarMode === 'custom' ? a.customAvatar : isDefaultAvatar(a.profile.avatar) ? '' : a.profile.avatar,
        syncing: this.profileChecks.get(a.id)?.busy === true, running: tabs.length > 0, paused: entry?.paused === true && tabs.length === 0, loading: tabs.some(t => t.view.webContents.isLoading()),
        crashed: tabs.some(t => t.crashed), pageError: tabs.find(t => t.id === entry.active)?.error || '' };
    }), tabs: (this.entries.get(this.selected)?.tabs || []).map(t => ({
      id: t.id, primary: t.primary, title: t.primary ? '扣子' : (t.view.webContents.getTitle() || '新页面').slice(0, 60), active: t.id === this.entries.get(this.selected).active
    })), error: this.activeTab()?.error || this.profileErrors.get(this.selected) || '', host: (() => { try { return new URL(this.activeTab()?.view.webContents.getURL()).hostname; } catch { return ''; } })() };
  }
  async dispose() {
    clearInterval(this.profileTimer);
    this.onUpdate = () => {}; this.detach();
    for (const entry of this.entries.values()) {
      await entry.session.cookies.flushStore(); entry.session.flushStorageData();
      await Promise.all(entry.tabs.map(t => closeContents(t.view.webContents)));
    }
  }
}
module.exports = { AccountBrowser, safeURL, LEFT, COMPACT_LEFT, TOP, FOOT };
