'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {Store}=require('../src/store.cjs');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'coze-review-'));t.after(()=>fs.rmSync(root,{recursive:true}));return{root,store:new Store(root)};}
function failure(code){return Object.assign(new Error('INJECTED_'+code),{code});}
test('review: no post-commit filesystem failure can report an uncommitted account save',t=>{
 const {store}=fixture(t),id=store.accounts[0].id,original={};let committed=false;
 for(const name of ['renameSync','chmodSync','fchmodSync','closeSync','fsyncSync'])original[name]=fs[name];
 fs.renameSync=(a,b)=>{const result=original.renameSync(a,b);if(b===store.file)committed=true;return result;};
 for(const name of ['chmodSync','fchmodSync','closeSync','fsyncSync'])fs[name]=(...args)=>{if(committed)throw failure('EIO_AFTER_COMMIT');return original[name](...args);};
 let error;try{store.edit(id,'合成提交名称','合成备注');}catch(e){error=e;}finally{for(const [name,fn]of Object.entries(original))fs[name]=fn;}
 const disk=JSON.parse(fs.readFileSync(store.file,'utf8')).find(a=>a.id===id);
 assert.equal(committed,true);assert.equal(disk.name,'合成提交名称');assert.equal(store.get(id).name,disk.name,'committed disk and memory disagree');assert.equal(error,undefined,'post-commit error falsely reports failure');
});
test('review: failed account rename preserves old bytes, state and unrelated session and leaves no own temporary',t=>{
 const {store,root}=fixture(t),id=store.accounts[0].id,before=fs.readFileSync(store.file),state=JSON.stringify(store.accounts);
 const session=store.sessionPath(id);fs.mkdirSync(session,{recursive:true});fs.writeFileSync(path.join(session,'synthetic-marker'),'keep');
 const rename=fs.renameSync;fs.renameSync=(a,b)=>{if(b===store.file)throw failure('EROFS');return rename(a,b);};
 try{assert.throws(()=>store.edit(id,'未提交名称','未提交备注'),{code:'EROFS'});}finally{fs.renameSync=rename;}
 assert.deepEqual(fs.readFileSync(store.file),before);assert.equal(JSON.stringify(store.accounts),state);assert.equal(fs.readFileSync(path.join(session,'synthetic-marker'),'utf8'),'keep');assert.equal(fs.readdirSync(root).some(n=>n.includes('.tmp-')),false,'failed save leaked a temporary file');
});
test('review: failed UI rename preserves UI disk and memory and leaves no own temporary',t=>{
 const {store,root}=fixture(t);store.setSidebarCollapsed(false);const before=fs.readFileSync(store.uiFile);const rename=fs.renameSync;
 fs.renameSync=(a,b)=>{if(b===store.uiFile)throw failure('EACCES');return rename(a,b);};
 try{assert.throws(()=>store.setSidebarCollapsed(true),{code:'EACCES'});}finally{fs.renameSync=rename;}
 assert.equal(store.sidebarCollapsed,false);assert.deepEqual(fs.readFileSync(store.uiFile),before);assert.equal(fs.readdirSync(root).some(n=>n.includes('.tmp-')),false,'failed UI save leaked a temporary file');
});
test('review: restrictive umask still produces private owner-readable/writable account and UI files',t=>{
 const {store}=fixture(t),previous=process.umask(0o777);
 try{store.edit(store.accounts[0].id,'合成私有名称','');store.setSidebarCollapsed(true);}finally{process.umask(previous);}
 assert.equal(fs.statSync(store.file).mode&0o777,0o600);assert.equal(fs.statSync(store.uiFile).mode&0o777,0o600);
});
test('review: invalid existing config is preserved and never replaced by defaults',t=>{
 const {store,root}=fixture(t);const bad=Buffer.from('{invalid dummy config');fs.writeFileSync(store.file,bad);assert.throws(()=>new Store(root),e=>e.message.includes(root)&&e.message.includes('请截图此提示联系维护者')&&!e.message.includes('invalid dummy config'));assert.deepEqual(fs.readFileSync(store.file),bad);assert.equal(fs.readdirSync(root).some(n=>n.includes('.tmp-')),false);
});
