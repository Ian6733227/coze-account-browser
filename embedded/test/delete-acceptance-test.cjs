'use strict';
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {dialog,WebContentsView}=require('electron');
const {request}=require('../src/control-transport.cjs');
const {Store}=require('../src/store.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const end=Date.now()+15000;while(Date.now()<end){if(await fn())return;await sleep(40);}throw Error(label);}
async function ready(wc){await until(()=>!wc.isLoading()&&wc.getURL().startsWith('http:'),'anonymous load');}
const probe=wc=>wc.executeJavaScript('({cookie:document.cookie,value:localStorage.getItem("delete-marker")})');
exports.run=async({win,browser,store,root})=>{
 const server=http.createServer((_q,r)=>{r.writeHead(200,{'Content-Type':'text/html'});r.end('<!doctype html><title>Anonymous deletion fixture</title><p>Synthetic only</p>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));browser.home=`http://127.0.0.1:${server.address().port}/`;
 const checkpoint=path.join(root,'delete-acceptance.json'),original=dialog.showMessageBox;let resolver=null,lastPrompt;
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
  resolver=null;
  await win.webContents.executeJavaScript(`window.__deleteReply=window.coze.deleteAccount(${JSON.stringify(target)});null`);await until(()=>Boolean(resolver),'delete confirmation again');
  const targetEntry=browser.entries.get(target),others=store.accounts.filter(a=>a.id!==target).map(a=>({id:a.id,wc:browser.entries.get(a.id).tabs[0].view.webContents}));
  resolver({response:1});await until(()=>!browser.overlay,'delete completed');assert.equal((await win.webContents.executeJavaScript('window.__deleteReply')).ok,true);
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
 }finally{dialog.showMessageBox=original;if(browser.overlay&&resolver)resolver({response:0});await new Promise(r=>server.close(r));}
};
