'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const fs = require('node:fs'), path = require('node:path');
// Deliberately an offline DOM model: verifies node identity and event routing,
// not layout, paint, Electron IPC or native-window behavior.
function fixture() {
  let document;
  class Element {
    constructor() { this.children=[];this.dataset={};this.attrs={};this.events={};this.style={setProperty(){}};this.classList={toggle(){}};this.value='';this.checked=false;this.hidden=false;this.scrollTop=0; }
    set textContent(value) { this.text=String(value);for(const child of this.children)child.parent=null;this.children=[]; }
    get textContent() { return this.text||''; }
    get firstChild() { return this.children[0]||null; }
    replaceChildren(...nodes) { this.textContent='';this.append(...nodes); }
    append(...nodes) { for(const node of nodes)this.insertBefore(node,null); }
    insertBefore(node,before) { node.remove();node.parent=this;this.children.splice(before?this.children.indexOf(before):this.children.length,0,node); }
    remove() { if(this.parent){this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;} }
    setAttribute(k,v) { this.attrs[k]=v; }
    getAttribute(k) { return this.attrs[k]; }
    removeAttribute(k) { delete this.attrs[k]; }
    addEventListener(k,fn) { (this.events[k]||=[]).push(fn); }
    emit(k,event={preventDefault(){}}) { if(k==='click'&&this.disabled)return;for(const fn of this.events[k]||[])fn(event); }
    focus() { document.activeElement=this; }
    select() {}
    showModal() { this.open=true; }
    close() { this.open=false; }
    closest() { return this.dataset.accountId?this:null; }
  }
  const ids=new Map(),empty=new Element(),header=new Element();
  for(const match of fs.readFileSync(path.join(__dirname,'../ui/index.html'),'utf8').matchAll(/id="([^"]+)"/g))ids.set(match[1],new Element());
  document={body:new Element(),activeElement:null,getElementById:id=>ids.get(id),createElement:()=>new Element(),querySelector:s=>s==='.empty'?empty:s==='header'?header:null};
  const accounts=Array.from({length:5},(_,i)=>({id:`a${i+1}`,name:`账号${i+1}`,displayName:`账号${i+1}`,displayAvatar:i===0?'data:image/png;base64,one':'',profile:{name:`昵称${i+1}`,avatar:'data:image/png;base64,synced'},customAvatar:'data:image/png;base64,custom',avatarMode:'sync',useProfileName:true,running:true}));
  const state={selected:'a1',accounts,tabs:[]},calls=[];let render;
  const ok=value=>Promise.resolve({ok:true,value});
  const coze={onState:fn=>{render=fn;},onHelp(){},state:()=>new Promise(()=>{}),select:id=>{calls.push(['select',id]);return ok();},tab:id=>{calls.push(['tab',id]);return ok();},closeTab:()=>ok(),overlay:()=>ok(),chooseAvatar:()=>ok('data:image/png;base64,new'),edit:(...args)=>{calls.push(['edit',...args]);return ok();}};
  for(const name of ['sidebar','archive','pause','syncProfile','add'])coze[name]=()=>ok();
  const context=vm.createContext({document,window:{coze}});
  vm.runInContext(fs.readFileSync(process.env.COZE_UI_SOURCE||path.join(__dirname,'../ui/app.js'),'utf8'),context);
  render(state);
  return {state,calls,ids,document,context,render};
}
test('100 unchanged UI updates retain account and image nodes, focus and scroll', () => {
  const {state,render,ids,document}=fixture(),parent=ids.get('accounts'),rows=[...parent.children],avatar=rows[0].children.find(x=>x.className==='avatar'),image=avatar.children[0];
  rows[2].focus();parent.scrollTop=91;
  for(let i=0;i<100;i++)render(structuredClone(state));
  assert.ok(rows.every((row,i)=>parent.children[i]===row));assert.equal(avatar.children[0],image);
  assert.equal(document.activeElement,rows[2]);assert.equal(parent.scrollTop,91);
});
test('changing one avatar, filtering archives and clicking a retained row keep fixed identity', () => {
  const {state,render,ids,calls}=fixture(),parent=ids.get('accounts'),first=parent.children[0],third=parent.children[2],avatar=first.children.find(x=>x.className==='avatar'),image=avatar.children[0];
  state.accounts[0].displayAvatar='data:image/png;base64,two';state.accounts[1].archived=true;render(state);
  assert.notEqual(avatar.children[0],image);const updatedImage=avatar.children[0];image.emit('error');assert.equal(avatar.children[0],updatedImage);assert.equal(parent.children[1],third);
  const badge=third.children.find(x=>x.className==='account-number');assert.equal(badge.textContent,'3');
  third.emit('click');assert.deepEqual(calls,[['select','a3']]);
  ids.get('archived').checked=true;render(state);assert.equal(parent.children[2],third);assert.equal(parent.children[0],first);
});
test('pause state disables only the closing account and its actions; unchanged tabs are retained', () => {
  const {state,render,ids}=fixture();state.tabs=[{id:'tab1',title:'扣子',primary:true,active:true},{id:'tab2',title:'其他页',primary:false,active:false}];render(state);
  const firstTab=ids.get('tabs').children[0];state.accounts[0].pausing=true;render(state);
  assert.equal(ids.get('status').textContent,'正在关闭网页…');assert.equal(ids.get('accounts').children[0].disabled,true);assert.equal(ids.get('accounts').children[1].disabled,false);
  for(const id of ['pause','resume','sync'])assert.equal(ids.get(id).disabled,true,id);
  assert.equal(ids.get('tabs').children[0],firstTab);assert.equal(firstTab.disabled,true);
  state.accounts[0].pausing=false;render(state);assert.equal(ids.get('pause').disabled,false);
});
test('editor preserves custom avatar data and restores the synced avatar across updates', async () => {
  const {state,render,ids,context}=fixture();state.accounts[0].avatarMode='custom';state.accounts[0].displayAvatar=state.accounts[0].customAvatar;render(state);
  await vm.runInContext('editor("a1")',context);
  assert.equal(ids.get('avatar-preview').children[0].src,'data:image/png;base64,custom');
  render(structuredClone(state));assert.equal(ids.get('avatar-preview').children[0].src,'data:image/png;base64,custom');
  ids.get('restore-avatar').emit('click');assert.equal(ids.get('avatar-preview').children[0].src,'data:image/png;base64,synced');
  assert.equal(ids.get('restore-avatar').disabled,true);
});
test('adding an account without any avatar opens the editor with a fallback', async () => {
  const {ids,context}=fixture();await vm.runInContext('editor()',context);
  assert.equal(ids.get('avatar-preview').firstChild.src,'platform-icons/coze.png');assert.equal(ids.get('editor').open,true);
  assert.equal(ids.get('account-name').value,'扣子账号 6');
});
test('a failed current page has clear recovery actions; background errors do not cover a healthy page', () => {
  const {state,render,ids,document}=fixture();state.accounts[0].crashed=true;state.accounts[0].pageError='synthetic failure';render(state);
  assert.equal(document.querySelector('.empty').style.display,'flex');assert.equal(ids.get('recover-reload').hidden,false);assert.equal(ids.get('recover-home').hidden,false);assert.equal(ids.get('resume').hidden,true);
  state.accounts[0].crashed=false;state.accounts[0].pageError='';state.accounts[0].backgroundError=true;render(state);
  assert.equal(document.querySelector('.empty').style.display,'none');assert.equal(ids.get('recover-reload').hidden,true);
});


test('accounts use the matching local platform icon until a personal image is available', () => {
  const {state,render,ids}=fixture();
  state.platforms={ coze:{label:'扣子'}, doubao:{label:'豆包'} };
  state.accounts[1].platform='doubao';
  render(state);
  const row=ids.get('accounts').children[1];
  const avatar=row.children.find(x=>x.className==='avatar');
  const badge=row.children.find(x=>x.className==='account-number');
  assert.equal(avatar.firstChild.src,'platform-icons/doubao.png');
  assert.equal(badge.hidden,false);
  state.accounts[1].displayAvatar='data:image/png;base64,personal';
  render(state);
  assert.equal(badge.hidden,false);
  assert.equal(avatar.firstChild.src,state.accounts[1].displayAvatar);
  avatar.firstChild.emit('error');
  assert.equal(avatar.firstChild.src,'platform-icons/doubao.png');
  render(state);
  assert.equal(badge.hidden,false);
  state.platformView='doubao'; render(state);
  assert.equal(ids.get('accounts').children.length,1);
  assert.equal(badge.textContent,'2');
});
