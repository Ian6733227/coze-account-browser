'use strict';
function requireCurrent(browser, id) {
  if (!id || id !== browser.selected) throw Object.assign(new Error('当前账号已变化，请确认账号后重试。'), { code: 'STALE_SELECTION' });
}
module.exports = { requireCurrent };
