'use strict';
const assert = require('node:assert/strict');
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
  }
  try {
    const original = store.accounts[0];
    for (const a of store.accounts.slice(1)) store.toggleArchive(a.id);
    const accounts = [original];
    for (const [id, info] of Object.entries(platforms)) {
      if (id !== 'coze') accounts.push(store.add(info.label + ' 合成账号', '', false, id));
    }
    accounts.push(store.add('豆包第二个合成账号', '', false, 'doubao'));
    for (const [index, a] of accounts.entries()) {
      const entry = browser.entry(a.id);
      await entry.session.cookies.set({url: platforms[a.platform || 'coze'].home, name: 'fixture', value: String(index), secure: true, path: '/'});
      await entry.session.protocol.handle('https', () => new Response(
        `<!doctype html><title>Platform fixture ${index}</title><p>Anonymous platform fixture</p>`,
        { headers: { 'Content-Type': 'text/html' } }));
    }
    browser.openStartupAccounts();
    for (const [index, a] of accounts.entries()) {
      const wc = browser.entries.get(a.id).tabs[0].view.webContents;
      const home = platforms[a.platform || 'coze'].home;
      await until(() => !wc.isLoading() && wc.getURL() === home, 'platform home did not load: ' + home);
      assert.equal(await wc.executeJavaScript('document.cookie'), 'fixture=' + index);
      assert.equal(await wc.executeJavaScript('typeof window.coze'), 'undefined');
    }
    console.log('PASS all five platform homes, separate sessions and no privileged bridge in remote pages');
    await until(async () => (await rowIDs()).length === accounts.length, 'combined accounts');
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
    assert.equal(await shell('document.querySelector("#profile-name-field").hidden'), true);
    await shell('document.querySelector("#cancel").click(); null');
    await until(() => !browser.overlay, 'new account editor dismissed');
    console.log('PASS menu filters each platform, combined view restores, selection/sessions retained, CLI rejects cross-platform URL');
  } finally {
    Menu.prototype.popup = originalPopup;
  }
};
