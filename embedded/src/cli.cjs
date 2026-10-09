#!/usr/bin/env node
'use strict';
const os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process');
const { request, endpoint } = require('./control-transport.cjs');
const version = require('../package.json').version;
const HELP = `coze-browser — 扣子账号浏览器本机控制 CLI ${version}
  coze-browser launch                         启动应用并等待控制通道就绪
  coze-browser accounts                       列出账号编号、固定ID、名称与运行状态
  coze-browser status                         查询当前账号和页面加载状态
  coze-browser switch <编号|ID|名称>           切换账号（同名时用编号或ID）
  coze-browser open <HTTPS链接> [--account N]  在指定/当前账号内新增或切回页面
  coze-browser open-all                       打开全部未停用账号
  coze-browser sidebar collapse|expand        收起/展开账号侧栏
  coze-browser endpoint                       查询本机Unix socket路径
  coze-browser --version
所有控制结果为JSON；--json可显式标记。失败退出码1，参数错误退出码2。
可选：--data-root <专属资料目录>，--timeout <毫秒，100–30000，默认10000>。
open返回已开始导航，页面完成需查询status；不代表网站任务完成。
`;
function parse(args) {
  const words = []; let root = path.join(os.homedir(),'Library/Application Support/CozeAccountsBrowser'), account, timeout = 10000;
  for (let i=0;i<args.length;i++) {
    const arg = args[i];
    if (['--data-root','--account','--timeout'].includes(arg)) {
      const value = args[++i]; if (!value || value.startsWith('--')) throw new Error(`${arg}需要参数。`);
      if (arg==='--data-root') root = path.resolve(value);
      if (arg==='--account') account = value;
      if (arg==='--timeout') { timeout = Number(value); if (!Number.isInteger(timeout) || timeout < 100 || timeout > 30000) throw new Error('timeout必须是100到30000毫秒。'); }
    } else if (arg==='--json') {}
    else if (arg==='--version') words.push('version');
    else if (['--help','-h'].includes(arg)) words.push('help');
    else if (arg.startsWith('-')) throw new Error('不支持的选项。');
    else words.push(arg);
  }
  if (!words.length) words.push('help');
  const command = words[0], params = {};
  if (account !== undefined && command !== 'open') throw new Error('--account仅用于open。');
  if (command==='switch' && words.length===2) params.account = words[1];
  else if (command==='open' && words.length===2) { params.url=words[1]; if (account !== undefined) params.account=account; }
  else if (command==='sidebar' && words.length===2 && ['collapse','expand'].includes(words[1])) params.collapsed=words[1]==='collapse';
  else if (!['accounts','status','open-all','launch','endpoint','version','help'].includes(command) || words.length!==1) throw new Error('命令或参数不正确，请运行coze-browser --help。');
  return {command,params,root,timeout};
}
async function launch(root,timeout) {
  const appPath = process.env.COZE_BROWSER_APP || path.join(os.homedir(),'Applications/扣子账号浏览器.app');
  await new Promise((resolve,reject) => {
    const custom = root !== path.join(os.homedir(),'Library/Application Support/CozeAccountsBrowser');
    // The bundled CLI runs Electron as Node; that mode must not reach the GUI.
    const launchEnv = { ...process.env }; delete launchEnv.ELECTRON_RUN_AS_NODE;
    const child = spawn('/usr/bin/open',['-n','-a',appPath,...(custom ? ['--args','--data-root',root] : [])],{stdio:'ignore',env:launchEnv});
    child.once('error',reject); child.once('exit',code => code===0 ? resolve() : reject(new Error('应用未能启动。')));
  });
  const deadline=Date.now()+timeout;
  while (Date.now()<deadline) {
    try { const result=await request(root,'status',{},Math.min(1000,deadline-Date.now())); if(result.ok)return result; }
    catch {}
    await new Promise(resolve => setTimeout(resolve,150));
  }
  throw new Error('控制接口未就绪；旧版应用正在运行时，请正常退出后再launch。');
}
async function main(args = process.argv.slice(2)) {
  let options;
  try { options=parse(args); } catch(error) { process.stdout.write(JSON.stringify({ok:false,error:{code:'INVALID_ARGUMENT',message:error.message}})+'\n'); process.exitCode=2; return; }
  const {command,params,root,timeout}=options;
  if(command==='help'){process.stdout.write(HELP);return;}
  if(command==='version'){process.stdout.write(JSON.stringify({ok:true,result:{version}})+'\n');return;}
  try {
    const reply = command==='launch' ? await launch(root,timeout) : command==='endpoint' ? {ok:true,result:{protocolVersion:1,...endpoint(root)}} : await request(root,command,params,timeout);
    process.stdout.write(JSON.stringify(reply)+'\n'); if (!reply.ok) process.exitCode=1;
  } catch(error) {
    process.stdout.write(JSON.stringify({ok:false,error:{code:error.code || 'CONNECTION_FAILED',message:['ENOENT','ECONNREFUSED'].includes(error.code) ? '浏览器控制接口未运行，请先执行coze-browser launch。' : error.message}})+'\n');process.exitCode=1;
  }
}
if (require.main === module) main();
module.exports = { parse, main };
