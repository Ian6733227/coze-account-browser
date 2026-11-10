'use strict';
// Synthetic medium-weight page used for same-load memory measurements
// (test/memory-test.cjs inside the app, scripts/brave-baseline.cjs in Brave).
// ~2000 DOM nodes shaped like a chat list plus one timer that touches one node per second.
// Self-contained: no external resources, no real account data. Do not require electron here
// (the Brave baseline loads this file from plain Node).
const http = require('node:http');
const MESSAGES = 400;            // 400 rows x 5 nodes (row, avatar, name, time, text) = 2000 nodes
function buildPage() {
  const rows = [];
  for (let i = 0; i < MESSAGES; i++) {
    const own = i % 3 === 0;
    rows.push(`<div class="row${own ? ' own' : ''}" id="r${i}"><span class="av">${String.fromCharCode(65 + (i % 26))}</span>` +
      `<b class="nm">${own ? 'Me' : 'Agent ' + (i % 7)}</b><i class="tm">10:${String(i % 60).padStart(2, '0')}</i>` +
      `<p class="tx">Synthetic message ${i}: lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor ${i * 7919 % 1000}.</p></div>`);
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>Synthetic memory page</title><style>
body{font:13px system-ui;margin:0}#list{height:100vh;overflow:auto}.row{display:grid;grid-template-columns:32px 1fr auto;gap:2px 8px;padding:6px 10px;border-bottom:1px solid #eee}
.row.own{background:#eef4ff}.av{grid-row:1/3;width:28px;height:28px;border-radius:50%;background:#9ab;color:#fff;text-align:center;line-height:28px}
.nm{font-weight:600}.tm{color:#888}.tx{grid-column:2/4;margin:0}</style></head><body><div id="list">${rows.join('')}</div><script>
let tick=0;setInterval(()=>{tick++;const n=document.getElementById('r'+(tick%${MESSAGES})).querySelector('.tx');n.textContent='Synthetic message updated at tick '+tick+' ('+new Date().toISOString()+')'},1000);
</script></body></html>`;
}
// Returns { server, port, url, nodes, close() }; url ends with "/" and every path serves the same page.
async function createMemoryServer() {
  const html = buildPage();
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  return { server, port, url: `http://127.0.0.1:${port}/`, nodes: MESSAGES * 5,
    close: () => { server.closeAllConnections?.(); return new Promise(resolve => server.close(resolve)); } };
}
module.exports = { createMemoryServer, MESSAGES };
