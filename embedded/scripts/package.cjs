'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('此打包脚本面向 Apple Silicon macOS。');
const root = path.join(__dirname, '..'), version = require('../package.json').version;
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'coze-browser-package-'));
const app = path.join(stage, '智进化 AI 工作台.app'), dist = path.join(root, 'dist');
const electronVersion = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleVersion', path.join(root, 'node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/Info.plist')], { encoding: 'utf8' }).trim();
if (electronVersion !== require('../package.json').devDependencies.electron) throw new Error('实际 Electron 运行时版本与锁定版本不一致，未打包。');
const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' });
run('ditto', ['--norsrc', '--noextattr', path.join(root, 'node_modules/electron/dist/Electron.app'), app]);
const plist = path.join(app, 'Contents/Info.plist');
for (const [key, value] of Object.entries({ CFBundleName: '智进化 AI 工作台', CFBundleDisplayName: '智进化 AI 工作台', CFBundleIdentifier: 'cn.local.cozeaccounts.browser',
  CFBundleExecutable: 'CozeAccountBrowser', CFBundleIconFile: 'ZhijinhuaApp.icns', CFBundleShortVersionString: version, CFBundleVersion: version.split('.').reduce((value, part) => value * 100 + Number(part), 0).toString() })) {
  try { execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist], { stdio: 'pipe' }); }
  catch { run('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${value}`, plist]); }
}
fs.renameSync(path.join(app, 'Contents/MacOS/Electron'), path.join(app, 'Contents/MacOS/CozeAccountBrowser'));
fs.copyFileSync(path.join(root, 'assets/ZhijinhuaApp.icns'), path.join(app, 'Contents/Resources/ZhijinhuaApp.icns'));
const appSource = path.join(app, 'Contents/Resources/app'); fs.mkdirSync(appSource, { recursive: true });
for (const dir of ['src', 'ui', 'assets', 'bin']) run('ditto', ['--norsrc', '--noextattr', path.join(root, dir), path.join(appSource, dir)]);
fs.writeFileSync(path.join(appSource, 'package.json'), JSON.stringify({ name: 'coze-account-browser', productName: '智进化 AI 工作台', version, main: 'src/main.cjs', private: true }, null, 2));
// Self-test code is included to verify the installed bundle with synthetic profiles.
run('ditto', ['--norsrc', '--noextattr', path.join(root, 'test'), path.join(appSource, 'test')]);
for (const name of ['LICENSE', 'LICENSES.chromium.html']) {
  const source = path.join(process.env.COZE_BROWSER_LICENSE_DIR || path.join(root, 'node_modules/electron/dist'), name);
  if (!fs.existsSync(source)) throw new Error('缺少运行时许可证，未打包。');
  fs.writeFileSync(path.join(app, 'Contents/Resources', name), fs.readFileSync(source));
}
run('xattr', ['-cr', app]);
run('codesign', ['--force', '--deep', '--sign', '-', app]);
run('codesign', ['--verify', '--deep', '--strict', app]);
fs.mkdirSync(dist, { recursive: true });
run('ditto', ['--norsrc', '--noextattr', app, path.join(dist, '智进化 AI 工作台.app')]);
const zip = path.join(dist, `智进化 AI 工作台-${version}.zip`);
run('ditto', ['-c', '-k', '--norsrc', '--noextattr', '--keepParent', app, zip]);
const manifest = path.join(dist, `build-${path.basename(stage)}.tmp`);
fs.writeFileSync(manifest, JSON.stringify({ version, electron: electronVersion, arch: process.arch, stage: app, archive: zip }, null, 2) + '\n');
fs.renameSync(manifest, path.join(dist, 'build.json'));
console.log(`Signed staging app: ${app}\nPackage: ${zip}`);
