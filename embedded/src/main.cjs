'use strict';
const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { Store } = require('./store.cjs');
const { AccountBrowser } = require('./browser.cjs');
const { avatarData } = require('./identity.cjs');
const { startControl } = require('./control.cjs');
const testing = process.argv.includes('--self-test');
const rootIndex = process.argv.indexOf('--data-root');
const root = rootIndex >= 0 ? path.resolve(process.argv[rootIndex + 1]) : testing ? fs.mkdtempSync(path.join(os.tmpdir(), 'coze-browser-test-')) :
  path.join(app.getPath('appData'), 'CozeAccountsBrowser');
app.setName('扣子账号浏览器');
app.setPath('userData', root);
if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  let win, browser, control, quitting = false, quitInProgress = false;
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.whenReady().then(async () => {
    // HTTP User-Agent is a byte header; the Chinese app display name must not
    // leak into it (session.fetch/custom protocol headers reject non-ASCII).
    app.userAgentFallback = app.userAgentFallback.replaceAll('扣子账号浏览器', 'CozeAccountsBrowser');
    app.setAboutPanelOptions({ applicationName: '扣子账号浏览器', applicationVersion: app.getVersion(),
      iconPath: path.join(__dirname, '../assets/coze-multi-account.png'),
      copyright: '非官方辅助工具 · 一个窗口，多个独立账号' });
    const store = new Store(root, testing || rootIndex >= 0 ? null : path.join(app.getPath('appData'), 'CozeAccounts', 'accounts.json'));
    win = new BrowserWindow({ width: 1280, height: 840, minWidth: 960, minHeight: 650,
      title: '扣子账号浏览器', titleBarStyle: 'hiddenInset', backgroundColor: '#f6f7fb',
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    browser = new AccountBrowser(win, store);
    browser.shortcuts(win.webContents);
    const shellURL = pathToFileURL(path.join(__dirname, '../ui/index.html')).href;
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    browser.onUpdate = () => { if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('coze:update', browser.state()); };
    const handle = (name, fn) => ipcMain.handle(`coze:${name}`, async (event, payload) => {
      if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== shellURL) throw new Error('不允许访问。');
      try {
        if (browser.overlay && ['select','open-all','sidebar','archive','pause','navigation','tab','close-tab','sync-profile'].includes(name)) throw new Error('请先关闭帮助，或保存/取消账号编辑。');
        return { ok: true, value: await fn(payload) };
      } catch (err) { return { ok: false, error: err.message || '操作未完成。' }; }
    });
    handle('state', () => browser.state());
    handle('sidebar', value => browser.setSidebarCollapsed(value));
    handle('select', id => { store.get(id); browser.select(id); });
    handle('open-all', () => browser.openAll());
    handle('add', data => { const a = store.add(data?.name, data?.note, data?.useProfileName); browser.select(a.id); });
    handle('edit', data => { store.edit(data?.id, data?.name, data?.note, data?.useProfileName, data?.avatarMode, data?.customAvatar); browser.onUpdate(); });
    handle('sync-profile', async id => { await browser.syncProfile(id, true); });
    handle('choose-avatar', async id => {
      store.get(id);
      const chosen = await dialog.showOpenDialog(win, { title: '选择本机头像', properties: ['openFile'], filters: [{ name: '头像图片', extensions: ['png','jpg','jpeg','webp'] }] });
      if (chosen.canceled || !chosen.filePaths[0]) return;
      const file = chosen.filePaths[0];
      if (fs.statSync(file).size > 8 * 1024 * 1024) throw new Error('请选择小于 8 MB 的头像图片。');
      return avatarData(fs.readFileSync(file));
    });
    handle('archive', id => { store.toggleArchive(id); browser.onUpdate(); });
    handle('pause', async id => {
      store.get(id);
      const result = await dialog.showMessageBox(win, { type: 'warning', message: `暂停「${store.get(id).name}」？`,
        detail: '该账号的网页会关闭，正在运行的任务和未保存的编辑可能中断。登录资料会保留。', buttons: ['继续运行', '暂停网页'], defaultId: 0, cancelId: 0 });
      if (result.response === 1) await browser.pause(id);
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
        { label: '扣子首页', click: () => browser.navigate('home') },
        { label: '刷新当前网页', accelerator: 'CmdOrCtrl+R', click: () => browser.navigate('reload') },
        { label: '放大', accelerator: 'CmdOrCtrl+=', click: () => browser.navigate('zoom-in') }, { label: '缩小', accelerator: 'CmdOrCtrl+-', click: () => browser.navigate('zoom-out') },
        { label: '原始大小', accelerator: 'CmdOrCtrl+0', click: () => browser.navigate('zoom-reset') }, { role: 'togglefullscreen', label: '全屏' }] },
      { label: '窗口', submenu: [{ role: 'minimize', label: '最小化' }, { role: 'front', label: '前置窗口' }] },
      { role: 'help', label: '帮助', submenu: [{ label: '使用帮助与视频教程', accelerator: 'CmdOrCtrl+Shift+H',
        click: () => { if (!browser.overlay) win.webContents.send('coze:show-help'); } }] }
    ]));
    await win.loadURL(shellURL);
    if (!testing) { const first = store.accounts.find(a => !a.archived); if (first) browser.select(first.id); }
    if (!process.argv.includes('--no-control')) control = await startControl({browser,store,win,version:app.getVersion(),isBusy:() => quitInProgress});
    if (testing) {
      try { await require('../test/browser-test.cjs').run({ app, win, browser, store, root }); await control?.close(); await browser.dispose(); app.exit(0); }
      catch (err) { console.error('BROWSER_TEST_FAILED', err?.stack || String(err)); await control?.close(); await browser.dispose(); app.exit(1); }
    } else {
      win.on('close', event => { if (!quitting) { event.preventDefault(); app.quit(); } });
      app.on('before-quit', event => {
        if (quitting) return;
        event.preventDefault(); if (quitInProgress) return; quitInProgress = true;
        (async () => {
          // Ordinary quit flushes sessions and closes pages without an extra confirmation.
          await control?.close(); await browser.dispose(); quitting = true; app.quit();
        })().catch(() => { quitting = true; app.quit(); });
      });
      app.on('activate', () => { if (win && !win.isDestroyed()) { win.show(); win.focus(); } });
    }
  }).catch(err => { dialog.showErrorBox('启动失败', err.message); app.exit(1); });
}
