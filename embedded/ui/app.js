'use strict';
const $ = id => document.getElementById(id);
let state = { accounts: [], tabs: [] }, editing = null, avatarMode = 'sync', customAvatar = '';
async function invoke(promise) {
  try { const result = await promise; if (!result.ok) throw new Error(result.error); return result.value; }
  catch (err) { $('message').textContent = err.message; $('message').className = 'error'; throw err; }
}
function selected() { return state.accounts.find(a => a.id === state.selected); }
function fillAvatar(element, value, fallback) {
  element.replaceChildren();
  if (value) { const img = document.createElement('img'); img.src = value; img.alt = ''; img.addEventListener('error', () => { element.textContent = fallback; }, {once:true}); element.append(img); }
  else element.textContent = fallback;
}
function initials(name) { return /^[a-z0-9]/i.test(name) ? Array.from(name).slice(0,2).join('').toUpperCase() : Array.from(name)[0] || '号'; }
function avatarColor(id) {
  const colors = ['#505fc7','#187867','#a44868','#8b5b26','#6852a3','#276fa0'];
  let hash = 0; for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return colors[hash % colors.length];
}
function pageStatus(account, current) {
  return account.crashed ? '网页已退出 · 请刷新' : account.pageError ? '加载失败 · 请刷新' : account.loading ? '加载中' :
    account.running ? (current ? '当前网页' : '后台运行') : account.paused ? '已暂停' : '网页未打开';
}
function render(value) {
  state = value; const current = selected();
  document.body.classList.toggle('sidebar-collapsed', state.sidebarCollapsed === true);
  const toggleLabel = state.sidebarCollapsed ? '展开账号侧栏' : '收起账号侧栏';
  $('sidebar-toggle').title = toggleLabel; $('sidebar-toggle').setAttribute('aria-label', toggleLabel);
  $('sidebar-toggle').setAttribute('aria-expanded', String(!state.sidebarCollapsed));
  const archivedRunning = state.accounts.filter(a => a.archived && a.running).length;
  $('count').textContent = `${state.accounts.filter(a => !a.archived).length} 个账号 · ${state.accounts.filter(a => a.running).length} 个网页运行中${archivedRunning ? `（含 ${archivedRunning} 个已停用）` : ''}`;
  const focusedAccount = document.activeElement?.closest('#accounts .account')?.dataset.accountId;
  const accountScroll = $('accounts').scrollTop;
  $('accounts').replaceChildren();
  state.accounts.filter(a => !a.archived || $('archived').checked || a.id === state.selected).forEach(a => {
    const button = document.createElement('button'); button.className = `account${a.id === state.selected ? ' active' : ''}`;
    button.dataset.accountId = a.id;
    button.setAttribute('aria-current', a.id === state.selected ? 'true' : 'false');
    const avatar = document.createElement('span'); avatar.className = 'avatar'; avatar.style.setProperty('--avatar-color', avatarColor(a.id)); fillAvatar(avatar, a.displayAvatar, initials(a.displayName));
    if (!a.displayAvatar || state.accounts.filter(other => other.displayName === a.displayName).length > 1) {
      const badge = document.createElement('span'); badge.className = 'account-number'; badge.textContent = String(state.accounts.indexOf(a) + 1); badge.setAttribute('aria-hidden', 'true'); button.append(badge);
    }
    const details = document.createElement('span'); details.className = 'account-details';
    const name = document.createElement('span'); name.className = 'account-name'; name.textContent = a.displayName;
    const status = document.createElement('span'); status.className = 'account-state';
    status.textContent = pageStatus(a, a.id === state.selected);
    if (a.archived) status.textContent += ' · 已停用';
    const dot = document.createElement('span'); dot.className = `dot ${a.crashed || a.pageError ? 'error' : a.loading ? 'loading' : a.running ? 'running' : ''}`;
    details.append(name, status); button.append(avatar, details, dot);
    button.title = `${a.displayName} · 账号 ${state.accounts.indexOf(a) + 1} · ${status.textContent}${a.note ? '\n' + a.note : ''}`;
    button.setAttribute('aria-label', `${a.displayName}，账号 ${state.accounts.indexOf(a) + 1}，${status.textContent}`);
    button.addEventListener('click', () => invoke(window.coze.select(a.id)).catch(() => {})); $('accounts').append(button);
  });
  if (focusedAccount) [...$('accounts').children].find(button => button.dataset.accountId === focusedAccount)?.focus({preventScroll:true});
  $('accounts').scrollTop = accountScroll;
  $('name').textContent = current?.displayName || '扣子账号浏览器';
  $('status').textContent = current ? pageStatus(current, true) : '选择账号开始';
  $('status').classList.toggle('error', Boolean(current?.crashed || current?.pageError));
  $('archive').textContent = current?.archived ? '恢复' : '停用';
  for (const id of ['edit','archive','pause','resume','sync']) $(id).disabled = !current;
  $('pause').disabled = !current?.running;
  $('sync').disabled = !current?.running || current?.syncing;
  $('sync').textContent = current?.syncing ? '同步中…' : '同步头像昵称';
  document.querySelector('.empty').style.display = current?.running ? 'none' : 'flex';
  $('message').textContent = state.error || '后台账号保持运行；暂停网页可释放该账号的网页内存。';
  $('message').className = state.error ? 'error' : '';
  const multiple = state.tabs.length > 1;
  document.querySelector('header').classList.toggle('multiple-pages', multiple);
  $('tabs').hidden = !multiple;
  $('tabs').replaceChildren(); if (multiple) state.tabs.forEach(tab => {
    const button = document.createElement('button'); button.className = `tab${tab.active ? ' active' : ''}`; button.textContent = tab.title;
    button.addEventListener('click', () => invoke(window.coze.tab(tab.id)).catch(() => {})); $('tabs').append(button);
    if (tab.active && !tab.primary) { const close = document.createElement('button'); close.className = 'close-tab'; close.textContent = '× 关闭此页';
      close.addEventListener('click', () => invoke(window.coze.closeTab()).catch(() => {})); $('tabs').append(close); }
  });
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
  $('avatar-editor').hidden = !id;
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
$('pause').addEventListener('click', () => invoke(window.coze.pause(state.selected)).catch(() => {}));
$('resume').addEventListener('click', () => invoke(window.coze.select(state.selected)).catch(() => {}));
$('sync').addEventListener('click', () => invoke(window.coze.syncProfile(state.selected)).catch(() => {}));
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
