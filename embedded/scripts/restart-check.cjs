'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { request } = require('../src/control-transport.cjs');
const build = JSON.parse(fs.readFileSync(path.join(__dirname, '../dist/build.json')));
const app = process.env.COZE_BROWSER_TEST_APP || build.stage;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coze-normal-restart-'));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let child, closed, success = false;
async function start() {
  child = spawn(path.join(app, 'Contents/MacOS/CozeAccountBrowser'), ['--data-root', root], { env, stdio: 'ignore' });
  closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
  for (let attempt = 0; attempt < 100; attempt++) {
    try { const reply = await request(root, 'status', {}, 1000); if (reply.ok) return reply.result; } catch { /* Wait only for this owned instance. */ }
    await sleep(100);
  }
  throw new Error('Normal signed startup did not become ready');
}
async function stop() {
  child.kill('SIGTERM');
  let timer;
  const result = await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Normal quit timed out')), 10000); })]).finally(() => clearTimeout(timer));
  assert.equal(result.code, 0); assert.equal(result.signal, null); child = null;
}
async function main() {
  try {
    const before = await start(); assert.equal(before.version, build.version);
    const switched = await request(root, 'switch', { account: '2' }); assert.equal(switched.ok, true);
    const selected = switched.result.selected;
    await stop();
    const after = await start(); assert.equal(after.selected, selected);
    assert.equal(after.accounts.filter(a => a.running).length, 1);
    assert.equal(after.pages.length, 1); assert.equal(after.version, build.version);
    await stop(); success = true;
    console.log('PASS normal signed startup, IPC selection, two normal quits and restored last account with one open page');
  } finally {
    if (child) { child.kill('SIGTERM'); await Promise.race([closed.catch(() => {}), sleep(10000)]); }
    if (success) fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    else console.error('Anonymous restart fixture retained at ' + root);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
