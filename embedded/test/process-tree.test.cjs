'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePs, descendants, sumRss, summarize, accountCount } = require('../scripts/lib/process-tree.cjs');

// Hand-written `ps -axo pid=,ppid=,rss=` output; no real ps is called.
const SAMPLE = `    1     0   1000
  100     1  50000
  101   100  30000
  102   100  20000
  103   101  10000
  200     1  99999
  201   200   5000
`;

test('parsePs reads pid, ppid and rss and skips malformed lines', () => {
  const rows = parsePs(SAMPLE + '\nnot a row\n 12 x 5\n 7 3\n');
  assert.equal(rows.length, 7);
  assert.deepEqual(rows[1], { pid: 100, ppid: 1, rssKB: 50000 });
  assert.deepEqual(parsePs(''), []);
  assert.deepEqual(parsePs('  5 4 321\r\n  6 5 10\r\n'), [{ pid: 5, ppid: 4, rssKB: 321 }, { pid: 6, ppid: 5, rssKB: 10 }]);
});

test('descendants includes the root and every nested child, but not siblings', () => {
  const rows = parsePs(SAMPLE);
  assert.deepEqual(descendants(rows, 100), [100, 101, 102, 103]);
  assert.deepEqual(descendants(rows, 101), [101, 103]);
  assert.deepEqual(descendants(rows, 103), [103]);
  assert.deepEqual(descendants(rows, 200), [200, 201]);
});

test('descendants returns nothing for an exited root and survives odd tables', () => {
  assert.deepEqual(descendants(parsePs(SAMPLE), 4242), []);
  // A pid that is its own parent must not loop forever.
  assert.deepEqual(descendants([{ pid: 9, ppid: 9, rssKB: 1 }, { pid: 10, ppid: 9, rssKB: 1 }], 9), [9, 10]);
});

test('sumRss adds KB for the given pids once each', () => {
  const rows = parsePs(SAMPLE);
  assert.equal(sumRss(rows, descendants(rows, 100)), 50000 + 30000 + 20000 + 10000);
  assert.equal(sumRss(rows, new Set([200, 201])), 104999);
  assert.equal(sumRss(rows, [100, 100, 100]), 50000);
  assert.equal(sumRss(rows, []), 0);
  assert.equal(sumRss(rows, [4242]), 0);
});

test('summarize reports average, peak and sample count', () => {
  assert.deepEqual(summarize([100, 200, 600]), { samples: 3, avgKB: 300, peakKB: 600 });
  assert.deepEqual(summarize([]), { samples: 0, avgKB: 0, peakKB: 0 });
  assert.deepEqual(summarize([10, NaN, 20]), { samples: 2, avgKB: 15, peakKB: 20 });
});

test('accountCount defaults to 6 and clamps to 1-12', () => {
  assert.equal(accountCount(undefined), 6);
  assert.equal(accountCount(''), 6);
  assert.equal(accountCount('abc'), 6);
  assert.equal(accountCount('8'), 8);
  assert.equal(accountCount('0'), 1);
  assert.equal(accountCount('99'), 12);
  assert.equal(accountCount('-3'), 1);
});
