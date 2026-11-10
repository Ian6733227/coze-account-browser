'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const build = JSON.parse(fs.readFileSync(path.join(__dirname, '../dist/build.json')));
const app = process.env.COZE_BROWSER_TEST_APP || build.stage;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coze-signed-regression-'));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
for (let phase = 1; phase <= 2; phase++) {
  const result = spawnSync(path.join(app, 'Contents/MacOS/CozeAccountBrowser'), ['--self-test', '--data-root', root], { env, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', maxBuffer: 1048576, timeout: 90000 });
  process.stdout.write(result.stdout || '');
  const marker = phase === 1 ? 'PASS independent CLI switches six accounts' : 'PASS independent CLI reconnects and switches after application restart';
  if (result.status !== 0 || !result.stdout?.includes(marker)) {
    console.error(`Signed phase ${phase} failed; anonymous fixture retained at ${root}`);
    if (result.error) console.error(result.error.message);
    process.exit(result.status || 1);
  }
}
fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
console.log('PASS signed package two-phase regression and ordinary process exit');
