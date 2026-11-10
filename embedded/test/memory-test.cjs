'use strict';
// Memory measurement only: no pass/fail threshold. Started through
//   electron . --self-test --memory-check --data-root <tmp>      (test/browser-test.cjs dispatches here)
// N accounts (COZE_MEMORY_ACCOUNTS, default 6, clamped 1-12) all load the same synthetic page, settle for
// 30 s, then app.getAppMetrics() is sampled every 5 s for 60 s. Output: a MEMORY_REPORT line with JSON.
// scripts/memory-check.cjs reads that line and adds an external `ps` RSS measurement of the process tree.
// Kept self-contained under test/ because only test/ is copied into the packaged app.
const assert = require('node:assert/strict');
const { BrowserWindow } = require('electron');
const { createMemoryServer } = require('./fixtures/memory-page.cjs');
const SETTLE_MS = 30000, INTERVAL_MS = 5000, WINDOW_MS = 60000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, limit = 15000) {
  const end = Date.now() + limit;
  while (Date.now() < end) { if (await fn()) return; await sleep(50); }
  throw new Error(`Timed out: ${label}`);
}
const accountCount = value => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.min(12, Math.max(1, parsed)) : 6; };
const stats = values => ({ avgKB: Math.round(values.reduce((a, b) => a + b, 0) / values.length), peakKB: Math.max(...values) });

exports.run = async ({ app, browser, store }) => {
  const wanted = accountCount(process.env.COZE_MEMORY_ACCOUNTS);
  while (store.accounts.filter(a => !a.archived).length < wanted) store.add(`扣子账号 ${store.accounts.length + 1}`);
  // The store starts with five entries; hide any beyond the requested count so openAll() opens exactly `wanted`.
  for (const extra of store.accounts.filter(a => !a.archived).slice(wanted)) store.toggleArchive(extra.id);
  const open = store.accounts.filter(a => !a.archived);
  assert.equal(open.length, wanted);
  const page = await createMemoryServer();
  try {
    browser.home = page.url;
    browser.openAll();
    for (const account of open) {
      const wc = () => browser.entries.get(account.id).tabs[0].view.webContents;
      await until(() => !wc().isLoading() && wc().getURL() === page.url, `memory page for ${account.name}`, 30000);
    }
    assert.equal(BrowserWindow.getAllWindows().length, 1);
    console.log(`MEMORY_LOADED accounts=${wanted} nodes=${page.nodes}; settling ${SETTLE_MS / 1000}s`);
    await sleep(SETTLE_MS);

    const startedAt = new Date().toISOString(), samples = [];
    console.log('MEMORY_SAMPLING_START');
    const total = WINDOW_MS / INTERVAL_MS;
    for (let index = 1; index <= total; index++) {
      await sleep(INTERVAL_MS);
      const byType = {}, sum = { workingSetKB: 0, privateKB: 0, processes: 0 };
      for (const metric of app.getAppMetrics()) {
        const memory = metric.memory || {}, type = metric.type || 'Unknown';
        // privateBytes is documented as Windows-only; it is 0/undefined on macOS and then reported as unavailable.
        const entry = byType[type] ||= { workingSetKB: 0, privateKB: 0, processes: 0 };
        const working = Number(memory.workingSetSize) || 0, priv = Number(memory.privateBytes) || 0;
        entry.workingSetKB += working; entry.privateKB += priv; entry.processes++;
        sum.workingSetKB += working; sum.privateKB += priv; sum.processes++;
      }
      samples.push({ byType, total: sum });
      // Tick marker lets the external ps sampler take a paired measurement at the same moment.
      console.log(`MEMORY_SAMPLE_TICK ${index}/${total}`);
    }
    console.log('MEMORY_SAMPLING_END');

    const types = [...new Set(samples.flatMap(s => Object.keys(s.byType)))].sort();
    const field = (pick, key) => samples.map(s => pick(s)?.[key] || 0);
    const summarizeGroup = pick => ({
      workingSetKB: stats(field(pick, 'workingSetKB')), privateKB: stats(field(pick, 'privateKB')),
      processes: stats(field(pick, 'processes'))
    });
    const summary = { total: summarizeGroup(s => s.total), byType: Object.fromEntries(types.map(type => [type, summarizeGroup(s => s.byType[type])])) };
    summary.privateBytesAvailable = summary.total.privateKB.peakKB > 0;
    const report = {
      version: require('../package.json').version, electron: process.versions.electron, chrome: process.versions.chrome,
      accounts: wanted, samples: samples.length, intervalSeconds: INTERVAL_MS / 1000, settleSeconds: SETTLE_MS / 1000,
      page: { nodes: page.nodes, updatesPerSecond: 1 },
      metric: 'electron getAppMetrics workingSetSize', unit: 'KB', summary, startedAt, timestamp: new Date().toISOString()
    };
    console.log('MEMORY_REPORT ' + JSON.stringify(report));
    console.log('PASS memory sampling completed');
  } finally { await page.close(); }
};
