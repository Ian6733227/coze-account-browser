'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Menu } = require('electron');
const { platforms } = require('../src/platforms.cjs');
const { Store } = require('../src/store.cjs');
const { request } = require('../src/control-transport.cjs');

async function until(predicate, description) {
  for (let i = 0; i < 150; i++) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(description);
}

exports.run = async ({ win, browser, store, root }) => {
  const shell = script => win.webContents.executeJavaScript(script);
  const rowIDs = () => shell('Array.from(document.querySelectorAll(".account"), row => row.dataset.accountId)');
  const checkIcon = async id => {
    await until(() => shell(`(() => {
      const icon = document.querySelector('#platform-icon');
      return icon.getAttribute('src') === 'platform-icons/${id}.png' &&
        icon.complete && icon.naturalWidth === 72 && icon.getBoundingClientRect().width === 24;
    })()`), 'platform icon: ' + id);
  };
  const originalPopup = Menu.prototype.popup;
  let menuChoice;
  Menu.prototype.popup = function () {
    const item = this.items.find(item => item.label === menuChoice);
    assert.ok(item, 'platform menu item missing: ' + menuChoice);
    item.click();
  };
  async function view(id) {
    menuChoice = id === 'all' ? '全部平台' : platforms[id].label;
    await shell('document.querySelector("#platform-switch").click(); null');
    await until(() => store.platformView === id, 'platform switch');
    await checkIcon(id);
  }
  try {
    const original = store.accounts[0];
    for (const a of store.accounts.slice(1)) store.toggleArchive(a.id);
    const accounts = [original];
    for (const [id, info] of Object.entries(platforms)) {
      if (id !== 'coze') accounts.push(store.add(info.label + ' 合成账号', '', false, id));
    }
    accounts.push(store.add('豆包第二个合成账号', '', false, 'doubao'));
    const avatar = fs.readFileSync(path.join(__dirname, '../ui/platform-icons/all.png'));
    const identity = index => '平台测试昵称 ' + index;
    for (const [index, a] of accounts.entries()) {
      const entry = browser.entry(a.id);
      const platform = a.platform || 'coze';
      const home = platforms[platform].home;
      const avatarURL = new URL('/fixture-avatar.png', home).href;
      const name = identity(index);
      const img = `<img src="${avatarURL}" alt="${name}">`;
      const markup = {
        coze: '',
        doubao: `<img data-testid="chat_header_avatar_button" src="${avatarURL}"><span>${name}</span>`,
        aily: `<button data-testid="sidebar_footer_user_menu_trigger">${img}<span class="truncate">${name}</span></button>`,
        workbuddy: `<button class="user-menu-trigger" data-track-id="user_avatar_menu"><span class="user-menu-trigger-avatar">${img}</span><span class="user-menu-trigger-name">${name}</span></button>`,
        qwenwork: `<script>sessionStorage.setItem('qwen-work.auth-identity.v1',JSON.stringify({version:1,cachedAt:Date.now(),userId:'synthetic',displayName:${JSON.stringify(name)},avatarUrl:${JSON.stringify(avatarURL)}}))</script>`
      }[platform];
      await entry.session.cookies.set({url: home, name: 'fixture', value: String(index), secure: true, path: '/'});
      await entry.session.protocol.handle('https', req => {
        if (new URL(req.url).pathname === '/fixture-avatar.png') return new Response(avatar, { headers: { 'Content-Type': 'image/png' } });
        if (new URL(req.url).pathname === '/passport/account/info/v2/') return new Response(JSON.stringify(
          {message:'success',data:{user_id_str:'synthetic',name,avatar_url:avatarURL}}),
          {headers:{'Content-Type':'application/json'}});
        return new Response(`<!doctype html><meta charset=utf-8><title>Platform fixture ${index}</title>${markup}`, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      });
    }
    browser.openStartupAccounts();
    for (const [index, a] of accounts.entries()) {
      const wc = browser.entries.get(a.id).tabs[0].view.webContents;
      const home = platforms[a.platform || 'coze'].home;
      await until(() => !wc.isLoading() && wc.getURL() === home, 'platform home did not load: ' + home);
      assert.equal(await wc.executeJavaScript('document.cookie'), 'fixture=' + index);
      assert.equal(await wc.executeJavaScript('typeof window.coze'), 'undefined');
    }
    await until(() => accounts.every((account, index) => {
      const profile = store.get(account.id).profile;
      return profile.name === identity(index) && profile.avatar.startsWith('data:image/png;base64,');
    }), 'automatic nicknames and avatars across five platforms');
    const custom = accounts.at(-1);
    assert.equal(browser.state().accounts.find(a => a.id === custom.id).displayName, custom.name);
    store.edit(custom.id, custom.name, '', false, 'custom', 'data:image/png;base64,' + avatar.toString('base64'));
    await browser.syncProfile(custom.id, true);
    assert.equal(browser.state().accounts.find(a => a.id === custom.id).displayAvatar, store.get(custom.id).customAvatar);
    console.log('PASS automatic profile name and avatar for five platforms and independent custom overrides');
    console.log('PASS all five platform homes, separate sessions and no privileged bridge in remote pages');
    await until(async () => (await rowIDs()).length === accounts.length, 'combined accounts');
    await checkIcon('all');
    const current = browser.entries.get(original.id).tabs[0].view.webContents.id;
    for (const [id] of Object.entries(platforms)) {
      await view(id);
      const expected = accounts.filter(a => (a.platform || 'coze') === id).map(a => a.id);
      await until(async () => JSON.stringify(await rowIDs()) === JSON.stringify(expected), 'platform filter: ' + id);
      assert.ok(expected.includes(browser.selected));
      assert.equal(browser.entries.get(original.id).tabs[0].view.webContents.id, current);
      assert.equal(new Store(root).platformView, id);
      assert.equal(win.contentView.children.filter(view => view.getVisible()).length, 1);
    }
    await view('all');
    await until(async () => (await rowIDs()).length === accounts.length, 'restore combined accounts');
    await view('coze');
    const qwen = accounts.find(a => a.platform === 'qwenwork');
    const rejected = await request(root, 'open', { account: qwen.id, url: platforms.doubao.home });
    assert.equal(rejected.error.code, 'INVALID_URL');
    const switched = await request(root, 'switch', { account: qwen.id });
    assert.equal(switched.ok, true);
    assert.equal(switched.result.accounts.find(a => a.id === qwen.id).platform, 'qwenwork');
    assert.equal(store.platformView, 'qwenwork');
    assert.equal(new Store(root).sessionPath(original.id), store.sessionPath(original.id));
    await shell('document.querySelector("#add").click(); null');
    await until(() => shell('document.querySelector("#editor").open'), 'new account editor');
    assert.equal(await shell('document.querySelector("#account-platform").value'), 'qwenwork');
    assert.equal(await shell('document.querySelector("#account-platform").options.length'), 5);
    assert.equal(await shell('document.querySelector("#profile-name").checked'), true);
    await shell('document.querySelector("#cancel").click(); null');
    await until(() => !browser.overlay, 'new account editor dismissed');
    browser.setSidebarCollapsed(true);
    await checkIcon('qwenwork');
    assert.equal(await shell('document.querySelector("#platform-switch").getBoundingClientRect().width > 0'), true);
    console.log('PASS six platform icons decode locally and the compact switch stays visible');
    if (process.env.COZE_PLATFORM_LOGO_PREVIEW) {
      await view('doubao');
      const clip = { x: 0, y: 40, width: 232, height: 116 };
      browser.setSidebarCollapsed(false);
      await shell('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      require('node:fs').writeFileSync(process.env.COZE_PLATFORM_LOGO_PREVIEW, (await win.webContents.capturePage(clip)).toPNG());
    }
    console.log('PASS menu filters each platform, combined view restores, selection/sessions retained, CLI rejects cross-platform URL');
  } finally {
    Menu.prototype.popup = originalPopup;
  }
};
