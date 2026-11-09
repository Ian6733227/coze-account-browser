'use strict';
const $ = id => document.getElementById(id);
let state = { accounts: [], tabs: [] }, editing = null, avatarMode = 'sync', customAvatar = '';
const accountRows = new Map(), tabRows = new Map(), avatars = new WeakMap();
function reconcile(parent, children) {
  const keep = new Set(children);
  for (const child of [...parent.children]) if (!keep.has(child)) child.remove();
  children.forEach((child, index) => { if (parent.children[index] !== child) parent.insertBefore(child, parent.children[index] || null); });
}
async function invoke(promise) {
  try { const result = await promise; if (!result.ok) throw new Error(result.error); return result.value; }
  catch (err) { $('message').textContent = err.message; $('message').className = 'error'; throw err; }
}
function selected() { return state.accounts.find(a => a.id === state.selected); }
function fillAvatar(element, value, fallback) {
  const prior = avatars.get(element);
  if (prior && prior.value === value && prior.fallback === fallback) return;
  avatars.set(element, {value, fallback});
  element.replaceChildren();
  if (value) { const img = document.createElement('img'); img.src = value; img.alt = ''; img.addEventListener('error', () => { if (element.firstChild === img) element.textContent = fallback; }, {once:true}); element.append(img); }
  else element.textContent = fallback;
}
function initials(name) { return /^[a-z0-9]/i.test(name) ? Array.from(name).slice(0,2).join('').toUpperCase() : Array.from(name)[0] || '号'; }
function avatarColor(id) {
  const colors = ['#505fc7','#187867','#a44868','#8b5b26','#6852a3','#276fa0'];
  let hash = 0; for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return colors[hash % colors.length];
}
function pageStatus(account, current) {
  return account.clearing ? '正在清除登录资料…' : account.pausing ? '正在关闭网页…' : account.crashed ? '网页已退出 · 请刷新' : account.pageError ? '加载失败 · 请刷新' : account.loading ? '加载中' :
    account.running ? (current ? '当前网页' : '后台运行') + (account.identityStatus === 'unconfirmed' ? ' · 昵称待确认' : '') : account.paused ? '网页已关闭' : '网页未打开';
}
function render(value) {
  state = value; const current = selected();
  document.body.classList.toggle('sidebar-collapsed', state.sidebarCollapsed === true);
  const toggleLabel = state.sidebarCollapsed ? '展开账号侧栏' : '收起账号侧栏';
  $('sidebar-toggle').title = toggleLabel; $('sidebar-toggle').setAttribute('aria-label', toggleLabel);
  $('sidebar-toggle').setAttribute('aria-expanded', String(!state.sidebarCollapsed));
  const archivedRunning = state.accounts.filter(a => a.archived && a.running).length;
  $('count').textContent = `${state.accounts.filter(a => !a.archived).length} 个账号 · ${state.accounts.filter(a => a.running).length} 个网页运行中${archivedRunning ? `（含 ${archivedRunning} 个已隐藏）` : ''}`;
  const accountScroll = $('accounts').scrollTop;
  const nameCounts = new Map();
  for (const a of state.accounts) nameCounts.set(a.displayName, (nameCounts.get(a.displayName) || 0) + 1);
  const present = new Set(state.accounts.map(a => a.id));
  for (const id of accountRows.keys()) if (!present.has(id)) accountRows.delete(id);
  const rows = [];
  state.accounts.forEach((a, index) => {
    if (a.archived && !$('archived').checked && a.id !== state.selected) return;
    let row = accountRows.get(a.id);
    if (!row) {
      const button = document.createElement('button'), avatar = document.createElement('span'), badge = document.createElement('span');
      const details = document.createElement('span'), name = document.createElement('span'), status = document.createElement('span'), dot = document.createElement('span');
      button.dataset.accountId = a.id; avatar.className = 'avatar'; avatar.style.setProperty('--avatar-color', avatarColor(a.id));
      badge.className = 'account-number'; badge.setAttribute('aria-hidden', 'true'); details.className = 'account-details';
      name.className = 'account-name'; status.className = 'account-state'; details.append(name, status); button.append(badge, avatar, details, dot);
      button.addEventListener('click', () => invoke(window.coze.select(a.id)).catch(() => {}));
      row = {button, avatar, badge, name, status, dot}; accountRows.set(a.id, row);
    }
    const {button, avatar, badge, name, status, dot} = row;
    button.className = `account${a.id === state.selected ? ' active' : ''}`;
    button.disabled = a.pausing === true;
    button.setAttribute('aria-current', a.id === state.selected ? 'true' : 'false');
    fillAvatar(avatar, a.displayAvatar, initials(a.displayName));
    badge.hidden = Boolean(a.displayAvatar) && nameCounts.get(a.displayName) < 2;
    badge.textContent = String(index + 1); name.textContent = a.displayName;
    status.textContent = pageStatus(a, a.id === state.selected);
    if (a.archived) status.textContent += ' · 已隐藏';
    dot.className = `dot ${a.crashed || a.pageError ? 'error' : a.loading ? 'loading' : a.running ? 'running' : ''}`;
    button.title = `${a.displayName} · 账号 ${index + 1} · ${status.textContent}${a.note ? '\n' + a.note : ''}`;
    button.setAttribute('aria-label', `${a.displayName}，账号 ${index + 1}，${status.textContent}`);
    rows.push(button);
  });
  reconcile($('accounts'), rows);
  $('accounts').scrollTop = accountScroll;
  $('name').textContent = current?.displayName || '扣子账号浏览器';
  $('status').textContent = current ? pageStatus(current, true) : '选择账号开始';
  $('status').classList.toggle('error', Boolean(current?.crashed || current?.pageError));
  $('archive').textContent = current?.archived ? '显示账号入口' : '隐藏账号入口';
  for (const id of ['edit','archive','pause','resume','sync']) $(id).disabled = !current;
  $('pause').disabled = !current?.running;
  for (const id of ['pause','resume']) $(id).disabled ||= current?.pausing === true;
  $('all').disabled = state.accounts.some(a => !a.archived && a.pausing);
  $('sync').disabled = !current?.running || current?.syncing || current?.pausing;
  $('sync').textContent = current?.syncing ? '同步中…' : '同步头像昵称';
  const recovery = Boolean(current?.running && (current.crashed || current.pageError));
  document.querySelector('.empty').style.display = !current?.running || recovery ? 'flex' : 'none';
  $('empty-title').textContent = recovery ? '这个网页暂时无法显示' : '一个界面，多个扣子账号';
  $('empty-description').textContent = recovery ? (current.pageError || '网页进程已退出，请重新加载。') : '① 选择左侧账号　② 在右侧扣子网页完成登录。';
  $('empty-steps').hidden = recovery;
  $('resume').hidden = recovery;
  $('recover-reload').hidden = $('recover-home').hidden = !recovery;
  const confirmed = current?.identityStatus === 'confirmed';
  $('sync').title = confirmed ? `网页昵称读取于 ${new Date(current.identityCheckedAt).toLocaleString()}；头像不可用时显示默认图标，不代表登录或任务状态` : '头像与昵称可能是上次同步的缓存；登录后可重新同步';
  $('message').textContent = state.error || '后台账号保持运行；关闭网页可释放该账号的网页内存。';
  $('message').className = state.error ? 'error' : '';
  const multiple = state.tabs.length > 1;
  document.querySelector('header').classList.toggle('multiple-pages', multiple);
  $('tabs').hidden = !multiple;
  const tabIds = new Set(state.tabs.map(tab => tab.id)), buttons = [];
  for (const id of tabRows.keys()) if (!tabIds.has(id)) tabRows.delete(id);
  if (multiple) state.tabs.forEach(tab => {
    let row = tabRows.get(tab.id);
    if (!row) {
      const button = document.createElement('button'), close = document.createElement('button');
      close.className = 'close-tab'; close.textContent = '× 关闭此页';
      button.addEventListener('click', () => invoke(window.coze.tab(tab.id)).catch(() => {}));
      close.addEventListener('click', () => invoke(window.coze.closeTab()).catch(() => {}));
      row = {button, close}; tabRows.set(tab.id, row);
    }
    row.button.className = `tab${tab.active ? ' active' : ''}`; row.button.textContent = tab.title; row.button.disabled = current?.pausing === true;
    buttons.push(row.button);
    if (tab.active && !tab.primary) { row.close.disabled = current?.pausing === true; buttons.push(row.close); }
  });
  reconcile($('tabs'), buttons);
  if (editing) {
    const a = state.accounts.find(a => a.id === editing);
    fillAvatar($('avatar-preview'), avatarMode === 'custom' ? customAvatar : a?.profile.avatar, '头像');
    $('restore-avatar').disabled = avatarMode !== 'custom';
  }
}
async function editor(id = null) {
  editing = id; const account = id ? state.accounts.find(a => a.id === id) : null;
  $('editor-title').textContent = id ? '编辑账号' : '添加账号'; $('account-name').value = account?.name || `扣子账号 ${state.accounts.length + 1}`;
  $('note').value = account?.note || ''; $('form-error').textContent = '';
  $('profile-name').checked = account?.useProfileName ?? true;
  $('profile-hint').textContent = account?.profile.name ? `扣子昵称：${account.profile.name}` : '登录后自动获取当前账号的昵称与头像。';
  $('avatar-editor').hidden = !id; $('clear-account-data').hidden = !id; $('clear-account-data').disabled = account?.pausing === true;
  avatarMode = account?.avatarMode || 'sync'; customAvatar = account?.customAvatar || '';
  fillAvatar($('avatar-preview'), account?.displayAvatar, '头像');
  $('restore-avatar').disabled = account?.avatarMode !== 'custom';
  await invoke(window.coze.overlay(true)); $('editor').showModal(); $('account-name').focus(); $('account-name').select();
}
async function closeEditor() { $('editor').close(); editing = null; await invoke(window.coze.overlay(false)); }
async function openHelp() {
  if ($('editor').open || $('help-dialog').open) return;
  await invoke(window.coze.overlay(true));
  if (!$('help-frame').getAttribute('src')) $('help-frame').src = 'help/index.html';
  $('help-dialog').showModal(); $('help-close').focus();
}
async function closeHelp() {
  // Unload the document to stop tutorial audio when returning to an account.
  $('help-frame').removeAttribute('src'); $('help-dialog').close();
  await invoke(window.coze.overlay(false)); $('help').focus();
}
$('help').addEventListener('click', () => openHelp().catch(() => {}));
$('empty-help').addEventListener('click', () => openHelp().catch(() => {}));
$('help-close').addEventListener('click', () => closeHelp().catch(() => {}));
$('help-dialog').addEventListener('cancel', event => { event.preventDefault(); closeHelp().catch(() => {}); });
window.coze.onHelp(() => openHelp().catch(() => {}));
$('add').addEventListener('click', () => editor().catch(() => {}));
$('edit').addEventListener('click', () => editor(state.selected).catch(() => {}));
$('cancel').addEventListener('click', () => closeEditor().catch(() => {}));
$('editor').addEventListener('cancel', event => { event.preventDefault(); closeEditor().catch(() => {}); });
$('form').addEventListener('submit', async event => { event.preventDefault();
  try { const name = $('account-name').value.trim(); if (!name) throw new Error('请填写账号名称。');
    if (editing) await invoke(window.coze.edit(editing, name, $('note').value, $('profile-name').checked, avatarMode, customAvatar));
    else await invoke(window.coze.add(name, $('note').value, $('profile-name').checked));
    await closeEditor();
  } catch (err) { $('form-error').textContent = err.message; }
});
$('account-name').addEventListener('input', () => { $('profile-name').checked = false; });
$('archived').addEventListener('change', () => render(state));
$('all').addEventListener('click', () => invoke(window.coze.openAll()).catch(() => {}));
$('sidebar-toggle').addEventListener('click', () => invoke(window.coze.sidebar(!state.sidebarCollapsed)).catch(() => {}));
$('archive').addEventListener('click', () => invoke(window.coze.archive(state.selected)).catch(() => {}));
$('clear-account-data').addEventListener('click', async () => {
  const id = editing; if (!id) return;
  try { await closeEditor(); await invoke(window.coze.clearAccountData(id)); } catch { /* invoke displays the error. */ }
});
$('pause').addEventListener('click', () => invoke(window.coze.pause(state.selected)).catch(() => {}));
$('resume').addEventListener('click', () => invoke(window.coze.select(state.selected)).catch(() => {}));
$('sync').addEventListener('click', () => invoke(window.coze.syncProfile(state.selected)).catch(() => {}));
$('recover-reload').addEventListener('click', () => invoke(window.coze.navigation('reload')).catch(() => {}));
$('recover-home').addEventListener('click', () => invoke(window.coze.navigation('home')).catch(() => {}));
$('choose-avatar').addEventListener('click', async () => {
  if (!editing) return;
  try { const value = await invoke(window.coze.chooseAvatar(editing));
    if (value) { avatarMode = 'custom'; customAvatar = value; fillAvatar($('avatar-preview'), value, '头像'); $('restore-avatar').disabled = false; }
  } catch (err) { $('form-error').textContent = err.message; }
});
$('restore-avatar').addEventListener('click', () => {
  avatarMode = 'sync'; fillAvatar($('avatar-preview'), state.accounts.find(a => a.id === editing)?.profile.avatar, '头像'); $('restore-avatar').disabled = true;
});
window.coze.onState(render); invoke(window.coze.state()).then(render).catch(() => {});
