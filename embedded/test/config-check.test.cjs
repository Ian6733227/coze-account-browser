'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../src/store.cjs'),{inspect}=require('../scripts/check-account-config.cjs');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'coze-config-check-'));t.after(()=>fs.rmSync(root,{recursive:true}));return{root,store:new Store(root)};}
function snapshot(root){const rows=[];for(const name of fs.readdirSync(root)){const p=path.join(root,name),s=fs.lstatSync(p);rows.push([name,s.mode,s.isFile()?fs.readFileSync(p).toString('base64'):s.isSymbolicLink()?fs.readlinkSync(p):'directory']);}return JSON.stringify(rows);}
test('config checker does not create a missing root or disclose an input path',t=>{const {root}=fixture(t),missing=path.join(root,'not-created');const r=inspect(missing);assert.equal(r.status,'error');assert.equal(fs.existsSync(missing),false);assert.equal(JSON.stringify(r).includes(root),false);});
test('valid never-opened accounts need no session directory and checker makes no writes',t=>{
 const {root,store}=fixture(t);store.edit(store.accounts[0].id,'TEST_PRIVATE_NAME','TEST_PRIVATE_NOTE');const before=snapshot(root),original={};
 for(const n of ['writeFileSync','mkdirSync','renameSync','unlinkSync','chmodSync']){original[n]=fs[n];fs[n]=()=>{throw Error('READ_ONLY_VIOLATION');};}
 let r;try{r=inspect(root);}finally{for(const [n,fn]of Object.entries(original))fs[n]=fn;}
 assert.equal(r.status,'ok');assert.equal(r.accountCount,5);assert.equal(r.accountsWithoutSessionDirectory,5);assert.equal(snapshot(root),before);assert(!JSON.stringify(r).includes('TEST_PRIVATE_'));
});
test('stale config reports unmatched session count without session IDs or content',t=>{
 const {root,store}=fixture(t),other='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';fs.mkdirSync(store.sessionPath(store.accounts[0].id),{recursive:true});fs.mkdirSync(path.join(root,'Sessions',other));fs.writeFileSync(path.join(root,'Sessions',other,'Cookies'),'TEST_PRIVATE_CONTENT');
 const r=inspect(root);assert.equal(r.status,'warning');assert.equal(r.matchedSessionDirectoryCount,1);assert.equal(r.unmatchedSessionDirectoryCount,1);assert(!JSON.stringify(r).includes(other));assert(!JSON.stringify(r).includes('TEST_PRIVATE_CONTENT'));assert.equal(fs.readFileSync(path.join(root,'Sessions',other,'Cookies'),'utf8'),'TEST_PRIVATE_CONTENT');
});
test('invalid JSON is preserved and no raw private value is emitted',t=>{const {root,store}=fixture(t),bad='{"TEST_PRIVATE_JSON":';fs.writeFileSync(store.file,bad);const r=inspect(root);assert.equal(r.configStatus,'invalid_or_unreadable');assert.equal(fs.readFileSync(store.file,'utf8'),bad);assert(!JSON.stringify(r).includes('TEST_PRIVATE_JSON'));});
test('config and session symlinks are rejected without following or modifying targets',t=>{
 const {root,store}=fixture(t),target=path.join(root,'synthetic-target');fs.mkdirSync(target);const marker=path.join(target,'private.json');fs.writeFileSync(marker,'TEST_PRIVATE_TARGET',{mode:0o600});fs.unlinkSync(store.file);fs.symlinkSync(marker,store.file);fs.symlinkSync(target,path.join(root,'Sessions'));
 const r=inspect(root);assert.equal(r.configStatus,'unsafe');assert(r.warnings.includes('UNSAFE_SESSIONS_DIRECTORY'));assert.equal(r.sessionDirectoryCount,null);assert.equal(r.matchedSessionDirectoryCount,null);assert.equal(fs.readFileSync(marker,'utf8'),'TEST_PRIVATE_TARGET');assert(!JSON.stringify(r).includes('TEST_PRIVATE_TARGET'));
});
test('root symlink is rejected and large metadata is a read-limit result, not a repair',t=>{
 const {root,store}=fixture(t),link=path.join(root,'link');fs.symlinkSync(root,link);assert(inspect(link).warnings.includes('UNSAFE_DIRECTORY'));fs.writeFileSync(store.file,' '.repeat(16*1024*1024+1));const before=fs.statSync(store.file).size;const r=inspect(root);assert(r.warnings.includes('METADATA_READ_LIMIT'));assert.equal(r.configStatus,'not_checked');assert.equal(fs.statSync(store.file).size,before);
});
test('an entry disappearing during session scan is incomplete, never a successful zero count',t=>{
 const {root,store}=fixture(t),entry=store.sessionPath(store.accounts[0].id);fs.mkdirSync(entry,{recursive:true});const lstat=fs.lstatSync;
 fs.lstatSync=(p,...args)=>{if(p===entry)throw Object.assign(Error('SYNTHETIC_ENTRY_DISAPPEARED'),{code:'ENOENT'});return lstat(p,...args);};
 let r;try{r=inspect(root);}finally{fs.lstatSync=lstat;}
 assert.equal(r.status,'warning');assert(r.warnings.includes('SESSIONS_UNREADABLE'));assert.equal(r.sessionDirectoryCount,null);assert.equal(r.matchedSessionDirectoryCount,null);assert.equal(r.accountsWithoutSessionDirectory,null);
});
