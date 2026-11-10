'use strict';
// Developer-only recovery aid. No Store construction, writes, session-content reads or real-site identity access.
const fs=require('node:fs'),path=require('node:path');
const {validate}=require('../src/store.cjs');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MAX_METADATA_BYTES=16*1024*1024;
function inspect(root){
 const result={status:'error',configStatus:'not_checked',accountCount:null,sessionDirectoryCount:0,matchedSessionDirectoryCount:null,unmatchedSessionDirectoryCount:null,accountsWithoutSessionDirectory:null,warnings:[]};
 if(typeof root!=='string'||!path.isAbsolute(root)){result.warnings.push('ABSOLUTE_DIRECTORY_REQUIRED');return result;}
 const own=stat=>stat.uid===process.getuid();
 let parent;
 try{parent=fs.lstatSync(root);}catch{result.warnings.push('DIRECTORY_UNAVAILABLE');return result;}
 if(!parent.isDirectory()||parent.isSymbolicLink()||!own(parent)||(parent.mode&0o077)){result.warnings.push('UNSAFE_DIRECTORY');return result;}
 let ids=null;
 try{
  const file=path.join(root,'accounts.json'),s=fs.lstatSync(file);
  if(!s.isFile()||s.isSymbolicLink()||!own(s)||(s.mode&0o077)){result.configStatus='unsafe';result.warnings.push('UNSAFE_CONFIG_FILE');}
  else if(s.size>MAX_METADATA_BYTES){result.configStatus='not_checked';result.warnings.push('METADATA_READ_LIMIT');}
  else{
   const parsed=validate(JSON.parse(fs.readFileSync(file,'utf8')));ids=new Set(parsed.map(a=>a.id.toLowerCase()));result.accountCount=ids.size;result.configStatus='valid';
  }
 }catch(e){result.configStatus=e.code==='ENOENT'?'missing':'invalid_or_unreadable';result.warnings.push(e.code==='ENOENT'?'CONFIG_MISSING':'CONFIG_INVALID_OR_UNREADABLE');}
 const sessions=path.join(root,'Sessions');let sessionIds=[],complete=true,sessionStat;
 try{sessionStat=fs.lstatSync(sessions);}catch(e){if(e.code!=='ENOENT'){complete=false;result.warnings.push('SESSIONS_UNREADABLE');}}
 if(sessionStat)try{
  const s=sessionStat;
  if(!s.isDirectory()||s.isSymbolicLink()||!own(s)){complete=false;result.warnings.push('UNSAFE_SESSIONS_DIRECTORY');}
  else for(const name of fs.readdirSync(sessions)){
   const entry=fs.lstatSync(path.join(sessions,name));
   if(entry.isSymbolicLink()){complete=false;result.warnings.push('SESSION_LINK_NOT_INSPECTED');continue;}
   if(UUID.test(name)&&entry.isDirectory()&&own(entry))sessionIds.push(name.toLowerCase());
   else result.warnings.push('NON_ACCOUNT_ENTRY_NOT_INSPECTED');
  }
 }catch{complete=false;result.warnings.push('SESSIONS_UNREADABLE');}
 if(new Set(sessionIds).size!==sessionIds.length){complete=false;result.warnings.push('DUPLICATE_SESSION_DIRECTORY_IDS');}
 result.sessionDirectoryCount=complete?sessionIds.length:null;
 if(ids&&complete){
  result.matchedSessionDirectoryCount=sessionIds.filter(id=>ids.has(id)).length;
  result.unmatchedSessionDirectoryCount=sessionIds.filter(id=>!ids.has(id)).length;
  result.accountsWithoutSessionDirectory=ids.size-result.matchedSessionDirectoryCount;
  if(result.unmatchedSessionDirectoryCount)result.warnings.push('UNMATCHED_SESSION_DIRECTORIES');
 }
 result.warnings=[...new Set(result.warnings)];result.status=result.configStatus==='valid'?(result.warnings.length?'warning':'ok'):'error';return result;
}
if(require.main===module){
 const args=process.argv.slice(2);const result=args.length===2&&args[0]==='--data-root'?inspect(args[1]):{status:'error',warnings:['USAGE: node check-account-config.cjs --data-root ABSOLUTE_DIRECTORY']};
 process.stdout.write(JSON.stringify(result)+'\n');process.exitCode=result.status==='ok'?0:result.status==='warning'?2:1;
}
module.exports={inspect};
