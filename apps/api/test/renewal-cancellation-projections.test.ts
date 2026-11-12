import test from 'node:test';
import assert from 'node:assert/strict';
import {renewalCancellationFixture} from './order-renewals-cancellation-fixture';
import {completedCancellationFixture} from './renewal-cancellation-history-fixture';
import {renewalOps,renewalFinance,renewalNow} from './order-renewals-fixture';
import {readRenewalWorkspace,listRenewalWorkspaces} from '../src/order-renewals/workspace';
import {CustomerController} from '../src/orders/customer';
import {partnerRenewalFixture} from './partner-renewal-workspace-fixture';
import {readPartnerOrderWorkspace} from '../src/partners/order-workspace';
import {workspaceProjection} from '../src/offline-documents/workspace.service';
import {addRenewalCancellationArchive} from './renewal-cancellation-paper-fixture';
const code=(s:string)=>(e:any)=>e.getResponse?.().error?.code===s;
async function opened(){const f=await renewalCancellationFixture(true),p=await f.service.cancellationPreview(f.change.id,renewalOps);await f.service.openCancellation(f.change.id,{revision:p.revision,orderRevision:p.orderRevision,previewHash:p.previewHash,reason:'双方正在办理未来续期取消',idempotencyKey:'public-cancel-open'},renewalOps);return f;}

test('OPEN cancellation reaches safe customer/admin summaries and disables every current renewal capability without writes',async()=>{
 const f=await opened(),writes=f.writes.length;
 for(const viewer of [{actor:renewalOps},{actor:renewalFinance},{customerId:f.customer.id}]){const v=await readRenewalWorkspace(f.tx,f.change.id,viewer,renewalNow);assert.deepEqual(v.cancellation,{id:f.cases[0].id,status:'OPEN',completedAt:null});for(const key of ['canQuote','canReview','canPublish','canCancel','canPrepareFinance','canSchedule','canActivate','canConfirm','canReject'])assert.equal((v as any)[key],false,key);}
 const list=await listRenewalWorkspaces(f.tx,{}, {customerId:f.customer.id},renewalNow);assert.deepEqual(list.items[0].cancellation,{id:f.cases[0].id,status:'OPEN',completedAt:null});assert.equal(f.writes.length,writes);
 f.cases[0].customerId='foreign';await assert.rejects(readRenewalWorkspace(f.tx,f.change.id,{customerId:f.customer.id},renewalNow));
});

test('partner sees OPEN on future period without changing current terms or leaking verification evidence',async()=>{
 let base:any;const f=await renewalCancellationFixture(true,{baseFixture:async()=>{base=await partnerRenewalFixture();return base;}}),p=await f.service.cancellationPreview(f.change.id,renewalOps);
 await f.service.openCancellation(f.change.id,{revision:p.revision,orderRevision:p.orderRevision,previewHash:p.previewHash,reason:'双方核对取消新增期',idempotencyKey:'partner-open'},renewalOps);
 const writes=f.writes.length,v=await readPartnerOrderWorkspace(f.tx,base.session,f.owner.id,f.order.id,renewalNow);assert.equal(v.currentPeriod?.monthlyFeeAmount,10000);assert.equal(v.futureRenewals[0].cancellation.status,'OPEN');assert.deepEqual(v.cancelledRenewals,[]);assert.equal(f.writes.length,writes);for(const key of ['signatureEvidenceFileIds','mutualAgreementHash','completionSnapshot','sourceSnapshot'])assert.equal(JSON.stringify(v).includes('"'+key+'"'),false);
 f.cases[0].quoteId='wrong';await assert.rejects(readPartnerOrderWorkspace(f.tx,base.session,f.owner.id,f.order.id,renewalNow));
});

test('workspace bills preserve a current payable bill and deny the cancelled future bill individually',()=>{
 const v=workspaceProjection({id:'o',contractMode:'OFFLINE',status:'ACTIVE',finalPlanSnapshot:{commercialHash:'a'.repeat(64)},offlinePaymentReadiness:{ready:true,blockers:[]},bills:[{id:'old',type:'SUBSCRIPTION',status:'PENDING',amount:10000,paidAmount:0,canPay:true,cancellation:null},{id:'new',type:'SUBSCRIPTION',status:'PENDING',amount:20000,paidAmount:0,canPay:false,cancellation:{id:'case',status:'OPEN',completedAt:null}}]},[],{id:'customer',role:'CUSTOMER'});
 assert.equal(v.capabilities.canPay,true);assert.equal(v.billing[0].canPay,true);assert.equal(v.billing[1].canPay,false);assert.equal(v.billing[1].cancellation?.status,'OPEN');
});

test('completed partner renewal moves to cancellation history through real cancellation commands, keeping original period and archive',async()=>{
 let base:any;const f=await renewalCancellationFixture(true,{baseFixture:async()=>{base=await partnerRenewalFixture();return base;}});
 const input=async()=>{const p=await f.service.cancellationPreview(f.change.id,renewalOps);return{revision:p.revision,orderRevision:p.orderRevision,previewHash:p.previewHash,...(f.cases[0]?{cancellationId:f.cases[0].id,cancellationRevision:f.cases[0].revision}:{})};};
 await f.service.openCancellation(f.change.id,{...await input(),reason:'同意取消未开始租期',idempotencyKey:'partner-complete-open'},renewalOps);
 await f.service.verifyCancellationSignature(f.change.id,{...await input(),signatureState:'SIGNED',evidenceFileIds:[f.evidence.id],note:'核对真实原签署',idempotencyKey:'partner-complete-signature'},renewalOps);
 await f.service.confirmCancellationAgreement(f.change.id,{...await input(),mutuallyAgreedAt:renewalNow.toISOString(),evidenceFileIds:[f.evidence.id],note:'双方真实同意取消',idempotencyKey:'partner-complete-mutual'},renewalOps);
 await addRenewalCancellationArchive(f,f.cases[0]);await f.service.cancelPrepared(f.change.id,{...await input(),reason:'新增款核清',idempotencyKey:'partner-complete'},renewalOps);
 const writes=f.writes.length,v=await readPartnerOrderWorkspace(f.tx,base.session,f.owner.id,f.order.id,renewalNow);assert.equal(v.currentPeriod?.monthlyFeeAmount,10000);assert.deepEqual(v.futureRenewals,[]);assert.equal(v.cancelledRenewals.length,1);assert.equal(v.cancelledRenewals[0].cancellation.status,'COMPLETED');assert.equal(v.cancelledRenewals[0].archive.id,f.archive.id);assert.equal(f.writes.length,writes);
});

test('customer pending future bill loses pay during cancellation while original period remains payable',async()=>{
 const f=await opened(),controller=new CustomerController(f.tx as any),future=f.bills.find(b=>b.serviceStageId===f.stage!.id)!,old=f.bills.find(b=>!b.serviceStageId)!;old.status='PENDING';
 const pending:any=await controller.record('bills',future.id,{customer:f.customer});assert.deepEqual(pending.cancellation,{id:f.cases[0].id,status:'OPEN',completedAt:null});assert.equal(pending.actions.some((a:any)=>a.id==='pay'),false);assert.match(pending.statusText,/取消处理中/);
 const current:any=await controller.record('bills',old.id,{customer:f.customer});assert.equal(current.actions.some((a:any)=>a.id==='pay'),true);assert.equal(current.cancellation,null);
 await assert.rejects(controller.record('bills',future.id,{customer:{id:'foreign'}}),code('NOT_FOUND'));
});

test('only the exact completed cancellation future VOID bill is customer-readable; raw completion evidence is never projected',async()=>{
 const f=await completedCancellationFixture(),controller=new CustomerController(f.tx as any),bill=f.bill!;
 const v:any=await controller.record('bills',bill.id,{customer:f.customer});assert.equal(v.status,'VOID');assert.match(v.statusText,/已取消/);assert.deepEqual(Object.keys(v.cancellation).sort(),['completedAt','id','status']);assert.equal(v.cancellation.status,'COMPLETED');assert.equal(v.actions.length,0);
 const encoded=JSON.stringify(v);for(const key of ['mutualAgreementHash','signatureEvidenceFileIds','completionSnapshot','sourceSnapshot','providerTransactionId'])assert.equal(encoded.includes('"'+key+'"'),false);
 const old=f.bills.find(b=>!b.serviceStageId)!;old.status='VOID';await assert.rejects(controller.record('bills',old.id,{customer:f.customer}),code('NOT_FOUND'));
 f.record.completionHash='f'.repeat(64);await assert.rejects(controller.record('bills',bill.id,{customer:f.customer}));
});
