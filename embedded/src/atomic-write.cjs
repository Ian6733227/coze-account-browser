'use strict';
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');

// Rename is the commit point. All fallible permission/write/close operations
// happen on our exclusive temporary file before it replaces the destination.
// This does not promise power-loss durability (no fsync is performed).
function atomicWrite(file, text) {
  const temp = file + `.tmp-${randomUUID()}`;
  let fd = null, created = false;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    created = true;
    fs.fchmodSync(fd, 0o600);
    fs.writeFileSync(fd, text, 'utf8');
    const closing = fd;
    fd = null; // close may release the descriptor even when it reports an error.
    fs.closeSync(closing);
    fs.renameSync(temp, file);
  } catch (error) {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* Preserve the original failure. */ } }
    if (created) { try { fs.unlinkSync(temp); } catch { /* Never delete any other temporary or session file. */ } }
    throw error;
  }
}
module.exports = { atomicWrite };
