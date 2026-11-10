'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'coze-delete-native-')),app=process.env.COZE_BROWSER_TEST_APP;
const binary=app?path.join(app,'Contents/MacOS/CozeAccountBrowser'):require('electron');
for(const phase of [1,2]){
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const args=[...(!app?['.']:[]),'--self-test','--delete-acceptance','--data-root',root];
 const r=spawnSync(binary,args,{cwd:path.join(__dirname,'..'),env,stdio:'inherit',timeout:120000});
 if(r.status!==0){console.error(`Delete phase ${phase} failed; own anonymous fixture retained at ${root}`);process.exit(r.status||1);}
}
fs.mkdirSync(path.join(__dirname,'../dist'),{recursive:true});fs.copyFileSync(path.join(root,'delete-editor.png'),path.join(__dirname,'../dist/delete-editor-check.png'));
fs.rmSync(root,{recursive:true,force:true});console.log('PASS native deletion and empty-list restart, no real accounts');
