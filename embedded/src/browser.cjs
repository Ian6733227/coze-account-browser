'use strict';
const { WebContentsView, session } = require('electron');
const { randomUUID } = require('node:crypto');
const { trustedPage, profileScript, fetchAvatar, isDefaultAvatar } = require('./identity.cjs');
const { platforms, matchesPlatform } = require('./platforms.cjs');
const { deadline, flushEntry, closeTabs } = require('./closing.cjs');
const LEFT = 232, COMPACT_LEFT = 76, TOP = 43, FOOT = 26;
const safeURL = value => { try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } };
class AccountBrowser {
  constructor(win, store, home = 'https://www.coze.cn/') {
    this.win = win; this.store = store; this.home = home; this.entries = new Map();
    this.selected = null; this.lastSelectedByPlatform = new Map(); this.attached = null; this.overlay = false; this.onUpdate = () => {};
    this.disposing = false; this.pausing = new Set();
    this.saveTimeout = 5000; this.closeTimeout = 5000; this.clearTimeout = 10000;
    this.profileChecks = new Map(); this.profileErrors = new Map();
    this.profileTimer = setInterval(() => {
      for (const id of this.entries.keys()) {
        if (id === this.selected || this.store.get(id).platform) this.syncProfile(id).catch(() => {});
      }
    }, 30000);
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
      const account = this.store.accounts[Number(input.key) - 1];
      if (account && !account.archived) {
        event.preventDefault();
        if (!this.entries.get(account.id)?.closing && !this.entries.get(account.id)?.clearing && !this.entries.get(account.id)?.flushing && !this.disposing) this.select(account.id);
      }
    });
  }
  makeTab(entry, options = {}, primary = false) {
    this.assertAvailable(entry);
    if (entry.tabs.length >= 32) throw Object.assign(new Error('该账号页面过多，请先关闭不用的页面。'), { code: 'PAGE_LIMIT' });
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
      if (entry.closing || this.disposing || entry.tabs.length >= 32) return { action: 'deny' };
      if (!safeURL(details.url) && details.url !== 'about:blank') return { action: 'deny' };
      return { action: 'allow', createWindow: opts => {
        const previous = entry.active;
        const child = this.makeTab(entry, opts);
        if (details.disposition === 'background-tab') { entry.active = previous; child.view.webContents.loadURL(details.url).catch(() => {}); }
        if (this.selected === entry.id) this.display();
        this.onUpdate(); return child.view.webContents;
      } };
    });
    wc.on('did-start-loading', () => { tab.error = ''; tab.generation = (tab.generation || 0) + 1; if (primary) { const check = this.profileChecks.get(entry.id); if (check) check.confirmedAt = 0; } this.display(); this.onUpdate(); });
    wc.on('did-stop-loading', () => { if (!tab.error && !wc.isCrashed?.()) tab.crashed = false; this.display(); this.onUpdate(); if (primary) this.syncProfile(entry.id).catch(() => {}); });
    const navigated = () => { if (this.selected === entry.id && entry.active === tab.id) this.rememberSelection(); this.onUpdate(); };
    wc.on('did-navigate', navigated);
    wc.on('did-navigate-in-page', navigated);
    wc.on('page-title-updated', () => this.onUpdate());
    wc.on('did-fail-load', (_e, code, _description, _url, mainFrame) => {
      if (mainFrame && code !== -3) { tab.error = `网页加载失败（${code}），请重新加载或返回平台首页。`; this.display(); this.onUpdate(true); }
    });
    wc.on('render-process-gone', () => { tab.crashed = true; tab.error = '网页进程退出，请重新加载或返回平台首页。'; this.display(); this.onUpdate(true); });
    wc.on('destroyed', () => {
      if (!this.win.isDestroyed() && this.win.contentView.children.includes(view)) this.win.contentView.removeChildView(view);
      entry.tabs = entry.tabs.filter(t => t !== tab);
      if (entry.active === tab.id) entry.active = entry.tabs[0]?.id || null;
      if (this.attached === view) this.attached = null;
      if (!this.win.isDestroyed()) { if (this.selected === entry.id) this.rememberSelection(); this.display(); this.onUpdate(); }
    });
    return tab;
  }
  homeFor(id) {
    const platform = this.store.get(id).platform || 'coze';
    return platform === 'coze' ? this.home : platforms[platform].home;
  }
  ensure(id, initialURL = this.homeFor(id)) {
    const entry = this.entry(id);
    this.assertAvailable(entry);
    if (!entry.tabs.some(t => t.primary && !t.view.webContents.isDestroyed())) {
      entry.paused = false;
      const tab = this.makeTab(entry, {}, true);
      tab.requestedURL = initialURL;
      tab.view.webContents.loadURL(initialURL).catch(() => {});
    }
    return entry;
  }
  select(id, initialURL) {
    const account = this.store.get(id);
    this.assertAvailable(this.entries.get(id));
    if (!matchesPlatform(account, this.store.platformView)) this.store.setPlatformView(account.platform || 'coze');
    this.ensure(id, initialURL);
    this.selected = id;
    this.lastSelectedByPlatform.set(account.platform || 'coze', id);
    this.rememberSelection(); this.display(); this.onUpdate(true); this.syncProfile(id).catch(() => {});
  }
  setPlatformView(view) {
    this.store.setPlatformView(view);
    const current = this.store.accounts.find(a => a.id === this.selected);
    if (!current || !matchesPlatform(current, view)) {
      const accounts = this.store.orderedAccounts().filter(a => !a.archived && matchesPlatform(a, view));
      const previous = accounts.find(a => a.id === this.lastSelectedByPlatform.get(view));
      const next = [previous, ...accounts].find(a => a && !this.accountBusy(a.id));
      if (next) { this.select(next.id); return; }
      this.selected = null;
    }
    this.display(); this.onUpdate(true);
  }
  accountBusy(id) {
    const entry = this.entries.get(id);
    return entry?.closing || entry?.clearing || entry?.flushing;
  }
  openStartupAccounts() {
    const selection = this.store.startupSelection();
    if (selection) this.select(selection.accountId, selection.url || undefined);
    this.openAll();
  }
  rememberSelection() {
    if (this.disposing || !this.selected || this.pausing.has(this.selected)) return;
    const tab = this.activeTab(), wc = tab?.view.webContents;
    const current = wc && !wc.isDestroyed() ? wc.getURL() : '';
    this.store.setResume(this.selected, current && current !== 'about:blank' ? current : tab?.requestedURL);
  }
  openPage(id,url) {
    const account = this.store.get(id);
    this.assertAvailable(this.entries.get(id));
    if (!matchesPlatform(account, this.store.platformView)) this.store.setPlatformView(account.platform || 'coze');
    const entry = this.ensure(id);
    let tab = entry.tabs.find(t => (t.requestedURL === url && t.view.webContents.isLoading()) || t.view.webContents.getURL() === url);
    const created = !tab;
    if (!tab) {
      if (entry.tabs.length >= 32) throw new Error('该账号页面过多，请先关闭不用的页面。');
      tab = this.makeTab(entry); tab.requestedURL = url;
      tab.view.webContents.loadURL(url).catch(() => {});
    }
    entry.active = tab.id; this.select(id);
    return {tab,created};
  }
  async syncProfile(id, force = false) {
    const platform = this.store.get(id).platform || 'coze';
    const entry = this.entries.get(id), tab = entry?.tabs.find(t => t.primary), wc = tab?.view.webContents;
    if (entry?.closing || entry?.flushing || entry?.clearing || this.disposing) {
      if (force) this.assertAvailable(entry);
      return;
    }
    if (!wc || wc.isDestroyed() || wc.isLoading() || !trustedPage(wc.getURL(), platform)) {
      if (force) throw new Error('先在这个账号中打开平台网页并登录，再同步头像与昵称。');
      return;
    }
    const prior = this.profileChecks.get(id);
    if (prior?.busy || (!force && prior && prior.generation === tab.generation && Date.now() - prior.at < 30000)) return;
    const check = { busy: true, at: Date.now(), generation: tab.generation, avatarURL: prior?.avatarURL }; this.profileChecks.set(id, check);
    this.onUpdate();
    try {
      const url = wc.getURL(), generation = tab.generation;
      const stillCurrent = () => !this.disposing && !this.accountBusy(id) && !wc.isDestroyed() &&
        wc.getURL() === url && tab.generation === generation;
      const profile = await deadline(wc.executeJavaScript(profileScript(platform)), 10000,
        'PROFILE_TIMEOUT', '账号资料读取超时。');
      if (!stillCurrent()) return;
      const name = typeof profile?.name === 'string' ? profile.name.trim() : '';
      if (!name || name.length > 80 || /^(?:登录|未登录|游客|登录\/注册|sign in|log in|guest|loading|加载中)$/i.test(name)) {
        throw new Error('暂未获取到账号信息；请确认已登录后重试。');
      }
      const account = this.store.get(id);
      const cached = account.profile.name === name ? account.profile.avatar : '';
      const avatarURL = typeof profile.avatarURL === 'string' ? profile.avatarURL : '';
      const avatar = !force && cached && avatarURL === check.avatarURL ? cached : await fetchAvatar(entry.session, avatarURL, platform);
      if (!stillCurrent()) return;
      const picture = avatar || cached;
      if (avatar) check.avatarURL = avatarURL;
      if (account.profile.name !== name || account.profile.avatar !== picture || force) this.store.profile(id, name, picture);
      check.confirmedAt = Date.now();
      this.profileErrors.delete(id);
      if (force && !avatar) this.profileErrors.set(id, '昵称已同步，头像暂未获取到；稍后可以重试或自定义。');
    } catch (err) {
      if (this.disposing || this.accountBusy(id) || wc.isDestroyed() || tab.generation !== check.generation) return;
      check.confirmedAt = 0;
      const message = '账号信息暂未确认，当前头像与昵称可能是缓存；请登录后重新同步。';
      this.profileErrors.set(id, message);
      if (force) throw new Error(message);
    } finally { check.busy = false; this.onUpdate(); }
  }
  openAll(view = 'all') {
    const accounts = this.store.accounts.filter(a => !a.archived && matchesPlatform(a, view));
    // Validate the whole action before opening any account.
    for (const a of accounts) this.assertAvailable(this.entries.get(a.id));
    for (const a of accounts) this.ensure(a.id);
    const first = accounts.find(a => matchesPlatform(a, this.store.platformView));
    if (!this.selected && first) { this.select(first.id); return; }
    this.rememberSelection();
    this.display(); this.onUpdate();
  }
  activeTab() { const entry = this.entries.get(this.selected); return entry?.tabs.find(t => t.id === entry.active); }
  detach() {
    if (this.attached && !this.win.isDestroyed()) this.attached.setVisible(false);
    this.attached = null;
  }
  display() {
    if (this.win.isDestroyed()) return;
    const tab = this.activeTab();
    const view = this.disposing || this.entries.get(this.selected)?.closing || this.entries.get(this.selected)?.clearing || tab?.crashed || tab?.error ? null : tab?.view;
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
  setSidebarCollapsed(value) { this.store.setSidebarCollapsed(value); this.layout(); this.onUpdate(true); }
  setOverlay(value) { this.overlay = value; this.display(); }
  switchTab(id) {
    const entry = this.entries.get(this.selected);
    this.assertAvailable(entry);
    if (!entry?.tabs.some(t => t.id === id)) throw new Error('页面不存在。');
    entry.active = id; this.rememberSelection(); this.display(); this.onUpdate(true);
  }
  closeTab() {
    if (this.disposing || this.entries.get(this.selected)?.closing || this.entries.get(this.selected)?.clearing) return;
    const tab = this.activeTab(); if (tab && !tab.primary) tab.view.webContents.close();
  }
  navigate(action) {
    if (this.overlay || this.disposing || this.entries.get(this.selected)?.closing || this.entries.get(this.selected)?.clearing) return;
    const tab = this.activeTab(); if (!tab) { if (this.selected) this.select(this.selected); return; }
    const wc = tab.view.webContents;
    if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else if (action === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    else if (action === 'reload') { tab.crashed = false; wc.reload(); }
    else if (action === 'home') wc.loadURL(this.homeFor(this.selected)).catch(() => {});
    else if (action === 'zoom-in') wc.setZoomFactor(Math.min(2, wc.getZoomFactor() + .1));
    else if (action === 'zoom-out') wc.setZoomFactor(Math.max(.5, wc.getZoomFactor() - .1));
    else if (action === 'zoom-reset') wc.setZoomFactor(1);
  }
  assertAvailable(entry) {
    if (this.disposing) throw Object.assign(new Error('浏览器正在退出。'), { code: 'UI_BUSY' });
    if (entry?.clearing) throw Object.assign(new Error('这个账号正在清除登录资料，请稍候；其他账号可继续使用。'), { code: 'ACCOUNT_CLEARING' });
    if (entry?.closing) throw Object.assign(new Error('这个账号正在暂停，请稍候再打开。'), { code: 'ACCOUNT_PAUSING' });
    if (entry?.flushing) throw Object.assign(new Error('这个账号仍在保存，请稍候；其他账号可继续使用。'), { code: 'ACCOUNT_SAVING' });
  }
  pause(id) {
    const entry = this.entries.get(id); if (!entry) return Promise.resolve();
    if (entry.closing) return entry.closing;
    this.assertAvailable(entry);
    if (this.selected === id) this.store.setResume(id, null);
    this.pausing.add(id);
    // Install ownership before starting asynchronous work, including a flush
    // implementation that might throw synchronously.
    entry.closing = Promise.resolve().then(async () => {
      try {
        entry.lifecycleError = '';
        await flushEntry(entry, this.saveTimeout);
        await closeTabs([...entry.tabs], this.closeTimeout);
        entry.paused = true;
      } catch (error) {
        entry.paused = false;
        entry.lifecycleError = '保存或网页关闭未确认，请检查这个账号后重试。';
        throw error;
      } finally {
        entry.closing = null; this.pausing.delete(id);
        if (entry.flushing) entry.flushing.then(() => this.onUpdate(true), () => this.onUpdate(true));
        if (this.selected === id) this.rememberSelection();
        this.display(); this.onUpdate();
      }
    });
    if (this.selected === id) this.detach();
    this.onUpdate();
    return entry.closing;
  }
  clearAccountData(id) {
    const entry = this.entry(id);
    this.assertAvailable(entry);
    // Close only this session's pages before clearing. Keep the underlying
    // operation owned even if the UI wait expires; never recreate pages in it.
    const closing = this.pause(id);
    const pending = closing.then(async () => {
      this.store.clearProfile(id);
      this.profileChecks.delete(id); this.profileErrors.delete(id);
      const results = await Promise.allSettled([
        Promise.resolve().then(() => entry.session.clearData()),
        Promise.resolve().then(() => entry.session.clearAuthCache())
      ]);
      const failure = results.find(result => result.status === 'rejected');
      if (failure) throw new Error('登录资料清除未完成，请重试；这个账号可能需要重新登录。');
    });
    entry.clearing = pending;
    const release = () => { if (entry.clearing === pending) entry.clearing = null; this.display(); this.onUpdate(true); };
    pending.then(release, release); this.onUpdate(true);
    return deadline(pending, this.saveTimeout + this.closeTimeout + this.clearTimeout, 'CLEAR_TIMEOUT', '清除尚未确认；请等待这个账号处理结束，其他账号可继续使用。');
  }
  async deleteAccount(id) {
    // Keep the entry discoverable until its session clearing is confirmed.
    // A failure or timeout must not remove the only way to retry clearing it.
    await this.clearAccountData(id);
    try { this.store.remove(id); }
    catch (cause) {
      throw Object.assign(new Error('登录资料已清除，但账号入口未能删除。请重试删除；其他账号未受影响。'), {code:'ACCOUNT_REMOVE_FAILED',cause});
    }
    this.entries.delete(id); this.profileChecks.delete(id); this.profileErrors.delete(id);
    if (this.selected === id) this.selected = this.store.orderedAccounts().find(a => !a.archived && matchesPlatform(a, this.store.platformView))?.id || null;
    // Do not open a new website or perform another fallible metadata write
    // after deletion. Already-running next accounts can be shown immediately.
    this.display(); this.onUpdate(true);
  }
  state() {
    return { selected: this.selected, sidebarCollapsed: this.store.sidebarCollapsed, sidebarOrder: this.store.sidebarOrder, platformView: this.store.platformView, platforms, accounts: this.store.accounts.map(a => {
      const entry = this.entries.get(a.id), tabs = entry?.tabs || [];
      return { ...a, platform: a.platform || 'coze', displayName: a.useProfileName && a.profile.name ? a.profile.name : a.name,
        displayAvatar: a.avatarMode === 'custom' ? a.customAvatar : isDefaultAvatar(a.profile.avatar) ? '' : a.profile.avatar,
        identityStatus: this.profileChecks.get(a.id)?.confirmedAt ? 'confirmed' : 'unconfirmed', identityCheckedAt: this.profileChecks.get(a.id)?.confirmedAt || null,
        syncing: this.profileChecks.get(a.id)?.busy === true, running: tabs.length > 0, clearing: Boolean(entry?.clearing), pausing: Boolean(entry?.closing || entry?.flushing || entry?.clearing), paused: entry?.paused === true && tabs.length === 0, loading: tabs.some(t => t.view.webContents.isLoading()),
        crashed: tabs.find(t => t.id === entry.active)?.crashed === true, pageError: tabs.find(t => t.id === entry.active)?.error || '', backgroundError: tabs.some(t => t.id !== entry.active && (t.crashed || t.error)) };
    }), tabs: (this.entries.get(this.selected)?.tabs || []).map(t => ({
      id: t.id, primary: t.primary, title: t.primary ? platforms[this.store.get(this.selected).platform || 'coze'].label : (t.view.webContents.getTitle() || '新页面').slice(0, 60), active: t.id === this.entries.get(this.selected).active
    })), error: this.activeTab()?.error || this.entries.get(this.selected)?.lifecycleError || this.profileErrors.get(this.selected) || this.startupWarning || '', host: (() => { try { return new URL(this.activeTab()?.view.webContents.getURL()).hostname; } catch { return ''; } })() };
  }
  async dispose() {
    this.rememberSelection(); this.disposing = true;
    clearInterval(this.profileTimer);
    this.onUpdate = () => {}; this.detach();
    const results = await Promise.allSettled([...this.entries.values()].map(async entry => {
      if (entry.clearing) await deadline(entry.clearing, this.clearTimeout, 'CLEAR_TIMEOUT', '登录资料清除尚未确认。');
      if (entry.closing) await deadline(entry.closing, this.saveTimeout + this.closeTimeout, 'CLOSE_TIMEOUT', '暂停尚未结束。').catch(() => {});
      await flushEntry(entry, this.saveTimeout);
      await closeTabs([...entry.tabs], this.closeTimeout);
    }));
    const failed = results.filter(r => r.status === 'rejected').length;
    if (failed) throw new Error(`保存或关闭未确认（${failed} 个账号），下次启动后请检查。`);
  }
}
module.exports = { AccountBrowser, safeURL, LEFT, COMPACT_LEFT, TOP, FOOT };
