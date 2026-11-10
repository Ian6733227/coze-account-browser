'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process');
const build = JSON.parse(fs.readFileSync(path.join(__dirname, '../dist/build.json')));
const app = process.env.COZE_BROWSER_TEST_APP || build.stage;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coze-background-check-'));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(path.join(app, 'Contents/MacOS/CozeAccountBrowser'), ['--self-test', '--background-check', '--data-root', root], { env, stdio: ['ignore', 'pipe', 'inherit'] });
let output = '', timedOut = false;
child.stdout.on('data', chunk => { process.stdout.write(chunk); output = (output + chunk).slice(-65536); });
const deadline = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, 3720000);
child.on('error', error => { clearTimeout(deadline); console.error(error.message); process.exitCode = 1; });
child.on('close', (code, signal) => {
  clearTimeout(deadline);
  if (code !== 0 || signal || timedOut || !output.includes('PASS 60-minute synthetic background run')) {
    console.error('Background check incomplete or failed; anonymous fixture retained at ' + root);
    process.exitCode = 1; return;
  }
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  console.log('PASS signed background-test process exited normally after explicit 60-minute success');
});
