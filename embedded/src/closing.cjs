'use strict';
function deadline(promise, milliseconds, code, message) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(message), { code })), milliseconds);
  })]).finally(() => clearTimeout(timer));
}
function flushEntry(entry, milliseconds) {
  // A timeout does not cancel Electron's write. Keep ownership until it settles.
  if (!entry.flushing) {
    const pending = Promise.resolve().then(() => entry.session.cookies.flushStore()).then(() => entry.session.flushStorageData());
    entry.flushing = pending;
    const release = () => { if (entry.flushing === pending) entry.flushing = null; };
    pending.then(release, release);
  }
  return deadline(entry.flushing, milliseconds, 'SAVE_TIMEOUT', '保存尚未确认，网页已保留；请稍后检查。');
}
function closeContents(wc, milliseconds) {
  if (wc.isDestroyed()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timer;
    const finish = error => { clearTimeout(timer); wc.removeListener('destroyed', closed); error ? reject(error) : resolve(); };
    const closed = () => finish();
    wc.once('destroyed', closed);
    timer = setTimeout(() => finish(Object.assign(new Error('网页关闭尚未确认，请稍后重试。'), { code: 'CLOSE_TIMEOUT' })), milliseconds);
    try { wc.close({ waitForBeforeUnload: false }); } catch (error) { finish(error); }
  });
}
async function closeTabs(tabs, milliseconds) {
  const results = await Promise.allSettled(tabs.map(tab => closeContents(tab.view.webContents, milliseconds)));
  const failure = results.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
}
module.exports = { deadline, flushEntry, closeContents, closeTabs };
