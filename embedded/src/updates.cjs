'use strict';
// Page events often arrive in a burst. Build the latest UI snapshot once per
// burst, without delaying account switching or synchronous CLI state queries.
function coalesceUpdates(send, delay = 50, schedule = setTimeout, unschedule = clearTimeout) {
  let pending = null;
  const notify = () => {
    if (pending !== null) return;
    pending = schedule(() => { pending = null; send(); }, delay);
  };
  notify.cancel = () => { if (pending !== null) unschedule(pending); pending = null; };
  notify.flush = () => { notify.cancel(); send(); };
  return notify;
}
module.exports = { coalesceUpdates };
