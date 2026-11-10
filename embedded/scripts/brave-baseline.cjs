'use strict';
// Optional same-load Brave comparison for scripts/memory-check.cjs. Measurement only.
//   BRAVE_PATH            Brave executable (default: /Applications/Brave Browser.app/Contents/MacOS/Brave Browser)
//   COZE_MEMORY_ACCOUNTS  number of "accounts" = separate Brave profiles/processes (1-12, default 6)
// Each "account" gets its own brand-new temporary --user-data-dir under one temp root created here, and loads
// the same synthetic page as the app. The user's own Brave profile is never touched. Writes
// os.tmpdir()/brave-memory-report-<timestamp>.json with the same `external` block as memory-check.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { parsePs, descendants, sumRss, summarize, accountCount } = require('./lib/process-tree.cjs');
const { createMemoryServer } = require('../test/fixtures/memory-page.cjs');
const run = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const SETTLE_MS = 30000, INTERVAL_MS = 5000, WINDOW_MS = 60000;
const bravePath = process.env.BRAVE_PATH || '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
if (!fs.existsSync(bravePath)) { console.log('SKIP Brave not installed'); process.exit(0); }

(async () => {
  const accounts = accountCount(process.env.COZE_MEMORY_ACCOUNTS);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brave-baseline-'));
  const roots = [];          // { child, exited }
  let page = null, cleaned = false;
  async function cleanup() {
    if (cleaned) return; cleaned = true;
    for (const item of roots) if (!item.exited) { try { item.child.kill('SIGTERM'); } catch { /* already gone */ } }
    const end = Date.now() + 10000;
    while (Date.now() < end && roots.some(item => !item.exited)) await sleep(100);
    for (const item of roots) if (!item.exited) { try { item.child.kill('SIGKILL'); } catch { /* already gone */ } }
    await sleep(500);
    if (page) await page.close().catch(() => {});
    // Only the temporary root created by this script is removed.
    if (path.basename(tempRoot).startsWith('brave-baseline-') && path.dirname(tempRoot) === os.tmpdir()) fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { cleanup().finally(() => process.exit(130)); });
  try {
    page = await createMemoryServer();
    for (let index = 1; index <= accounts; index++) {
      const dir = path.join(tempRoot, `profile-${index}`); fs.mkdirSync(dir, { recursive: true });
      const child = spawn(bravePath, [`--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--disable-sync',
        // Keep the baseline offline apart from the local page: no component updates or background requests.
        '--disable-component-update', '--disable-background-networking', '--new-window', page.url],
        { stdio: 'ignore' });
      const item = { child, exited: false }; roots.push(item);
      child.on('exit', () => { item.exited = true; }); child.on('error', error => { item.exited = true; console.error(`Brave ${index} could not start: ${error.message}`); });
    }
    console.log(`Started ${accounts} Brave instances (separate temporary profiles); settling ${SETTLE_MS / 1000}s`);
    await sleep(SETTLE_MS);
    const series = [], total = WINDOW_MS / INTERVAL_MS;
    for (let tick = 1; tick <= total; tick++) {
      await sleep(INTERVAL_MS);
      const { stdout } = await run('ps', ['-axo', 'pid=,ppid=,rss='], { maxBuffer: 16 * 1024 * 1024, timeout: 10000 });
      const rows = parsePs(stdout), pids = new Set();
      for (const item of roots) for (const pid of descendants(rows, item.child.pid)) pids.add(pid);
      series.push({ tick, at: new Date().toISOString(), rssKB: sumRss(rows, pids), processes: pids.size, rootsAlive: roots.filter(item => !item.exited).length });
    }
    const report = {
      kind: 'brave-memory-report', generatedAt: new Date().toISOString(), accounts, browser: { executable: bravePath },
      page: { nodes: page.nodes, updatesPerSecond: 1 }, settleSeconds: SETTLE_MS / 1000, intervalSeconds: INTERVAL_MS / 1000,
      host: `${os.platform()} ${os.arch()} ${os.release()}`,
      external: { metric: 'ps rss of process tree', unit: 'KB', ...summarize(series.map(s => s.rssKB)), series },
      note: 'One Brave instance per temporary profile; RSS counts shared pages in every process. Compare with the external block of coze-memory-report only, at the same account count.'
    };
    if (series.some(s => s.rootsAlive < accounts)) report.warning = 'At least one Brave root process exited during sampling; the totals understate the load.';
    const file = path.join(os.tmpdir(), `brave-memory-report-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
    console.log(`Brave ps RSS: ${report.external.samples} samples, avg ${report.external.avgKB} KB, peak ${report.external.peakKB} KB`);
    if (report.warning) console.error('warning: ' + report.warning);
    console.log(`BRAVE_REPORT_FILE ${file}`);
  } catch (error) {
    console.error('Brave baseline failed: ' + (error?.stack || error)); process.exitCode = 1;
  } finally { await cleanup(); }
})();
