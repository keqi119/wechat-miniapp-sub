import test from 'node:test';import assert from 'node:assert/strict';
import {LegalClient,shanghaiSigningInstant,authorityConfirmation} from './legal-client.ts';
test('legal client isolates legal routes, full protected PDFs and stale sessions',async()=>{
 let finish!:(r:Response)=>void;const api=new LegalClient(async()=>new Promise(r=>finish=r));api.setCsrf('one');
 const pending=api.request('/owners/company/electronic-documents/task/files/source');api.clear();finish(new Response('%PDF-synthetic',{headers:{'Content-Type':'application/pdf'}}));await assert.rejects(pending,/变化/);
 await assert.rejects(api.request('/owners/company/revenue'));await assert.rejects(api.request('/admin/electronic-documents/task/sign',{}));
 assert.equal(shanghaiSigningInstant('2026-11-08T12:00'),'2026-11-08T04:00:00.000Z');
 assert.throws(()=>authorityConfirmation({grant:null} as never,'technical'));
});
test('a successful JSON response cannot be mistaken for a protected PDF',async()=>{
 const api=new LegalClient(async()=>new Response(JSON.stringify({data:{url:'https://invalid.example'}}),{headers:{'Content-Type':'application/json'}}));
 await assert.rejects(api.request('/owners/company/electronic-documents/task/files/source'),/文件响应异常/);
});
test('enterprise authority PDF uses the original protected legal session and rejects JSON or unrelated paths',async()=>{
 let requested='';const api=new LegalClient(async(path,init)=>{requested=String(path);assert.equal(init?.credentials,'same-origin');return new Response('%PDF-synthetic',{headers:{'Content-Type':'application/pdf'}});});
 const blob=await api.request<Blob>('/owners/company/authorities/grant/document/signed');assert.equal(await blob.text(),'%PDF-synthetic');assert.equal(requested,'/owner/api/owners/company/authorities/grant/document/signed');
 await assert.rejects(api.request('/owners/company/authorities/grant/document/other'));
 const invalid=new LegalClient(async()=>new Response('{}',{headers:{'Content-Type':'application/json'}}));await assert.rejects(invalid.request('/owners/company/authorities/grant/document/signed'),/文件响应异常/);
});
