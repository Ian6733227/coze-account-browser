'use strict';
const { pageURL } = require('./control.cjs');
// Reuse the CLI's page allowlist. Never persist queries, fragments or login URLs.
function safeResumeURL(value) {
  try { const url = new URL(pageURL(value)); return url.origin + url.pathname; }
  catch { return null; }
}
module.exports = { safeResumeURL };
