import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../src/common/data';
import {customerContractRecord} from '../src/orders/customer-contract-view';
import {customerHandoverSigningReadiness} from '../src/orders/customer-handover-view';
import {handoverDocumentReady} from '../src/offline-documents/readiness';
import {FieldArchiveService} from '../src/offline-documents/field';
function source(){
 const initial={commercialHash:'a'.repeat(64),startDate:'2026-10-01',months:12,monthlyFeeAmount:10000,lessorSnapshot:{ownerId:'owner',name:'原出租方'},commercialTerms:{vehicleIdentification:'原合同车辆'}};
 const order={id:'order',customerId:'customer',contractMode:'OFFLINE',effectiveTermsVersionId:'changed-terms',finalPlanSnapshot:initial};
 const row:any={id:'contract',orderId:order.id,customerId:order.customerId,executionMode:'OFFLINE',kind:'SUBSCRIPTION',status:'DRAFT',offlineArchiveId:'archive',documentHash:initial.commercialHash,order};
 const archive:any={id:'archive',kind:'RENTAL',subjectType:'ORDER',subjectId:order.id,orderId:order.id,currentApprovedVersionId:'version',versions:[{id:'version',version:1,status:'ARCHIVED',businessSnapshotHash:initial.commercialHash,files:[{versionId:'version',fileId:'paper',position:1,file:{id:'paper',name:'原签字件.pdf',purpose:'offline-archive'}}],feedback:[]}]};
 let requestedKind='';const tx:any={$queryRaw:async()=>[],order:{findFirst:async()=>order},orderTermsVersion:{findFirst:async()=>({hash:'b'.repeat(64)})},documentArchive:{findFirst:async({where}:any)=>{requestedKind=where.kind;return where.kind===archive.kind&&where.id===archive.id?archive:null;}}};
 return{initial,order,row,archive,tx,kind:()=>requestedKind};
}
test('customer original paper contract remains archived on its original hash after changed terms',async()=>{
 const f=source(),v=await customerContractRecord(f.tx,'customer',f.row,f.order);assert.ok('archive' in v.contractDetail);assert.equal(v.contractDetail.archive.ready,true);assert.equal(v.documents[0].id,'paper');assert.equal(v.contractDetail.summaryRows.find((r:any)=>r.label==='月度订阅费')?.value,'¥100.00');
});
test('customer amendment reads its exact quote archive and never borrows the original rental',async()=>{
 const f=source(),body='已确认补充协议';Object.assign(f.row,{id:'amendment',kind:'AMENDMENT',delayQuoteId:'quote',documentId:'template',templateVersion:1,body,documentHash:'c'.repeat(64),delayQuote:{id:'quote',changeId:'change',commercialHash:'c'.repeat(64),revision:1,status:'CONFIRMED',snapshot:{document:{id:'template',type:'OFFLINE_ORDER_AMENDMENT',version:1,bodyHash:hash(body),content:body}},change:{id:'change',orderId:'order',customerId:'customer',kind:'DELIVERY_DELAY',status:'APPLIED',priorTerms:f.initial}}});
 Object.assign(f.archive,{kind:'ORDER_AMENDMENT',subjectType:'ORDER_CHANGE_QUOTE',subjectId:'quote',quoteId:'quote'});f.archive.versions[0].businessSnapshotHash=f.row.documentHash;
 let v=await customerContractRecord(f.tx,'customer',f.row,f.order);assert.equal(f.kind(),'ORDER_AMENDMENT');assert.equal(v.title,'订阅变更补充协议');assert.ok('archive' in v.contractDetail);assert.equal(v.contractDetail.archive.ready,true);assert.equal(v.documents[0].id,'paper');assert.equal(v.contractDetail.canSign,false);assert.equal(JSON.stringify(v).includes('priorTerms'),false);
 f.archive.quoteId='foreign';v=await customerContractRecord(f.tx,'customer',f.row,f.order);assert.equal(v.documents.length,0);
 f.row.delayQuote.change.customerId='foreign';v=await customerContractRecord(f.tx,'customer',f.row,f.order);assert.equal(v.documents.length,0);
});
test('SWAP_RETURN selects the return receipt in business gate and customer view',async()=>{
 const f=source(),h={id:'handover',orderId:'order',customerId:'customer',type:'SWAP_RETURN',executionMode:'OFFLINE',offlineArchiveId:'archive',manifestHash:'d'.repeat(64),revision:1,status:'CUSTOMER_CONFIRMED',customerResponse:'CONFIRM',confirmedAt:new Date()};Object.assign(f.archive,{kind:'RETURN_RECEIPT',subjectType:'HANDOVER',subjectId:h.id,handoverId:h.id});f.archive.versions[0].businessSnapshotHash=h.manifestHash;
 f.tx.handover={findUnique:async()=>h};const original=f.tx.documentArchive.findFirst;f.tx.documentArchive.findFirst=async({where}:any)=>original({where:{id:'archive',...where}});
 assert.equal((await handoverDocumentReady(f.tx,h.id)).ready,true);assert.equal((await customerHandoverSigningReadiness(f.tx,'customer',h)).stage,'PAPER_ARCHIVED');assert.equal(f.kind(),'RETURN_RECEIPT');
});
test('assigned FIELD may read its swap-return paper without invoking final physical return effects',async()=>{
 const f=source(),task={id:'task',orderId:'order',assigneeId:'field',status:'ASSIGNED',version:1,type:'SWAP_RETURN',vehicleId:'old-car',vehicleAssignmentId:'assignment',currentHandoverId:'handover',materialGeneration:0};Object.assign(f.archive,{kind:'RETURN_RECEIPT',handoverId:'handover'});const version=f.archive.versions[0],file=version.files[0].file;
 f.tx.fieldHandoverTask={findUnique:async()=>task};f.tx.adminUser={findUnique:async()=>({id:'field',role:'FIELD',active:true,authVersion:1})};f.tx.handover={findUnique:async()=>({id:'handover',fieldTaskId:'task',type:task.type,vehicleId:task.vehicleId,assignmentId:task.vehicleAssignmentId,manifestHash:version.businessSnapshotHash})};f.tx.documentArchive.findUnique=async()=>f.archive;f.tx.archiveFile={findUnique:async()=>({versionId:version.id,version:{...version,archiveId:f.archive.id},file})};
 f.tx.assetPrivateFile={count:async()=>0};const result=await new FieldArchiveService({serial:async(fn:any)=>fn(f.tx)} as any).file('task','paper',{id:'field',role:'FIELD',authVersion:1});assert.equal(result.id,'paper');
});
