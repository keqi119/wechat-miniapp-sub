import test from 'node:test';
import assert from 'node:assert/strict';
import {ApiClient,ApiError} from './core.ts';
const path='/admin/vehicles/vehicle-1/documents/file-1';
const session={user:{id:'staff',username:'staff',role:'OPERATIONS',permissions:[]},csrfToken:'synthetic'};
test('native original open links are built only from the trusted client base and scoped identifiers',()=>{
 for(const base of ['/api','https://api.evsub.ndacar.com/api']){let hits=0;const client=new ApiClient(async()=>{hits++;return new Response();},base);client.setSession(session);assert.equal(client.vehicleDocumentOpenUrl('vehicle-1','file-1'),base+path+'/open');assert.equal(hits,0);}
 const client=new ApiClient();client.setSession(session);for(const invalid of ['../file','x/y','x?next=https://other.invalid','x#fragment','https://other.invalid','bad%2fpath','']){assert.throws(()=>client.vehicleDocumentOpenUrl(invalid,'file-1'));assert.throws(()=>client.vehicleDocumentOpenUrl('vehicle-1',invalid));}client.setSession({...session,user:{...session.user,role:'FINANCE'}});assert.throws(()=>client.vehicleDocumentOpenUrl('vehicle-1','file-1'));client.setSession(null);assert.throws(()=>client.vehicleDocumentOpenUrl('vehicle-1','file-1'));
});
test('private originals download authenticates and preserves DOCX and MP4 bytes up to 32MiB',async()=>{
 for(const type of ['application/vnd.openxmlformats-officedocument.wordprocessingml.document','video/mp4']){
  let request:RequestInit|undefined;
  const client=new ApiClient(async(url,init)=>{assert.equal(url,'/api'+path);request=init;return new Response(new Uint8Array(11*1024*1024),{headers:{'Content-Type':type}});});client.setSession(session);
  const blob=await client.downloadPrivateFile(path,type);assert.equal(blob.size,11*1024*1024);assert.equal(request?.credentials,'include');
 }
});
test('private originals reject unsupported scope, MIME, roles, oversized data, and stale sessions',async()=>{
 let hits=0;
 const client=new ApiClient(async()=>{hits++;return new Response('bytes',{headers:{'Content-Type':'application/pdf'}});});client.setSession(session);
 for(const invalid of ['/admin/files/file-1','/admin/vehicles/../documents/file-1','/admin/vehicles/v/documents/f?x=1'])await assert.rejects(()=>client.downloadPrivateFile(invalid,'application/pdf'));
 await assert.rejects(()=>client.downloadPrivateFile(path,'text/html'));assert.equal(hits,0);
 client.setSession({...session,user:{...session.user,role:'FINANCE'}});await assert.rejects(()=>client.downloadPrivateFile(path,'application/pdf'));assert.equal(hits,0);
 const mismatch=new ApiClient(async()=>new Response('html',{headers:{'Content-Type':'text/html'}}));mismatch.setSession(session);await assert.rejects(()=>mismatch.downloadPrivateFile(path,'application/pdf'));
 const large=new ApiClient(async()=>new Response('bytes',{headers:{'Content-Type':'application/pdf','Content-Length':String(32*1024*1024+1)}}));large.setSession(session);await assert.rejects(()=>large.downloadPrivateFile(path,'application/pdf'));
 const stale=new ApiClient(async()=>{stale.setSession({...session});return new Response('bytes',{headers:{'Content-Type':'application/pdf'}});});stale.setSession(session);await assert.rejects(()=>stale.downloadPrivateFile(path,'application/pdf'),(e:unknown)=>e instanceof ApiError&&e.code==='SESSION_CHANGED');
});
