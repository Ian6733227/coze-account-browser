'use strict';
const {test} = require('node:test'), assert = require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {promisify}=require('node:util'),execFile=promisify(require('node:child_process').execFile);
const {Store}=require('../src/store.cjs');
const {dispatcher,resolveAccount,pageURL}=require('../src/control.cjs');
const {createServer,request,endpoint,LIMIT}=require('../src/control-transport.cjs');
const {parse}=require('../src/cli.cjs');
const vm=require('node:vm');
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'coze-control-test-')),store=new Store(root);
  t.after(()=>{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(endpointDirectory,{recursive:true,force:true});});
  const endpointDirectory=endpoint(root).directory;
  const browser={selected:store.accounts[0].id,overlay:false,entries:new Map(),
    state:()=>({selected:browser.selected,sidebarCollapsed:store.sidebarCollapsed,accounts:store.accounts.map(a=>({...a,displayName:a.useProfileName&&a.profile.name?a.profile.name:a.name,running:true,loading:false,crashed:false}))}),
    select:id=>{browser.selected=id;},setSidebarCollapsed:value=>store.setSidebarCollapsed(value),openAll:()=>{}};
  const win={isMinimized:()=>false,show:()=>{},focus:()=>{}};
  return {root,store,browser,dispatch:dispatcher({store,browser,win,version:'synthetic'})};
}
function packet(command,extra={}) {return {v:1,requestId:'synthetic-request',command,...extra};}
function raw(socket,data) {
  return new Promise((resolve,reject)=>{const client=net.createConnection(socket);let result='';client.once('connect',()=>client.write(data));client.setEncoding('utf8');client.on('data',part=>result+=part);client.once('error',reject);client.once('end',()=>resolve(JSON.parse(result)));});
}
test('account selectors use full list numbers/IDs; same names and archived accounts are rejected',t=>{
  const {store}=fixture(t);store.edit(store.accounts[0].id,'同名','');store.edit(store.accounts[1].id,'同名','');
  assert.equal(resolveAccount(store,'2').id,store.accounts[1].id);
  assert.equal(resolveAccount(store,store.accounts[0].id).name,'同名');
  assert.throws(()=>resolveAccount(store,'同名'),{code:'AMBIGUOUS_ACCOUNT'});
  for(const value of ['0','-1','999',''])assert.throws(()=>resolveAccount(store,value));
  store.toggleArchive(store.accounts[0].id);assert.throws(()=>resolveAccount(store,'1'),{code:'ACCOUNT_ARCHIVED'});
  assert.throws(()=>resolveAccount(store,undefined,store.accounts[0].id),{code:'ACCOUNT_ARCHIVED'});
  assert.equal(resolveAccount(store,'2').id,store.accounts[1].id);
});
test('open permits official webpage URLs but rejects APIs, credentials, unsafe protocols and lookalike hosts',()=>{
  assert.equal(pageURL('https://www.coze.cn/project/123'),'https://www.coze.cn/project/123');
  for(const value of ['file:///etc/passwd','javascript:alert(1)','http://www.coze.cn/','https://coze.cn.attacker.example/','https://secret@coze.cn/','https://coze.cn:9443/','https://coze.cn/api/delete','https://coze.cn/%61pi/delete','https://coze.cn/session/%2e%2e%2fapi/delete','https://coze.cn/session/1?token=synthetic','https://coze.cn/passport/login','https://other.example/'])assert.throws(()=>pageURL(value),{code:'INVALID_URL'});
});
test('strict command protocol excludes evaluation, arbitrary files and actions during edit overlays',t=>{
  const {browser,dispatch}=fixture(t);
  assert.throws(()=>dispatch(packet('evaluate',{script:'synthetic'})),{code:'UNSUPPORTED_COMMAND'});
  assert.throws(()=>dispatch(packet('status',{cookies:true})),{code:'INVALID_REQUEST'});
  assert.throws(()=>dispatch({...packet('status'),v:2}),{code:'INVALID_REQUEST'});
  browser.overlay=true;assert.throws(()=>dispatch(packet('switch',{account:'2'})),{code:'UI_BUSY'});
  assert.ok(dispatch(packet('status')).accounts.length===5);
});
test('socket is private, JSON never exposes avatars/notes/auth, and external CLI changes the selected account',async t=>{
  const {root,store,browser,dispatch}=fixture(t);store.edit(store.accounts[0].id,'测试用户','synthetic-private-note');
  store.profile(store.accounts[0].id,'昵称','data:image/png;base64,c3ludGhldGlj');
  const api=await createServer(root,dispatch);t.after(()=>api.close());
  assert.equal(fs.statSync(endpoint(root).directory).mode&0o777,0o700);assert.equal(fs.statSync(api.socket).mode&0o777,0o600);
  const status=await request(root,'status');assert.equal(status.ok,true);assert.equal(status.result.accounts[0].name,'测试用户');
  const serialized=JSON.stringify(status);assert.equal(serialized.includes('synthetic-private-note'),false);assert.equal(serialized.includes('base64'),false);
  const cli=path.join(__dirname,'../src/cli.cjs');
  const reply=JSON.parse((await execFile(process.execPath,[cli,'switch','2','--data-root',root])).stdout);
  assert.equal(reply.ok,true);assert.equal(browser.selected,store.accounts[1].id);
  const invalid=await raw(api.socket,'not json\n');assert.equal(invalid.error.code,'INVALID_JSON');
  const oversized=await raw(api.socket,'x'.repeat(LIMIT+1)+'\n');assert.equal(oversized.error.code,'REQUEST_TOO_LARGE');
});
test('Unicode selector survives arbitrary socket packet fragmentation',async t=>{
  const {root,store,browser,dispatch}=fixture(t);store.edit(store.accounts[2].id,'中文图标','');
  const api=await createServer(root,dispatch);t.after(()=>api.close());
  const bytes=Buffer.from(JSON.stringify(packet('switch',{account:'中文图标'}))+'\n');
  const result=await new Promise((resolve,reject)=>{
    const client=net.createConnection(api.socket);let output='';client.setEncoding('utf8');client.once('error',reject);client.on('data',data=>output+=data);client.once('end',()=>resolve(JSON.parse(output)));
    client.once('connect',async()=>{for(const byte of bytes){client.write(Buffer.from([byte]));await new Promise(resolve=>setImmediate(resolve));}});
  });
  assert.equal(result.ok,true);assert.equal(browser.selected,store.accounts[2].id);
});
test('live sockets and substituted directories/files are not overwritten',async t=>{
  const f=fixture(t),api=await createServer(f.root,f.dispatch);t.after(()=>api.close());
  await assert.rejects(createServer(f.root,f.dispatch),/已有浏览器/);assert.equal((await request(f.root,'status')).ok,true);
  const g=fixture(t),target=endpoint(g.root);fs.symlinkSync(g.root,target.directory);
  await assert.rejects(createServer(g.root,g.dispatch),/权限不正确/);
  fs.unlinkSync(target.directory);fs.mkdirSync(target.directory,{mode:0o700});fs.writeFileSync(target.socket,'keep',{mode:0o600});
  await assert.rejects(createServer(g.root,g.dispatch),/权限不正确/);assert.equal(fs.readFileSync(target.socket,'utf8'),'keep');
});
test('client has a bounded timeout with no automatic resend',async t=>{
  const {root}=fixture(t),target=endpoint(root);fs.mkdirSync(target.directory,{mode:0o700});
  const clients=[],server=net.createServer(client=>{clients.push(client);client.on('error',()=>{});});
  await new Promise(resolve=>server.listen(target.socket,resolve));fs.chmodSync(target.socket,0o600);
  t.after(async()=>{for(const client of clients)client.destroy();await new Promise(resolve=>server.close(resolve));});
  await assert.rejects(request(root,'status',{},100),{code:'TIMEOUT'});assert.equal(clients.length,1);
});
test('a crashed process leaves only an owned stale socket which can be recovered',async t=>{
  const {root,dispatch}=fixture(t),target=endpoint(root);fs.mkdirSync(target.directory,{mode:0o700});
  await execFile(process.execPath,['-e',"require('node:net').createServer().listen(process.argv[1],()=>{require('node:fs').chmodSync(process.argv[1],0o600);process.exit(0);})",target.socket]);
  assert.equal(fs.lstatSync(target.socket).isSocket(),true);
  const api=await createServer(root,dispatch);t.after(()=>api.close());assert.equal((await request(root,'status')).ok,true);
});
test('CLI parser accepts selectors and isolated roots and rejects missing/unknown arguments',()=>{
  assert.equal(parse([]).command,'help');assert.equal(parse(['switch','2']).params.account,'2');
  assert.equal(parse(['open','https://coze.cn/','--account','5','--json']).params.account,'5');
  assert.equal(parse(['sidebar','collapse']).params.collapsed,true);
  for(const args of [['switch'],['status','--account','2'],['open','https://coze.cn/','extra'],['status','--timeout','0'],['eval','script'],['status','--data-root']])assert.throws(()=>parse(args));
});
test('new CLI status and launch fail explicitly on an existing older version without changing accounts', async t => {
  const {root,browser,dispatch}=fixture(t);const api=await createServer(root,dispatch);t.after(()=>api.close());const selected=browser.selected;
  for(const command of ['status','launch']){
    await assert.rejects(execFile(process.execPath,[path.join(__dirname,'../src/cli.cjs'),command,'--data-root',root]),error=>{
      assert.equal(error.code,1);const reply=JSON.parse(error.stdout);assert.equal(reply.error.code,'VERSION_MISMATCH');assert.match(reply.error.message,/synthetic/);return true;
    });
  }
  assert.equal(browser.selected,selected);
});
test('a server appearing on the second launch probe is version checked before reporting success', async () => {
  const expected=require('../package.json').version;
  for(const actual of ['2.3.1','99.0.0',expected]) {
    let probes=0;const output=[],processStub={argv:[],env:{},stdout:{write:s=>output.push(s)},exitCode:0};
    const mod={exports:{}};
    const filename=path.join(__dirname,'../src/cli.cjs');
    const context={module:mod,exports:mod.exports,__dirname:path.dirname(filename),process:processStub,setTimeout,clearTimeout,
      require:name=>name==='./control-transport.cjs'?{request:async()=>{if(++probes===1)throw Object.assign(new Error('absent'),{code:'ENOENT'});return {ok:true,result:{version:actual}};},endpoint:()=>({})}:
      name==='node:child_process'?{spawn:()=>{throw new Error('must not launch another GUI')}}:
      name.startsWith('../')||name.startsWith('./')?require(path.resolve(path.dirname(filename),name)):require(name)};
    vm.runInNewContext(fs.readFileSync(filename,'utf8'),context,{filename});
    await mod.exports.main(['launch']);const reply=JSON.parse(output.join(''));
    assert.equal(probes,2);assert.equal(reply.ok,actual===expected);
    if(actual!==expected){assert.equal(reply.error.code,'VERSION_MISMATCH');assert.equal(processStub.exitCode,1);}
    else assert.equal(processStub.exitCode,0);
  }
});
