'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const electron = require('electron');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coze-integration-'));
for (let phase = 1; phase <= 2; phase++) {
  const result = spawnSync(electron, ['.', '--self-test', '--data-root', root], { cwd: path.join(__dirname, '..'), stdio: 'inherit', timeout: 90000 });
  if (result.status !== 0) { console.error(`Phase ${phase} failed; synthetic fixture retained at ${root}`); process.exit(result.status || 1); }
}
fs.rmSync(root, { recursive: true, force: true });
console.log('PASS application restart and isolated browser regression');
