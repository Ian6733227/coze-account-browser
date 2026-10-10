'use strict';
const assert = require('node:assert/strict'), http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { BrowserWindow, nativeImage } = require('electron');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const execute = promisify(execFile);
const { TOP, LEFT, COMPACT_LEFT, FOOT, safeURL } = require('../src/browser.cjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) {
  const end = Date.now() + 15000;
  while (Date.now() < end) { if (await fn()) return; await sleep(50); }
  throw new Error(`Timed out: ${label}`);
}
async function ready(wc) { await until(() => !wc.isLoading() && wc.getURL().startsWith('http:'), 'local page load'); }
async function probe(wc) { return wc.executeJavaScript('({cookie:document.cookie,stored:localStorage.getItem("identity"),node:typeof require,bridge:typeof window.coze})'); }
exports.run = async ({ win, browser, store, root }) => {
  const cli = async (...args) => {
    const env={...process.env,ELECTRON_RUN_AS_NODE:'1'};
    if (path.basename(process.execPath)==='CozeAccountBrowser') env.COZE_BROWSER_APP=path.resolve(path.dirname(process.execPath),'../..');
    const {stdout}=await execute(process.execPath,[path.join(__dirname,'../src/cli.cjs'),...args,'--data-root',root],{env,timeout:15000,maxBuffer:1024*1024});
    const reply=JSON.parse(stdout);assert.equal(reply.ok,true);return reply.result;
  };
  const planFile = path.join(root, 'synthetic-plan.json');
  const plan = fs.existsSync(planFile) ? JSON.parse(fs.readFileSync(planFile)) : null;
  const server = http.createServer((req, res) => {
    if (req.url === '/failure') { req.socket.destroy(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><title>Synthetic ${req.url === '/popup' ? 'Popup' : 'Account'}</title></head><body><h1>本机测试网页</h1><p>合成账号，没有真实登录资料</p><script>window.popupMessage='';addEventListener('message',e=>{if(e.origin===location.origin)window.popupMessage=e.data});if(location.pathname==='/popup'&&window.opener)window.opener.postMessage('popup-ok',location.origin);</script></body></html>`);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(plan?.port || 0, '127.0.0.1', resolve); });
  const port = server.address().port; browser.home = `http://127.0.0.1:${port}/`;
  try {
    if (plan) {
      browser.openAll(); assert.equal(store.accounts.filter(a => !a.archived).length, 6);
      assert.equal(store.sidebarCollapsed, true); assert.equal(browser.attached.getBounds().x, COMPACT_LEFT);
      await until(async () => await win.webContents.executeJavaScript('document.body.classList.contains("sidebar-collapsed")'), 'compact sidebar survives restart');
      for (const [index, account] of store.accounts.filter(a => !a.archived).entries()) {
        const wc = browser.entries.get(account.id).tabs[0].view.webContents; await ready(wc);
        const data = await probe(wc); assert.equal(data.cookie, `identity=synthetic-${index}`); assert.equal(data.stored, `synthetic-${index}`);
      }
      assert.equal(BrowserWindow.getAllWindows().length, 1); console.log('PASS six isolated sessions survive full application restart');
      for (const [index, a] of store.accounts.filter(a => !a.archived).entries()) {
        assert.equal(a.profile.name, `测试昵称 ${index + 1}`); assert.ok(a.profile.avatar.startsWith('data:image/png;base64,'));
      }
      console.log('PASS six per-account synced avatars and nicknames survive restart');
      assert.equal((await cli('status')).sidebarCollapsed,true);
      assert.equal((await cli('switch','6')).selected,store.accounts[5].id);
      console.log('PASS independent CLI reconnects and switches after application restart');
      return;
    }
    store.add('扣子账号 6'); browser.openAll(); const identities = [];
    for (const [index, account] of store.accounts.entries()) {
      const entry = browser.entries.get(account.id), wc = entry.tabs[0].view.webContents; await ready(wc);
      const before = await probe(wc); assert.equal(before.cookie, ''); assert.equal(before.stored, null); assert.equal(before.node, 'undefined'); assert.equal(before.bridge, 'undefined');
      await wc.executeJavaScript(`document.cookie='identity=synthetic-${index}; Max-Age=86400; SameSite=Lax';localStorage.setItem('identity','synthetic-${index}')`);
      identities.push(wc.id);
    }
    console.log('PASS six simultaneously loaded sessions isolate cookies and localStorage; no Node or desktop bridge in remote pages');
    for (const [index, account] of store.accounts.entries()) {
      browser.select(account.id); assert.equal(win.contentView.children.filter(v => v.getVisible()).length, 1); assert.equal(browser.activeTab().view.webContents.id, identities[index]);
      const data = await probe(browser.activeTab().view.webContents); assert.equal(data.stored, `synthetic-${index}`); assert.equal(data.cookie, `identity=synthetic-${index}`);
    }
    assert.equal(BrowserWindow.getAllWindows().length, 1); console.log('PASS switching keeps all six renderer identities and only one visible view/window');
    // Genuine local navigation failure must not look healthy in the sidebar or CLI.
    const failedTab = browser.activeTab();
    await failedTab.view.webContents.loadURL(browser.home + 'failure').catch(() => {});
    await until(() => Boolean(browser.state().accounts.find(a => a.id === browser.selected).pageError), 'per-account navigation error');
    await until(async () => await win.webContents.executeJavaScript(`document.querySelector('.account.active .dot').classList.contains('error') && document.querySelector('#status').textContent.includes('加载失败')`), 'red failed page status');
    assert.ok((await cli('status')).accounts.find(a => a.selected).error);
    await failedTab.view.webContents.loadURL(browser.home);
    await until(() => !browser.state().accounts.find(a => a.id === browser.selected).pageError, 'navigation error clears after recovery');
    console.log('PASS real local page failure is red in sidebar/header and returned by CLI; recovery clears it');
    // Editing owns a fixed account target; shell shortcuts and page menu actions stay blocked.
    const editorAccount = store.accounts[1]; browser.select(editorAccount.id);
    await until(async () => await win.webContents.executeJavaScript(`document.querySelector('#name').textContent === ${JSON.stringify(editorAccount.name)}`), 'editor target rendered');
    await win.webContents.executeJavaScript(`document.querySelector('#edit').click()`);
    await until(() => browser.overlay, 'editor overlay');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: '1', modifiers: ['meta'] });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: '1', modifiers: ['meta'] });
    await sleep(100); assert.equal(browser.selected, editorAccount.id);
    const editorURL = browser.activeTab().view.webContents.getURL(); browser.navigate('home');
    assert.equal(browser.activeTab().view.webContents.getURL(), editorURL);
    await win.webContents.executeJavaScript(`document.querySelector('#account-name').value='编辑目标 B';document.querySelector('#profile-name').checked=false;document.querySelector('#form').requestSubmit()`);
    await until(() => !browser.overlay, 'editor save');
    assert.equal(store.get(editorAccount.id).name, '编辑目标 B'); assert.equal(store.accounts[0].name, '扣子账号 1');
    store.edit(editorAccount.id, editorAccount.name, '', true);
    console.log('PASS editor shortcut lock and save target remain consistent');
    // State updates preserve keyboard focus on account controls and fallback numbers.
    await win.webContents.executeJavaScript(`document.querySelectorAll('#accounts .account')[2].focus()`);
    browser.onUpdate();
    await until(async () => await win.webContents.executeJavaScript(`document.activeElement.dataset.accountId === ${JSON.stringify(store.accounts[2].id)}`), 'account keyboard focus survives update');
    assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('#accounts .account-number').length`), 6);
    console.log('PASS default avatar numbers and focus retained');
    // Help lives in the same native window and restores the existing account renderer.
    const helpAccount = browser.selected, helpRenderer = browser.attached.webContents.id;
    await win.webContents.executeJavaScript(`document.querySelector('#help').click()`);
    await until(() => browser.overlay, 'help overlay');
    await until(async () => await win.webContents.executeJavaScript(`document.querySelector('#help-frame').contentDocument?.querySelector('video')?.readyState >= 1`), 'bundled tutorial metadata');
    assert.equal(await win.webContents.executeJavaScript(`document.querySelector('#help-frame').contentDocument.querySelector('video').duration`), 60);
    assert.equal(win.contentView.children.filter(v => v.getVisible()).length, 0);
    // Help itself has scripts disabled. Inspect it through the trusted shell;
    // never weaken that sandbox simply to inject a test into the help frame.
    assert.equal(await win.webContents.executeJavaScript(`typeof document.querySelector('#help-frame').contentWindow.coze`), 'undefined');
    assert.equal(await win.webContents.executeJavaScript(`typeof document.querySelector('#help-frame').contentWindow.require`), 'undefined');
    await win.webContents.executeJavaScript(`const helpVideo=document.querySelector('#help-frame').contentDocument.querySelector('video');helpVideo.muted=true;helpVideo.play()`);
    await until(async () => await win.webContents.executeJavaScript(`document.querySelector('#help-frame').contentDocument.querySelector('video').currentTime > .2`), 'bundled tutorial playback');
    if (process.env.COZE_BROWSER_EVIDENCE) {
      const evidence = process.env.COZE_BROWSER_EVIDENCE; fs.mkdirSync(evidence,{recursive:true});
      fs.writeFileSync(path.join(evidence,'help-window.png'),(await win.webContents.capturePage()).toPNG());
    }
    await win.webContents.executeJavaScript(`document.querySelector('#help-close').click()`);
    await until(() => !browser.overlay, 'help close');
    assert.equal(browser.selected, helpAccount); assert.equal(browser.attached.webContents.id, helpRenderer);
    await until(async () => await win.webContents.executeJavaScript(`!document.querySelector('#help-frame').getAttribute('src') && !document.querySelector('#help-dialog').open`), 'help unload stops media');
    browser.select(store.accounts[5].id);
    console.log('PASS numbered fallback icons, retained keyboard focus, one-window offline help video and original account restoration');
    win.setContentSize(1080, 720); browser.layout(); assert.deepEqual(browser.attached.getBounds(), { x: LEFT, y: TOP, width: 1080 - LEFT, height: 720 - TOP - FOOT });
    browser.setOverlay(true); assert.equal(win.contentView.children.filter(v => v.getVisible()).length, 0); browser.setOverlay(false); assert.equal(win.contentView.children.filter(v => v.getVisible()).length, 1);
    console.log('PASS resize and native view overlay suppression');
    const entry = browser.entries.get(browser.selected), primary = browser.activeTab();
    await primary.view.webContents.executeJavaScript('void window.open("/popup", "authTest")');
    await until(() => entry.tabs.length === 2 && !entry.tabs[1].view.webContents.isLoading(), 'embedded popup');
    await until(async () => (await primary.view.webContents.executeJavaScript('window.popupMessage')) === 'popup-ok', 'popup opener message');
    assert.equal(BrowserWindow.getAllWindows().length, 1); assert.equal(win.contentView.children.filter(v => v.getVisible()).length, 1);
    assert.equal((await probe(browser.activeTab().view.webContents)).stored, 'synthetic-5');
    await browser.activeTab().view.webContents.executeJavaScript('window.close()');
    await until(() => entry.tabs.length === 1, 'popup close'); assert.equal(browser.activeTab(), primary); assert.equal(win.contentView.children.filter(v => v.getVisible()).length, 1);
    assert.equal(safeURL('file:///etc/passwd'), false); assert.equal(safeURL('javascript:alert(1)'), false);
    await primary.view.webContents.executeJavaScript('void window.open("file:///etc/passwd")'); await sleep(150); assert.equal(entry.tabs.length, 1);
    console.log('PASS authorization popup shares account session/opener and stays in one window; unsafe schemes denied');
    const id = browser.selected, oldID = primary.view.webContents.id; await browser.pause(id); assert.equal(entry.tabs.length, 0); assert.equal(win.contentView.children.filter(v => v.getVisible()).length, 0);
    assert.equal(browser.state().accounts.find(a => a.id === id).paused, true);
    browser.select(id); await ready(browser.activeTab().view.webContents); assert.notEqual(browser.activeTab().view.webContents.id, oldID);
    assert.equal(browser.state().accounts.find(a => a.id === id).paused, false);
    assert.equal((await probe(browser.activeTab().view.webContents)).stored, 'synthetic-5'); assert.equal((await probe(browser.activeTab().view.webContents)).cookie, 'identity=synthetic-5');
    const stablePath = store.sessionPath(id); store.edit(id, '第六个测试账号', '测试'); assert.equal(store.sessionPath(id), stablePath);
    const seventh = store.add('第七个账号'); browser.select(seventh.id); await ready(browser.activeTab().view.webContents); assert.equal((await probe(browser.activeTab().view.webContents)).cookie, '');
    store.toggleArchive(seventh.id); await browser.pause(seventh.id); browser.select(id);
    console.log('PASS pause/resume retains state; rename stable path; seventh account isolated and archive reversible');
    // Synthetic render crash is deliberately induced only in this temporary test profile.
    browser.activeTab().view.webContents.forcefullyCrashRenderer(); await until(() => browser.activeTab().crashed, 'renderer crash');
    browser.navigate('reload'); await ready(browser.activeTab().view.webContents); assert.equal((await probe(browser.activeTab().view.webContents)).stored, 'synthetic-5');
    console.log('PASS crashed renderer reload preserves session');
    const iconBytes = fs.readFileSync(path.join(__dirname, '../assets/coze-official-logo.png'));
    for (const [index, a] of store.accounts.filter(a => !a.archived).entries()) {
      const entry = browser.entries.get(a.id), wc = entry.tabs[0].view.webContents;
      await entry.session.cookies.set({ url: 'https://p3-passport.byteacctimg.com/', name: 'avatar-should-not-be-sent', value: 'synthetic', secure: true });
      await entry.session.protocol.handle('https', request => {
        const url = new URL(request.url);
        if (url.hostname === 'p3-passport.byteacctimg.com') {
          assert.equal(request.headers.get('cookie'), null);
          return new Response(iconBytes, { headers: { 'Content-Type': 'image/png' } });
        }
        if (url.pathname === '/passport/account/info/v2/') return Response.json({ message: 'success', data: {
          user_id_str: `synthetic-${index}`, name: `测试昵称 ${index + 1}`, avatar_url: 'https://p3-passport.byteacctimg.com/avatar.png', session_key: 'synthetic-not-exported'
        } });
        return new Response('<!doctype html><title>Synthetic profile</title><p>本机合成头像同步测试</p>', { headers: { 'Content-Type': 'text/html' } });
      });
      await wc.loadURL('https://www.coze.cn/profile-fixture');
      await until(() => store.get(a.id).profile.name === `测试昵称 ${index + 1}`, 'automatic profile synchronization');
      const picture = nativeImage.createFromDataURL(store.get(a.id).profile.avatar);
      assert.deepEqual(picture.getSize(), { width: 128, height: 128 });
      browser.select(a.id);
      const appearance = browser.state().accounts.find(item => item.id === a.id);
      assert.ok(appearance.displayAvatar.startsWith('data:image/png;base64,'));
    }
    const custom = store.accounts[0], customPicture = store.get(custom.id).profile.avatar;
    store.edit(custom.id, '本机自定义名', '', false, 'custom', customPicture);
    await browser.syncProfile(custom.id, true);
    assert.equal(browser.state().accounts[0].displayName, '本机自定义名'); assert.equal(store.get(custom.id).customAvatar, customPicture);
    assert.equal(fs.readFileSync(store.file,'utf8').includes('synthetic-not-exported'), false);
    browser.select(custom.id); browser.onUpdate();
    await until(async () => await win.webContents.executeJavaScript('document.querySelector("#name").textContent === "本机自定义名"'), 'shell profile rendering');
    assert.equal(await win.webContents.executeJavaScript('document.querySelector(".toolbar") === null && document.querySelector("#tabs").hidden'), true);
    assert.equal(browser.attached.getBounds().y, TOP);
    console.log('PASS six automatic own profiles isolate avatar/name, omit avatar cookies, preserve custom overrides and remove toolbar');
    const anonymous = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'fixtures/site-default-avatar.png')).toString('base64');
    const second = store.accounts[1], third = store.accounts[2];
    store.profile(second.id, '同名测试', anonymous); store.profile(third.id, '同名测试', anonymous);
    browser.onUpdate();
    assert.equal(browser.state().accounts[1].displayAvatar, '');
    store.edit(second.id, second.name, '', true, 'custom', anonymous);
    assert.equal(browser.state().accounts[1].displayAvatar, anonymous);
    store.edit(second.id, second.name, '', true, 'sync', '');
    await until(async () => await win.webContents.executeJavaScript('document.querySelectorAll(".account-number").length === 2'), 'same-name icon badges');
    const retainedView = browser.attached.webContents.id;
    await win.webContents.executeJavaScript('document.querySelector("#sidebar-toggle").click()');
    await until(() => store.sidebarCollapsed && browser.attached.getBounds().x === COMPACT_LEFT, 'collapse relocates native page');
    const compact = await win.webContents.executeJavaScript(`({aside:document.querySelector('aside').getBoundingClientRect().width,main:document.querySelector('main').getBoundingClientRect().left,hidden:getComputedStyle(document.querySelector('.account-details')).display,label:document.querySelector('.account').getAttribute('aria-label'),expand:document.querySelector('#sidebar-toggle').getAttribute('aria-expanded')})`);
    assert.equal(compact.aside, COMPACT_LEFT); assert.equal(compact.main, COMPACT_LEFT); assert.equal(compact.hidden, 'none'); assert.ok(compact.label.includes('账号 1')); assert.equal(compact.expand, 'false');
    assert.equal(browser.attached.webContents.id, retainedView);
    if (process.env.COZE_BROWSER_EVIDENCE) fs.writeFileSync(path.join(process.env.COZE_BROWSER_EVIDENCE,'compact-sidebar.png'),(await win.webContents.capturePage()).toPNG());
    const cookieBefore = (await probe(browser.entries.get(second.id).tabs[0].view.webContents)).cookie;
    browser.select(second.id); assert.equal(browser.attached.getBounds().x, COMPACT_LEFT);
    assert.equal((await probe(browser.activeTab().view.webContents)).cookie, cookieBefore);
    await win.webContents.executeJavaScript('document.querySelector("#sidebar-toggle").click()');
    await until(() => !store.sidebarCollapsed && browser.attached.getBounds().x === LEFT, 'expand restores native page');
    await until(async () => await win.webContents.executeJavaScript('document.querySelector("aside").getBoundingClientRect().width === 232'), 'expanded shell bounds');
    browser.setSidebarCollapsed(true);
    // Restore fixture identities expected by the second process.
    store.profile(second.id, '测试昵称 2', customPicture); store.profile(third.id, '测试昵称 3', customPicture);
    console.log('PASS compact sidebar CSS/native bounds, accessible icons, duplicate badges, custom default image override and live session preservation');
    const listed=await cli('accounts');assert.equal(listed.accounts.length,7);assert.equal(listed.accounts[6].archived,true);
    const originalViews=store.accounts.slice(0,6).map(a=>browser.entries.get(a.id).tabs[0].view.webContents.id);
    for(let index=0;index<6;index++) {
      const reply=await cli('switch',String(index+1));assert.equal(reply.selected,store.accounts[index].id);
      assert.equal(win.contentView.children.filter(view=>view.getVisible()).length,1);
    }
    assert.deepEqual(store.accounts.slice(0,6).map(a=>browser.entries.get(a.id).tabs[0].view.webContents.id),originalViews);
    const target=store.accounts[2],targetEntry=browser.entries.get(target.id);
    await targetEntry.session.cookies.set({url:'https://www.coze.cn/',name:'cli-identity',value:'synthetic-third',secure:true});
    const opened=await cli('open','https://www.coze.cn/session/900','--account','3');
    assert.equal(opened.accountId,target.id);assert.equal(opened.effect,'navigation_started');assert.equal(targetEntry.tabs.length,2);
    const newContents=browser.activeTab().view.webContents;
    await until(()=>!newContents.isLoading() && newContents.getURL()==='https://www.coze.cn/session/900','CLI requested page');
    assert.equal((await probe(newContents)).cookie,'cli-identity=synthetic-third');
    assert.equal((await probe(newContents)).bridge,'undefined');
    assert.equal(browser.attached.getBounds().y,TOP+33);
    const reused=await cli('open','https://www.coze.cn/session/900','--account','3');assert.equal(reused.effect,'existing_page_selected');assert.equal(targetEntry.tabs.length,2);
    const changedRoot=await cli('open','https://www.coze.cn/project/901?view=synthetic','--account','3');assert.equal(changedRoot.accountId,target.id);
    await until(()=>!browser.activeTab().view.webContents.isLoading(),'second CLI page');
    const queried=await cli('status');assert.equal(queried.pages.find(page=>page.active).location,'https://www.coze.cn/project/901');assert.equal(JSON.stringify(queried).includes('view=synthetic'),false);
    await cli('sidebar','expand');assert.equal(browser.attached.getBounds().x,LEFT);await cli('sidebar','collapse');assert.equal(browser.attached.getBounds().x,COMPACT_LEFT);
    browser.setOverlay(true);
    const busy=await execute(process.execPath,[path.join(__dirname,'../src/cli.cjs'),'switch','1','--data-root',root],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}}).catch(error=>error);
    assert.equal(busy.code,1);assert.equal(JSON.parse(busy.stdout).error.code,'UI_BUSY');browser.setOverlay(false);
    assert.deepEqual(store.accounts.slice(0,6).map(a=>browser.entries.get(a.id).tabs[0].view.webContents.id),originalViews);
    assert.equal(BrowserWindow.getAllWindows().length,1);
    console.log('PASS independent CLI switches six accounts, opens/deduplicates own-session pages, filters metadata, handles editor busy and adjusts compact bounds without Computer Use');
    if(path.basename(process.execPath)==='CozeAccountBrowser') {
      assert.equal((await cli('launch')).version,require('../package.json').version);
      assert.equal(BrowserWindow.getAllWindows().length,1);
      console.log('PASS packaged launch reconnects to existing isolated instance without duplicate window');
    }
    fs.writeFileSync(planFile, JSON.stringify({ port }));
  } finally { await new Promise(resolve => server.close(resolve)); }
};
