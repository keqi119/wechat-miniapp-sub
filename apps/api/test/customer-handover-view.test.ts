import {onlineRecordFacts} from '../src/operations/online-handover';
import {canonicalHash} from '../src/customers/types';
import './legacy-esign-mode';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {WorkflowsController} from '../src/operations/workflows';
import {SignaturePolicyService} from '../src/esign/enterprise-seal/signature-policy.service';
import {CustomerESignOnboardingService} from '../src/esign/customer-esign-onboarding.service';
import {ContractPdfArtifactWriterService} from '../src/contract/contract-pdf-artifact-writer.service';
import {compileSigningPlan} from '../src/esign/enterprise-seal/signing-plan-compiler';
import {hashSigningPlanPayload} from '../src/esign/enterprise-seal/signing-plan-hash';
import {explicitPlatformLegalEntity,platformLegalEntity} from '../src/common/platform-legal-entity';
import {MINIAPP_PROVIDER_API} from '../src/esign/native-signing';
import {termSwapFixture} from './term-swap-fixture';
import {grantSwapCredit} from '../src/swap-purchases/ledger';
const savedEnv={enabled:process.env.MINIAPP_SIGNING_ENABLED,base:process.env.FADADA_BASE_URL,hosts:process.env.MINIAPP_SIGNING_PROVIDER_HOSTS};
before(()=>{process.env.MINIAPP_SIGNING_ENABLED='true';process.env.FADADA_BASE_URL=MINIAPP_PROVIDER_API;process.env.MINIAPP_SIGNING_PROVIDER_HOSTS='textapi17.fadada.com,realnameverify16.fadada.com';});
after(()=>{for(const [key,value] of [['MINIAPP_SIGNING_ENABLED',savedEnv.enabled],['FADADA_BASE_URL',savedEnv.base],['MINIAPP_SIGNING_PROVIDER_HOSTS',savedEnv.hosts]]){if(value===undefined)delete process.env[key!];else process.env[key!]=value;}});
const manifest='a'.repeat(64),sourceHash='b'.repeat(64),signedHash='c'.repeat(64);
function fixture(){
 const now=new Date(),customer={id:'customer',name:'合成客户',mobile:'13900000000'};
 const order:any={id:'order',customerId:'customer',status:'AWAITING_HANDOVER',vehicleId:'vehicle',confirmedMileageKm:10,vehicle:{id:'vehicle',title:'合成车辆',reservedOrderId:'order',status:'RESERVED',mileageKm:10},customer};
 const h:any={id:'handover',orderId:'order',customerId:'customer',vehicleId:'vehicle',assignmentId:null,changeId:null,type:'DELIVERY',readingKm:12,actualAt:now,fileIds:['evidence'],checklist:[{label:'batteryLevel',value:'90%'}],manifestHash:manifest,revision:1,status:'CUSTOMER_CONFIRMED',customerResponse:'CONFIRM',confirmedAt:now,signatureStatus:'DRAFT',providerTaskId:null,signingLeaseUntil:null,signedFileId:null,responseKey:'SECRET_RESPONSE',resolvedBy:'SECRET_OPERATOR'};
 const resource=()=>({...h,order});
 const policy:any={id:'policy',policyCode:'HANDOVER',policyName:'合成交接策略',status:'ACTIVE',kind:'HANDOVER',executionMode:'SEQUENTIAL',sealId:'seal'};
 const seal:any={id:'seal',organizationName:platformLegalEntity(),status:'ACTIVE',confirmedBy:'operator',confirmedAt:now,providerCustomerId:'SECRET_PLATFORM',providerSignatureId:'SECRET_SEAL'};
 const settings:any={enabled:true,signingEnabled:true,platformCustomerId:'SECRET_PLATFORM',platformSignatureId:'SECRET_SEAL'};
 const actors:any[]=[{id:'requester',active:true,role:'OPERATIONS'},{id:'reviewer',active:true,role:'ADMIN'}];
 const authorities:any[]=[{id:'request-authority',sealId:'seal',status:'ACTIVE',authorityType:'REQUEST_USE',subjectType:'USER',subjectId:'requester',requiresTwoPersonApproval:true},{id:'approve-authority',sealId:'seal',status:'ACTIVE',authorityType:'APPROVE_USE',subjectType:'USER',subjectId:'reviewer',requiresTwoPersonApproval:true}];
 const identityCiphertext='SECRET_CIPHERTEXT',account:any={customerId:'customer',providerCustomerId:'SECRET_CUSTOMER',registrationStatus:'REGISTERED',realNameStatus:'VERIFIED',identityCiphertext,verifiedIdentityHash:createHash('sha256').update(identityCiphertext).digest('hex'),verifiedSerialNo:'SECRET_SERIAL',verificationTransactionNo:'SECRET_TRANSACTION',verificationSource:'QUERY',verifiedAt:now,checkedAt:now,certStatus:'BOUND',certSerialNo:'SECRET_CERT'};
 const plan:any=compileSigningPlan({contractId:'handover',customerId:'customer',orderId:'order',decision:{code:'ALLOW',compileAllowed:true,requiresApproval:true,reasonCode:'synthetic'},policy:{id:'policy',policyCode:'HANDOVER',policyName:policy.policyName,status:'ACTIVE',executionMode:'SEQUENTIAL',requiresEnterpriseSeal:true,defaultSealId:'seal'},seal:{id:'seal',provider:'FADADA',providerSealId:seal.providerSignatureId,sealName:undefined as any,sealType:'COMPANY',status:'ACTIVE'}});
 const storedPlan=explicitPlatformLegalEntity()?{...plan,platformLegalEntityName:platformLegalEntity()}:plan;
 const approval:any={id:'approval',kind:'HANDOVER',resourceId:'handover',customerId:'customer',documentHash:manifest,sourceFileId:'source',sourcePdfHash:sourceHash,slotCoordinates:[{slotId:'STAGE2_HANDOVER_CUSTOMER',pageNumber:0,x:100,y:100},{slotId:'STAGE2_HANDOVER_PLATFORM',pageNumber:0,x:200,y:100}],policyId:'policy',sealId:'seal',requesterId:'requester',approverId:'reviewer',approvedAt:now,expiresAt:new Date(now.getTime()+3600000),status:'APPROVED',plan:storedPlan};
 approval.planHash=hashSigningPlanPayload({compiledPlan:storedPlan,documentHash:manifest,sourcePdfHash:sourceHash,slotCoordinates:approval.slotCoordinates});
 const task:any={id:'task',kind:'HANDOVER',resourceId:'handover',customerId:'customer',documentHash:manifest,sourceFileId:'source',sourcePdfHash:sourceHash,approvalId:'approval',customerProviderId:'SECRET_CUSTOMER',platformProviderId:'SECRET_PLATFORM',status:'PREPARED',uploadedAt:null,customerSignedAt:null,platformSignedAt:null,signedFileId:null,signedPdfHash:null,processingUntil:null,platformSigningMode:'MANUAL'};
 const files:any[]=[{id:'evidence',name:'合成照片',mimeType:'image/png',size:10,customerId:null},{id:'source',name:'合成PDF',mimeType:'application/pdf',size:100,customerId:'customer',purpose:'contract',sha256:sourceHash},{id:'signed',name:'合成归档',mimeType:'application/pdf',size:120,customerId:'customer',purpose:'contract',sha256:signedHash}];
 let currentApproval:any=approval,currentTask:any=null,changes=0;const calls:any[]=[];
 const scoped=(name:string,args:any)=>{calls.push([name,args]);assert.equal(args.where.kind,'HANDOVER');assert.equal(args.where.resourceId,'handover');assert.equal(args.where.customerId,'customer');assert.equal(args.where.documentHash,manifest);};
 const db:any={vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},serial:async()=>{throw Error('GET must never open write transaction');},order:{findFirst:async(args:any)=>args.where.id===order.id&&args.where.customerId===order.customerId?order:null},handover:{findFirst:async(args:any)=>{calls.push(['handover',args]);return args.where.id===h.id&&args.where.customerId===h.customerId&&h.status!=='DRAFT'?h:null;},findUnique:async()=>resource()},vehicle:{findUnique:async()=>order.vehicle},storedFile:{findMany:async(args:any)=>files.filter(f=>args.where.id.in.includes(f.id)).map(({id,name,mimeType,size})=>({id,name,mimeType,size})),findFirst:async(args:any)=>files.find(f=>f.id===args.where.id&&f.customerId===args.where.customerId&&f.sha256===args.where.sha256)||null,findUnique:async(args:any)=>files.find(f=>f.id===args.where.id)||null},fadadaTask:{findFirst:async(args:any)=>{scoped('task',args);return currentTask;},findUnique:async()=>currentTask},eSignApproval:{findFirst:async(args:any)=>{scoped('approval',args);return currentApproval;},findUnique:async(args:any)=>args.where.id===currentApproval?.id?currentApproval:null},signaturePolicy:{findUnique:async()=>policy},enterpriseSeal:{findUnique:async()=>seal},adminUser:{findUnique:async(args:any)=>actors.find(a=>a.id===args.where.id)||null},sealAuthority:{findMany:async()=>authorities},eSignAccount:{findUnique:async()=>account},orderChange:{count:async()=>changes}};
 const trap:any=new Proxy({},{get:()=>()=>{throw Error('Provider access forbidden during customer GET');}}),writer=new ContractPdfArtifactWriterService(db);writer.readVerified=async(id:string,hash:string)=>{const f=files.find(file=>file.id===id);assert.equal(f?.sha256,hash);return Buffer.from('%PDF-synthetic read boundary');};writer.prepare=async()=>{throw Error('GET must not prepare PDFs');};
 const accounts=new CustomerESignOnboardingService(db,settings,trap),policies=new SignaturePolicyService(db,writer,accounts,settings);
 const controller=new (WorkflowsController as any)(db,trap,trap,policies,settings);
 return{controller,request:{customer},db,h,order,task,approval,policy,seal,settings,actors,authorities,account,files,calls,writer,noApproval:()=>{currentApproval=null;},useTask:()=>{currentTask=task;h.providerTaskId=task.id;},blockChange:()=>{changes=1;}};
}
async function view(f:ReturnType<typeof fixture>){const result=await f.controller.getHandover('handover',f.request);assert.ok(result.signingReadiness,'customer handover needs persisted read-only signing readiness');return{result,s:result.signingReadiness};}

test('confirmed facts without prepared PDF or approval await preparation without write or provider effects',async()=>{const f=fixture();f.noApproval();const {result,s}=await view(f);assert.equal(s.stage,'PREPARING');assert.equal(s.canSign,false);assert.equal(s.version,1);assert.equal(s.handoverId,result.id);assert.equal(s.manifestHash,result.manifestHash);assert.equal(s.revision,result.revision);assert.match(s.message,/准备/);assert.equal(result.checklist[0].label,'交接时电量');assert.doesNotMatch(JSON.stringify(result),/SECRET_|requester|approver|provider|processingUntil/);});
test('published facts stay separate from pending PDF review and approved signing',async()=>{const f=fixture();f.h.status='PUBLISHED';f.h.customerResponse=null;f.h.confirmedAt=null;let r=await view(f);assert.equal(r.s.stage,'FACTS_PENDING');assert.equal(r.s.canSign,false);assert.equal(f.calls.filter(([n])=>n==='approval').length,0);f.h.status='CUSTOMER_CONFIRMED';f.h.customerResponse='CONFIRM';f.h.confirmedAt=new Date();f.approval.status='PENDING';r=await view(f);assert.equal(r.s.stage,'REVIEWING');assert.equal(r.s.canSign,false);assert.match(r.s.message,/复核/);});
test('valid approved document passes the real read-only policy guard before sign is displayed',async()=>{const f=fixture();const {s}=await view(f);assert.equal(s.stage,'READY_TO_SIGN');assert.equal(s.canSign,true);assert.doesNotMatch(JSON.stringify(s),/SECRET_|seal|approval|requester|approver/);});
for(const [name,mutate] of [
 ['expired approval',(f:any)=>f.approval.expiresAt=new Date(0)],['same requester reviewer',(f:any)=>f.approval.approverId='requester'],['disabled reviewer',(f:any)=>f.actors[1].active=false],['revoked review authority',(f:any)=>f.authorities[1].status='DISABLED'],['disabled policy',(f:any)=>f.policy.status='DISABLED'],['disabled seal',(f:any)=>f.seal.status='DISABLED'],['changed plan hash',(f:any)=>f.approval.planHash='SECRET_INVALID'],['stale identity',(f:any)=>f.account.checkedAt=new Date(0)],['disabled provider',(f:any)=>f.settings.enabled=false],['disabled signing',(f:any)=>f.settings.signingEnabled=false],['foreign PDF',(f:any)=>f.files[1].customerId='foreign'],['changed PDF hash',(f:any)=>f.files[1].sha256='d'.repeat(64)],['changed approval hash',(f:any)=>f.approval.documentHash='d'.repeat(64)],['foreign approval',(f:any)=>f.approval.customerId='foreign'],['changed order ownership',(f:any)=>f.order.customerId='foreign'],['wrong order stage',(f:any)=>f.order.status='ACTIVE'],['order change pending',(f:any)=>f.blockChange()]
] as const)test(`readiness blocks ${name} without leaking guard internals`,async()=>{const f=fixture();mutate(f);const {s}=await view(f);assert.equal(s.stage,'BLOCKED');assert.equal(s.canSign,false);assert.doesNotMatch(JSON.stringify(s),/SECRET_|seal|approval|requester|approver|SIGNING_PLAN/);});
test('bound prepared task may use only the same approved PDF and identities',async()=>{const f=fixture();f.useTask();let r=await view(f);assert.equal(r.s.canSign,true);f.task.sourcePdfHash='d'.repeat(64);r=await view(f);assert.equal(r.s.stage,'BLOCKED');assert.equal(r.s.canSign,false);});
test('customer-signed current task waits for platform and never reopens signing even if approval expires',async()=>{const f=fixture();f.useTask();f.task.status='PENDING';f.task.uploadedAt=new Date();f.task.customerSignedAt=new Date();f.approval.expiresAt=new Date(0);const {s}=await view(f);assert.equal(s.stage,'WAITING_PLATFORM');assert.equal(s.canSign,false);});
test('an uploaded unknown attempt stays verifying rather than offering another sign action',async()=>{const f=fixture();f.useTask();f.task.status='PENDING';f.task.uploadedAt=new Date();f.h.signatureStatus='PENDING';const {s}=await view(f);assert.equal(s.stage,'VERIFYING');assert.equal(s.canSign,false);});
test('signed with missing archive waits for archive and complete verified archive is signed',async()=>{const f=fixture();f.h.signatureStatus='SIGNED';let r=await view(f);assert.equal(r.s.stage,'ARCHIVING');assert.equal(r.s.canSign,false);f.useTask();Object.assign(f.task,{status:'SIGNED',uploadedAt:new Date(),customerSignedAt:new Date(),platformSignedAt:new Date(),signedFileId:'signed',signedPdfHash:signedHash});f.h.signedFileId='signed';r=await view(f);assert.equal(r.s.stage,'SIGNED');assert.equal(r.s.canSign,false);f.files[2].customerId='foreign';r=await view(f);assert.equal(r.s.stage,'BLOCKED');assert.equal(r.s.canSign,false);});
test('unknown or foreign current task cannot grant sign or inherit another approval',async()=>{for(const mutate of [(f:any)=>f.task.customerId='foreign',(f:any)=>f.task.resourceId='foreign',(f:any)=>f.task.documentHash='d'.repeat(64),(f:any)=>f.task.status='FUTURE_STATE']){const f=fixture();f.useTask();mutate(f);const {s}=await view(f);assert.equal(s.stage,'BLOCKED');assert.equal(s.canSign,false);}});
test('guard errors are customer-safe and absent optional DI fails closed',async()=>{const f=fixture();f.db.signaturePolicy.findUnique=async()=>{throw Error('SECRET_INTERNAL_FAILURE');};let r=await view(f);assert.equal(r.s.stage,'BLOCKED');assert.doesNotMatch(r.s.message,/SECRET_|INTERNAL/);const c=new WorkflowsController(f.db,{} as any,{} as any);const result:any=await c.getHandover('handover',f.request);assert.equal(result.signingReadiness.canSign,false);});
test('customer ownership is checked before any signing data reads',async()=>{const f=fixture();await assert.rejects(f.controller.getHandover('handover',{customer:{id:'foreign'}}),(e:any)=>e.getStatus?.()===404);assert.deepEqual(f.calls.map(([n])=>n),['handover']);});

test('an unbound pending transaction verifies and a claimed signed file without archive proof blocks',async()=>{const f=fixture();f.noApproval();f.h.signatureStatus='PENDING';let r=await view(f);assert.equal(r.s.stage,'VERIFYING');assert.equal(r.s.canSign,false);f.h.signatureStatus='SIGNED';f.h.signedFileId='signed';r=await view(f);assert.equal(r.s.stage,'BLOCKED');assert.equal(r.s.canSign,false);});
test('disabled native entry cannot advertise signing even with an approved PDF',async()=>{const f=fixture();const prior=process.env.MINIAPP_SIGNING_ENABLED;try{process.env.MINIAPP_SIGNING_ENABLED='false';const {s}=await view(f);assert.equal(s.stage,'BLOCKED');assert.equal(s.canSign,false);}finally{process.env.MINIAPP_SIGNING_ENABLED=prior;}});


function returnFixture(assigned=true){
 const f=fixture();f.h.type='RETURN';f.order.status='ACTIVE';f.order.vehicle.status='IN_USE';f.order.currentAssignmentId=assigned?'assignment':null;f.h.assignmentId=f.order.currentAssignmentId;
 const readings={endReadingKm:11};f.db.vehicleAssignment={count:async()=>assigned?1:0};f.db.usageSegment={aggregate:async()=>({_max:readings})};f.db.usagePeriod={aggregate:async()=>({_max:readings})};return{...f,readings};
}
test('normal return honors current assignment and highest same-vehicle reading while legacy return remains usable',async()=>{
 for(const assigned of [true,false]){const f=returnFixture(assigned);let r=await view(f);assert.equal(r.s.stage,'READY_TO_SIGN');f.readings.endReadingKm=13;r=await view(f);assert.equal(r.s.stage,'BLOCKED');assert.equal(r.s.canSign,false);}
 const missing=returnFixture();missing.order.currentAssignmentId=null;const r=await view(missing);assert.equal(r.s.stage,'BLOCKED');assert.equal(r.s.canSign,false);
});
function swapFixture(side:'RETURN'|'DELIVERY'){
 const f=fixture(),at=f.h.actualAt;f.h.type=side==='RETURN'?'SWAP_RETURN':'SWAP_DELIVERY';f.h.changeId='change';f.order.status='ACTIVE';f.order.finalPlanSnapshot={months:12};f.order.currentAssignmentId=side==='RETURN'?'assignment':null;
 const oldAssignment:any={id:'assignment',vehicleId:'vehicle',status:'ACTIVE',startAt:new Date(at.getTime()-86400000),startReadingKm:10};
 const change:any={id:'change',kind:'VEHICLE_CHANGE',orderId:'order',customerId:'customer',activeQuoteId:'quote',status:side==='RETURN'?'AWAITING_FINANCE':'SWAP_RETURNED',returnHandoverId:side==='RETURN'?'handover':'old-handover',deliveryHandoverId:side==='DELIVERY'?'handover':null,targetVehicleId:'target'};
 const quote:any={id:'quote',changeId:'change',financePreparedAt:at,contract:{status:'SIGNED'},snapshot:{plannedReturnAt:at.toISOString(),plannedDeliveryAt:at.toISOString(),originalAssignmentId:'assignment',affectedSequence:1,depositAmount:0,depositRefundAmount:0,periods:[{sequence:1,refundAmount:0}]}};
 const oldHandover:any={id:'old-handover',status:'COMPLETED',actualAt:new Date(at.getTime()-3600000)};
 const target:any={id:'target',status:'PUBLISHED',reservedOrderId:null,holdId:'hold',mileageKm:2};const hold:any={id:'hold',changeId:'change',quoteId:'quote',status:'HELD'};
 const readings:any={endReadingKm:11},counts={settled:0},free:any={id:'free',orderId:'order',source:'FREE',cycleSequence:1,termSequence:null,sourcePaymentId:null,policySnapshot:null,status:'ACTIVE',consumedChangeId:null},account:any={id:'account',customerId:'customer',returnedOn:null,orderId:'order',startedOn:new Date(at.toISOString().slice(0,10)+'T00:00:00Z')};
 f.h.vehicleId=side==='RETURN'?'vehicle':'target';f.h.assignmentId=side==='RETURN'?'assignment':null;f.order.vehicle.status='IN_USE';if(side==='DELIVERY')f.h.readingKm=3;
 f.db.orderServiceStage={findMany:async()=>[]};f.db.orderChange.findMany=async()=>[];
 f.db.orderChange.findUnique=async()=>change;f.db.delayQuote={findUniqueOrThrow:async()=>quote};f.db.serviceObligation={findMany:async()=>[{sequence:1,startDate:at,endDate:new Date(at.getTime()+86400000),dueDate:at,amount:1,chargeAmount:0,allocations:[{amount:1}]}]};f.db.refund={findMany:async()=>[]};f.db.bill={findMany:async()=>[]};f.db.vehicleAssignment={findUnique:async()=>oldAssignment};f.db.usageSegment={aggregate:async()=>({_max:readings})};f.db.usagePeriod={count:async()=>counts.settled};f.db.vehicleHold={findUnique:async()=>hold};f.db.usageAccount={findUniqueOrThrow:async()=>account};f.db.swapCredit={findUnique:async()=>free,findMany:async()=>[]};f.db.payment={findUnique:async()=>null};f.db.swapCreditPurchase={findFirst:async()=>null};f.db.swapReservation={count:async()=>0,findMany:async()=>[]};f.db.vehicle.findUnique=async(args:any)=>args.where.id==='target'?target:f.order.vehicle;
 const originalFind=f.db.handover.findUnique;f.db.handover.findUnique=async(args:any)=>args.where.id==='old-handover'?oldHandover:originalFind(args);
 return{...f,change,quote,oldAssignment,oldHandover,target,hold,readings,counts,free};
}
test('both valid swap sides retain signing once their exact physical and financial prerequisites match',async()=>{for(const side of ['RETURN','DELIVERY'] as const){const f=swapFixture(side);const {s}=await view(f);assert.equal(s.stage,'READY_TO_SIGN');assert.equal(s.canSign,true);}});
for(const [name,side,mutate] of [
 ['foreign change','RETURN',(f:any)=>f.change.customerId='foreign'],['unsigned quote','RETURN',(f:any)=>f.quote.contract.status='PENDING'],['unprepared finance','RETURN',(f:any)=>f.quote.financePreparedAt=null],['unsettled finance','RETURN',(f:any)=>f.quote.snapshot.depositAmount=1],['changed physical date','RETURN',(f:any)=>f.quote.snapshot.plannedReturnAt='2000-01-01T00:00:00Z'],['obsolete return side','RETURN',(f:any)=>f.change.returnHandoverId='other'],['stale assignment','RETURN',(f:any)=>f.order.currentAssignmentId='other'],['higher old reading','RETURN',(f:any)=>f.readings.endReadingKm=99],['settled period','RETURN',(f:any)=>f.counts.settled=1],['invalid target hold','DELIVERY',(f:any)=>f.hold.quoteId='old-quote'],['uncompleted old side','DELIVERY',(f:any)=>f.oldHandover.status='CUSTOMER_CONFIRMED'],['wrong delivery sequence','DELIVERY',(f:any)=>f.change.status='AWAITING_FINANCE'],['reserved target','DELIVERY',(f:any)=>f.target.reservedOrderId='other'],['unavailable credit','DELIVERY',(f:any)=>f.free.consumedChangeId='other'],['before old return','DELIVERY',(f:any)=>f.oldHandover.actualAt=new Date(f.h.actualAt.getTime()+1000)]
] as const)test(`swap signing display rejects ${name} through read-only equivalents`,async()=>{const f=swapFixture(side);mutate(f);const {s}=await view(f);assert.equal(s.stage,'BLOCKED');assert.equal(s.canSign,false);});
test('a signature state changing during approved reads cannot reopen the sign action',async()=>{const f=fixture();f.writer.resource=async()=>({...f.h,signatureStatus:'PENDING',order:f.order});const {s}=await view(f);assert.equal(s.stage,'BLOCKED');assert.equal(s.canSign,false);});

test('swap delivery can use a verified active paid credit when its free cycle was already consumed',async()=>{
 const f=swapFixture('DELIVERY'),t=termSwapFixture(0,80000,true);f.free.consumedChangeId='other-change';const {p,bill,payment}=t.purchase();const currentAccount=await f.db.usageAccount.findUniqueOrThrow();p.expiresAt=new Date(currentAccount.startedOn);p.expiresAt.setUTCFullYear(p.expiresAt.getUTCFullYear()+1);p.expiresAt=new Date(p.expiresAt.getTime()-8*3600000);await grantSwapCredit(t.tx,bill,payment.id,t.now);
 f.db.swapCredit.findMany=t.tx.swapCredit.findMany;f.db.payment=t.tx.payment;f.db.swapCreditPurchase=t.tx.swapCreditPurchase;
 assert.equal((await view(f)).s.stage,'READY_TO_SIGN');
 payment.refunds=[{id:'pending',status:'PENDING_APPROVAL'}];assert.equal((await view(f)).s.stage,'BLOCKED');payment.refunds=[];
 bill.customerId='foreign';assert.equal((await view(f)).s.stage,'BLOCKED');bill.customerId='customer';
 p.paymentId='foreign-payment';assert.equal((await view(f)).s.stage,'BLOCKED');
});

test('OFFLINE total mode blocks a legacy approved handover sign action but preserves its verified signed history',async()=>{
 const previous=process.env.NEW_ORDER_CONTRACT_MODE;process.env.NEW_ORDER_CONTRACT_MODE='OFFLINE';
 try{
  const f=fixture();let result=await view(f);assert.equal(result.s.canSign,false);assert.equal(result.result.signatureStatus,'DRAFT');
  f.useTask();Object.assign(f.task,{status:'SIGNED',uploadedAt:new Date(),customerSignedAt:new Date(),platformSignedAt:new Date(),signedFileId:'signed',signedPdfHash:signedHash});f.h.signatureStatus='SIGNED';f.h.signedFileId='signed';
  result=await view(f);assert.equal(result.s.stage,'SIGNED');assert.equal(result.s.canSign,false);assert.equal(result.result.signedFileId,'signed');
 }finally{if(previous===undefined)delete process.env.NEW_ORDER_CONTRACT_MODE;else process.env.NEW_ORDER_CONTRACT_MODE=previous;}
});

test('v2 handover preview rejects exhausted term gifts and accepts verified configured-price credit without writes',async()=>{
 const f=swapFixture('DELIVERY'),t=termSwapFixture(0,50000);f.order.finalPlanSnapshot=t.order.finalPlanSnapshot;
 f.db.swapCredit=t.tx.swapCredit;f.db.swapReservation=t.tx.swapReservation;f.db.swapCreditPurchase=t.tx.swapCreditPurchase;f.db.payment=t.tx.payment;
 let result=await view(f);assert.equal(result.s.stage,'BLOCKED');assert.equal(t.writes(),0);
 const {bill,payment}=t.purchase();await grantSwapCredit(t.tx,bill,payment.id,t.now);const writes=t.writes();result=await view(f);assert.equal(result.s.stage,'READY_TO_SIGN');assert.equal(t.writes(),writes);
 t.credits[0].policySnapshot.sourceHash='0'.repeat(64);assert.equal((await view(f)).s.stage,'BLOCKED');assert.equal(t.writes(),writes);
});

test('customer service DTO never exposes injected private order, risk, revenue or account data from old handover rows',async()=>{
 const f=fixture();f.noApproval();Object.assign(f.h,{riskSnapshot:'PRIVATE_RISK',onlineRecordSnapshot:{documentId:'terms',termsVersion:'1',termsTitle:'约定',termsContent:'公开正文',termsHash:'a'.repeat(64),parties:{customerName:'客户',orderSnapshot:{riskSnapshot:'PRIVATE_RISK',revenueRuleSnapshot:'PRIVATE_REVENUE',account:'PRIVATE_ACCOUNT'},lessorSnapshot:{name:'出租方',account:'PRIVATE_ACCOUNT'}},evidence:[],riskSnapshot:'PRIVATE_RISK'},onlineConfirmation:{confirmedAt:new Date().toISOString(),requestHash:'PRIVATE_ACCOUNT',revenue:'PRIVATE_REVENUE'}});
 const result=await f.controller.getHandover(f.h.id,f.request);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_RISK|PRIVATE_REVENUE|PRIVATE_ACCOUNT/);assert.equal(result.onlineRecordSnapshot,undefined);
});

test('valid legacy online snapshot stays hash-stable while GET, objection and replay return only public fields',async()=>{
 const f=fixture();f.h.confirmationMode='ONLINE_RECORD';f.h.status='PUBLISHED';f.h.responseKey=null;
 const s={documentId:'terms',termsVersion:'1',termsTitle:'线上交接约定',termsContent:'公开约定正文',termsHash:require('../src/common/data').hash('公开约定正文'),facts:onlineRecordFacts(f.h),evidence:[{fileId:'evidence',sha256:'d'.repeat(64),size:10}],parties:{customerId:'customer',customerName:'合成客户',orderSnapshot:{riskSnapshot:'PRIVATE_RISK',revenueRuleSnapshot:'PRIVATE_REVENUE'},lessorSnapshot:{ownerId:'lessor',name:'合成出租方',account:'PRIVATE_ACCOUNT'}},sourceHash:'old'};
 f.h.onlineRecordSnapshot=s;f.h.manifestHash=canonicalHash(s);const before=f.h.manifestHash;
 const read=await f.controller.getHandover(f.h.id,f.request);assert.equal(read.signingReadiness.stage,'FACTS_PENDING');assert.equal(read.onlineRecord.termsContent,'公开约定正文');assert.equal(read.onlineRecord.evidence[0].fileId,'evidence');assert.doesNotMatch(JSON.stringify(read),/PRIVATE_|onlineRecordSnapshot/);
 f.db.serial=(fn:any)=>fn(f.db);f.db.$queryRaw=async()=>[];f.db.storedFile.count=async()=>0;f.db.auditLog={create:async()=>({})};f.db.handover.update=async({data}:any)=>Object.assign(f.h,data);
 const input={revision:1,manifestHash:before,reason:'合成异议',readFileIds:[],fileIds:[],idempotencyKey:'objection-request-key'};
 for(const result of [await f.controller.objectHandover(f.h.id,input,f.request),await f.controller.objectHandover(f.h.id,input,f.request)]){assert.equal(result.status,'OBJECTION_SUBMITTED');assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|requestHash|onlineRecordSnapshot/);}
 assert.equal(f.h.manifestHash,before);assert.equal(f.h.onlineRecordSnapshot.parties.orderSnapshot.riskSnapshot,'PRIVATE_RISK');
});
