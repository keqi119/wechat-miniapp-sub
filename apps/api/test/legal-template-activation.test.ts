import test from 'node:test';
import assert from 'node:assert/strict';
import {AdminController} from '../src/operations/admin';
import {hash} from '../src/common/data';
import {readFileSync} from 'node:fs';

const fingerprint=(d:any)=>hash({type:d.type,version:d.version,title:d.title,content:d.content});
test('V31 activation validates complete structured source and mapped placeholders',async()=>{
 const f=fixture(),content=readFileSync('../../docs/legal/drafts/ninda/launch-20261107-v31/01.json','utf8');
 Object.assign(f.documents[1],{type:'ELECTRONIC_V31_SUBSCRIPTION',content});f.body.expectedContentHash=fingerprint(f.documents[1]);
 assert.equal((await f.controller.activateLegal('new',f.body,f.request)).status,'PUBLISHED');
 const bad=fixture(),parsed=JSON.parse(content);parsed.markers.pop();Object.assign(bad.documents[1],{type:'ELECTRONIC_V31_SUBSCRIPTION',content:JSON.stringify(parsed)});bad.body.expectedContentHash=fingerprint(bad.documents[1]);
 await assert.rejects(()=>bad.controller.activateLegal('new',bad.body,bad.request));assert.equal(bad.documents[1].status,'DRAFT');
});
function fixture(role='OPERATIONS'){
 const documents:any[]=[{id:'old',type:'OFFLINE_RENTAL',version:1,title:'旧模板',content:'历史正文',status:'PUBLISHED'},{id:'new',type:'OFFLINE_RENTAL',version:2,title:'新模板',content:'由 {{customerName}} 与 {{ownerName}} 签署。',status:'DRAFT'}];
 const commands=new Map<string,any>(),events:any[]=[];
 const tx:any={$queryRaw:async()=>[],adminUser:{findUnique:async()=>({id:'staff',role,active:true,authVersion:1})},legalDocument:{findUnique:async({where}:any)=>documents.find(d=>d.id===where.id),updateMany:async({where,data}:any)=>{for(const d of documents)if(d.type===where.type&&d.status===where.status)Object.assign(d,data);return{count:1}},update:async({where,data}:any)=>Object.assign(documents.find(d=>d.id===where.id),data)},archiveCommand:{findUnique:async({where}:any)=>commands.get(JSON.stringify(where.actorId_resourceId_action_key)),create:async({data}:any)=>{commands.set(JSON.stringify({actorId:data.actorId,resourceId:data.resourceId,action:data.action,key:data.key}),data);return data;}},auditLog:{create:async({data}:any)=>events.push(data)}};
 const controller=new AdminController({serial:async(fn:any)=>fn(tx)} as any),body={confirmed:true,expectedVersion:2,expectedContentHash:fingerprint(documents[1]),idempotencyKey:'enable-template-v2'},request={admin:{id:'staff',role,authVersion:1},body};
 tx.$executeRaw=async()=>0;
 return{documents,events,controller,body,request};
}
test('one operator activates a frozen draft version, retires old version, and replay is idempotent',async()=>{
 const f=fixture(),activate=(body:any)=> (f.controller as any).activateLegal('new',body,f.request);
 const result=await activate(f.body);assert.equal(result.status,'PUBLISHED');assert.equal(result.confirmedBy,'staff');assert.equal(f.documents[0].status,'RETIRED');assert.ok(result.confirmedAt);assert.deepEqual(await activate(f.body),result);assert.equal(f.events.length,1);
});
test('activation refuses changed content, missing confirmation and non-operator without publishing',async()=>{
 for(const mutation of ['changed','confirmation','role']){
  const f=fixture(mutation==='role'?'FINANCE':'OPERATIONS');if(mutation==='changed')f.documents[1].content='已改稿';if(mutation==='confirmation')f.body.confirmed=false;
  await assert.rejects(()=>(f.controller as any).activateLegal('new',f.body,f.request));assert.equal(f.documents[1].status,'DRAFT');assert.equal(f.documents[0].status,'PUBLISHED');assert.equal(f.events.length,0);
 }
});
test('activation rejects unresolved unsupported template variables',async()=>{
 const f=fixture();f.documents[1].content='正文 {{unknownVariable}}';f.body.expectedContentHash=fingerprint(f.documents[1]);
 await assert.rejects(()=>(f.controller as any).activateLegal('new',f.body,f.request));assert.equal(f.documents[1].status,'DRAFT');
});
test('legacy publish cannot bypass the confirmed content snapshot',async()=>{
 const f=fixture();Object.assign(f.documents[1],{confirmedBy:'staff',confirmedAt:new Date()});f.request.body={} as any;
 await assert.rejects(()=>f.controller.publishLegal('new',f.request));assert.equal(f.documents[1].status,'DRAFT');
});
test('termination activation accepts only printable original-contract variables',async()=>{
 const f=fixture();Object.assign(f.documents[1],{type:'OFFLINE_TERMINATION',content:JSON.stringify({requiredSigners:['CUSTOMER','OWNER','PLATFORM'],body:'原合同 {{originalContractName}} 编号 {{originalContractNumber}}，因 {{terminationReason}} 于 {{terminationEffectiveAt}} 终止。'})});f.body.expectedContentHash=fingerprint(f.documents[1]);
 assert.equal((await (f.controller as any).activateLegal('new',f.body,f.request)).status,'PUBLISHED');
});
