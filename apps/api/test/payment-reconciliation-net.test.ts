import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deliveryReady} from '../src/orders/readiness';
import {PaymentReconciliationService,validateReconciliationResolution} from '../src/billing/reconciliation';

const receipt=(id:string,extra:Record<string,any>={})=>({id,status:'SUCCEEDED',amount:100,providerTransactionId:`verified-${id}`,refunds:[],reconciliationRequired:false,...extra});
const bill=(payments:any[])=>({id:'bill',orderId:'order',type:'SUBSCRIPTION',sequence:1,status:'PAID',amount:100,paidAmount:100,payments});
function deliveryTx(payments:any[]){return{orderChange:{count:async()=>0},order:{findUnique:async()=>({id:'order',contractMode:'ESIGN'})},contract:{count:async()=>1},bill:{findMany:async()=>[bill(payments)]}} as any;}
const fullRefund=()=>[{status:'SUCCEEDED',amount:100}];

test('returned duplicate receipts unblock delivery only after full actual refund and exception resolution',async()=>{
 const original=receipt('original'),duplicate=receipt('duplicate',{reconciliationRequired:true,refunds:fullRefund()}),tx=deliveryTx([original,duplicate]);
 assert.equal(await deliveryReady(tx,'order'),false);
 duplicate.reconciliationRequired=false;
 assert.equal(await deliveryReady(tx,'order'),true);
 for(const refunds of [[{status:'SUCCEEDED',amount:99}],[{status:'PENDING_APPROVAL',amount:100}],[{status:'PROCESSING',amount:100}],[...fullRefund(),{status:'PROCESSING',amount:1}],[]]){
  duplicate.refunds=refunds;assert.equal(await deliveryReady(tx,'order'),false,JSON.stringify(refunds));
 }
 duplicate.refunds=fullRefund();original.amount=99;assert.equal(await deliveryReady(tx,'order'),false,'paid bill metadata cannot replace missing retained cash');
 original.amount=101;assert.equal(await deliveryReady(tx,'order'),false,'unexplained excess cash still blocks');
});

test('allocated delivery keeps valid signed partial refunds but applies net receipt checks to deposits',async()=>{
 const extra=receipt('extra',{refunds:fullRefund()}),deposit=bill([receipt('deposit'),extra]);deposit.type='DEPOSIT';
 const source=receipt('source',{amount:120,refunds:[{status:'SUCCEEDED',amount:20}]});
 const tx:any=deliveryTx([]);tx.order.findUnique=async()=>({contractMode:'ESIGN',effectiveTermsVersionId:'terms'});tx.bill.findMany=async()=>[deposit];tx.serviceObligation={findFirst:async()=>({amount:100,allocations:[{amount:100,payment:source}]})};
 assert.equal(await deliveryReady(tx,'order'),true);extra.reconciliationRequired=true;assert.equal(await deliveryReady(tx,'order'),false);
 extra.reconciliationRequired=false;source.refunds.push({status:'PROCESSING',amount:1});assert.equal(await deliveryReady(tx,'order'),false);
});

function reviewFixture(type='SUBSCRIPTION'){
 const current=receipt('current',{billId:'bill',customerId:'customer',revision:1,reconciliationRequired:true});
 const sourceBill=bill([current]);sourceBill.type=type;
 const payment={...current,bill:sourceBill};
 const record:any={id:'review',paymentId:'current',status:'SUBMITTED',resolution:'APPLY_TO_BILL',submittedBy:'submitter',evidenceFileIds:['evidence'],paymentSnapshot:{paymentId:'current',billId:'bill',customerId:'customer',amount:100,providerTransactionId:'verified-current',status:'SUCCEEDED'}};
 const duplicate=receipt('duplicate',{refunds:fullRefund()});
 let mutations=0;
 const tx:any={vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},
  $queryRaw:async()=>[],adminUser:{findUnique:async()=>({id:'reviewer',active:true,role:'FINANCE'})},archiveCommand:{findUnique:async()=>null,create:async()=>{}},
  payment:{findUnique:async()=>payment,findUniqueOrThrow:async()=>payment,findMany:async()=>[duplicate],count:async()=>1,update:async({data}:any)=>{mutations++;Object.assign(payment,data.reconciliationRequired===false?{reconciliationRequired:false}:{});return{...payment,revision:2};}},
  paymentReconciliation:{findUnique:async()=>record,findMany:async()=>[record],update:async({data}:any)=>{mutations++;return{...record,...data};}},storedFile:{findMany:async()=>[{id:'evidence',adminId:'submitter',customerId:null,purpose:'evidence',mimeType:'application/pdf',size:10}]},
  order:{findUniqueOrThrow:async()=>({id:'order',contractMode:'ESIGN',status:'ACTIVE'}),findUnique:async()=>({id:'order',contractMode:'ESIGN',status:'ACTIVE'})},vehicleReceiptEvent:{findFirst:async()=>null},auditLog:{create:async()=>{}},
 };
 return{tx,payment,record,duplicate,mutations:()=>mutations};
}
const review=(f:ReturnType<typeof reviewFixture>)=>new PaymentReconciliationService().review(f.tx,{id:'reviewer',role:'FINANCE'},'current','review',{revision:1,idempotencyKey:'review-net-case',decision:'APPROVED',note:'独立核对完整退款及原账单'});

test('APPLY review ignores only fully refunded resolved duplicates and leaves unresolved money untouched',async()=>{
 const okay=reviewFixture();assert.equal((await review(okay)).status,'APPROVED');assert.equal(okay.payment.reconciliationRequired,false);
 for(const change of [{reconciliationRequired:true},{refunds:[{status:'SUCCEEDED',amount:99}]},{refunds:[{status:'PROCESSING',amount:100}]},{refunds:[]}]){
  const f=reviewFixture();Object.assign(f.duplicate,change);await assert.rejects(review(f),(error:any)=>error.getResponse().error.code==='DUPLICATE_RECEIPT');assert.equal(f.mutations(),0);assert.equal(f.payment.reconciliationRequired,true);
 }
});

test('REFUNDED review restores handover readiness when the original receipt still covers the bill',async()=>{
 const f=reviewFixture();f.record.resolution='REFUNDED';f.payment.refunds=fullRefund();f.payment.bill.payments=[receipt('original'),f.payment];
 let orderStatus='AWAITING_PAYMENT';
 f.tx.order.findUnique=async()=>({id:'order',contractMode:'ESIGN',status:orderStatus});
 f.tx.order.updateMany=async({data}:any)=>{orderStatus=data.status;return{count:1};};
 f.tx.orderChange={count:async()=>0};f.tx.contract={count:async()=>1};f.tx.bill={findMany:async()=>[f.payment.bill]};
 assert.equal((await review(f)).status,'APPROVED');assert.equal(f.payment.reconciliationRequired,false);assert.equal(orderStatus,'AWAITING_HANDOVER');
});

test('special benefit and adjustment bills cannot be falsely completed by APPLY',async()=>{
 for(const type of ['MILEAGE_PACK','SWAP_CREDIT','DELAY_ADJUSTMENT','SWAP_ADJUSTMENT','DEPOSIT_ADJUSTMENT','EXTRA_FEE']){
  const f=reviewFixture(type);assert.throws(()=>validateReconciliationResolution(f.payment,f.payment.bill,'APPLY_TO_BILL'),(error:any)=>error.getResponse().error.code==='RECONCILIATION_APPLY_UNSUPPORTED');
  await assert.rejects(review(f),(error:any)=>error.getResponse().error.code==='RECONCILIATION_APPLY_UNSUPPORTED');assert.equal(f.mutations(),0);assert.equal(f.payment.reconciliationRequired,true);
  f.payment.refunds=fullRefund();assert.doesNotThrow(()=>validateReconciliationResolution(f.payment,f.payment.bill,'REFUNDED'));
  assert.deepEqual((await new PaymentReconciliationService().list(f.tx,{id:'reviewer',role:'FINANCE'},'current')).allowedResolutions,['REFUNDED']);
 }
 for(const type of ['DEPOSIT','SUBSCRIPTION']){
  const f=reviewFixture(type);assert.doesNotThrow(()=>validateReconciliationResolution(f.payment,f.payment.bill,'APPLY_TO_BILL'));
  assert.deepEqual((await new PaymentReconciliationService().list(f.tx,{id:'reviewer',role:'FINANCE'},'current')).allowedResolutions,['APPLY_TO_BILL','REFUNDED']);
 }
});
