'use strict';
const { app, BrowserWindow, ipcMain, Menu, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { Store } = require('./store.cjs');
const { AccountBrowser } = require('./browser.cjs');
const { avatarData } = require('./identity.cjs');
const { startControl } = require('./control.cjs');
const { coalesceUpdates } = require('./updates.cjs');
const { requireCurrent } = require('./actions.cjs');
const { checkedVersion } = require('./compatibility.cjs');
const { request } = require('./control-transport.cjs');
const { platforms } = require('./platforms.cjs');
const { deadline } = require('./closing.cjs');
const TOOL_LINKS = Object.freeze({
  remoteDisplay: 'https://soft.jiunai.tech/mac-remote-display/',
  displayControl: 'https://soft.jiunai.tech/mac-display-control/',
  catalog: 'https://soft.jiunai.tech/',
  brand: 'https://zhijinhua.cn/'
});
const testing = process.argv.includes('--self-test');
const rootIndex = process.argv.indexOf('--data-root');
const root = rootIndex >= 0 ? path.resolve(process.argv[rootIndex + 1]) : testing ? fs.mkdtempSync(path.join(os.tmpdir(), 'coze-browser-test-')) :
  path.join(app.getPath('appData'), 'CozeAccountsBrowser');
app.setName('扣子账号浏览器');
app.setPath('userData', root);
if (!app.requestSingleInstanceLock()) {
  app.whenReady().then(async () => {
    try { checkedVersion(await request(root, 'status', {}, 1500), app.getVersion()); }
    catch (error) {
      if (error.code === 'VERSION_MISMATCH') dialog.showErrorBox('正在运行另一版本', error.message);
      else dialog.showErrorBox('浏览器已经打开', '另一个实例正在使用这些账号资料。请先正常退出原窗口，再启动此版本。');
    }
    app.exit(1);
  });
}
else {
  let win, browser, control, quitting = false, quitInProgress = false;
  function showWindow() {
    if (!win || win.isDestroyed() || quitInProgress) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
  app.on('second-instance', showWindow);
  app.on('activate', showWindow);
  app.whenReady().then(async () => {
    // HTTP User-Agent is a byte header; the Chinese app display name must not
    // leak into it (session.fetch/custom protocol headers reject non-ASCII).
    app.userAgentFallback = app.userAgentFallback.replaceAll('扣子账号浏览器', 'CozeAccountsBrowser');
    app.setAboutPanelOptions({ applicationName: '扣子账号浏览器', applicationVersion: app.getVersion(),
      iconPath: path.join(__dirname, '../assets/zhijinhua-app.png'),
      copyright: '智进化 · 多账号工作台' });
    const store = new Store(root, testing || rootIndex >= 0 ? null : path.join(app.getPath('appData'), 'CozeAccounts', 'accounts.json'));
    win = new BrowserWindow({ width: 1280, height: 840, minWidth: 960, minHeight: 650,
      title: '扣子账号浏览器', titleBarStyle: 'hiddenInset', backgroundColor: '#f6f7fb',
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    win.on('close', event => {
      if (quitting) return;
      event.preventDefault();
      if (!quitInProgress) win.minimize();
    });
    browser = new AccountBrowser(win, store);
    const warningFile = path.join(root, 'shutdown-warning.json');
    if (fs.existsSync(warningFile)) browser.startupWarning = '上次退出时保存未确认，请检查各账号网页；登录资料目录未清除。';
    browser.shortcuts(win.webContents);
    const shellURL = pathToFileURL(path.join(__dirname, '../ui/index.html')).href;
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    const notify = coalesceUpdates(() => { if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('coze:update', browser.state()); });
    browser.onUpdate = immediate => immediate === true ? notify.flush() : notify();
    win.on('closed', () => notify.cancel());
    const handle = (name, fn) => ipcMain.handle(`coze:${name}`, async (event, payload) => {
      if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== shellURL) throw new Error('不允许访问。');
      try {
        if (quitInProgress) throw new Error('浏览器正在退出。');
        if (browser.overlay && ['platform-menu','account-menu','select','open-all','sidebar','archive','pause','clear-account-data','delete-account','navigation','tab','close-tab','sync-profile'].includes(name)) throw new Error('请先完成当前确认，或关闭帮助、保存/取消账号编辑。');
        return { ok: true, value: await fn(payload) };
      } catch (err) { notify.flush(); return { ok: false, error: err.message || '操作未完成。' }; }
    });
    handle('state', () => browser.state());
    handle('tool-link', key => {
      if (typeof key !== 'string' || !Object.hasOwn(TOOL_LINKS, key)) throw new Error('工具链接不可用。');
      return shell.openExternal(TOOL_LINKS[key]);
    });
    handle('sidebar', value => browser.setSidebarCollapsed(value));
    handle('select', id => { store.get(id); browser.select(id); return browser.state(); });
    handle('open-all', () => browser.openAll(store.platformView));
    handle('platform-menu', () => {
      const options = [['all', '全部平台'], ...Object.entries(platforms).map(([id, platform]) => [id, platform.label])];
      const menu = Menu.buildFromTemplate(options.map(([id, label]) => ({
        label, type: 'radio', checked: store.platformView === id,
        click: () => {
          if (browser.overlay || quitInProgress) return;
          try { browser.setPlatformView(id); }
          catch (error) { dialog.showErrorBox('切换平台失败', error.message); }
        }
      })));
      menu.popup({ window: win });
    });
    handle('add', data => { const a = store.add(data?.name, data?.note, data?.useProfileName, data?.platform); browser.select(a.id); });
    handle('edit', data => { store.edit(data?.id, data?.name, data?.note, data?.useProfileName, data?.avatarMode, data?.customAvatar); browser.onUpdate(); });
    handle('sync-profile', async id => { requireCurrent(browser, id); await browser.syncProfile(id, true); });
    handle('choose-avatar', async id => {
      store.get(id);
      const chosen = await dialog.showOpenDialog(win, { title: '选择本机头像', properties: ['openFile'], filters: [{ name: '头像图片', extensions: ['png','jpg','jpeg','webp'] }] });
      if (chosen.canceled || !chosen.filePaths[0]) return;
      const file = chosen.filePaths[0];
      if (fs.statSync(file).size > 8 * 1024 * 1024) throw new Error('请选择小于 8 MB 的头像图片。');
      return avatarData(fs.readFileSync(file));
    });
    handle('archive', id => { requireCurrent(browser, id); store.toggleArchive(id); browser.onUpdate(true); });
    handle('pause', async id => {
      requireCurrent(browser, id); store.get(id);
      const name = browser.state().accounts.find(a => a.id === id).displayName;
      browser.setOverlay(true);
      try {
      const result = await dialog.showMessageBox(win, { type: 'warning', message: `关闭「${name}」的网页？`,
        detail: '该账号的网页会关闭，正在运行的任务和未保存的编辑可能中断。登录资料会保留。', buttons: ['继续运行', '关闭网页'], defaultId: 0, cancelId: 0 });
      if (result.response === 1) { requireCurrent(browser, id); await browser.pause(id); }
      } finally { browser.setOverlay(false); }
    });
    handle('clear-account-data', async id => {
      requireCurrent(browser, id); browser.assertAvailable(browser.entries.get(id));
      const name = browser.state().accounts.find(a => a.id === id).displayName;
      browser.setOverlay(true);
      try {
        const result = await dialog.showMessageBox(win, { type: 'warning', message: `清除「${name}」的登录资料？`,
          detail: '会关闭这个账号的全部网页，清除此入口的网站登录、缓存及网站本机数据和同步昵称头像。需要重新登录，未保存内容可能丢失。保留入口名称、备注和自定义头像；其他账号、已下载文件和云端内容不受影响。此操作不可撤销。',
          buttons: ['取消', '清除登录资料'], defaultId: 0, cancelId: 0, noLink: true });
        if (result.response === 1) { requireCurrent(browser, id); await browser.clearAccountData(id); }
      } finally { browser.setOverlay(false); }
    });
    async function confirmDeleteAccount(id) {
      store.get(id);
      browser.assertAvailable(browser.entries.get(id));
      const account = browser.state().accounts.find(a => a.id === id);
      const number = store.accounts.findIndex(a => a.id === id) + 1;
      browser.setOverlay(true);
      try {
        const result = await dialog.showMessageBox(win, { type: 'warning', message: `删除「${account.displayName}」账号入口？`,
          detail: `账号编号 ${number}。会关闭该入口的全部网页，清除它在本机的网站登录和网站数据，并从账号列表移除。以后添加需要重新登录。不会注销扣子网站账号，也不影响其他入口、已下载文件或云端内容。未保存内容可能丢失，此操作不可撤销。`,
          buttons: ['取消', '删除账号并清除登录资料'], defaultId: 0, cancelId: 0, noLink: true });
        if (result.response === 1) await browser.deleteAccount(id);
      } finally { browser.setOverlay(false); }
    }
    handle('delete-account', id => {
      requireCurrent(browser, id);
      return confirmDeleteAccount(id);
    });
    let accountMenuOpen = false;
    handle('account-menu', async ({ id, x, y, showArchived } = {}) => {
      if (accountMenuOpen) return;
      store.get(id);
      browser.assertAvailable(browser.entries.get(id));
      const neighbors = store.sidebarNeighbors(id, showArchived === true, browser.selected);
      const [width, height] = win.getContentSize();
      const coordinate = (value, max) => Number.isFinite(value) ? Math.max(0, Math.min(max - 1, Math.round(value))) : 0;
      accountMenuOpen = true;
      let action;
      try {
        action = await new Promise(resolve => {
          const menu = Menu.buildFromTemplate([
            { label: '上移一位', enabled: Boolean(neighbors.up), click: () => resolve('up') },
            { label: '下移一位', enabled: Boolean(neighbors.down), click: () => resolve('down') },
            { type: 'separator' },
            { label: '删除账号…', click: () => resolve('delete') }
          ]);
          menu.popup({ window: win, x: coordinate(x, width), y: coordinate(y, height),
            callback: () => setImmediate(resolve) });
        });
      } finally { accountMenuOpen = false; }
      if (!action || quitInProgress || browser.overlay) return;
      if (action === 'delete') return confirmDeleteAccount(id);
      store.moveSidebarAccount(id, action, showArchived === true, browser.selected);
      browser.onUpdate(true);
    });
    handle('navigation', action => { if (!['back','forward','reload','home','zoom-in','zoom-out','zoom-reset'].includes(action)) throw new Error('无效操作。'); browser.navigate(action); });
    handle('tab', id => browser.switchTab(id));
    handle('close-tab', () => browser.closeTab());
    handle('overlay', value => { if (typeof value !== 'boolean') throw new Error('无效操作。'); browser.setOverlay(value); });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: app.name, submenu: [{ role: 'about', label: '关于扣子账号浏览器' }, { type: 'separator' }, { role: 'hide', label: '隐藏' }, { role: 'quit', label: '退出' }] },
      { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: '网页', submenu: [{ label: '后退', accelerator: 'CmdOrCtrl+[', click: () => browser.navigate('back') },
        { label: '前进', accelerator: 'CmdOrCtrl+]', click: () => browser.navigate('forward') },
        { label: '当前平台首页', click: () => browser.navigate('home') },
        { label: '刷新当前网页', accelerator: 'CmdOrCtrl+R', click: () => browser.navigate('reload') },
        { label: '放大', accelerator: 'CmdOrCtrl+=', click: () => browser.navigate('zoom-in') }, { label: '缩小', accelerator: 'CmdOrCtrl+-', click: () => browser.navigate('zoom-out') },
        { label: '原始大小', accelerator: 'CmdOrCtrl+0', click: () => browser.navigate('zoom-reset') }, { role: 'togglefullscreen', label: '全屏' }] },
      { label: '窗口', submenu: [{ role: 'minimize', label: '最小化' }, { role: 'front', label: '前置窗口' }] },
      { role: 'help', label: '帮助', submenu: [{ label: '使用帮助与视频教程', accelerator: 'CmdOrCtrl+Shift+H',
        click: () => { if (!browser.overlay) win.webContents.send('coze:show-help'); } }] }
    ]));
    await win.loadURL(shellURL);
    if (!testing) browser.openStartupAccounts();
    if (!process.argv.includes('--no-control')) control = await startControl({browser,store,win,version:app.getVersion(),isBusy:() => quitInProgress});
    if (testing) {
      try { await require(process.argv.includes('--background-check') ? '../test/background-test.cjs' : '../test/browser-test.cjs').run({ app, win, browser, store, root }); await control?.close(); await browser.dispose(); app.exit(0); }
      catch (err) { console.error('BROWSER_TEST_FAILED', err?.stack || String(err)); await control?.close(); await browser.dispose(); app.exit(1); }
    } else {
      app.on('before-quit', event => {
        if (quitting) return;
        event.preventDefault(); if (quitInProgress) return; quitInProgress = true;
        (async () => {
          // Ordinary quit flushes sessions and closes pages without an extra confirmation.
          let failed = false;
          try { await deadline(control?.close(), 2000, 'CONTROL_TIMEOUT', '控制通道关闭未确认。'); } catch { failed = true; }
          try { await browser.dispose(); } catch { failed = true; }
          if (failed) {
            try { fs.writeFileSync(warningFile, JSON.stringify({ saved: 'unconfirmed', at: Date.now() }) + '\n', { mode: 0o600 }); } catch { /* Exit must remain bounded even if the warning cannot be saved. */ }
            console.error('COZE_SHUTDOWN_UNCONFIRMED'); app.exit(1); return;
          }
          fs.rmSync(warningFile, { force: true }); quitting = true; app.quit();
        })().catch(() => { console.error('COZE_SHUTDOWN_UNCONFIRMED'); app.exit(1); });
      });
    }
  }).catch(err => { dialog.showErrorBox('启动失败', err.message); app.exit(1); });
}
