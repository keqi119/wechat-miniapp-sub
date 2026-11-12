import { spawn as nodeSpawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, realpathSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const apiRoot=resolve(root,'apps/api');
const require=createRequire(resolve(apiRoot,'package.json'));
const lockPath=resolve(root,'.runtime/mvp-api-tests.lock');
export function validateTestDatabaseUrl(value){
 let url;try{url=new URL(value);}catch{throw new Error('MVP_TEST_DATABASE_REQUIRED: provide the dedicated local TEST_DATABASE_URL');}
 if(!['postgres:','postgresql:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.port!=='55432'||url.pathname!=='/chundian_test'||url.hash||[...url.searchParams].some(([key,val])=>key!=='schema'||val!=='public'))throw new Error('MVP_TEST_DATABASE_DENIED: only loopback:55432/chundian_test is allowed');
 return value;
}
export function testArguments(args){
 if(args.length===1&&args[0]==='--migrate')return ['src/common/migrate.ts','--test'];
 if(args.length===1&&args[0]==='--backfill-dry-run')return ['src/operations/seven-module-migration.ts','--test'];
 if(args.length===1&&args[0]==='--backfill')return ['src/operations/seven-module-migration.ts','--test','--apply'];
 if(args.length===1&&args[0]==='--all')args=readdirSync(resolve(apiRoot,'test')).filter(name=>/^[A-Za-z0-9_-]+\.test\.ts$/.test(name)).sort().map(name=>'test/'+name);
 if(!args.length||args.some(name=>!/^test\/[A-Za-z0-9_-]+\.test\.ts$/.test(name)))throw new Error('MVP_TEST_ARGUMENTS: use test/<file>.test.ts, --all, --migrate, --backfill-dry-run, or --backfill');
 const testRoot=realpathSync(resolve(apiRoot,'test'));
 for(const name of args){if(dirname(realpathSync(resolve(apiRoot,name)))!==testRoot)throw new Error('MVP_TEST_ARGUMENTS: test file must remain inside this project');}
 return ['--test','--test-concurrency=1',...args];
}
export function acquireTestLock(path=lockPath){
 mkdirSync(dirname(path),{recursive:true});const token=randomUUID();let fd;
 try{fd=openSync(path,'wx');writeFileSync(fd,JSON.stringify({pid:process.pid,token}));closeSync(fd);}catch{if(fd!==undefined)closeSync(fd);throw new Error('MVP_TEST_BUSY: another API test runner owns the local lock');}
 let released=false;return()=>{if(released)return;released=true;try{if(JSON.parse(readFileSync(path,'utf8')).token===token)unlinkSync(path);}catch{/* Missing/replaced locks are never removed. */}};
}
export function redactOutput(value,urls){
 let text=String(value);const secrets=new Set();for(const raw of urls.filter(Boolean)){secrets.add(raw);try{const url=new URL(raw);for(const secret of [url.username,url.password]){if(secret){secrets.add(secret);secrets.add(decodeURIComponent(secret));}}}catch{}}
 for(const secret of [...secrets].sort((a,b)=>b.length-a.length))text=text.split(secret).join('[REDACTED]');
 return text.replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi,'[REDACTED_DATABASE_URL]');
}
async function spawnChild(command,args,options){
 return new Promise((resolveResult,reject)=>{
  const child=nodeSpawn(command,args,{...options,windowsHide:true,detached:process.platform!=='win32'});let output='',termination=Promise.resolve();
  const flush=data=>{output+=data;let index;while((index=output.indexOf('\n'))>=0){process.stdout.write(redactOutput(output.slice(0,index+1),[options.env.TEST_DATABASE_URL,process.env.DATABASE_URL]));output=output.slice(index+1);}};
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',flush);child.stderr.on('data',flush);
  const interrupt=signal=>{
   if(process.platform==='win32'&&child.pid){termination=new Promise(done=>{const killer=nodeSpawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',shell:false});killer.once('error',done);killer.once('close',done);});}
   else if(child.pid){try{process.kill(-child.pid,signal);}catch{child.kill(signal);}}
  },onInt=()=>interrupt('SIGINT'),onTerm=()=>interrupt('SIGTERM');process.once('SIGINT',onInt);process.once('SIGTERM',onTerm);
  const cleanup=()=>{process.off('SIGINT',onInt);process.off('SIGTERM',onTerm);if(output)process.stdout.write(redactOutput(output,[options.env.TEST_DATABASE_URL,process.env.DATABASE_URL]));};
  child.once('error',()=>{cleanup();reject(new Error('MVP_TEST_CHILD_FAILED: unable to start local test runner'));});
  child.once('close',async(code,signal)=>{await termination;cleanup();resolveResult(code??(signal==='SIGINT'?130:143));});
 });
}
export async function runMvpApiTests(args,{env=process.env,spawn=spawnChild}={}){
 const databaseUrl=validateTestDatabaseUrl(env.TEST_DATABASE_URL),parameters=testArguments(args),release=acquireTestLock();
 process.once('exit',release);
 try{return await spawn(process.execPath,['--import',pathToFileURL(require.resolve('tsx')).href,...parameters],{cwd:apiRoot,env:{...env,NODE_ENV:'test',MVP_TEST_GUARD:'local-project-v1',TEST_DATABASE_URL:databaseUrl,DATABASE_URL:databaseUrl},shell:false,stdio:['ignore','pipe','pipe']});}
 finally{process.off('exit',release);release();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 require('dotenv').config({path:resolve(root,'.env'),quiet:true});
 try{process.exitCode=await runMvpApiTests(process.argv.slice(2));}catch(error){process.stderr.write(redactOutput(error instanceof Error?error.message:'MVP_TEST_FAILED',[process.env.TEST_DATABASE_URL,process.env.DATABASE_URL])+'\n');process.exitCode=1;}
}
