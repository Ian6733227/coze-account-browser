'use strict';
// Pure Node helpers for summing the memory of a process tree from `ps -axo pid=,ppid=,rss=`.
// Never imports electron; unit-tested in test/process-tree.test.cjs.

// Parse `ps -axo pid=,ppid=,rss=` output into [{ pid, ppid, rssKB }]. Malformed lines are skipped.
function parsePs(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(line);
    if (match) rows.push({ pid: Number(match[1]), ppid: Number(match[2]), rssKB: Number(match[3]) });
  }
  return rows;
}

// Sorted pids of rootPid and all of its descendants. Returns [] when rootPid is not in rows
// (the process has already exited), so callers never count an unrelated pid.
function descendants(rows, rootPid) {
  const children = new Map(), known = new Set();
  for (const row of rows) {
    known.add(row.pid);
    if (!children.has(row.ppid)) children.set(row.ppid, []);
    children.get(row.ppid).push(row.pid);
  }
  if (!known.has(rootPid)) return [];
  const seen = new Set([rootPid]), queue = [rootPid];
  while (queue.length) {
    for (const child of children.get(queue.shift()) || []) {
      if (!seen.has(child)) { seen.add(child); queue.push(child); }
    }
  }
  return [...seen].sort((a, b) => a - b);
}

// Total RSS in KB of the listed pids (array or Set; each pid counted once).
function sumRss(rows, pids) {
  const wanted = new Set(pids), counted = new Set();
  let total = 0;
  for (const row of rows) {
    if (wanted.has(row.pid) && !counted.has(row.pid)) { counted.add(row.pid); total += row.rssKB; }
  }
  return total;
}

// Average / peak / count of a list of numbers (KB), rounded to whole KB.
function summarize(values) {
  const numbers = values.filter(Number.isFinite);
  if (!numbers.length) return { samples: 0, avgKB: 0, peakKB: 0 };
  return { samples: numbers.length, avgKB: Math.round(numbers.reduce((a, b) => a + b, 0) / numbers.length), peakKB: Math.max(...numbers) };
}

// Parse the shared COZE_MEMORY_ACCOUNTS setting: integer 1-12, default 6.
function accountCount(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(12, Math.max(1, parsed)) : 6;
}
module.exports = { parsePs, descendants, sumRss, summarize, accountCount };
