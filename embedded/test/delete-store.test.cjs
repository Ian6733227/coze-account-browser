'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../src/store.cjs');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'coze-delete-store-'));t.after(()=>fs.rmSync(root,{recursive:true}));return{root,store:new Store(root)};}
test('deleting one entry preserves other stable IDs and an empty list persists without default initialization',t=>{
 const {root,store}=fixture(t),ids=store.accounts.map(a=>a.id),rest=JSON.stringify(store.accounts.slice(1));
 store.setResume(ids[0],'https://www.coze.cn/overview');store.remove(ids[0]);
 assert.equal(JSON.stringify(store.accounts),rest);assert.equal(store.resume,null);assert.throws(()=>store.get(ids[0]));
 for(const a of [...store.accounts])store.remove(a.id);
 assert.deepEqual(store.accounts,[]);assert.deepEqual(new Store(root).accounts,[]);
 const added=store.add('重新添加');assert.equal(ids.includes(added.id),false);
});
test('failed delete commit preserves list bytes, entry identity and unrelated session directory',t=>{
 const {root,store}=fixture(t),id=store.accounts[0].id,before=fs.readFileSync(store.file),state=JSON.stringify(store.accounts);
 const dir=store.sessionPath(store.accounts[1].id);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'keep'),'synthetic');
 const rename=fs.renameSync;fs.renameSync=(a,b)=>{if(b===store.file)throw Object.assign(new Error('synthetic read only'),{code:'EROFS'});return rename(a,b);};
 try{assert.throws(()=>store.remove(id),{code:'EROFS'});}finally{fs.renameSync=rename;}
 assert.deepEqual(fs.readFileSync(store.file),before);assert.equal(JSON.stringify(store.accounts),state);assert.equal(fs.readFileSync(path.join(dir,'keep'),'utf8'),'synthetic');
 assert.equal(fs.readdirSync(root).some(n=>n.includes('.tmp-')),false);
});
