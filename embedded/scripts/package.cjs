'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('此打包脚本面向 Apple Silicon macOS。');
const root = path.join(__dirname, '..'), version = require('../package.json').version;
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'coze-browser-package-'));
const app = path.join(stage, '扣子账号浏览器.app'), dist = path.join(root, 'dist');
const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' });
run('ditto', ['--norsrc', '--noextattr', path.join(root, 'node_modules/electron/dist/Electron.app'), app]);
const plist = path.join(app, 'Contents/Info.plist');
for (const [key, value] of Object.entries({ CFBundleName: '扣子账号浏览器', CFBundleDisplayName: '扣子账号浏览器', CFBundleIdentifier: 'cn.local.cozeaccounts.browser',
  CFBundleExecutable: 'CozeAccountBrowser', CFBundleIconFile: 'CozeIcon.icns', CFBundleShortVersionString: version, CFBundleVersion: '20000' })) {
  try { execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist], { stdio: 'pipe' }); }
  catch { run('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${value}`, plist]); }
}
fs.renameSync(path.join(app, 'Contents/MacOS/Electron'), path.join(app, 'Contents/MacOS/CozeAccountBrowser'));
fs.copyFileSync(path.join(root, 'assets/CozeIcon.icns'), path.join(app, 'Contents/Resources/CozeIcon.icns'));
const appSource = path.join(app, 'Contents/Resources/app'); fs.mkdirSync(appSource, { recursive: true });
for (const dir of ['src', 'ui', 'assets', 'bin']) run('ditto', ['--norsrc', '--noextattr', path.join(root, dir), path.join(appSource, dir)]);
fs.writeFileSync(path.join(appSource, 'package.json'), JSON.stringify({ name: 'coze-account-browser', productName: '扣子账号浏览器', version, main: 'src/main.cjs', private: true }, null, 2));
// Self-test code is included to verify the installed bundle with synthetic profiles.
run('ditto', ['--norsrc', '--noextattr', path.join(root, 'test'), path.join(appSource, 'test')]);
for (const name of ['LICENSE', 'LICENSES.chromium.html']) {
  const source = path.join(root, 'node_modules/electron/dist', name); if (fs.existsSync(source)) fs.copyFileSync(source, path.join(app, 'Contents/Resources', name));
}
run('xattr', ['-cr', app]);
run('codesign', ['--force', '--deep', '--sign', '-', app]);
run('codesign', ['--verify', '--deep', '--strict', app]);
fs.mkdirSync(dist, { recursive: true });
run('ditto', ['--norsrc', '--noextattr', app, path.join(dist, '扣子账号浏览器.app')]);
const zip = path.join(dist, `扣子账号浏览器-${version}.zip`);
run('ditto', ['-c', '-k', '--norsrc', '--noextattr', '--keepParent', app, zip]);
fs.writeFileSync(path.join(dist, 'build.json'), JSON.stringify({ version, electron: require('electron/package.json').version, arch: process.arch, stage: app, archive: zip }, null, 2) + '\n');
console.log(`Signed staging app: ${app}\nPackage: ${zip}`);
