'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const vm = require('node:vm'), { EventEmitter } = require('node:events');
const { Store } = require('../src/store.cjs');
const { dispatcher } = require('../src/control.cjs');
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
test('delete keeps the entry on clear failure and reports a list-save failure after clearing precisely',async t=>{
 const {browser,store}=fixture(t),id=store.accounts[0].id;browser.select(id);const entry=browser.entries.get(id);
 entry.session.clearData=async()=>{throw new Error('synthetic clear failure');};entry.session.clearAuthCache=async()=>{};
 await assert.rejects(browser.deleteAccount(id),/清除未完成/);assert.equal(store.get(id).id,id);assert.equal(browser.entries.has(id),true);
 entry.session.clearData=async()=>{};const remove=store.remove;store.remove=()=>{throw new Error('synthetic metadata failure');};
 await assert.rejects(browser.deleteAccount(id),e=>e.code==='ACCOUNT_REMOVE_FAILED'&&e.message.includes('登录资料已清除'));
 assert.equal(store.get(id).id,id);store.remove=remove;await browser.deleteAccount(id);assert.throws(()=>store.get(id));assert.equal(browser.entries.has(id),false);
});
test('delete timeout retains its entry even when late native clearing succeeds',async t=>{
 const {browser,store}=fixture(t),id=store.accounts[0].id;browser.select(id);const entry=browser.entries.get(id),gate=deferred();
 browser.saveTimeout=5;browser.closeTimeout=5;browser.clearTimeout=5;
 entry.session.clearData=()=>gate.promise;entry.session.clearAuthCache=async()=>{};
 await assert.rejects(browser.deleteAccount(id),{code:'CLEAR_TIMEOUT'});assert.equal(store.get(id).id,id);assert.throws(()=>browser.select(id),{code:'ACCOUNT_CLEARING'});
 const pending=entry.clearing;gate.resolve();await pending;assert.equal(store.get(id).id,id);assert.equal(entry.clearing,null);
});
test('deleting last account leaves an empty usable browser and has no post-commit UI write',async t=>{
 const {browser,store}=fixture(t),id=store.accounts[0].id;for(const a of store.accounts.slice(1))store.remove(a.id);
 browser.select(id);const entry=browser.entries.get(id);entry.session.clearData=async()=>{};entry.session.clearAuthCache=async()=>{};
 const remove=store.remove.bind(store);store.remove=value=>{remove(value);store.writeUI=()=>{throw new Error('no write allowed after deletion commit');};};
 await browser.deleteAccount(id);assert.deepEqual(store.accounts,[]);assert.equal(browser.selected,null);assert.equal(browser.state().accounts.length,0);assert.equal(browser.entries.size,0);
});
function fixture(t) {
  const sessions = new Map();
  class Contents extends EventEmitter {
    constructor() { super(); this.url=''; this.destroyed=false; }
    isDestroyed() { return this.destroyed; }
    isLoading() { return false; }
    getURL() { return this.url; }
    getTitle() { return 'Anonymous page'; }
    loadURL(url) { this.url=url; return Promise.resolve(); }
    setZoomMode() {}
    setWindowOpenHandler(fn) { this.openHandler=fn; }
    close() { if (this.holdClose) return; this.destroyed=true; this.emit('destroyed'); }
  }
  class View {
    constructor() { this.webContents=new Contents(); }
    setVisible(value) { this.visible=value; }
    setBounds() {}
  }
  const electron={WebContentsView:View,session:{fromPath(p) {
    if (!sessions.has(p)) sessions.set(p,{cookies:{flushStore:async()=>{}},flushStorageData(){},setPermissionRequestHandler(){},setPermissionCheckHandler(){},on(){}});
    return sessions.get(p);
  }}};
  const module={exports:{}};
  const customRequire = name => name==='electron' ? electron : name==='./identity.cjs' ?
    {trustedPage:()=>false,isDefaultAvatar:()=>false} : require(name.startsWith('./') ? '../src/' + name.slice(2) : name);
  const source=fs.readFileSync(process.env.COZE_BROWSER_SOURCE||path.join(__dirname,'../src/browser.cjs'),'utf8');
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`,{filename:'browser.cjs'})(customRequire,module,module.exports);
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'coze-lifecycle-'));
  const store=new Store(root),win=new EventEmitter();
  Object.assign(win,{isDestroyed:()=>false,getContentSize:()=>[1280,840],isMinimized:()=>false,show(){},focus(){}});
  win.contentView={children:[],addChildView(v){this.children.push(v);},removeChildView(v){this.children=this.children.filter(x=>x!==v);}};
  const browser=new module.exports.AccountBrowser(win,store,'https://example.invalid/');
  t.after(()=>{clearInterval(browser.profileTimer);fs.rmSync(root,{recursive:true,force:true});});
  return {browser,store,win,Contents};
}
test('archiving #2 never shifts keyboard #3 or CLI #3', t => {
  const {browser,store,win,Contents}=fixture(t),third=store.accounts[2].id;
  store.toggleArchive(store.accounts[1].id);
  const wc=new Contents();browser.shortcuts(wc);
  const press=key=>wc.emit('before-input-event',{preventDefault(){}},{type:'keyDown',meta:true,key});
  press('3');assert.equal(browser.selected,third);
  press('2');assert.equal(browser.selected,third);
  const dispatch=dispatcher({browser,store,win,version:'test'});
  assert.equal(dispatch({v:1,requestId:'fixed-number',command:'switch',account:'3'}).selected,third);
});
test('clearing login data owns only the target until both native clear operations settle', async t => {
  const {browser,store}=fixture(t),[a,b]=store.accounts;
  browser.select(a.id);browser.select(b.id);browser.select(a.id);
  store.profile(a.id,'Old identity','');store.profile(b.id,'Keep identity','');
  const before=JSON.stringify(store.get(b.id)),entry=browser.entries.get(a.id),other=browser.entries.get(b.id),gate=deferred();
  let clears=0;entry.session.clearData=async()=>{clears++;assert.equal(entry.tabs.length,0);await gate.promise;};entry.session.clearAuthCache=async()=>{};
  const job=browser.clearAccountData(a.id);
  for(let i=0;i<30&&clears===0;i++)await Promise.resolve();
  assert.equal(clears,1);assert.throws(()=>browser.select(a.id),{code:'ACCOUNT_CLEARING'});
  assert.throws(()=>browser.clearAccountData(a.id),{code:'ACCOUNT_CLEARING'});
  browser.select(b.id);assert.equal(other.tabs.length,1);assert.equal(JSON.stringify(store.get(b.id)),before);
  gate.resolve();await job;
  assert.equal(store.get(a.id).profile.name,'');assert.equal(store.get(a.id).id,a.id);assert.equal(store.get(a.id).name,a.name);
  assert.equal(JSON.stringify(store.get(b.id)),before);assert.equal(browser.state().accounts[0].clearing,false);
});
test('clear failure cannot release ownership while another clear operation is still running', async t => {
  const {browser,store}=fixture(t),id=store.accounts[0].id;browser.select(id);
  const entry=browser.entries.get(id),gate=deferred();let started=false;
  browser.saveTimeout=5;browser.closeTimeout=5;browser.clearTimeout=5;
  entry.session.clearData=async()=>{throw new Error('synthetic clear failure');};
  entry.session.clearAuthCache=async()=>{started=true;await gate.promise;};
  await assert.rejects(browser.clearAccountData(id),{code:'CLEAR_TIMEOUT'});
  assert.equal(started,true);assert.throws(()=>browser.select(id),{code:'ACCOUNT_CLEARING'});
  const pending=entry.clearing;gate.resolve();await assert.rejects(pending,/清除未完成/);
  assert.equal(entry.clearing,null);
});
test('pause owns its account until flushing and closing both finish', async t => {
  const {browser,store}=fixture(t),id=store.accounts[0].id,other=store.accounts[1].id;
  browser.select(id);const entry=browser.entries.get(id),wc=entry.tabs[0].view.webContents,gate=deferred();
  let flushes=0;entry.session.cookies.flushStore=()=>{flushes++;return gate.promise;};
  const first=browser.pause(id),again=browser.pause(id);
  assert.equal(first,again);assert.equal(browser.state().accounts[0].pausing,true);
  const reject=()=>assert.throws(()=>browser.select(id),e=>e.code==='ACCOUNT_PAUSING');
  reject();assert.throws(()=>browser.openPage(id,'https://www.coze.cn/session/anonymous'),e=>e.code==='ACCOUNT_PAUSING');
  browser.select(other);assert.equal(browser.selected,other);
  assert.equal(wc.openHandler({url:'https://www.coze.cn/'}).action,'deny');
  wc.holdClose=true;gate.resolve();await Promise.resolve();await Promise.resolve();reject();
  wc.holdClose=false;wc.close();await first;assert.equal(flushes,1);assert.equal(entry.tabs.length,0);
  assert.equal(browser.state().accounts[0].paused,true);assert.equal(browser.state().accounts[0].pausing,false);
  browser.select(id);assert.equal(entry.tabs.length,1);assert.notEqual(entry.tabs[0].view.webContents,wc);
});
test('simultaneous pauses retain separate guards and recover from flush failure', async t => {
  const {browser,store}=fixture(t),[a,b]=store.accounts;
  browser.select(a.id);browser.select(b.id);
  const one=browser.entries.get(a.id),two=browser.entries.get(b.id),ga=deferred(),gb=deferred();
  one.session.cookies.flushStore=()=>ga.promise;two.session.cookies.flushStore=()=>gb.promise;
  const pa=browser.pause(a.id),pb=browser.pause(b.id);
  ga.resolve();await pa;
  assert.throws(()=>browser.select(b.id),e=>e.code==='ACCOUNT_PAUSING');
  gb.reject(new Error('synthetic flush failure'));await assert.rejects(pb,/synthetic flush failure/);
  assert.equal(two.tabs.length,1);assert.equal(two.paused,false);assert.equal(browser.attached,two.tabs[0].view);
  browser.select(b.id);assert.equal(browser.selected,b.id);
});
test('dispose waits for an existing pause before flushing the same session again', async t => {
  const {browser,store}=fixture(t),id=store.accounts[0].id;browser.select(id);
  const entry=browser.entries.get(id),gate=deferred();let flushes=0;
  entry.session.cookies.flushStore=()=>{flushes++;return flushes===1?gate.promise:Promise.resolve();};
  const pause=browser.pause(id);await Promise.resolve();const dispose=browser.dispose();await Promise.resolve();
  assert.equal(flushes,1);gate.resolve();await pause;await dispose;assert.equal(entry.tabs.length,0);
});
test('critical selection and sidebar updates bypass batching; stale account actions are rejected', t => {
  const {browser,store}=fixture(t),sent=[];
  browser.onUpdate=urgent=>sent.push(urgent);browser.select(store.accounts[1].id);
  assert.ok(sent.includes(true));sent.length=0;browser.setSidebarCollapsed(true);assert.deepEqual(sent,[true]);
  const {requireCurrent}=require('../src/actions.cjs');
  assert.throws(()=>requireCurrent(browser,store.accounts[0].id),{code:'STALE_SELECTION'});
  assert.doesNotThrow(()=>requireCurrent(browser,store.accounts[1].id));
});
test('all popup paths share the page limit and background tabs retain the active page', t => {
  const {browser,store}=fixture(t),id=store.accounts[0].id;browser.select(id);
  const entry=browser.entries.get(id),primary=browser.activeTab(),handler=primary.view.webContents.openHandler;
  const popup=handler({url:'https://example.invalid/background',disposition:'background-tab'});
  assert.equal(popup.action,'allow');popup.createWindow({});assert.equal(entry.active,primary.id);
  while(entry.tabs.length<32)browser.makeTab(entry);
  assert.equal(handler({url:'https://example.invalid/next'}).action,'deny');
  assert.throws(()=>browser.makeTab(entry),{code:'PAGE_LIMIT'});assert.equal(entry.tabs.length,32);
});
test('successful home and CLI page navigation clear only the recovered page crash', t => {
  const {browser,store}=fixture(t),id=store.accounts[0].id;browser.select(id);
  const primary=browser.activeTab(),wc=primary.view.webContents;
  wc.emit('render-process-gone');assert.equal(browser.attached,null);
  browser.navigate('home');wc.emit('did-start-loading');wc.emit('did-stop-loading');
  assert.equal(primary.crashed,false);assert.equal(browser.state().accounts[0].crashed,false);assert.equal(browser.attached,primary.view);
  const other=browser.makeTab(browser.entries.get(id));browser.display();wc.emit('render-process-gone');
  assert.equal(browser.state().accounts[0].crashed,false);assert.equal(browser.state().accounts[0].backgroundError,true);assert.equal(browser.attached,other.view);
  browser.switchTab(primary.id);assert.equal(browser.attached,null);
  browser.openPage(id,wc.getURL());wc.emit('did-start-loading');wc.emit('did-stop-loading');assert.equal(primary.crashed,false);
});
test('a flush timeout retains the live view and ownership until the original write settles', async t => {
  const {browser,store}=fixture(t),id=store.accounts[0].id,other=store.accounts[1].id;browser.select(id);browser.saveTimeout=15;
  const entry=browser.entries.get(id),wc=browser.activeTab().view.webContents,gate=deferred();let count=0;
  entry.session.cookies.flushStore=()=>{count++;return gate.promise;};
  await assert.rejects(browser.pause(id),{code:'SAVE_TIMEOUT'});
  assert.equal(wc.isDestroyed(),false);assert.equal(entry.paused,false);assert.equal(count,1);
  assert.throws(()=>browser.select(id),{code:'ACCOUNT_SAVING'});browser.select(other);assert.equal(browser.selected,other);
  gate.resolve();await entry.flushing;assert.doesNotThrow(()=>browser.select(id));
});
test('close timeout is a visible failure and dispose still saves independent accounts', async t => {
  const {browser,store}=fixture(t),[a,b]=store.accounts;browser.select(a.id);browser.select(b.id);browser.closeTimeout=15;
  const one=browser.entries.get(a.id),two=browser.entries.get(b.id),wc=one.tabs[0].view.webContents;wc.holdClose=true;
  await assert.rejects(browser.pause(a.id),{code:'CLOSE_TIMEOUT'});assert.equal(one.paused,false);assert.equal(wc.listenerCount('destroyed'),1);
  let flushed=false;two.session.cookies.flushStore=async()=>{flushed=true;};
  await assert.rejects(browser.dispose(),/未确认/);assert.equal(flushed,true);assert.equal(two.tabs.length,0);assert.equal(one.tabs.length,1);
});
test('one failing close cannot release the account while another close is still pending', async t => {
  const {browser,store,Contents}=fixture(t),id=store.accounts[0].id;browser.select(id);browser.closeTimeout=100;
  const entry=browser.entries.get(id),first=entry.tabs[0].view.webContents,second=browser.makeTab(entry).view.webContents;
  first.close=()=>{throw new Error('synthetic first close failure');};second.holdClose=true;
  const pause=browser.pause(id);const rejection=assert.rejects(pause,/synthetic first close failure/);
  await new Promise(resolve=>setTimeout(resolve,5));assert.ok(entry.closing);
  assert.throws(()=>browser.select(id),{code:'ACCOUNT_PAUSING'});
  second.holdClose=false;Contents.prototype.close.call(second);await rejection;assert.equal(entry.closing,null);
});
