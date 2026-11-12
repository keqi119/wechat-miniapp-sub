import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ContractPdfArtifactWriterService} from '../src/contract/contract-pdf-artifact-writer.service';
const exec=promisify(execFile);
async function permission(path:string){if(process.platform!=='win32')return{mode:(await fs.stat(path)).mode&0o777};const script=`$ErrorActionPreference='Stop';$a=[IO.File]::GetAccessControl($env:QUARANTINE_TEST_PATH);@{protected=$a.AreAccessRulesProtected;owner=$a.Owner;rules=@($a.Access|ForEach-Object{@{sid=$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value;inherited=$_.IsInherited;type=[string]$_.AccessControlType}});service=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value}|ConvertTo-Json -Depth 4 -Compress`;return JSON.parse((await exec('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,env:{...process.env,QUARANTINE_TEST_PATH:path}})).stdout);}
function privatePermission(p:any){if(process.platform==='win32'){assert.equal(p.protected,true);assert.ok(p.rules.length>0);assert.ok(p.rules.every((r:any)=>r.sid===p.service&&!r.inherited&&r.type==='Allow'));}else assert.equal(p.mode,0o600);}
test('quarantine newly written and reused files have actual private OS permissions',async()=>{
 const root=resolve('.runtime','task4-acl-'+randomUUID()),old=process.env.UPLOAD_DIR;process.env.UPLOAD_DIR=root;const records:any[]=[],db:any={storedFile:{create:async({data}:any)=>{const row={id:String(records.length),...data};records.push(row);return row;}}};
 try{const writer=new ContractPdfArtifactWriterService(db),bytes=Buffer.from('%PDF-1.7\n'+('private synthetic '.repeat(20))),first=await writer.persistPdf(bytes,{customerId:null,name:'q.pdf',purpose:'electronic-quarantine'});assert.ok(first.storagePath.includes('electronic-quarantine'));privatePermission(await permission(first.storagePath));if(process.platform==='win32')await exec('icacls.exe',[first.storagePath,'/grant','*S-1-5-32-545:(R)'],{windowsHide:true});else await fs.chmod(first.storagePath,0o644);await writer.persistPdf(bytes,{customerId:null,name:'q.pdf',purpose:'electronic-quarantine'});privatePermission(await permission(first.storagePath));}finally{if(old===undefined)delete process.env.UPLOAD_DIR;else process.env.UPLOAD_DIR=old;}
});
test('legacy referenced quarantine file is hardened without changing unrelated shard files',async()=>{
 const root=resolve('.runtime','task4-legacy-acl-'+randomUUID()),old=process.env.UPLOAD_DIR;process.env.UPLOAD_DIR=root;await fs.mkdir(resolve(root,'aa'),{recursive:true});const file=resolve(root,'aa','legacy.pdf'),other=resolve(root,'aa','ordinary.pdf'),bytes=Buffer.from('%PDF-1.7\n'+('legacy synthetic '.repeat(20)));await fs.writeFile(file,bytes);await fs.writeFile(other,'ordinary synthetic');const before=await permission(other),sha256=require('node:crypto').createHash('sha256').update(bytes).digest('hex'),row={id:'legacy',storagePath:file,sha256,size:bytes.length,mimeType:'application/pdf',purpose:'electronic-quarantine'};
 const db:any={electronicFileQuarantine:{findUnique:async()=>({fileId:row.id,sha256})},storedFile:{findUnique:async()=>row}};
 try{const writer=new ContractPdfArtifactWriterService(db);assert.deepEqual(await writer.readQuarantined(row.id,sha256),bytes);privatePermission(await permission(file));assert.deepEqual(await permission(other),before);assert.deepEqual(await writer.readQuarantined(row.id,sha256),bytes);privatePermission(await permission(file));}finally{if(old===undefined)delete process.env.UPLOAD_DIR;else process.env.UPLOAD_DIR=old;}
});
test('legacy hash mismatch is rejected before changing that file permissions',async()=>{
 const root=resolve('.runtime','task4-badlegacy-acl-'+randomUUID()),old=process.env.UPLOAD_DIR;process.env.UPLOAD_DIR=root;await fs.mkdir(root,{recursive:true});const path=resolve(root,'not-the-bound-file.pdf'),bytes=Buffer.from('%PDF-1.7\n'+('different synthetic '.repeat(20)));await fs.writeFile(path,bytes);const before=await permission(path),sha256='a'.repeat(64),db:any={electronicFileQuarantine:{findUnique:async()=>({fileId:'bad',sha256})},storedFile:{findUnique:async()=>({id:'bad',storagePath:path,sha256,size:bytes.length,mimeType:'application/pdf'})}};
 try{await assert.rejects(new ContractPdfArtifactWriterService(db).readQuarantined('bad',sha256));assert.deepEqual(await permission(path),before);}finally{if(old===undefined)delete process.env.UPLOAD_DIR;else process.env.UPLOAD_DIR=old;}
});
