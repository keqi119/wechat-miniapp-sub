import {test} from 'node:test';
import assert from 'node:assert/strict';
import {technicalSafe,technicalAllowed,technicalPayload,technicalApprovalId,technicalNotice,signingResourcePath,technicalInitial,technicalWrite,TechnicalViewGuard,technicalArchiveText} from './technical-acceptance.ts';
import {ApiClient,ApiError} from './core.ts';
import {resources,resourceAccessible,resourceWritable,actionAllowed} from './resources.ts';
const record={id:'qa-tech',customerId:'qa-person',verificationNo:'QA-TECH-1',revision:3,status:'CONFIRMED',signatureStatus:'DRAFT',stoppedAt:null,canPrepare:true,canStop:true,canReviewRetention:false,canPurge:false,sourceFileId:'qa-original',signedFileId:null,document:{id:'qa-document',version:1,content:'本份独立文件全文，无租赁收费',documentHash:'qa-doc-hash',bodyHash:'qa-body-hash',templateHash:'qa-template-hash'},approval:null};
test('technical resource is independent, ADMIN/OPS only and never offers commercial or client signing actions',()=>{
 const resource=resources.find(value=>value.key==='technical-acceptances')!;assert.ok(resource);assert.equal(resource.edit,undefined);assert.equal(resource.create,true);
 for(const role of ['ADMIN','OPERATIONS','FINANCE','SUPPORT']){assert.equal(resourceAccessible(resource,['*'],role),['ADMIN','OPERATIONS'].includes(role));assert.equal(resourceWritable(resource,['*'],role),['ADMIN','OPERATIONS'].includes(role));}
 assert.deepEqual(resource.fields?.map(field=>field.key),['customerId','documentId']);assert.deepEqual(resource.actions?.map(action=>action.path),['prepare-signature','stop','retention-review','purge']);
 assert.equal(resource.actions?.some(action=>/confirm|send|approve|sign$|pay/.test(action.path)),false);
});
test('prepare/stop are strict server capabilities and stop does not claim external cancellation or erase a signed fact',()=>{
 assert.equal(technicalAllowed('prepare-signature',record,'OPERATIONS'),true);
 for(const changed of [{canPrepare:'true'},{canPrepare:false},{stoppedAt:'2026-10-16T00:00:00Z'},{status:'STOPPED'},{status:'PURGED'}])assert.equal(technicalAllowed('prepare-signature',{...record,...changed},'ADMIN'),false);
 assert.equal(technicalAllowed('prepare-signature',record,'FINANCE'),false);assert.equal(actionAllowed('technical-acceptances',{path:'prepare-signature',label:'准备'},record),true);
 const stopped={...record,status:'STOPPED',signatureStatus:'PENDING',stoppedAt:'2026-10-16T00:00:00Z',statusMessage:'已记录停止，原任务结果尚待核实'};assert.match(technicalNotice(stopped),/停止/);assert.match(technicalNotice(stopped),/核实/);
 assert.equal(technicalAllowed('stop',{...record,status:'SIGNED',signatureStatus:'SIGNED'},'ADMIN'),true);
});
test('creation/action payloads bind only their independent resource, version and stable key',()=>{
 assert.deepEqual(technicalPayload('create',{customerId:'qa-person',documentId:'qa-doc'},'qa-stable-key'),{customerId:'qa-person',documentId:'qa-doc',idempotencyKey:'qa-stable-key'});
 for(const extra of [{orderId:'fake-order'},{amount:0},{body:'arbitrary text'},{consent:true}])assert.throws(()=>technicalPayload('create',{customerId:'qa-person',documentId:'qa-doc',...extra},'qa-stable-key'));
 assert.deepEqual(technicalPayload('prepare-signature',{policyId:'qa-policy',revision:3},'qa-stable-key',record,'ADMIN'),{revision:3,policyId:'qa-policy',idempotencyKey:'qa-stable-key'});
 assert.deepEqual(technicalPayload('stop',{},'qa-stable-key',record,'OPERATIONS'),{revision:3,idempotencyKey:'qa-stable-key'});
 assert.throws(()=>technicalPayload('stop',{revision:2},'qa-stable-key',record,'ADMIN'),/版本/);assert.throws(()=>technicalPayload('stop',{},undefined,record,'ADMIN'),/编号/);
});
test('180-day retention review requires explicit ADMIN choice and reason, purge must be independently allowed',()=>{
 const due={...record,retentionStatus:'REVIEW_DUE',canReviewRetention:true,canPurge:false};
 for(const legalHold of [undefined,'',null])assert.throws(()=>technicalPayload('retention-review',{legalHold,reason:'核对原独立文件'},'qa-stable-key',due,'ADMIN'));
 assert.deepEqual(technicalPayload('retention-review',{legalHold:'false',reason:'到期且无争议，审核解除留存'},'qa-stable-key',due,'ADMIN'),{revision:3,idempotencyKey:'qa-stable-key',legalHold:false,reason:'到期且无争议，审核解除留存'});
 assert.throws(()=>technicalPayload('retention-review',{legalHold:true,reason:'依法保留'},'qa-stable-key',due,'OPERATIONS'));
 assert.throws(()=>technicalPayload('purge',{reason:'审核后清理'},'qa-stable-key',due,'ADMIN'));
 assert.deepEqual(technicalPayload('purge',{reason:'到期审核后清理仅本验证资料'},'qa-stable-key',{...due,canPurge:true},'ADMIN'),{revision:3,idempotencyKey:'qa-stable-key',reason:'到期审核后清理仅本验证资料'});
});
test('retention forms never inherit an existing false hold as a new manual decision',()=>{
 assert.deepEqual(technicalInitial('retention-review',{...record,legalHold:false,reason:'旧理由'}),{revision:3,legalHold:'',reason:''});
 assert.deepEqual(technicalInitial('prepare-signature',{...record,policyId:'old-policy'}),{revision:3});
});
test('safe projection preserves frozen text and authorized PDF IDs without raw provider, full identity or commercial objects',()=>{
 const value=technicalSafe({...record,document:{...record.document,identityNo:'private'},disclosure:{version:'1',text:'本次必要数据用途',privacyDocumentId:'qa-privacy',privacyVersion:2,token:'private'},approval:{id:'qa-approval',status:'PENDING',planHash:'qa-plan',providerSecret:'private'},providerTaskId:'private',redirectUrl:'private',idCardNo:'private',order:{id:'private'},sourceFileId:'qa-original'});
 assert.equal(JSON.stringify(value).includes('private'),false);assert.equal(value.sourceFileId,'qa-original');assert.equal((value.document as any).content,record.document.content);assert.equal((value.approval as any).planHash,'qa-plan');
});
test('prepare response links only the actual approval for this record and technical approvals cannot route to commercial contracts',()=>{
 assert.equal(technicalApprovalId({record,approval:{id:'qa-approval',status:'PENDING'}},record.id),'qa-approval');assert.throws(()=>technicalApprovalId({record:{...record,id:'other'},approval:{id:'qa-approval'}},record.id));
 assert.equal(signingResourcePath('TECHNICAL_ACCEPTANCE','qa/tech'),'#technical-acceptances?record=qa%2Ftech');assert.equal(signingResourcePath('HANDOVER','qa-h'),'#handovers?record=qa-h');assert.equal(signingResourcePath('SUBSCRIPTION','qa-c'),'#contracts?record=qa-c');
});
test('a write conflict rereads the independent record without retrying a mutation or silently accepting a newer version',async()=>{
 const calls:{path:string;method:unknown;body:unknown}[]=[],fresh:unknown[]=[];
 const client=new ApiClient(async(url,init)=>{calls.push({path:String(url),method:init?.method,body:init?.body});return init?.method==='POST'?Response.json({error:{code:'REVISION_CONFLICT',message:'记录已更新'}},{status:409}):Response.json({...record,revision:4,canStop:false});});
 client.setSession({user:{id:'qa-admin',username:'qa',permissions:['technical-acceptances.write']},csrfToken:'qa-csrf'});
 await assert.rejects(technicalWrite(client,'/admin/technical-acceptances/qa-tech/stop',{revision:3,idempotencyKey:'qa-stable-key'},'qa-tech',value=>fresh.push(value)),(error:unknown)=>error instanceof ApiError&&error.code==='REVISION_CONFLICT');
 assert.deepEqual(calls.map(value=>value.method),['POST','GET']);assert.equal((fresh[0] as any).revision,4);assert.equal((fresh[0] as any).canStop,false);assert.match(calls[1].path,/technical-acceptances\/qa-tech$/);assert.equal(calls.filter(value=>value.method==='POST').length,1);
});
test('late conflict reread A cannot replace B, including leaving and returning to A',async()=>{
 let finish!:(response:Response)=>void;const applied:unknown[]=[],guard=new TechnicalViewGuard(),form={};
 guard.update('technical-acceptances','qa-A',form);const stamp=guard.capture();
 const client=new ApiClient(async(_url,init)=>init?.method==='POST'?Response.json({error:{code:'CONFLICT',message:'更新'}},{status:409}):new Promise(resolve=>{finish=resolve;}));
 client.setSession({user:{id:'qa',username:'qa',permissions:['*']},csrfToken:'qa'});
 const pending=technicalWrite(client,'/admin/technical-acceptances/qa-A/stop',{},'qa-A',value=>applied.push(value),()=>guard.current(stamp));
 await new Promise(resolve=>setImmediate(resolve));guard.update('technical-acceptances','qa-B',form);guard.update('technical-acceptances','qa-A',form);finish(Response.json({...record,id:'qa-A'}));
 await assert.rejects(pending,(error:unknown)=>error instanceof ApiError&&error.code==='VIEW_CHANGED');assert.deepEqual(applied,[]);
});
test('late successful prepare cannot navigate or clear a newer form or unmounted resource',async()=>{
 for(const destination of ['new-form','other-resource','unmount']){
  let finish!:(response:Response)=>void;const guard=new TechnicalViewGuard(),form={};guard.update('technical-acceptances','qa-A',form);const stamp=guard.capture();
  const client=new ApiClient(()=>new Promise(resolve=>{finish=resolve;}));client.setSession({user:{id:'qa',username:'qa',permissions:['*']},csrfToken:'qa'});
  let feedback=0;const pending=technicalWrite(client,'/admin/technical-acceptances/qa-A/prepare-signature',{},'qa-A',undefined,()=>guard.current(stamp)).then(()=>{feedback++;});
  if(destination==='unmount')guard.invalidate();else guard.update(destination==='other-resource'?'customers':'technical-acceptances','qa-A',{});
  finish(Response.json({record:{...record,id:'qa-A'},approval:{id:'qa-approval'}}));await assert.rejects(pending,(error:unknown)=>error instanceof ApiError&&error.code==='VIEW_CHANGED');assert.equal(feedback,0);
 }
});
test('purged signed history remains a signed fact with deliberately cleaned files and separate PDF hash',()=>{
 assert.match(technicalArchiveText({...record,status:'PURGED',signatureStatus:'SIGNED',signedFileId:null}),/历史双方签署.*已清理/);
 assert.match(technicalArchiveText({...record,signatureStatus:'SIGNED',signedFileId:null}),/尚未取得/);
 const value=technicalSafe({...record,consentRequirementsMet:false,document:{...record.document,sourcePdfHash:'qa-real-pdf-bytes'}});assert.equal((value.document as any).sourcePdfHash,'qa-real-pdf-bytes');assert.equal(value.consentRequirementsMet,false);
});
