import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ArchiveService} from '../src/offline-documents/archive.service';
import {readTerminationContext,terminationSourceFactHash} from '../src/offline-documents/termination';

const businessHash='a'.repeat(64),actor={id:'operator',role:'OPERATIONS'};
const details={reasonType:'CUSTOMER_REQUEST',reason:'取消订阅',effectiveAt:'2026-10-30T10:00:00+08:00',conditionSummary:'未交付，无需还车查验',violationStatus:'NOT_APPLICABLE',violationSummary:'未交付不适用',additionalPaymentAmount:0,refundAmount:0,retainedDepositAmount:0,retainedDepositHandling:'无',settlementBasis:'无应补应退款',unresolvedMatters:'无'};
const term=()=>({originalContract:{archiveId:'rental',versionId:'rental-v1',version:1,name:'原租赁合同',number:'RENT-001',signedOn:'2026-10-29',businessSnapshotHash:businessHash},relevantTerms:{earlyTerminationRule:'按原约定',depositRefundRule:'退还无争议押金'},vehicle:{id:'car',vin:'TESTVIN0000000001',plateNumber:'沪A测试',title:'测试车'},delivery:{state:'NOT_DELIVERED'},funds:{receivedAmount:100,refundedAmount:0,netReceivedAmount:100,depositReceivedAmount:0,depositRefundedAmount:0},blockers:[]});

test('uncompleted actual handover, receipt without delivery, and in-use status never print as not delivered',async()=>{
 for(const evidence of [{handovers:[{id:'h',type:'DELIVERY',status:'DRAFT',actualAt:new Date()}],receipt:null,status:'AWAITING_HANDOVER'},{handovers:[],receipt:{id:'receipt',receivedAt:new Date()},status:'AWAITING_HANDOVER'},{handovers:[],receipt:null,status:'ACTIVE'}]){
  const tx:any={vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},documentArchive:{findFirst:async()=>null},handover:{findMany:async()=>evidence.handovers},vehicleReceiptEvent:{findFirst:async()=>evidence.receipt},payment:{findMany:async()=>[]},vehicle:{findUnique:async()=>({id:'car',vin:'VIN',title:'测试车'})}};
  const result=await readTerminationContext(tx,{id:'order',vehicleId:'car',status:evidence.status});
  assert.equal(result.delivery.state,'UNKNOWN');assert.ok(result.blockers.some(b=>b.code==='TERMINATION_DELIVERY_UNCONFIRMED'));
 }
});

test('vehicle identity belongs to the original signed snapshot; a different current car cannot replace it',async()=>{
 const signed:any={id:'signed',version:1,status:'ARCHIVED',templateId:'t',contractNumber:'ORIGINAL',signedOn:'2026-10-29',businessSnapshotHash:businessHash,scopeSnapshot:{vehicleId:'original-car'},files:[{fileId:'signed-paper'}]};
 const tx:any={vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},documentArchive:{findFirst:async()=>({id:'rental',versions:[signed]})},legalDocument:{findUnique:async()=>({title:'原合同',type:'OFFLINE_RENTAL'})},handover:{findMany:async()=>[]},vehicleReceiptEvent:{findFirst:async()=>null},payment:{findMany:async()=>[]}};
 const order:any={id:'order',vehicleId:'replacement-car',status:'AWAITING_HANDOVER',finalPlanSnapshot:{commercialHash:businessHash,commercialTerms:{vehicleIdentification:'原车 VIN：LSVNV2182E2182777；原牌沪A00001',earlyTerminationRule:'原解约',depositRefundRule:'原押金'}}};
 const current=await readTerminationContext(tx,order);assert.equal(current.vehicle?.id,'original-car');assert.equal(current.vehicle?.vin,'LSVNV2182E2182777');assert.ok(current.blockers.some(b=>b.code==='TERMINATION_VEHICLE_UNCONFIRMED'));
 order.vehicleId='original-car';const same=await readTerminationContext(tx,order);assert.equal(same.blockers.length,0);assert.equal(same.delivery.state,'NOT_DELIVERED');
 order.status='AWAITING_HANDOVER';const paid=await readTerminationContext(tx,order);assert.equal(paid.delivery.state,'NOT_DELIVERED','paid awaiting-handover order without physical evidence is still before delivery');assert.equal(paid.blockers.length,0);
 order.finalPlanSnapshot.commercialTerms.vehicleIdentification='未记载VIN';const missing=await readTerminationContext(tx,order);assert.equal(missing.vehicle,null);assert.ok(missing.blockers.some(b=>b.code==='TERMINATION_VEHICLE_UNCONFIRMED'));
 order.finalPlanSnapshot.commercialTerms.vehicleIdentification='VIN：LSVNV2182E2182777';order.effectiveTermsVersionId='effective-terms';tx.orderTermsVersion={findUnique:async()=>({orderId:'order',hash:'b'.repeat(64),snapshot:{amendmentContractId:'signed-amendment'}})};
 tx.order={findUnique:async()=>order};
 const amended=await readTerminationContext(tx,order);assert.ok(amended.blockers.some(b=>b.code==='TERMINATION_AMENDMENT_REVIEW_REQUIRED'),'an effective signed amendment cannot be silently replaced with original rental clauses');assert.equal(amended.relevantTerms.earlyTerminationRule,'原解约');
});

function returnedAssignmentFixture(){
 const startAt=new Date('2026-10-30T01:00:00Z'),endAt=new Date('2026-10-30T02:00:00Z');
 const order:any={id:'order',customerId:'customer',vehicleId:'car',status:'SETTLING',currentAssignmentId:null,finalPlanSnapshot:{commercialHash:businessHash,commercialTerms:{vehicleIdentification:'原车 VIN：LSVNV2182E2182777',earlyTerminationRule:'按原约定',depositRefundRule:'退还押金'}}};
 const delivery:any={id:'delivery',orderId:'order',customerId:'customer',vehicleId:'car',assignmentId:'closed-assignment',type:'DELIVERY',status:'COMPLETED',actualAt:startAt,completedAt:startAt};
 const returned:any={id:'returned',orderId:'order',customerId:'customer',vehicleId:'car',assignmentId:'closed-assignment',type:'RETURN',status:'COMPLETED',actualAt:endAt,completedAt:endAt,readingKm:200};
 const assignment:any={id:'closed-assignment',orderId:'order',customerId:'customer',vehicleId:'car',status:'CLOSED',deliveryHandoverId:delivery.id,returnHandoverId:returned.id,startAt,endAt};
 const receipt:any={id:'receipt',orderId:'order',vehicleId:'car',assignmentId:'closed-assignment',handoverId:returned.id,receivedAt:endAt,storageLocation:'合成收车位',readingKm:200};
 const handovers:any[]=[returned,delivery];let queried=0;
 const tx:any={vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},documentArchive:{findFirst:async()=>({id:'rental',versions:[{id:'signed',version:1,status:'ARCHIVED',templateId:'t',contractNumber:'ORIGINAL',signedOn:'2026-10-29',businessSnapshotHash:businessHash,scopeSnapshot:{vehicleId:'car'},files:[{fileId:'signed-paper'}]}]})},legalDocument:{findUnique:async()=>({title:'原合同',type:'OFFLINE_RENTAL'})},handover:{findMany:async()=>handovers},vehicleReceiptEvent:{findFirst:async()=>receipt},payment:{findMany:async()=>[]},vehicleAssignment:{findFirst:async({where}:any)=>{queried++;assert.deepEqual(where,{id:'closed-assignment',orderId:'order',customerId:'customer',vehicleId:'car',status:'CLOSED',returnHandoverId:'returned'});return assignment;}}};
 return{tx,order,delivery,returned,assignment,receipt,handovers,queries:()=>queried};
}

test('formal return uses the same closed assignment after current assignment was cleared, without rewriting order or facts',async()=>{
 const f=returnedAssignmentFixture(),before=structuredClone({order:f.order,assignment:f.assignment,delivery:f.delivery,returned:f.returned,receipt:f.receipt});
 const result=await readTerminationContext(f.tx,f.order);
 assert.deepEqual(result.blockers,[]);assert.equal(result.delivery.state,'RETURNED');assert.equal(result.delivery.deliveryId,'delivery');assert.equal(result.delivery.returnId,'receipt');assert.equal(result.delivery.source,'PHYSICAL_RECEIPT');assert.equal(f.queries(),1);
 assert.deepEqual({order:f.order,assignment:f.assignment,delivery:f.delivery,returned:f.returned,receipt:f.receipt},before);
});

test('closed assignment fallback rejects foreign, swapped and incomplete handover facts',async()=>{
 const changes:Record<string,(f:ReturnType<typeof returnedAssignmentFixture>)=>void>={
  foreignAssignmentOrder:f=>{f.assignment.orderId='other';},foreignAssignmentCustomer:f=>{f.assignment.customerId='other';},foreignAssignmentVehicle:f=>{f.assignment.vehicleId='other';},
  activeAssignment:f=>{f.assignment.status='ACTIVE';},wrongReturnBinding:f=>{f.assignment.returnHandoverId='other';},wrongDeliveryBinding:f=>{f.assignment.deliveryHandoverId='other';},missingClosure:f=>{f.assignment.endAt=null;},
  foreignReturnOrder:f=>{f.returned.orderId='other';},foreignReturnCustomer:f=>{f.returned.customerId='other';},foreignReturnVehicle:f=>{f.returned.vehicleId='other';},unfinishedReturn:f=>{f.returned.status='CUSTOMER_CONFIRMED';},
  foreignDeliveryCustomer:f=>{f.delivery.customerId='other';},unfinishedDelivery:f=>{f.delivery.status='PUBLISHED';},mismatchedReceipt:f=>{f.receipt.assignmentId='other';},
  switchedVehicleHistory:f=>{f.handovers.push({...f.delivery,id:'swapped',type:'SWAP_RETURN',vehicleId:'other-car',assignmentId:'other-assignment'});},
  openOrder:f=>{f.order.status='ACTIVE';},
 };
 for(const[label,change]of Object.entries(changes)){const f=returnedAssignmentFixture();change(f);const result=await readTerminationContext(f.tx,f.order);assert.equal(result.delivery.state,'UNKNOWN',label);assert.ok(result.blockers.some(b=>b.code==='TERMINATION_DELIVERY_UNCONFIRMED'),label);}
});

function fixture(){
 let current:any=term();const v:any={id:'v',archiveId:'a',version:1,status:'DRAFT',templateId:'template',templateVersion:2,businessSnapshotHash:businessHash,scopeSnapshot:{vehicleId:'car',terminationDetails:details},requiredSigners:['CUSTOMER','OWNER','PLATFORM'],partiesSnapshot:['CUSTOMER','OWNER','PLATFORM'].map(role=>({role,partyId:role,name:role,subjectType:'ENTERPRISE',creditCode:'91310000TEST000001'})),files:[]};
 const a:any={id:'a',kind:'TERMINATION',subjectType:'ORDER',subjectId:'order',orderId:'order',revision:0,versions:[v]};let fileSequence=0;
 const tx:any={vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},$queryRaw:async()=>[],adminUser:{findUnique:async()=>({active:true,role:'OPERATIONS'})},documentArchive:{findUnique:async()=>a,update:async()=>({})},archiveVersion:{update:async({data}:any)=>Object.assign(v,data)},storedFile:{create:async({data}:any)=>({id:'source-'+(++fileSequence),...data})},archiveCommand:{findUnique:async()=>null,findFirst:async()=>({id:'print-command'}),create:async()=>({})},auditLog:{create:async()=>({})},legalDocument:{findUnique:async()=>({id:'template',version:2,type:'OFFLINE_TERMINATION',status:'PUBLISHED',confirmedBy:'legal',confirmedAt:new Date(),title:'终止协议',content:'终止《{{originalContractName}}》（{{originalContractNumber}}）。'})}};
 const context={resolve:async()=>({terminationContext:current,businessSnapshotHash:businessHash,businessSnapshot:{},scopeSnapshot:v.scopeSnapshot,requiredSigners:['CUSTOMER','OWNER','PLATFORM'],partiesSnapshot:['CUSTOMER','OWNER','PLATFORM'].map(role=>({role,partyId:role,name:role}))})};
 const service=new ArchiveService({serial:async(fn:any)=>fn(tx),...tx} as any,context as any);
 return{service,a,v,setCurrent:(value:any)=>{current=value;}};
}
async function prepare(f:ReturnType<typeof fixture>){const old=process.env.CONTRACT_CJK_FONT_PATH;process.env.CONTRACT_CJK_FONT_PATH='C:/Windows/Fonts/simhei.ttf';try{return await f.service.prepare('a','v',{revision:0,idempotencyKey:'prepare-snapshot'},actor);}finally{if(old===undefined)delete process.env.CONTRACT_CJK_FONT_PATH;else process.env.CONTRACT_CJK_FONT_PATH=old;}}
const errorCode=(expected:string)=>(e:any)=>e.getResponse?.().error.code===expected;

test('termination source digest survives JSONB object-key reordering at every level',()=>{
 const reorder=(value:any):any=>Array.isArray(value)?value.map(reorder):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).reverse().map(key=>[key,reorder(value[key])])):value;
 assert.equal(terminationSourceFactHash(term() as any),terminationSourceFactHash(reorder(term())));
});

test('generated termination source freezes original, vehicle and return facts without changing commercial hash',async()=>{
 const f=fixture();await prepare(f);const printed=f.v.scopeSnapshot.terminationPrintSnapshot;
 assert.equal(printed.context.originalContract.versionId,'rental-v1');assert.equal(printed.context.vehicle.vin,'TESTVIN0000000001');assert.equal(printed.context.delivery.state,'NOT_DELIVERED');assert.match(printed.sourceFactHash,/^[a-f0-9]{64}$/);assert.ok(printed.capturedAt);assert.equal(f.v.businessSnapshotHash,businessHash);
 const changed=term();changed.funds.refundedAmount=100;changed.funds.netReceivedAmount=0;f.setCurrent(changed);
 await f.service.confirmPrint('a','v',{revision:0,idempotencyKey:'confirm-money-change'},actor);
 assert.equal(f.v.scopeSnapshot.terminationPrintSnapshot.context.funds.refundedAmount,0,'printed reference remains as generated; later refund cannot overwrite it');
});

test('a changed original rental or delivery fact blocks confirm, upload, submit, approve and archive until corrected',async()=>{
 for(const operation of ['confirm','upload','submit','review','archive']){
  const f=fixture();await prepare(f);const changed=term();changed.originalContract.versionId='rental-v2';f.setCurrent(changed);
  const command={versionId:'v',revision:0,idempotencyKey:'changed-'+operation};
  if(operation==='confirm')await assert.rejects(f.service.confirmPrint('a','v',{revision:0,idempotencyKey:command.idempotencyKey},actor),errorCode('TERMINATION_SOURCE_CHANGED'));
  if(operation==='upload')await assert.rejects(f.service.upload('a','v',{position:1,revision:0,idempotencyKey:command.idempotencyKey},{buffer:Buffer.from('%PDF-synthetic'),mimetype:'application/pdf',originalname:'signed.pdf'} as any,actor),errorCode('TERMINATION_SOURCE_CHANGED'));
  if(operation==='submit')await assert.rejects(f.service.submit('a',command,actor),errorCode('TERMINATION_SOURCE_CHANGED'));
  if(operation==='review'){f.v.status='SUBMITTED';await assert.rejects(f.service.review('a',{...command,decision:'APPROVE',checklist:{partiesComplete:true,authorityChecked:true,pagesComplete:true,vehicleMatches:true,termsMatch:true,annexesComplete:true,legible:true},partyChecks:[],reason:'核验'},actor),errorCode('TERMINATION_SOURCE_CHANGED'));}
  if(operation==='archive'){f.v.status='REVIEWED';await assert.rejects(f.service.archive('a',command,actor),errorCode('TERMINATION_SOURCE_CHANGED'));}
 }
 const f=fixture();await prepare(f);f.setCurrent({...term(),delivery:{state:'AWAITING_RETURN',deliveryId:'delivered',deliveredAt:'2026-10-30T00:00:00.000Z'}});
 await assert.rejects(f.service.confirmPrint('a','v',{revision:0,idempotencyKey:'changed-delivery'},actor),errorCode('TERMINATION_SOURCE_CHANGED'));
});
