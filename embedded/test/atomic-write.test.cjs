'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {atomicWrite}=require('../src/atomic-write.cjs');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'coze-atomic-'));t.after(()=>fs.rmSync(root,{recursive:true}));const file=path.join(root,'state.json');fs.writeFileSync(file,'old',{mode:0o600});return{root,file};}
for(const operation of ['fchmodSync','writeFileSync','closeSync'])test(`atomic write: ${operation} failure preserves old file and removes only own temp`,t=>{
 const {root,file}=fixture(t),unrelated=file+'.tmp-preexisting';fs.writeFileSync(unrelated,'keep');
 const original=fs[operation];let injected=false;
 fs[operation]=(...args)=>{if(!injected){injected=true;if(operation==='closeSync')original(...args);throw Object.assign(Error('SYNTHETIC_IO_FAILURE'),{code:'EIO'});}return original(...args);};
 try{assert.throws(()=>atomicWrite(file,'new'),{code:'EIO'});}finally{fs[operation]=original;}
 assert(injected);assert.equal(fs.readFileSync(file,'utf8'),'old');assert.equal(fs.readFileSync(unrelated,'utf8'),'keep');assert.deepEqual(fs.readdirSync(root).sort(),['state.json','state.json.tmp-preexisting']);
});
test('atomic write: reported close error is never retried on a potentially reused descriptor',t=>{
 const {root,file}=fixture(t),close=fs.closeSync;let released=null,reused=null,calls=0;
 fs.closeSync=fd=>{calls++;close(fd);released=fd;reused=fs.openSync(path.join(root,'other-operation'),'w',0o600);throw Object.assign(Error('SYNTHETIC_CLOSE_EIO'),{code:'EIO'});};
 try{assert.throws(()=>atomicWrite(file,'new'),{code:'EIO'});}finally{fs.closeSync=close;}
 try{assert.equal(calls,1);assert.notEqual(released,null);assert(fs.fstatSync(reused).isFile());fs.writeFileSync(reused,'still-open');}finally{if(reused!==null)close(reused);}
 assert.equal(fs.readFileSync(file,'utf8'),'old');assert.equal(fs.readFileSync(path.join(root,'other-operation'),'utf8'),'still-open');
});
test('atomic write: exclusive-create collision never removes the preexisting file',t=>{
 const {root,file}=fixture(t),original=fs.openSync;let attempted;
 fs.openSync=(p,flags,mode)=>{attempted=p;assert.equal(flags,'wx');assert.equal(mode,0o600);const other=original(p,'w',0o600);try{fs.writeFileSync(other,'other-writer');}finally{fs.closeSync(other);}return original(p,flags,mode);};
 try{assert.throws(()=>atomicWrite(file,'new'),{code:'EEXIST'});}finally{fs.openSync=original;}
 assert.equal(fs.readFileSync(file,'utf8'),'old');assert.equal(fs.readFileSync(attempted,'utf8'),'other-writer');assert.equal(fs.readdirSync(root).length,2);
});
test('atomic write: cleanup failure preserves the original error and unrelated files',t=>{
 const {root,file}=fixture(t),rename=fs.renameSync,unlink=fs.unlinkSync;
 fs.renameSync=()=>{throw Object.assign(Error('SYNTHETIC_RENAME_FAILURE'),{code:'EROFS'});};fs.unlinkSync=()=>{throw Object.assign(Error('SYNTHETIC_CLEANUP_FAILURE'),{code:'EACCES'});};
 try{assert.throws(()=>atomicWrite(file,'new'),{code:'EROFS'});}finally{fs.renameSync=rename;fs.unlinkSync=unlink;}
 assert.equal(fs.readFileSync(file,'utf8'),'old');assert.equal(fs.readdirSync(root).filter(n=>n.startsWith('state.json.tmp-')).length,1);
});
