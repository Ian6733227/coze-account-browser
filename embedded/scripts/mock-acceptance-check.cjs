'use strict';
// Runs the synthetic acceptance suite (test/mock-acceptance-test.cjs) once.
//   default                        : development Electron in this directory
//   COZE_BROWSER_TEST_APP=<.app>   : that packaged app's Contents/MacOS/CozeAccountBrowser
// No real Coze account or real network is used; see ACCEPTANCE-2.3.5.md.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process');
const MARKER = 'PASS mock acceptance (synthetic data, no real Coze account)';
const TIMEOUT = 180000;
const packaged = process.env.COZE_BROWSER_TEST_APP;
const command = packaged ? path.join(packaged, 'Contents/MacOS/CozeAccountBrowser') : require('electron');
const args = packaged ? [] : ['.'];
args.push('--self-test', '--mock-acceptance', '--data-root');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coze-mock-acceptance-'));
args.push(root);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(command, args, { cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'inherit'] });
let output = '', timedOut = false, killTimer = null;
child.stdout.on('data', chunk => { process.stdout.write(chunk); output = (output + chunk).slice(-65536); });
const deadline = setTimeout(() => {
  timedOut = true; child.kill('SIGTERM');
  killTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
}, TIMEOUT);
const fail = message => { console.error(`${message}; synthetic data directory retained at ${root}`); process.exitCode = 1; };
child.on('error', error => { clearTimeout(deadline); fail(`Could not start the application (${error.message})`); });
child.on('close', (code, signal) => {
  clearTimeout(deadline); clearTimeout(killTimer);
  if (timedOut) return fail(`Mock acceptance timed out after ${TIMEOUT / 1000} seconds`);
  if (code !== 0 || signal) return fail(`Mock acceptance failed (exit ${code ?? signal})`);
  if (!output.includes(MARKER)) return fail('Mock acceptance ended without the final PASS marker');
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  console.log('PASS mock acceptance check (application exited normally; temporary data removed)');
});
