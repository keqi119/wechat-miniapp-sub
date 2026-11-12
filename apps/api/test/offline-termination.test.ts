import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildOfflinePrintModel,renderOfflineDocument} from '../src/offline-documents/print';
import {terminationDetailsSchema,readTerminationContext,validateTerminationForPrint} from '../src/offline-documents/termination';
import {ArchiveService} from '../src/offline-documents/archive.service';
import {ArchiveContextService} from '../src/offline-documents/context';
const details:any={reasonType:'CUSTOMER_REQUEST',reason:'客户取消尚未交付的车辆订阅',effectiveAt:'2026-10-30T10:00:00+08:00',conditionSummary:'未交付，无需还车查验',violationStatus:'NOT_APPLICABLE',violationSummary:'未交付，不适用',additionalPaymentAmount:0,refundAmount:1,refundDueOn:'2026-11-02',retainedDepositAmount:0,retainedDepositHandling:'不保留押金',settlementBasis:'已支付测试款0.01元全额退回',unresolvedMatters:'无'};
const termContext:any={vehicle:{id:'car',vin:'LSVNV2182E2182777',identification:'测试车；VIN：LSVNV2182E2182777'},originalContract:{archiveId:'rental',versionId:'rental-v1',version:1,name:'原车辆订阅合同',number:'RENT-001',signedOn:'2026-10-29',businessSnapshotHash:'original'},relevantTerms:{earlyTerminationRule:'按原合同约定协商终止',depositRefundRule:'核对后退还押金'},delivery:{state:'NOT_DELIVERED'},funds:{receivedAmount:1,refundedAmount:0,netReceivedAmount:1,depositReceivedAmount:0,depositRefundedAmount:0},blockers:[]};
const input:any={archive:{id:'termination',kind:'TERMINATION'},version:{version:1,businessSnapshotHash:'business'},template:{id:'t',version:2,title:'三方终止协议',content:'终止《{{originalContractName}}》（编号{{originalContractNumber}}）。'},context:{requiredSigners:['CUSTOMER','OWNER','PLATFORM'],partiesSnapshot:['CUSTOMER','OWNER','PLATFORM'].map(role=>({role,partyId:role,name:role})),businessSnapshot:{months:12,monthlyFeeAmount:399900,usagePolicy:{content:'不得进入终止协议的里程全文'},commercialTerms:{permittedUse:'不得进入的全量条款'},productSnapshot:{benefits:[{name:'不得进入的权益'}]}},scopeSnapshot:{terminationDetails:details},terminationContext:termContext}};
test('termination model references original contract and settlement only, never full subscription appendix',()=>{
 const model=buildOfflinePrintModel(input),text=JSON.stringify(model);
 assert.match(text,/RENT-001/);assert.match(text,/原车辆订阅合同/);assert.match(text,/0.01/);assert.match(text,/未交付/);
 for(const forbidden of ['不得进入','订阅方案','约定权益附件','每月里程','3999'])assert.equal(text.includes(forbidden),false);
 assert.equal(model.usageAppendix,'');
});
test('termination dates and explicit settlement instructions are required; return plans never claim actual return',()=>{
 assert.equal(terminationDetailsSchema.safeParse({...details,refundDueOn:undefined}).success,false);
 assert.equal(terminationDetailsSchema.safeParse({...details,additionalPaymentAmount:1}).success,false);
 assert.equal(terminationDetailsSchema.safeParse({...details,retainedDepositAmount:1,retainedDepositHandling:'待处理'}).success,false);
 assert.equal(terminationDetailsSchema.safeParse({...details,violationStatus:'PENDING',violationSummary:'待处理'}).success,false);
 assert.throws(()=>validateTerminationForPrint(details,{...termContext,delivery:{state:'AWAITING_RETURN'}}));
 assert.doesNotThrow(()=>validateTerminationForPrint({...details,plannedReturnAt:'2026-11-01T10:00:00+08:00',returnPlace:'约定交回点'},{...termContext,delivery:{state:'AWAITING_RETURN'}}));
 assert.throws(()=>buildOfflinePrintModel({...input,context:{...input.context,scopeSnapshot:{}}}));
});
test('original reference is same-order signed version, original terms snapshot, actual receipts and successful money only',async()=>{
 const order:any={id:'order',vehicleId:'car',currentAssignmentId:null,finalPlanSnapshot:{commercialHash:'oldhash',commercialTerms:{vehicleIdentification:'测试车；VIN：LSVNV2182E2182777',earlyTerminationRule:'原终止条款',depositRefundRule:'原押金条款'}}};
 const tx:any={vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},documentArchive:{findFirst:async({where}:any)=>{assert.equal(where.orderId,'order');return{id:'r',versions:[{id:'draft',version:2,status:'DRAFT'},{id:'signed',version:1,status:'ARCHIVED',scopeSnapshot:{vehicleId:'car'},businessSnapshotHash:'oldhash',contractNumber:'R1',signedOn:'2026-10-29',templateId:'rt',files:[{fileId:'f'}]}]};}},legalDocument:{findUnique:async()=>({title:'冻结租赁合同',type:'OFFLINE_RENTAL'})},handover:{findMany:async()=>[{id:'delivery',type:'DELIVERY',status:'COMPLETED',actualAt:new Date('2026-10-28T00:00:00Z')}]},vehicleReceiptEvent:{findFirst:async()=>({id:'receipt',receivedAt:new Date('2026-10-30T00:00:00Z'),storageLocation:'实际停车位',readingKm:123})},payment:{findMany:async()=>[{amount:100,status:'SUCCEEDED',bill:{type:'DEPOSIT'},refunds:[{amount:20,status:'SUCCEEDED'},{amount:30,status:'PROCESSING'}]}]}};
 const result=await readTerminationContext(tx,order);assert.equal(result.originalContract?.number,'R1');assert.equal(result.relevantTerms.earlyTerminationRule,'原终止条款');assert.equal(result.delivery.state,'RETURNED');assert.equal(result.delivery.source,'PHYSICAL_RECEIPT');assert.equal(result.funds.refundedAmount,20);assert.equal(result.funds.netReceivedAmount,80);
});
test('actual termination PDF renders using the compact model',async()=>{
 const pdf=await renderOfflineDocument(input,'C:/Windows/Fonts/simhei.ttf');assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.ok(pdf.length>1000);
 if(process.env.TERMINATION_PDF_SAMPLE==='true'){const fs=await import('node:fs/promises'),path=await import('node:path');const dir=path.resolve('../../.runtime/ninda/contract-trial-20261030');await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'termination-synthetic.pdf'),pdf);}
});
test('updating termination details clears generated source and draft metadata preserves the exact details',async()=>{
 const v:any={id:'v',version:1,status:'DRAFT',sourceFileId:'previous-source',scopeSnapshot:{vehicleId:'car'},files:[]},a:any={id:'a',kind:'TERMINATION',orderId:'order',revision:0,versions:[v]};
 const tx:any={vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},$queryRaw:async()=>[],adminUser:{findUnique:async()=>({role:'OPERATIONS',active:true})},documentArchive:{findUnique:async()=>a,update:async()=>({})},archiveVersion:{update:async({data}:any)=>Object.assign(v,data)},archiveCommand:{findUnique:async()=>null,create:async()=>({})},auditLog:{create:async()=>({})}};
 const service=new ArchiveService({serial:async(fn:any)=>fn(tx)} as any,{} as any);
 await service.patch('a','v',{revision:0,idempotencyKey:'term-details-edit',terminationDetails:details},{id:'operator',role:'OPERATIONS'});
 assert.equal(v.sourceFileId,null);assert.deepEqual(v.scopeSnapshot.terminationDetails,details);assert.equal(v.scopeSnapshot.vehicleId,'car');
 v.status='SUBMITTED';await assert.rejects(service.patch('a','v',{revision:0,idempotencyKey:'term-details-after-submit',terminationDetails:details},{id:'operator',role:'OPERATIONS'}));
});
test('missing original contract stays explicit and does not borrow a current product template',async()=>{
 const tx:any={vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},documentArchive:{findFirst:async()=>null},handover:{findMany:async()=>[]},vehicleReceiptEvent:{findFirst:async()=>null},payment:{findMany:async()=>[]}};
 const context=await readTerminationContext(tx,{id:'order',vehicleId:'car'});assert.equal(context.originalContract,null);assert.equal(context.delivery.state,'UNKNOWN');assert.equal(context.blockers[0].code,'TERMINATION_ORIGINAL_REQUIRED');
 assert.throws(()=>validateTerminationForPrint(details,context));
});
