'use strict';
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {dialog,Menu,WebContentsView}=require('electron');
const {request}=require('../src/control-transport.cjs');
const {Store}=require('../src/store.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const end=Date.now()+15000;while(Date.now()<end){if(await fn())return;await sleep(40);}throw Error(label);}
async function ready(wc){await until(()=>!wc.isLoading()&&wc.getURL().startsWith('http:'),'anonymous load');}
const probe=wc=>wc.executeJavaScript('({cookie:document.cookie,value:localStorage.getItem("delete-marker")})');
exports.run=async({win,browser,store,root})=>{
 const server=http.createServer((_q,r)=>{r.writeHead(200,{'Content-Type':'text/html'});r.end('<!doctype html><title>Anonymous deletion fixture</title><p>Synthetic only</p>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));browser.home=`http://127.0.0.1:${server.address().port}/`;
 const checkpoint=path.join(root,'delete-acceptance.json'),original=dialog.showMessageBox,originalPopup=Menu.prototype.popup;let resolver=null,lastPrompt;
 try{
  if(fs.existsSync(checkpoint)){
   const plan=JSON.parse(fs.readFileSync(checkpoint));assert.equal(store.accounts.length,0);assert.equal(browser.entries.size,0);
   await until(async()=>await win.webContents.executeJavaScript('document.querySelector("#empty-title").textContent==="还没有账号"'),'empty restart UI');
   await win.webContents.executeJavaScript('document.querySelector("#add").click();null');
   await until(()=>browser.overlay,'add editor');
   await win.webContents.executeJavaScript('document.querySelector("#account-name").value="重新添加的合成账号";document.querySelector("#form").requestSubmit();null');
   await until(()=>store.accounts.length===1&&!browser.overlay,'add after empty restart');await ready(browser.activeTab().view.webContents);
   assert.equal(plan.removed.includes(store.accounts[0].id),false);assert.deepEqual(await probe(browser.activeTab().view.webContents),{cookie:'',value:null});
   console.log('PASS delete restart preserves empty list; adding uses a new identity and no old login data');return;
  }
  store.add('删除合成账号6');browser.openAll();const originalIds=store.accounts.map(a=>a.id),target=store.accounts[1].id;
  for(const [n,a]of store.accounts.entries()){
   const wc=browser.entries.get(a.id).tabs[0].view.webContents;await ready(wc);
   await wc.executeJavaScript(`document.cookie='delete-marker=fixture-${n}; Max-Age=86400; SameSite=Lax';localStorage.setItem('delete-marker','fixture-${n}')`);
  }
  store.edit(target,'同名合成账号','',false);store.edit(store.accounts[2].id,'同名合成账号','',false);browser.select(target);store.toggleArchive(target);browser.onUpdate(true);
  const stale=await win.webContents.executeJavaScript(`window.coze.deleteAccount(${JSON.stringify(originalIds[0])})`);assert.equal(stale.ok,false);assert.equal(store.accounts.length,6);
  dialog.showMessageBox=async(_w,options)=>{lastPrompt=options;return new Promise(r=>{resolver=r;});};
  await win.webContents.executeJavaScript('document.querySelector("#edit").click();null');await until(()=>browser.overlay,'edit current hidden account');
  win.setSize(960,650);
  const visible=await win.webContents.executeJavaScript(`new Promise(resolve=>requestAnimationFrame(()=>{const b=document.querySelector('#delete-account');b.scrollIntoView({block:'nearest'});const r=b.getBoundingClientRect(),d=document.querySelector('#editor').getBoundingClientRect();resolve(r.width>0&&r.height>0&&r.top>=d.top&&r.bottom<=d.bottom&&r.bottom<=innerHeight);}));`);
  assert.equal(visible,true,'delete action reachable in smallest supported window');
  fs.writeFileSync(path.join(root,'delete-editor.png'),(await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript('document.querySelector("#delete-account").click();null');await until(()=>Boolean(resolver),'named delete confirmation');
  assert.ok(lastPrompt.message.includes('同名合成账号'));assert.ok(lastPrompt.detail.includes('账号编号 2'));assert.ok(lastPrompt.detail.includes('不会注销扣子网站账号'));assert.equal(lastPrompt.defaultId,0);assert.equal(lastPrompt.cancelId,0);
  assert.equal((await request(root,'switch',{account:'1'})).error.code,'UI_BUSY');
  resolver({response:0});await until(()=>!browser.overlay,'delete canceled');assert.equal(store.accounts.length,6);assert.equal((await probe(browser.activeTab().view.webContents)).value,'fixture-1');
  console.log('PASS delete button names current hidden entry and fixed number; cancel preserves it; CLI blocked during confirmation');
  // Execute the real IPC, menu template and callbacks without interacting
  // with the desktop pointer or accepting any real account dialog.
  const row = id => `document.querySelector('[data-account-id="${id}"]')`;
  const dispatch = (id,event) => win.webContents.executeJavaScript(`${row(id)}.dispatchEvent(${event}); null`);
  let menuCalls = 0;
  let action = '下移一位';
  Menu.prototype.popup = function (options) {
    menuCalls++;
    assert.equal(options.window, win);
    const item = this.items.find(item => item.label === action);
    if (item) {
      assert.equal(item.enabled, true);
      item.click();
    }
    options.callback();
  };
  await dispatch(originalIds[0], 'new MouseEvent("contextmenu", {bubbles:true,button:2,clientX:8,clientY:20})');
  await until(()=>menuCalls===1&&store.sidebarOrder[1]===originalIds[0],'right click moves the row');
  assert.equal(browser.selected,target);
  assert.deepEqual(store.accounts.map(a=>a.id),originalIds);
  assert.deepEqual(new Store(root).sidebarOrder,store.sidebarOrder);
  assert.deepEqual(await win.webContents.executeJavaScript('Array.from(document.querySelectorAll(".account")).slice(0,2).map(a=>a.dataset.accountId)'),[target,originalIds[0]]);
  action = '上移一位';
  await dispatch(originalIds[0], 'new MouseEvent("dblclick", {bubbles:true,button:0,detail:2})');
  await until(()=>menuCalls===2&&store.sidebarOrder[0]===originalIds[0],'double click opens menu and moves the row back');
  action = 'Dismiss';
  await dispatch(originalIds[0], 'new PointerEvent("pointerdown", {bubbles:true,button:0,clientX:10,clientY:25})');
  await dispatch(originalIds[0], 'new PointerEvent("pointermove", {bubbles:true,button:0,clientX:30,clientY:25})');
  await sleep(600);
  assert.equal(menuCalls,2,'moving the pointer cancels the long press');
  await dispatch(originalIds[0], 'new PointerEvent("pointerdown", {bubbles:true,button:0,clientX:10,clientY:25})');
  await until(()=>menuCalls===3,'long press opens menu');
  await dispatch(originalIds[0], 'new PointerEvent("pointerup", {bubbles:true,button:0})');
  await dispatch(originalIds[0], 'new MouseEvent("click", {bubbles:true,button:0,detail:1})');
  assert.equal(browser.selected,target,'releasing long press does not select a different account');
  console.log('PASS right click, double click and long press open the account menu; order persists and numeric IDs stay fixed');

  resolver=null;
  action = '删除账号…';
  browser.select(originalIds[0]);
  assert.equal(browser.selected,originalIds[0]);
  await win.webContents.executeJavaScript('document.querySelector("#archived").click();null');
  await dispatch(target, 'new KeyboardEvent("keydown", {bubbles:true,key:"F10",shiftKey:true})');
  await until(()=>menuCalls===4&&Boolean(resolver),'row menu delete confirmation');
  assert.ok(lastPrompt.message.includes('同名合成账号'));
  assert.ok(lastPrompt.detail.includes('账号编号 2'));
  assert.equal(lastPrompt.cancelId,0);
  assert.equal(browser.selected,originalIds[0],'deleting a different row does not change the active page');
  const targetEntry=browser.entries.get(target),others=store.accounts.filter(a=>a.id!==target).map(a=>({id:a.id,wc:browser.entries.get(a.id).tabs[0].view.webContents}));
  resolver({response:1});await until(()=>!browser.overlay,'delete completed');
  assert.equal(store.accounts.length,5);assert.equal(browser.entries.has(target),false);assert.throws(()=>store.get(target));
  await until(async()=>await win.webContents.executeJavaScript(`!document.querySelector('[data-account-id="${target}"]')`),'row removed');
  for(const item of others){const n=originalIds.indexOf(item.id);assert.equal(browser.entries.get(item.id).tabs[0].view.webContents.id,item.wc.id);assert.deepEqual(await probe(item.wc),{cookie:`delete-marker=fixture-${n}`,value:`fixture-${n}`});}
  const view=new WebContentsView({webPreferences:{session:targetEntry.session,sandbox:true,contextIsolation:true,nodeIntegration:false}});
  await view.webContents.loadURL(browser.home);assert.deepEqual(await probe(view.webContents),{cookie:'',value:null});view.webContents.close();
  console.log('PASS confirmed delete removes only target entry and cookie/localStorage; other five running identities remain unchanged');
  dialog.showMessageBox=async()=>({response:1});
  for(const a of [...store.accounts]){browser.select(a.id);const reply=await win.webContents.executeJavaScript(`window.coze.deleteAccount(${JSON.stringify(a.id)})`);assert.equal(reply.ok,true);}
  assert.equal(browser.selected,null);assert.equal(browser.entries.size,0);assert.deepEqual(new Store(root).accounts,[]);
  await until(async()=>await win.webContents.executeJavaScript('document.querySelector("#empty-title").textContent==="还没有账号"'),'last delete empty UI');
  assert.equal((await request(root,'accounts')).result.accounts.length,0);
  fs.writeFileSync(checkpoint,JSON.stringify({removed:originalIds})+'\n');
  console.log('PASS last entry can be deleted; empty metadata survives reload without generating default accounts');
 }finally{Menu.prototype.popup=originalPopup;dialog.showMessageBox=original;if(browser.overlay&&resolver)resolver({response:0});await new Promise(r=>server.close(r));}
};
