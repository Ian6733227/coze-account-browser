'use strict';
const { accountPageURL } = require('./control.cjs');
// Reuse the CLI's page allowlist. Never persist queries, fragments or login URLs.
function safeResumeURL(value, platform) {
  try { const url = new URL(accountPageURL(value, platform)); return url.origin + url.pathname; }
  catch { return null; }
}
module.exports = { safeResumeURL };
