'use strict';
const { createServer } = require('./control-transport.cjs');
const HOSTS = new Set(['coze.cn','www.coze.cn','space.coze.cn']);
const COMMANDS = new Set(['status','accounts','switch','open','open-all','sidebar']);
function fail(code,message) { throw Object.assign(new Error(message),{code}); }
function pageURL(value) {
  if (typeof value !== 'string' || value.length > 4096) fail('INVALID_URL','请提供扣子的HTTPS页面链接。');
  let url; try { url = new URL(value); } catch { fail('INVALID_URL','链接格式不正确。'); }
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname) || url.port || url.username || url.password) fail('INVALID_URL','仅支持扣子官网的HTTPS页面链接。');
  if (/%(?:2f|5c|2e|25)/i.test(url.pathname)) fail('INVALID_URL','请使用不含编码路径分隔符的页面链接。');
  let route; try { route = decodeURIComponent(url.pathname).replaceAll('\\','/'); } catch { fail('INVALID_URL','页面路径不正确。'); }
  if (route !== '/' && !/^\/(session|project|space|task|chat|workspaces|agent|agents|store|overview|home)(\/|$)/.test(route)) fail('INVALID_URL','仅支持扣子首页、会话、项目等网页路径；不支持接口和授权链接。');
  for (const key of url.searchParams.keys()) if (/(token|password|secret|authorization|api.?key|^code$)/i.test(key)) fail('INVALID_URL','请使用不含认证参数的页面链接。');
  return url.href;
}
function resolveAccount(store, selector, fallback) {
  if (selector === undefined && fallback) selector = fallback;
  if (typeof selector !== 'string' || !selector.trim() || selector.length > 80) fail('INVALID_ACCOUNT','请使用账号编号、固定ID或名称。');
  selector = selector.trim();
  let account;
  if (/^[1-9]\d*$/.test(selector)) account = store.accounts[Number(selector)-1];
  else {
    account = store.accounts.find(a => a.id === selector);
    if (!account) {
      const found = store.accounts.filter(a => a.name === selector || (a.useProfileName && a.profile.name === selector));
      if (found.length > 1) fail('AMBIGUOUS_ACCOUNT','有多个同名账号，请使用编号或固定ID。');
      account = found[0];
    }
  }
  if (!account) fail('ACCOUNT_NOT_FOUND','没有找到该账号。');
  if (account.archived) fail('ACCOUNT_ARCHIVED','该账号已停用，请先在界面中恢复。');
  return account;
}
function snapshot(browser,store,version) {
  const state = browser.state();
  return { protocolVersion:1,version,selected:state.selected,sidebarCollapsed:state.sidebarCollapsed,
    accounts:state.accounts.map((a,index) => ({number:index+1,id:a.id,name:a.displayName,archived:a.archived,selected:a.id===state.selected,running:a.running,paused:a.paused === true,loading:a.loading,crashed:a.crashed,error:a.pageError || null})),
    pages:[...(browser.entries.get(browser.selected)?.tabs || [])].map(tab => {
      let location = null; try { const url = new URL(pageURL(tab.view.webContents.getURL())); location = url.origin+url.pathname; } catch {}
      return {id:tab.id,primary:tab.primary,active:tab.id===browser.entries.get(browser.selected)?.active,location,loading:tab.view.webContents.isLoading(),crashed:tab.crashed,error:tab.error || null};
    }) };
}
function dispatcher({browser,store,win,version,isBusy = () => false}) {
  return request => {
    if (!request || request.v !== 1 || typeof request.requestId !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(request.requestId)) fail('INVALID_REQUEST','请求协议不正确。');
    if (!COMMANDS.has(request.command)) fail('UNSUPPORTED_COMMAND','不支持该控制命令。');
    const fields = {status:[],accounts:[],switch:['account'],open:['account','url'],'open-all':[],sidebar:['collapsed']}[request.command];
    if (Object.keys(request).some(key => !['v','requestId','command',...fields].includes(key))) fail('INVALID_REQUEST','请求包含不支持的参数。');
    if (!['status','accounts'].includes(request.command) && (isBusy() || browser.overlay)) fail('UI_BUSY','请先保存或取消正在打开的编辑/确认窗口。');
    if (request.command === 'accounts') return {protocolVersion:1,accounts:snapshot(browser,store,version).accounts};
    if (request.command === 'switch') browser.select(resolveAccount(store,request.account).id);
    if (request.command === 'open') {
      const url = pageURL(request.url), account = resolveAccount(store,request.account,browser.selected);
      const result = browser.openPage(account.id,url);
      if (win.isMinimized()) win.restore(); win.show(); win.focus();
      return {effect:result.created ? 'navigation_started' : 'existing_page_selected',accountId:account.id,pageId:result.tab.id,state:snapshot(browser,store,version)};
    }
    if (request.command === 'open-all') browser.openAll();
    if (request.command === 'sidebar') {
      if (typeof request.collapsed !== 'boolean') fail('INVALID_REQUEST','collapsed必须是布尔值。');
      browser.setSidebarCollapsed(request.collapsed);
    }
    if (['switch','open-all'].includes(request.command)) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
    return snapshot(browser,store,version);
  };
}
async function startControl(options) { return createServer(options.store.root,dispatcher(options)); }
module.exports = { pageURL, resolveAccount, snapshot, dispatcher, startControl };
