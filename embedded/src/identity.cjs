'use strict';
const { createHash } = require('node:crypto');
// Fingerprint of the site's shared anonymous person icon after our 128px PNG
// normalization. Keep other images, including custom copies, unchanged.
const DEFAULT_AVATAR_SHA256 = '6aaa55801d67d4ef68aa74eb15b456af47be69f42f739b8a34ed479293efdba1';
function isDefaultAvatar(value) {
  if (typeof value !== 'string' || !value.startsWith('data:image/png;base64,')) return false;
  return createHash('sha256').update(Buffer.from(value.slice(22), 'base64')).digest('hex') === DEFAULT_AVATAR_SHA256;
}
const PAGE_HOSTS = {
  coze: ['coze.cn', 'www.coze.cn', 'space.coze.cn'],
  doubao: ['doubao.com', 'www.doubao.com'],
  workbuddy: ['workbuddy.cn', 'www.workbuddy.cn'],
  aily: ['aily.feishu.cn'],
  qwenwork: ['qwenwork.cn', 'www.qwenwork.cn']
};
const BYTE_AVATAR_HOSTS = ['byteacctimg.com', 'byteimg.com', 'ibyteimg.com', 'pstatp.com', 'douyinpic.com', 'bytedance.net'];
const AVATAR_HOSTS = {
  coze: ['coze.cn', ...BYTE_AVATAR_HOSTS],
  doubao: ['doubao.com', ...BYTE_AVATAR_HOSTS],
  workbuddy: ['workbuddy.cn', 'qlogo.cn', 'qpic.cn', 'tencent-cloud.net'],
  aily: ['feishu.cn', 'feishucdn.com', 'larksuitecdn.com', ...BYTE_AVATAR_HOSTS],
  qwenwork: ['qwenwork.cn', 'alicdn.com', 'dingtalk.com', 'dingding.xin']
};
function httpsHost(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.port && !url.username && !url.password ? url.hostname : null;
  } catch { return null; }
}
function trustedPage(value, platform = 'coze') {
  return Object.hasOwn(PAGE_HOSTS, platform) && PAGE_HOSTS[platform].includes(httpsHost(value));
}
function trustedAvatar(value, platform = 'coze') {
  const host = httpsHost(value);
  return Boolean(host && Object.hasOwn(AVATAR_HOSTS, platform) &&
    AVATAR_HOSTS[platform].some(domain => host === domain || host.endsWith('.' + domain)));
}
// Executed only in the account's trusted main page. Return only its own public
// display identity; never return cookies, tokens, chat text or the full response.
const PROFILE_SCRIPT = `(async () => {
  const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), 8000);
  try {
    const response = await fetch('/passport/account/info/v2/?aid=510023', {
      method: 'GET', credentials: 'same-origin', signal:abort.signal
    });
    if (!response.ok) return null;
    const body = await response.json();
    if (body.message !== 'success') return null;
    const user = body.data;
    if (!user || !(user.user_id_str || user.user_id || user.uid)) return null;
    const name = user.name || user.screen_name || user.nickname;
    if (typeof name !== 'string' || !name.trim() || name.length > 80) return null;
    return {name:name.trim(), avatarURL:typeof user.avatar_url === 'string' ? user.avatar_url : ''};
  } catch { return null; } finally { clearTimeout(timer); }
})()`;
// Each reader runs in its account's own first-party page. Read only the
// display fields from the same identity source that powers its account menu.
function readDoubao() {
  const image = document.querySelector('img[data-testid="chat_header_avatar_button"]');
  const name = image?.nextElementSibling?.textContent?.trim();
  if (name) return {name, avatarURL: image.currentSrc || image.src};
  const layout = window._ROUTER_DATA?.loaderData?.chat_layout;
  for (const page of [layout?.chat_layout, layout]) {
    const user = page?.accountInfo?.data;
    if (user && !user.error_code && (user.user_id_str || user.user_id || user.uid)) {
      return {name:user.name || user.screen_name || user.nickname, avatarURL:user.avatar_url};
    }
  }
  return null;
}
function readAily() {
  const button = document.querySelector('[data-testid="sidebar_footer_user_menu_trigger"]');
  const image = button?.querySelector('img');
  const name = image?.alt || button?.querySelector('span.truncate')?.textContent;
  return { name, avatarURL: image?.currentSrc || image?.src };
}
function readWorkBuddy() {
  const trigger = document.querySelector('button.user-menu-trigger[data-track-id="user_avatar_menu"]');
  const image = trigger?.querySelector('.user-menu-trigger-avatar-img, .user-menu-trigger-avatar img');
  const name = trigger?.querySelector('.user-menu-trigger-name')?.textContent || image?.alt;
  return { name, avatarURL: image?.currentSrc || image?.src };
}
function readQwenWork() {
  try {
    const profile = JSON.parse(sessionStorage.getItem('qwen-work.auth-identity.v1'));
    if (profile?.version === 1 && profile.userId && Number.isFinite(profile.cachedAt) &&
        Date.now() - profile.cachedAt >= 0 && Date.now() - profile.cachedAt < 15 * 60 * 1000) {
      return { name: profile.displayName, avatarURL: profile.avatarUrl };
    }
  } catch { /* Logged-out and malformed identity caches are ignored. */ }
  return null;
}
const PROFILE_READERS = {doubao: readDoubao, aily: readAily, workbuddy: readWorkBuddy, qwenwork: readQwenWork};
function profileScript(platform) {
  if (platform === 'coze') return PROFILE_SCRIPT;
  if (!Object.hasOwn(PROFILE_READERS, platform)) throw new Error('未知的平台。');
  const reader = PROFILE_READERS[platform];
  return `(${reader.toString()})()`;
}

function avatarData(bytes) {
  const { nativeImage } = require('electron');
  if (!bytes?.length || bytes.length > 8 * 1024 * 1024) throw new Error('请选择小于 8 MB 的头像图片。');
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) throw new Error('这张图片无法用作头像，请选择 PNG、JPG 或 WebP。');
  const size = image.getSize();
  if (size.width > 8192 || size.height > 8192) throw new Error('头像图片尺寸过大，请选择较小的图片。');
  // Fit then crop a square, keeping a compact local PNG independent of expiring CDN URLs.
  const edge = Math.min(size.width, size.height);
  const square = image.crop({ x: Math.floor((size.width - edge) / 2), y: Math.floor((size.height - edge) / 2), width: edge, height: edge });
  return square.resize({ width: 128, height: 128, quality: 'best' }).toDataURL();
}
async function fetchAvatar(ses, value, platform = 'coze') {
  if (!trustedAvatar(value, platform)) return '';
  const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), 8000);
  try {
    // Public CDN requests carry no account cookies or authorization headers.
    const response = await ses.fetch(value, { credentials: 'omit', redirect: 'error', signal: abort.signal });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/') || Number(response.headers.get('content-length')) > 2 * 1024 * 1024) return '';
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > 2 * 1024 * 1024) { abort.abort(); return ''; } chunks.push(Buffer.from(chunk)); }
    return avatarData(Buffer.concat(chunks));
  } catch { return ''; } finally { clearTimeout(timer); }
}
module.exports = { trustedPage, trustedAvatar, PROFILE_SCRIPT, profileScript, avatarData, fetchAvatar, isDefaultAvatar };
