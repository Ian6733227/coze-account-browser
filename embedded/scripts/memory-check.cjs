'use strict';
// Same-load memory measurement of the account browser. Measurement only; no pass/fail threshold.
//   default                        : development Electron in this directory
//   COZE_BROWSER_TEST_APP=<.app>   : that packaged app's Contents/MacOS/CozeAccountBrowser
//   COZE_MEMORY_ACCOUNTS=N         : accounts (1-12, default 6)
// Two views are recorded separately and must be compared separately:
//   inApp    - electron app.getAppMetrics() workingSetSize (from test/memory-test.cjs)
//   external - `ps` RSS summed over the app's process tree (paired with every in-app sample)
// The merged JSON goes to os.tmpdir()/coze-memory-report-<timestamp>.json.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { parsePs, descendants, sumRss, summarize, accountCount } = require('./lib/process-tree.cjs');
const run = promisify(execFile);
const TIMEOUT = 300000;
const packaged = process.env.COZE_BROWSER_TEST_APP;
const command = packaged ? path.join(packaged, 'Contents/MacOS/CozeAccountBrowser') : require('electron');
const args = packaged ? [] : ['.'];
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coze-memory-'));
args.push('--self-test', '--memory-check', '--data-root', root);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(command, args, { cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'inherit'] });
let pending = '', output = '', timedOut = false, killTimer = null, reportLine = '';
const series = [], reads = [];
const fail = message => { console.error(`${message}; temporary data directory retained at ${root}`); process.exitCode = 1; };
async function sampleTree() {
  const { stdout } = await run('ps', ['-axo', 'pid=,ppid=,rss='], { maxBuffer: 16 * 1024 * 1024, timeout: 10000 });
  const rows = parsePs(stdout), pids = descendants(rows, child.pid);
  return { rssKB: sumRss(rows, pids), processes: pids.length };
}
function onLine(line) {
  if (line.startsWith('MEMORY_REPORT ')) reportLine = line.slice('MEMORY_REPORT '.length);
  const tick = /^MEMORY_SAMPLE_TICK (\d+)\//.exec(line);
  if (tick) reads.push(sampleTree().then(sample => { series.push({ tick: Number(tick[1]), at: new Date().toISOString(), ...sample }); }).catch(error => console.error('ps sampling failed: ' + error.message)));
}
child.stdout.on('data', chunk => {
  process.stdout.write(chunk); output = (output + chunk).slice(-65536);
  pending += chunk; const lines = pending.split('\n'); pending = lines.pop();
  for (const line of lines) onLine(line.trim());
});
const deadline = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); killTimer = setTimeout(() => child.kill('SIGKILL'), 5000); }, TIMEOUT);
child.on('error', error => { clearTimeout(deadline); fail(`Could not start the application (${error.message})`); });
child.on('close', async (code, signal) => {
  clearTimeout(deadline); clearTimeout(killTimer);
  if (pending.trim()) onLine(pending.trim());
  await Promise.allSettled(reads);
  if (timedOut) return fail(`Memory check timed out after ${TIMEOUT / 1000} seconds`);
  if (code !== 0 || signal) return fail(`Memory check failed (exit ${code ?? signal})`);
  if (!output.includes('PASS memory sampling completed') || !reportLine) return fail('Memory check ended without MEMORY_REPORT and the PASS marker');
  let inApp;
  try { inApp = JSON.parse(reportLine); } catch { return fail('MEMORY_REPORT was not valid JSON'); }
  series.sort((a, b) => a.tick - b.tick);
  const report = {
    kind: 'coze-memory-report', generatedAt: new Date().toISOString(), launchedFrom: packaged ? 'packaged app' : 'development electron',
    accounts: inApp.accounts, requestedAccounts: accountCount(process.env.COZE_MEMORY_ACCOUNTS), host: `${os.platform()} ${os.arch()} ${os.release()}`,
    inApp,
    external: { metric: 'ps rss of process tree', unit: 'KB', ...summarize(series.map(s => s.rssKB)), series },
    note: 'inApp and external use different metrics (working set vs RSS; RSS counts shared pages in every process). Compare each with the same metric of the other browser, never against each other.'
  };
  const file = path.join(os.tmpdir(), `coze-memory-report-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  console.log(`External ps RSS: ${report.external.samples} samples, avg ${report.external.avgKB} KB, peak ${report.external.peakKB} KB`);
  console.log(`MEMORY_REPORT_FILE ${file}`);
  if (series.length !== inApp.samples) console.error(`warning: ${series.length} external samples vs ${inApp.samples} in-app samples`);
});
