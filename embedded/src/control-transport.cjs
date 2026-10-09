'use strict';
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const LIMIT = 16384;
function endpoint(root) {
  const canonical = fs.realpathSync(root);
  const digest = createHash('sha256').update(canonical).digest('hex').slice(0, 16);
  const directory = path.join('/tmp', `coze-browser-${process.getuid()}-${digest}`);
  return { directory, socket: path.join(directory, 'control.sock') };
}
function privateEndpoint(root, requireSocket = false) {
  const target = endpoint(root);
  const directory = fs.lstatSync(target.directory);
  if (!directory.isDirectory() || directory.uid !== process.getuid() || (directory.mode & 0o077)) throw new Error('本机控制目录权限不正确。');
  if (requireSocket) {
    const socket = fs.lstatSync(target.socket);
    if (!socket.isSocket() || socket.uid !== process.getuid() || (socket.mode & 0o077)) throw new Error('本机控制通道权限不正确。');
  }
  return target;
}
async function startServer(root, dispatch) {
  const target = endpoint(root);
  fs.mkdirSync(target.directory, { mode: 0o700 });
  // EEXIST is handled by the caller below; never follow a substituted symlink.
  return listen(target, root, dispatch);
}
async function listen(target, root, dispatch) {
  privateEndpoint(root);
  if (fs.existsSync(target.socket)) {
    privateEndpoint(root, true);
    const alive = await new Promise((resolve, reject) => {
      const probe = net.createConnection(target.socket);
      probe.once('connect', () => { probe.destroy(); resolve(true); });
      probe.once('error', error => { probe.destroy(); if (['ECONNREFUSED','ENOENT'].includes(error.code)) resolve(false); else reject(error); });
      probe.setTimeout(1000, () => { probe.destroy(); reject(new Error('已有控制通道未响应；未覆盖。')); });
    });
    if (alive) throw new Error('已有浏览器控制通道，未覆盖。');
    // Only an owned, private, stale socket is disposable. No account files touched.
    privateEndpoint(root, true); fs.unlinkSync(target.socket);
  }
  const clients = new Set(); let stopped = false, pending = 0, queue = Promise.resolve();
  const server = net.createServer(client => {
    clients.add(client); client.once('close', () => clients.delete(client)); client.on('error', () => {});
    client.setTimeout(5000, () => client.destroy());
    let bytes = 0, input = Buffer.alloc(0), handled = false;
    const reply = value => { if (!client.destroyed) client.end(JSON.stringify(value) + '\n'); };
    client.on('data', data => {
      if (handled) return;
      bytes += data.length;
      if (bytes > LIMIT) { handled = true; reply({ok:false, error:{code:'REQUEST_TOO_LARGE',message:'请求过大。'}}); return; }
      input = Buffer.concat([input,data]);
      const end = input.indexOf(10); if (end < 0) return;
      handled = true;
      let request;
      try { request = JSON.parse(input.subarray(0,end).toString('utf8')); }
      catch { reply({ok:false,error:{code:'INVALID_JSON',message:'请求必须是一行JSON。'}}); return; }
      const requestId = typeof request?.requestId === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(request.requestId) ? request.requestId : null;
      if (pending >= 32 || stopped) { reply({ok:false,requestId,error:{code:'BUSY',message:'浏览器忙，请稍后重试。'}}); return; }
      pending++;
      const task = queue.then(() => {
        if (client.destroyed || stopped) throw Object.assign(new Error('请求已取消。'), {code:'CANCELLED'});
        return dispatch(request);
      });
      queue = task.catch(() => {});
      task.then(result => reply({ok:true,requestId,result}), error => reply({ok:false,requestId,error:{code:error.code || 'COMMAND_FAILED',message:error.message || '操作未完成。'}})).finally(() => pending--);
    });
  });
  server.maxConnections = 32;
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(target.socket,resolve); });
  fs.chmodSync(target.socket,0o600); server.on('error', () => {});
  return { socket:target.socket, close:async () => {
    stopped = true; for (const client of clients) client.destroy();
    await new Promise(resolve => server.close(resolve)); await queue;
  } };
}
async function createServer(root, dispatch) {
  try { return await startServer(root,dispatch); }
  catch (error) { if (error.code !== 'EEXIST') throw error; return listen(endpoint(root),root,dispatch); }
}
function request(root, command, options = {}, timeout = 10000) {
  return new Promise((resolve,reject) => {
    let target;
    try { target = privateEndpoint(root,true); }
    catch (error) { reject(error); return; }
    const requestId = randomUUID(); const client = net.createConnection(target.socket);
    let output = Buffer.alloc(0), settled = false;
    const finish = (error,value) => { if (settled) return; settled = true; clearTimeout(timer); client.destroy(); if (error) reject(error); else resolve(value); };
    const timer = setTimeout(() => finish(Object.assign(new Error('控制请求超时；请先查询状态，不自动重复操作。'),{code:'TIMEOUT'})),timeout);
    client.once('connect', () => client.write(JSON.stringify({v:1,requestId,command,...options})+'\n'));
    client.on('data',data => {
      output = Buffer.concat([output,data]);
      if (output.length > 1024*1024) { finish(new Error('响应过大。')); return; }
      const end = output.indexOf(10); if (end < 0) return;
      try { const reply = JSON.parse(output.subarray(0,end).toString('utf8')); if (reply.requestId !== requestId) throw new Error('响应与请求不匹配。'); finish(null,reply); }
      catch (error) { finish(error); }
    });
    client.once('error',error => finish(error));
    client.once('end',() => { if (!settled) finish(new Error('控制通道提前关闭。')); });
  });
}
module.exports = { endpoint, createServer, request, privateEndpoint, LIMIT };
