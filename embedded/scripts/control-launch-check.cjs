'use strict';
// Cold-start a signed package with disposable, unauthenticated profiles.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {promisify}=require('node:util'),execFile=promisify(require('node:child_process').execFile);
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {request,endpoint}=require('../src/control-transport.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
 const build=JSON.parse(fs.readFileSync(path.join(__dirname,'../dist/build.json')));
 const app=process.env.COZE_BROWSER_TEST_APP || build.stage,binary=path.join(app,'Contents/MacOS/CozeAccountBrowser'),shim=path.join(app,'Contents/Resources/app/bin/coze-browser');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'coze-cli-cold-launch-'));
 let cleanup=false;
 try {
  const {stdout}=await execFile(shim,['launch','--data-root',root,'--timeout','30000'],{timeout:35000,maxBuffer:1024*1024});
  const reply=JSON.parse(stdout);assert.equal(reply.ok,true);assert.equal(reply.result.version,build.version);
  const before=await request(root,'status');assert.equal(before.ok,true);assert.equal(before.result.accounts.length,5);
  const switched=await request(root,'switch',{account:'2'});assert.equal(switched.ok,true);assert.equal(switched.result.accounts.find(a=>a.selected).number,2);
  const repeated=JSON.parse((await execFile(shim,['launch','--data-root',root],{timeout:15000,maxBuffer:1024*1024})).stdout);
  assert.equal(repeated.ok,true);assert.equal(repeated.result.selected,switched.result.selected);
  console.log('PASS bundled CLI cold launch, direct IPC switch and repeat launch with retained selection');
 } finally {
  // Stream the process list: large developer sessions can exceed execFile's
  // default output limit. Retain only this exact disposable test instance.
  const owned=[], ps=spawn('/bin/ps',['-axo','pid,command'],{stdio:['ignore','pipe','ignore']});
  const expected=new Set([binary,fs.realpathSync(binary)].flatMap(executable=>[root,fs.realpathSync(root)].map(directory=>`${executable} --data-root ${directory}`)));
  const closed=new Promise((resolve,reject)=>{ps.once('error',reject);ps.once('close',code=>code===0?resolve():reject(new Error('Unable to inspect test processes')));});
  const lines=createInterface({input:ps.stdout,crlfDelay:Infinity});
  for await(const line of lines){
   const match=line.trim().match(/^(\d+) (.*)$/);
   if(match && expected.has(match[2]))owned.push(Number(match[1]));
  }
  await closed;
  assert.ok(owned.length>0,'Expected a disposable test process before cleanup');
  // A repeat launch may still be exiting after the single-instance handoff.
  for(const pid of owned){try{process.kill(pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}} // Exact test args only.
  for(let attempt=0;attempt<50;attempt++){
   if(owned.every(pid=>{try{process.kill(pid,0);return false;}catch(error){if(error.code==='ESRCH')return true;throw error;}})){cleanup=true;break;}
   await sleep(100);
  }
  if(cleanup){fs.rmSync(endpoint(root).directory,{recursive:true,force:true});fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
  else console.error('Disposable fixture retained for inspection: '+root);
 }
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
