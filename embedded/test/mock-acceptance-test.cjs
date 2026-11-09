'use strict';
// Synthetic acceptance suite (no real Coze account, no real network).
// Started through: electron . --self-test --mock-acceptance --data-root <tmp>
// (test/browser-test.cjs dispatches here). It covers, with simulated data only:
//   ID01  identity display: same nickname / same account twice / login switch / read failures
//   QA01  usage: upload isolation and concurrent download isolation
// Every https://*.coze.cn request is answered by session.protocol.handle('https', ...)
// inside each account's own Session; uploads/downloads use a 127.0.0.1 server.
const assert = require('node:assert/strict'), http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { createHash } = require('node:crypto');
const { BrowserWindow } = require('electron');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) {
  const end = Date.now() + 15000;
  while (Date.now() < end) { if (await fn()) return; await sleep(50); }
  throw new Error(`Timed out: ${label}`);
}
function withTimeout(promise, label, ms = 15000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), ms); })]).finally(() => clearTimeout(timer));
}
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
const UPLOAD_BYTES = 1024 * 1024, DOWNLOAD_BYTES = 2 * 1024 * 1024;
// Same formula runs inside the page (upload) and in Node (expected hash).
const uploadByte = (seed, k) => (k * 7 + seed * 31) & 255;
function uploadExpected(seed) {
  const bytes = Buffer.alloc(UPLOAD_BYTES);
  for (let k = 0; k < UPLOAD_BYTES; k++) bytes[k] = uploadByte(seed, k);
  return bytes;
}
function downloadContent(seed) {
  const bytes = Buffer.alloc(DOWNLOAD_BYTES);
  for (let k = 0; k < DOWNLOAD_BYTES; k++) bytes[k] = (k * 13 + seed * 57 + (k >> 8)) & 255;
  return bytes;
}
function parseMultipart(body, boundary) {
  const delimiter = Buffer.from('--' + boundary), parts = [];
  let position = body.indexOf(delimiter);
  while (position >= 0) {
    const next = body.indexOf(delimiter, position + delimiter.length);
    if (next < 0) break;
    const segment = body.subarray(position + delimiter.length, next), headEnd = segment.indexOf('\r\n\r\n');
    if (headEnd >= 0) parts.push({ head: segment.subarray(0, headEnd).toString('latin1'), data: segment.subarray(headEnd + 4, segment.length - 2) });
    position = next;
  }
  return parts;
}

exports.run = async ({ browser, store, root }) => {
  const iconBytes = fs.readFileSync(path.join(__dirname, '../assets/coze-official-logo.png'));
  // Store starts with five default entries; the suite needs at least six.
  while (store.accounts.filter(a => !a.archived).length < 6) store.add(`扣子账号 ${store.accounts.length + 1}`);
  assert.ok(store.accounts.length >= 6);
  const ids = store.accounts.slice(0, 6).map(a => a.id);
  const idOf = n => ids[n - 1];                    // 1-based account number, as in the sidebar
  const entryOf = n => browser.entries.get(idOf(n));
  const primary = n => entryOf(n).tabs.find(t => t.primary).view.webContents;
  const info = n => browser.state().accounts.find(a => a.id === idOf(n));
  const oneWindow = () => assert.equal(BrowserWindow.getAllWindows().length, 1);

  // ---- Local server for upload / download (QA01) -------------------------------------------
  const uploads = [], downloadLog = [], served = new Map();
  let activeDownloads = 0, maxActiveDownloads = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'POST' && url.pathname === '/upload') {
      const chunks = []; req.on('data', c => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks), boundary = /boundary=(.+)$/.exec(req.headers['content-type'] || '')?.[1];
        const file = boundary ? parseMultipart(body, boundary).find(p => /name="file"/.test(p.head)) : null;
        const record = { cookie: req.headers.cookie || '', bodyBytes: body.length, fileBytes: file?.data.length || 0, sha256: file ? sha256(file.data) : '' };
        uploads.push(record);
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ fileBytes: record.fileBytes, sha256: record.sha256 }));
      });
      return;
    }
    if (url.pathname === '/download') {
      const seed = Number(url.searchParams.get('seed')), content = downloadContent(seed);
      served.set(seed, sha256(content)); downloadLog.push({ seed, cookie: req.headers.cookie || '' });
      activeDownloads++; maxActiveDownloads = Math.max(maxActiveDownloads, activeDownloads);
      (async () => {
        // Hold the body until the other download has arrived so the two really overlap.
        const end = Date.now() + 5000; while (activeDownloads < 2 && Date.now() < end) await sleep(20);
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': content.length, 'Content-Disposition': 'attachment; filename="shared-name.bin"' });
        for (let at = 0; at < content.length; at += 65536) {
          if (!res.write(content.subarray(at, at + 65536))) await new Promise(r => res.once('drain', r));
          await sleep(5);
        }
        res.end();
      })().catch(() => res.destroy()).finally(() => { activeDownloads--; });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>Synthetic local account page</title><p>合成本机网页，没有真实登录资料</p>');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port, origin = `http://127.0.0.1:${port}`;

  // ---- Per-account simulated Coze (https) --------------------------------------------------
  // `table` is the mutable state controlling what each account's mock /passport API returns.
  const table = new Map();
  const setMock = (n, mode, user) => table.set(idOf(n), { mode, user });
  const installMock = n => {
    const id = idOf(n), ses = entryOf(n).session;
    try { ses.protocol.unhandle('https'); } catch { /* nothing registered yet */ }
    ses.protocol.handle('https', request => {
      const url = new URL(request.url);
      if (url.hostname === 'p3-passport.byteacctimg.com') return new Response(iconBytes, { headers: { 'Content-Type': 'image/png' } });
      if (url.pathname === '/passport/account/info/v2/') {
        const state = table.get(id);
        if (state.mode === 'http500') return new Response(JSON.stringify({ message: 'success', data: {} }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        if (state.mode === 'error-body') return Response.json({ message: 'error' });
        if (state.mode === 'network') return Response.error();
        return Response.json({ message: 'success', data: { user_id_str: state.user.id, name: state.user.name, avatar_url: 'https://p3-passport.byteacctimg.com/avatar.png', session_key: 'synthetic-not-exported' } });
      }
      return new Response(`<!doctype html><title>Synthetic Coze ${n}</title><p>合成扣子页面 ${n}</p>`, { headers: { 'Content-Type': 'text/html' } });
    });
  };
  const downloadHandlers = [];
  try {
    browser.home = origin + '/';
    browser.openAll();
    await until(() => ids.every(id => browser.entries.get(id)?.tabs.some(t => t.primary)), 'six primary pages created');
    for (let n = 1; n <= 6; n++) await until(() => !primary(n).isLoading() && primary(n).getURL().startsWith('http:'), `local page ${n}`);
    oneWindow();

    // ========================= QA01 (simulated): upload isolation ============================
    for (let n = 1; n <= 6; n++) {
      await withTimeout(primary(n).executeJavaScript(`document.cookie='qa-marker-${n}=acct-${n}; Max-Age=86400; SameSite=Lax'; true`), `cookie ${n}`);
    }
    for (let n = 1; n <= 6; n++) {
      const seed = n, before = uploads.length;
      const reply = await withTimeout(primary(n).executeJavaScript(`(async () => {
        const bytes = new Uint8Array(${UPLOAD_BYTES}); for (let k = 0; k < bytes.length; k++) bytes[k] = (k * 7 + ${seed} * 31) & 255;
        const form = new FormData(); form.append('label', 'acct-${n}'); form.append('file', new Blob([bytes]), 'synthetic-${n}.bin');
        const response = await fetch('/upload', { method: 'POST', body: form, credentials: 'same-origin' });
        return response.json();
      })()`), `upload ${n}`);
      assert.equal(uploads.length, before + 1);
      const seen = uploads.at(-1);
      assert.equal(seen.fileBytes, UPLOAD_BYTES, `account ${n} file size`);
      assert.equal(reply.fileBytes, UPLOAD_BYTES);
      assert.equal(seen.sha256, sha256(uploadExpected(seed)), `account ${n} bytes intact`);
      // The server must only ever see this account's own marker cookie.
      assert.equal(seen.cookie, `qa-marker-${n}=acct-${n}`, `account ${n} cookie header`);
      for (let other = 1; other <= 6; other++) if (other !== n) assert.equal(seen.cookie.includes(`qa-marker-${other}=`), false);
    }
    oneWindow();
    console.log('PASS mock QA01 upload isolation: six accounts each posted 1 MB via FormData; complete bytes and only the own marker Cookie reached the server');

    // ========================= QA01 (simulated): download isolation ==========================
    const downloadDir = path.join(root, 'mock-downloads'); fs.mkdirSync(downloadDir, { recursive: true });
    const finished = new Map();   // label -> { state, savePath }
    const watch = (n, label) => {
      const handler = (_event, item) => {
        // Set synchronously so no native save dialog is opened; the app's own listener only sets dialog options.
        const savePath = path.join(downloadDir, `${label}-${item.getFilename()}`);
        item.setSavePath(savePath);
        finished.set(label, new Promise(resolve => item.once('done', (_e, state) => resolve({ state, savePath }))));
      };
      entryOf(n).session.on('will-download', handler); downloadHandlers.push([entryOf(n).session, handler]);
    };
    watch(1, 'acct1'); watch(2, 'acct2');
    // Start from the page itself (a same-site top-level navigation that answers with Content-Disposition: attachment),
    // so the SameSite=Lax marker Cookie is sent exactly as in a real click on a download link.
    const clickDownload = (n, seed) => primary(n).executeJavaScript(`(() => { const a = document.createElement('a'); a.href = '/download?seed=${seed}'; document.body.appendChild(a); a.click(); a.remove(); return true; })()`);
    await withTimeout(Promise.all([clickDownload(1, 101), clickDownload(2, 202)]), 'start downloads');
    await until(() => finished.size === 2, 'both downloads started');
    const results = await withTimeout(Promise.all([finished.get('acct1'), finished.get('acct2')]), 'both downloads done', 30000);
    for (const result of results) assert.equal(result.state, 'completed');
    assert.notEqual(results[0].savePath, results[1].savePath);
    const hash1 = sha256(fs.readFileSync(results[0].savePath)), hash2 = sha256(fs.readFileSync(results[1].savePath));
    assert.equal(fs.statSync(results[0].savePath).size, DOWNLOAD_BYTES); assert.equal(fs.statSync(results[1].savePath).size, DOWNLOAD_BYTES);
    assert.equal(hash1, served.get(101)); assert.equal(hash2, served.get(202));
    assert.equal(hash1, sha256(downloadContent(101))); assert.equal(hash2, sha256(downloadContent(202)));
    assert.notEqual(hash1, hash2, 'two downloads must not overwrite each other');
    assert.equal(maxActiveDownloads, 2, 'downloads overlapped on the server');
    assert.equal(downloadLog.find(d => d.seed === 101).cookie, 'qa-marker-1=acct-1');
    assert.equal(downloadLog.find(d => d.seed === 202).cookie, 'qa-marker-2=acct-2');
    assert.equal(fs.readdirSync(downloadDir).filter(name => !name.endsWith('.crdownload')).length, 2);
    oneWindow();
    console.log('PASS mock QA01 download isolation: two accounts downloaded 2 MB concurrently; SHA-256 matches the server, files kept apart, only own Cookie sent, no save dialog');
    for (const [ses, handler] of downloadHandlers.splice(0)) ses.removeListener('will-download', handler);

    // ========================= ID01 (simulated): identity display ============================
    // Mock Coze users. user_id_str is what a real account would keep unique; the app itself only shows the name.
    const SAME_NAME = '同名测试用户';
    setMock(1, 'ok', { id: 'mock-uid-001', name: SAME_NAME });
    setMock(2, 'ok', { id: 'mock-uid-002', name: SAME_NAME });
    setMock(3, 'ok', { id: 'mock-uid-dup', name: '重复入口用户' });
    setMock(4, 'ok', { id: 'mock-uid-dup', name: '重复入口用户' });
    setMock(5, 'ok', { id: 'mock-uid-005', name: '独立用户五' });
    setMock(6, 'ok', { id: 'mock-uid-006', name: '独立用户六' });
    for (let n = 1; n <= 6; n++) installMock(n);
    const mockURL = n => `https://www.coze.cn/mock/${n}`;
    const profileIdle = n => until(() => { const check = browser.profileChecks.get(idOf(n)); return !check || !check.busy; }, `profile sync idle ${n}`);
    const loadMock = async n => {
      const wc = primary(n);
      await withTimeout(wc.loadURL(mockURL(n)).catch(error => { if (!/ERR_ABORTED/.test(String(error))) throw error; }), `load mock ${n}`);
      await until(() => !wc.isLoading() && wc.getURL() === mockURL(n), `mock page ${n} loaded`);
    };
    // reload + wait + explicit sync (profileIdle first: a busy sync would make a forced call return silently)
    const reloadAndSync = async (n, expectFailure) => {
      const wc = primary(n); wc.reload();
      await until(() => !wc.isLoading() && wc.getURL() === mockURL(n), `mock page ${n} reloaded`);
      await profileIdle(n);
      if (expectFailure) return browser.syncProfile(idOf(n), true);
      await browser.syncProfile(idOf(n), true);
    };
    for (let n = 1; n <= 6; n++) await loadMock(n);
    for (let n = 1; n <= 6; n++) {
      // The automatic sync after load normally confirms; force one if it was skipped so the suite does not depend on timing.
      await profileIdle(n);
      if (info(n).identityStatus !== 'confirmed') await browser.syncProfile(idOf(n), true);
      await until(() => info(n).identityStatus === 'confirmed', `account ${n} confirmed`);
    }
    oneWindow();

    // Per-account markers written inside each https page (cookie via the session, localStorage via the page).
    for (let n = 1; n <= 6; n++) {
      await entryOf(n).session.cookies.set({ url: 'https://www.coze.cn/', name: `mock-marker-${n}`, value: `acct-${n}`, secure: true, expirationDate: Math.floor(Date.now() / 1000) + 86400 });
      await withTimeout(primary(n).executeJavaScript(`localStorage.setItem('mock-marker','acct-${n}'); true`), `localStorage ${n}`);
    }
    const markerCookies = async n => (await entryOf(n).session.cookies.get({ url: 'https://www.coze.cn/' })).map(c => `${c.name}=${c.value}`);
    const storedMarker = n => withTimeout(primary(n).executeJavaScript(`localStorage.getItem('mock-marker')`), `read localStorage ${n}`);

    // --- Same nickname, different accounts -------------------------------------------------
    const apiUser = n => withTimeout(primary(n).executeJavaScript(`fetch('/passport/account/info/v2/?aid=510023').then(r => r.json()).then(b => b.data.user_id_str)`), `api user ${n}`);
    assert.notEqual(await apiUser(1), await apiUser(2), 'mock returns different user ids');
    assert.equal(info(1).identityStatus, 'confirmed'); assert.equal(info(2).identityStatus, 'confirmed');
    assert.equal(info(1).displayName, SAME_NAME); assert.equal(info(2).displayName, SAME_NAME);
    assert.notEqual(idOf(1), idOf(2)); assert.equal(store.get(idOf(1)).archived, false); assert.equal(store.get(idOf(2)).archived, false);
    assert.equal(new Set(store.accounts.map(a => a.id)).size, store.accounts.length);
    assert.equal(await storedMarker(1), 'acct-1'); assert.equal(await storedMarker(2), 'acct-2');
    assert.deepEqual(await markerCookies(1), ['mock-marker-1=acct-1']); assert.deepEqual(await markerCookies(2), ['mock-marker-2=acct-2']);
    console.log('PASS mock ID01 same nickname, different accounts: both confirmed with equal displayName, two separate entries, own Cookie/localStorage only');

    // --- Same account opened in two entries (2.3.5 baseline; there is no duplicate warning feature) ---
    // This only locks today's behaviour: neither entry is merged, hidden or deleted, and both show confirmed.
    const countBefore = store.accounts.length;
    assert.equal(await apiUser(3), await apiUser(4));
    await profileIdle(3); await profileIdle(4);
    await browser.syncProfile(idOf(3), true); await browser.syncProfile(idOf(4), true);
    assert.equal(info(3).identityStatus, 'confirmed'); assert.equal(info(4).identityStatus, 'confirmed');
    assert.equal(info(3).displayName, '重复入口用户'); assert.equal(info(4).displayName, '重复入口用户');
    assert.equal(store.accounts.length, countBefore); assert.equal(store.get(idOf(3)).archived, false); assert.equal(store.get(idOf(4)).archived, false);
    assert.notEqual(idOf(3), idOf(4)); assert.notEqual(entryOf(3).session, entryOf(4).session);
    console.log('PASS mock ID01 same account in two entries: both confirmed, not merged or removed, account count unchanged (2.3.5 has no duplicate warning; baseline only)');

    // --- Login changed inside an entry -----------------------------------------------------
    setMock(1, 'ok', { id: 'mock-uid-001-new', name: '换号后的用户' });
    await reloadAndSync(1);
    assert.equal(info(1).displayName, '换号后的用户'); assert.equal(info(1).identityStatus, 'confirmed');
    assert.equal(store.get(idOf(1)).profile.name, '换号后的用户');
    assert.equal(info(2).displayName, SAME_NAME);   // neighbours untouched
    console.log('PASS mock ID01 login changed in entry: after reload and sync the nickname follows the new user, still confirmed, other entries untouched');

    // --- Read failures must not look like a logout ------------------------------------------
    const subject = 5, cachedName = '独立用户五';
    assert.equal(info(subject).displayName, cachedName);
    const failures = [
      ['http500', 'HTTP 500'],
      ['error-body', "{message:'error'} body"],
      ['network', 'network error (Response.error())']
    ];
    for (const [mode, label] of failures) {
      setMock(subject, mode, null);
      await assert.rejects(reloadAndSync(subject, true), /账号信息暂未确认/);
      const state = info(subject);
      assert.equal(state.identityStatus, 'unconfirmed', `${label}: unconfirmed`);
      assert.equal(store.get(idOf(subject)).profile.name, cachedName, `${label}: stored nickname kept`);
      assert.equal(state.displayName, cachedName, `${label}: displayed nickname kept`);
      assert.equal(store.get(idOf(subject)).archived, false); assert.equal(state.archived, false);
      assert.deepEqual(await markerCookies(subject), [`mock-marker-${subject}=acct-${subject}`], `${label}: login Cookie still present`);
      assert.equal(await storedMarker(subject), `acct-${subject}`);
      assert.equal(info(6).identityStatus, 'confirmed');   // another account is not dragged along
      // Recover so the next variant starts from a confirmed state.
      setMock(subject, 'ok', { id: 'mock-uid-005', name: cachedName });
      await reloadAndSync(subject);
      assert.equal(info(subject).identityStatus, 'confirmed');
      console.log(`PASS mock ID01 read failure (${label}): sync reports 账号信息暂未确认, entry stays unconfirmed, cached nickname kept, not hidden, Cookie intact, recovers on next success`);
    }
    oneWindow();
    console.log('PASS mock acceptance (synthetic data, no real Coze account)');
  } finally {
    for (const [ses, handler] of downloadHandlers.splice(0)) ses.removeListener('will-download', handler);
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
};
