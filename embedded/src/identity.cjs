'use strict';
const { nativeImage } = require('electron');
const { createHash } = require('node:crypto');
// Fingerprint of the site's shared anonymous person icon after our 128px PNG
// normalization. Keep other images, including custom copies, unchanged.
const DEFAULT_AVATAR_SHA256 = '6aaa55801d67d4ef68aa74eb15b456af47be69f42f739b8a34ed479293efdba1';
function isDefaultAvatar(value) {
  if (typeof value !== 'string' || !value.startsWith('data:image/png;base64,')) return false;
  return createHash('sha256').update(Buffer.from(value.slice(22), 'base64')).digest('hex') === DEFAULT_AVATAR_SHA256;
}
const TRUSTED_PAGES = new Set(['coze.cn', 'www.coze.cn', 'space.coze.cn']);
const AVATAR_HOSTS = ['coze.cn', 'byteacctimg.com', 'byteimg.com', 'ibyteimg.com', 'pstatp.com', 'douyinpic.com', 'bytedance.net'];
function trustedPage(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.port && TRUSTED_PAGES.has(url.hostname); } catch { return false; }
}
function trustedAvatar(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.port && !url.username && !url.password && AVATAR_HOSTS.some(host => url.hostname === host || url.hostname.endsWith('.' + host)); } catch { return false; }
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
function avatarData(bytes) {
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
async function fetchAvatar(ses, value) {
  if (!trustedAvatar(value)) return '';
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
module.exports = { trustedPage, trustedAvatar, PROFILE_SCRIPT, avatarData, fetchAvatar, isDefaultAvatar };
