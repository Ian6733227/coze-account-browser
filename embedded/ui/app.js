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
function platformLabel(id) { return state.platforms?.[id]?.label || '扣子'; }
function matchesView(account) { return !state.platformView || state.platformView === 'all' || (account.platform || 'coze') === state.platformView; }
function selected() { return state.accounts.find(a => a.id === state.selected); }
function platformIcon(id, fallback = 'coze') {
  const supported = Object.hasOwn(state.platforms || {}, id);
  return 'platform-icons/' + (supported ? id : fallback) + '.png';
}
function fillAvatar(element, value, platform) {
  const fallback = platformIcon(platform);
  const prior = avatars.get(element);
  if (prior && prior.value === value && prior.fallback === fallback) return;
  const image = document.createElement('img');
  const current = {value, fallback};
  avatars.set(element, current);
  image.alt = '';
  image.src = value || fallback;
  if (value) image.addEventListener('error', () => {
    if (avatars.get(element) !== current) return;
    image.src = fallback;
  }, {once:true});
  element.replaceChildren(image);
}
function previewAvatar(account) {
  const value = avatarMode === 'custom' ? customAvatar : account?.syncedAvatar ?? account?.profile.avatar;
  fillAvatar($('avatar-preview'), value, account?.platform || $('account-platform').value);
}
function pageStatus(account, current) {
  return account.clearing ? '正在清除登录资料…' : account.pausing ? '正在关闭网页…' : account.crashed ? '网页已退出 · 请刷新' : account.pageError ? '加载失败 · 请刷新' : account.loading ? '加载中' :
    account.running ? (current ? '当前网页' : '后台运行') + (account.identityStatus === 'unconfirmed' ? ' · 昵称待确认' : '') : account.paused ? '网页已关闭' : '网页未打开';
}
function bindAccountRow(button, id) {
  let press = null, suppressClick = false, menuOpen = false;
  function cancelPress() {
    if (press) clearTimeout(press.timer);
    press = null;
  }
  async function openMenu(event) {
    event.preventDefault();
    cancelPress();
    if (menuOpen || button.disabled || !button.isConnected) return;
    menuOpen = true;
    const bounds = button.getBoundingClientRect();
    try {
      await invoke(window.coze.accountMenu(id, event.clientX || bounds.left + 12,
        event.clientY || bounds.bottom, $('archived').checked));
    } catch { /* invoke displays the error. */ }
    finally { menuOpen = false; }
  }
  button.addEventListener('click', event => {
    if (suppressClick && event.detail) return;
    if (!(event.detail >= 2)) invoke(window.coze.select(id)).catch(() => {});
  });
  button.addEventListener('contextmenu', openMenu);
  button.addEventListener('dblclick', openMenu);
  button.addEventListener('keydown', event => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openMenu(event);
  });
  button.addEventListener('pointerdown', event => {
    cancelPress();
    if (event.button !== 0 || event.ctrlKey) return;
    suppressClick = false;
    press = { x: event.clientX, y: event.clientY, timer: setTimeout(() => {
      suppressClick = true;
      openMenu(event);
    }, 550) };
  });
  button.addEventListener('pointermove', event => {
    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) cancelPress();
  });
  for (const name of ['pointerup', 'pointercancel', 'pointerleave']) button.addEventListener(name, cancelPress);
}
function render(value) {
  state = value; const current = selected();
  document.body.classList.toggle('sidebar-collapsed', state.sidebarCollapsed === true);
  const toggleLabel = state.sidebarCollapsed ? '展开账号侧栏' : '收起账号侧栏';
  $('sidebar-toggle').title = toggleLabel; $('sidebar-toggle').setAttribute('aria-label', toggleLabel);
  $('sidebar-toggle').setAttribute('aria-expanded', String(!state.sidebarCollapsed));
  const viewName = state.platformView && state.platformView !== 'all' ? platformLabel(state.platformView) : '全部平台';
  const icon = $('platform-icon');
  const platform = state.platformView;
  const iconPath = platformIcon(platform, 'all');
  if (icon.getAttribute('src') !== iconPath) icon.setAttribute('src', iconPath);
  $('platform-name').textContent = viewName;
  $('platform-switch').title = '切换平台 · ' + viewName;
  $('platform-switch').setAttribute('aria-label', '切换平台 · ' + viewName);
  const scopedAccounts = state.accounts.filter(matchesView);
  const showPlatformLabels = (!state.platformView || state.platformView === 'all') && scopedAccounts.some(a => a.platform && a.platform !== 'coze');
  const archivedRunning = scopedAccounts.filter(a => a.archived && a.running).length;
  $('count').textContent = `${scopedAccounts.filter(a => !a.archived).length} 个账号 · ${scopedAccounts.filter(a => a.running).length} 个网页运行中${archivedRunning ? `（含 ${archivedRunning} 个已隐藏）` : ''}`;
  const accountScroll = $('accounts').scrollTop;
  const present = new Set(state.accounts.map(a => a.id));
  for (const id of accountRows.keys()) if (!present.has(id)) accountRows.delete(id);
  const rows = [];
  const accountIndexes = new Map(state.accounts.map((account, index) => [account.id, index]));
  const order = new Set([...(state.sidebarOrder || []), ...accountIndexes.keys()]);
  for (const id of order) {
    const index = accountIndexes.get(id);
    if (index === undefined) continue;
    const a = state.accounts[index];
    if (!matchesView(a) || (a.archived && !$('archived').checked && a.id !== state.selected)) continue;
    let row = accountRows.get(a.id);
    if (!row) {
      const button = document.createElement('button'), avatar = document.createElement('span'), badge = document.createElement('span');
      const details = document.createElement('span'), name = document.createElement('span'), status = document.createElement('span'), dot = document.createElement('span');
      button.dataset.accountId = a.id; avatar.className = 'avatar';
      badge.className = 'account-number'; badge.setAttribute('aria-hidden', 'true'); details.className = 'account-details';
      name.className = 'account-name'; status.className = 'account-state'; details.append(name, status); button.append(badge, avatar, details, dot);
      button.setAttribute('aria-haspopup', 'menu'); bindAccountRow(button, a.id);
      row = {button, avatar, badge, name, status, dot}; accountRows.set(a.id, row);
    }
    const {button, avatar, badge, name, status, dot} = row;
    button.className = `account${a.id === state.selected ? ' active' : ''}`;
    button.disabled = a.pausing === true;
    button.setAttribute('aria-current', a.id === state.selected ? 'true' : 'false');
    fillAvatar(avatar, a.displayAvatar, a.platform);
    badge.textContent = String(index + 1); name.textContent = a.displayName;
    status.textContent = pageStatus(a, a.id === state.selected);
    if (showPlatformLabels) {
      status.textContent = platformLabel(a.platform) + ' · ' + status.textContent;
    }
    if (a.archived) status.textContent += ' · 已隐藏';
    dot.className = `dot ${a.crashed || a.pageError ? 'error' : a.loading ? 'loading' : a.running ? 'running' : ''}`;
    button.title = `${a.displayName} · 账号 ${index + 1} · ${status.textContent}${a.note ? '\n' + a.note : ''}`;
    button.setAttribute('aria-label', `${a.displayName}，账号 ${index + 1}，${status.textContent}`);
    rows.push(button);
  }
  const focusedRow = document.activeElement;
  reconcile($('accounts'), rows);
  if (document.activeElement !== focusedRow && rows.includes(focusedRow)) focusedRow.focus({ preventScroll: true });
  $('accounts').scrollTop = accountScroll;
  $('name').textContent = current?.displayName || '智进化 AI 工作台';
  $('status').textContent = current ? pageStatus(current, true) : '选择账号开始';
  $('status').classList.toggle('error', Boolean(current?.crashed || current?.pageError));
  $('archive').textContent = current?.archived ? '显示账号入口' : '隐藏账号入口';
  for (const id of ['edit','archive','pause','resume','sync']) $(id).disabled = !current;
  $('pause').disabled = !current?.running;
  for (const id of ['pause','resume']) $(id).disabled ||= current?.pausing === true;
  $('all').disabled = !scopedAccounts.some(a => !a.archived) || scopedAccounts.some(a => !a.archived && a.pausing);
  const openLabel = state.platformView && state.platformView !== 'all' ? '打开本平台账号' : '打开全部账号';
  $('all-open-label').textContent = openLabel;
  $('all').setAttribute('aria-label', openLabel);
  $('all').title = openLabel;
  $('sync').disabled = !current?.running || current?.syncing || current?.pausing;
  $('sync').textContent = current?.syncing ? '同步中…' : '同步头像昵称';
  const recovery = Boolean(current?.running && (current.crashed || current.pageError));
  document.querySelector('.empty').style.display = !current?.running || recovery ? 'flex' : 'none';
  $('empty-title').textContent = recovery ? '这个网页暂时无法显示' : !scopedAccounts.length ? '还没有账号' : '一个窗口，多个账号';
  $('empty-description').textContent = recovery ? (current.pageError || '网页进程已退出，请重新加载。') : !scopedAccounts.length ? '点击左侧“＋”添加账号，再在右侧网页登录。' : '① 选择左侧账号　② 在右侧网页完成登录。';
  $('empty-steps').hidden = recovery;
  $('resume').hidden = recovery || !current;
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
    previewAvatar(a);
    $('restore-avatar').disabled = avatarMode !== 'custom';
  }
}
async function editor(id = null) {
  editing = id; const account = id ? state.accounts.find(a => a.id === id) : null;
  const platform = account?.platform || (state.platformView && state.platformView !== 'all' ? state.platformView : 'coze');
  const picker = $('account-platform');
  picker.replaceChildren(...Object.entries(state.platforms || {coze:{label:'扣子'}}).map(([value, info]) => {
    const option = document.createElement('option'); option.value = value; option.textContent = info.label; return option;
  }));
  picker.value = platform;
  picker.disabled = Boolean(id);
  $('restore-avatar').textContent = '使用同步头像';
  $('editor-title').textContent = id ? '编辑账号' : '添加账号';
  $('account-name').value = account?.name || defaultAccountName(platform);
  $('note').value = account?.note || ''; $('form-error').textContent = '';
  $('profile-name').checked = account?.useProfileName ?? true;
  $('profile-hint').textContent = account?.profile.name ? `平台昵称：${account.profile.name}` : '登录后自动读取当前账号的昵称与头像。';
  $('avatar-editor').hidden = !id; $('clear-account-data').hidden = !id; $('clear-account-data').disabled = account?.pausing === true;
  $('delete-account').hidden = !id; $('delete-account').disabled = account?.pausing === true;
  avatarMode = account?.avatarMode || 'sync'; customAvatar = account?.customAvatar || '';
  previewAvatar(account);
  $('restore-avatar').disabled = account?.avatarMode !== 'custom';
  await invoke(window.coze.overlay(true)); $('editor').showModal(); $('account-name').focus(); $('account-name').select();
}
async function closeEditor() { $('editor').close(); editing = null; await invoke(window.coze.overlay(false)); }
function showHelpTools(visible) {
  $('tools-panel').hidden = !visible;
  $('help-frame').hidden = visible;
  $('help-tools').setAttribute('aria-expanded', String(visible));
  $('help-tools').textContent = visible ? '返回帮助' : '更多工具';
  $('tools-error').textContent = '';
  if (visible) {
    $('help-frame').removeAttribute('src');
    $('tools-title').focus();
  } else if ($('help-dialog').open) {
    $('help-frame').src = 'help/index.html';
  }
}
async function openHelp() {
  if ($('editor').open || $('help-dialog').open) return;
  await invoke(window.coze.overlay(true));
  if (!$('help-frame').getAttribute('src')) $('help-frame').src = 'help/index.html';
  $('help-dialog').showModal(); $('help-close').focus();
}
async function closeHelp() {
  // Unload the document to stop tutorial audio when returning to an account.
  $('help-frame').removeAttribute('src'); $('help-dialog').close();
  showHelpTools(false);
  await invoke(window.coze.overlay(false)); $('help').focus();
}
$('help').addEventListener('click', () => openHelp().catch(() => {}));
$('empty-help').addEventListener('click', () => openHelp().catch(() => {}));
$('help-tools').addEventListener('click', () => showHelpTools($('tools-panel').hidden));
for (const [id, key] of Object.entries({'tool-remote':'remoteDisplay', 'tool-display':'displayControl', 'tool-catalog':'catalog', 'tool-brand':'brand'})) {
  $(id).addEventListener('click', async () => {
    $('tools-error').textContent = '';
    try {
      const result = await window.coze.openToolLink(key);
      if (!result.ok) throw new Error(result.error);
    } catch { $('tools-error').textContent = '未能打开浏览器，请稍后重试。'; }
  });
}
$('help-close').addEventListener('click', () => closeHelp().catch(() => {}));
$('help-dialog').addEventListener('cancel', event => { event.preventDefault(); closeHelp().catch(() => {}); });
window.coze.onHelp(() => openHelp().catch(() => {}));
function defaultAccountName(platform) { return `${platformLabel(platform)}账号 ${state.accounts.length + 1}`; }
$('platform-switch').addEventListener('click', () => invoke(window.coze.platformMenu()).catch(() => {}));
$('account-platform').addEventListener('change', () => {
  const input = $('account-name'), platform = $('account-platform').value;
  if (Object.keys(state.platforms || {}).some(id => input.value === defaultAccountName(id))) {
    input.value = defaultAccountName(platform);
    $('profile-name').checked = true;
  }
  $('profile-hint').textContent = '登录后自动读取当前账号的昵称与头像。';
});
$('add').addEventListener('click', () => editor().catch(() => {}));
$('edit').addEventListener('click', () => editor(state.selected).catch(() => {}));
$('cancel').addEventListener('click', () => closeEditor().catch(() => {}));
$('editor').addEventListener('cancel', event => { event.preventDefault(); closeEditor().catch(() => {}); });
$('form').addEventListener('submit', async event => { event.preventDefault();
  try { const name = $('account-name').value.trim(); if (!name) throw new Error('请填写账号名称。');
    if (editing) await invoke(window.coze.edit(editing, name, $('note').value, $('profile-name').checked, avatarMode, customAvatar));
    else await invoke(window.coze.add(name, $('note').value, $('profile-name').checked, $('account-platform').value));
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
$('delete-account').addEventListener('click', async () => {
  const id = editing; if (!id) return;
  try { await closeEditor(); await invoke(window.coze.deleteAccount(id)); } catch { /* invoke displays the error. */ }
});
$('pause').addEventListener('click', () => invoke(window.coze.pause(state.selected)).catch(() => {}));
$('resume').addEventListener('click', () => invoke(window.coze.select(state.selected)).catch(() => {}));
$('sync').addEventListener('click', () => invoke(window.coze.syncProfile(state.selected)).catch(() => {}));
$('recover-reload').addEventListener('click', () => invoke(window.coze.navigation('reload')).catch(() => {}));
$('recover-home').addEventListener('click', () => invoke(window.coze.navigation('home')).catch(() => {}));
$('choose-avatar').addEventListener('click', async () => {
  if (!editing) return;
  try { const value = await invoke(window.coze.chooseAvatar(editing));
    if (value) { avatarMode = 'custom'; customAvatar = value; previewAvatar(state.accounts.find(a => a.id === editing)); $('restore-avatar').disabled = false; }
  } catch (err) { $('form-error').textContent = err.message; }
});
$('restore-avatar').addEventListener('click', () => {
  avatarMode = 'sync'; previewAvatar(state.accounts.find(a => a.id === editing)); $('restore-avatar').disabled = true;
});
window.coze.onState(render); invoke(window.coze.state()).then(render).catch(() => {});
