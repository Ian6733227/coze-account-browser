'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { BrowserWindow } = require('electron');
const { request } = require('../src/control-transport.cjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
exports.run = async ({ win, browser, store, root }) => {
  const duration = 60 * 60 * 1000;
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>匿名后台运行验证</title><h1>六个匿名网页持续运行</h1><script>window.ticks=0;setInterval(()=>window.ticks++,1000)</script>');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  browser.home = `http://127.0.0.1:${server.address().port}/`;
  try {
    store.add('第六个匿名后台测试'); browser.openAll();
    const ids = [];
    for (const [index, account] of store.accounts.entries()) {
      browser.select(account.id); const wc = browser.activeTab().view.webContents;
      const deadline = performance.now() + 15000;
      while (wc.isLoading() || wc.getURL() !== browser.home) {
        assert.ok(performance.now() < deadline, 'Anonymous page load timeout'); await sleep(50);
      }
      await wc.executeJavaScript(`localStorage.setItem('identity','anonymous-${index}');document.cookie='identity=anonymous-${index}; SameSite=Lax'`);
      ids.push(wc.id);
    }
    for (let index = 0; index < 30; index++) {
      const reply = await request(root, 'switch', { account: String(index % 6 + 1) });
      assert.equal(reply.ok, true); assert.equal(reply.result.selected, store.accounts[index % 6].id);
    }
    const started = performance.now(), checkpoints = [];
    console.log('START 60-minute signed-package synthetic background check; six isolated renderers, 30 IPC switches');
    while (performance.now() - started < duration) {
      await sleep(Math.min(60000, duration - (performance.now() - started)));
      const elapsed = performance.now() - started, ticks = [];
      for (const [index, account] of store.accounts.entries()) {
        const wc = browser.entries.get(account.id).tabs[0].view.webContents;
        assert.equal(wc.id, ids[index]); assert.equal(wc.isDestroyed(), false);
        const data = await wc.executeJavaScript('({ticks:window.ticks,identity:localStorage.getItem("identity"),cookie:document.cookie,node:typeof require,bridge:typeof window.coze})');
        assert.equal(data.identity, `anonymous-${index}`); assert.equal(data.cookie, `identity=anonymous-${index}`);
        assert.equal(data.node, 'undefined'); assert.equal(data.bridge, 'undefined');
        assert.ok(data.ticks >= Math.floor(elapsed / 1000 * .7), 'Background timer stalled'); ticks.push(data.ticks);
      }
      assert.equal(BrowserWindow.getAllWindows().length, 1);
      assert.equal(win.contentView.children.filter(view => view.getVisible()).length, 1);
      const status = await request(root, 'status'); assert.equal(status.ok, true);
      assert.equal(status.result.accounts.filter(a => a.running && !a.crashed && !a.error).length, 6);
      const record = { elapsed_ms: Math.round(elapsed), ticks, running: 6 };
      checkpoints.push(record);
      if (process.env.COZE_BROWSER_EVIDENCE) fs.writeFileSync(path.join(process.env.COZE_BROWSER_EVIDENCE, 'background-checkpoints.json'), JSON.stringify({ version: require('../package.json').version, status: elapsed >= duration ? 'passed' : 'running', checkpoints }, null, 2));
      console.log(`CHECK ${Math.floor(elapsed / 60000)} minutes: all six identities/timers/renderers intact`);
    }
    console.log('PASS 60-minute synthetic background run, isolated identities, stable renderers, private IPC and single window');
  } finally { await new Promise(resolve => server.close(resolve)); }
};
