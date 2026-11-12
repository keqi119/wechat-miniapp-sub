import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {guardPackRefund,settlePackRefund} from '../src/usage/refunds';
import {JourneyHarness} from './seven-module-journey-fixtures';
import {offlineOrder,approvedOfflineArchive} from './offline-fixtures';
import {tokenHash} from '../src/auth/auth.service';
import {hash} from '../src/common/data';
import {guardSwapRefund,settleSwapRefund} from '../src/swap-purchases/ledger';

function pureFixture(){
 const account={id:'account',orderId:'order',customerId:'customer'},bill={id:'bill',orderId:'order',customerId:'customer',type:'MILEAGE_PACK',amount:100};
 const pack:any={id:'pack',accountId:'account',orderId:'order',customerId:'customer',billId:'bill',status:'PENDING_PAYMENT',amount:100,remainingKm:0,paidAt:null};
 const payment:any={id:'payment',billId:'bill',customerId:'customer',status:'SUCCEEDED',providerTransactionId:'synthetic-verified',reconciliationRequired:true,amount:100,bill};
 const ledger:any[]=[];
 const rows=(where:any)=>ledger.filter(row=>(!where.type||row.type===where.type)&&(!where.sourceKey||row.sourceKey===where.sourceKey));
 const tx:any={bill:{findUniqueOrThrow:async()=>bill},order:{update:async()=>{}},usageAccount:{findUnique:async()=>account,update:async()=>account},mileagePurchase:{findUnique:async()=>pack,findUniqueOrThrow:async()=>pack,update:async({data}:any)=>Object.assign(pack,data)},mileageLedger:{count:async({where}:any)=>rows(where).length,findMany:async({where}:any)=>rows(where),create:async({data}:any)=>{ledger.push(data);return data;}},auditLog:{create:async()=>{}}};
 return{tx,pack,payment,ledger};
}
const denied=(error:any)=>error.getResponse?.().error?.code==='PACK_REFUND_REVIEW';

test('pure ungranted verified exception refunds freeze and retire zero quota without inventing a grant',async()=>{
 const f=pureFixture();await guardPackRefund(f.tx,f.payment,100);assert.equal(f.pack.status,'PENDING_PAYMENT');
 await guardPackRefund(f.tx,f.payment,100,true);assert.equal(f.pack.status,'REFUND_PENDING');assert.equal(f.ledger.length,0);
 await settlePackRefund(f.tx,{id:'refund',paymentId:'payment',payment:f.payment,customerId:'customer',amount:100});
 assert.equal(f.pack.status,'REFUNDED');assert.equal(f.pack.remainingKm,0);assert.equal(f.ledger.length,1);assert.equal(f.ledger[0].type,'REFUND');assert.equal(f.ledger[0].deltaKm,0);assert.equal(f.pack.paidAt,null);
});

function extraMileageFixture(){
 const f=pureFixture(),original={...f.payment,id:'original',providerTransactionId:'verified-original',reconciliationRequired:false};
 Object.assign(f.pack,{status:'ACTIVE',paidAt:new Date(),km:1000,remainingKm:600});
 f.ledger.push({packId:'pack',accountId:'account',type:'GRANT',sourceKey:'payment:original',deltaKm:1000},{packId:'pack',accountId:'account',type:'CONSUME',deltaKm:-400});
 f.tx.payment={findUnique:async()=>original};return{...f,original};
}
test('pure duplicate mileage receipt refunds only extra cash even after original pack consumption',async()=>{
 const f=extraMileageFixture(),packBefore=structuredClone(f.pack),ledgerBefore=structuredClone(f.ledger);
 await guardPackRefund(f.tx,f.payment,100);await guardPackRefund(f.tx,f.payment,100,true);
 await settlePackRefund(f.tx,{id:'refund-extra',paymentId:f.payment.id,payment:f.payment,customerId:'customer',amount:100});
 assert.deepEqual(f.pack,packBefore);assert.deepEqual(f.ledger,ledgerBefore);
 await assert.rejects(guardPackRefund(f.tx,f.original,100),denied,'The used original source still cannot be refunded');
});
test('pure extra mileage refunds require exact other verified receipt and reject borrowed or missing grants',async()=>{
 for(const change of [{status:'PENDING'},{providerTransactionId:null},{billId:'other'},{customerId:'other'},{amount:99},{id:'payment'}]){const f=extraMileageFixture();Object.assign(f.original,change);await assert.rejects(guardPackRefund(f.tx,f.payment,100),denied);}
 for(const change of [{providerTransactionId:null},{reconciliationRequired:false},{amount:99},{customerId:'other'}]){const f=extraMileageFixture();Object.assign(f.payment,change);await assert.rejects(guardPackRefund(f.tx,f.payment,100),denied);}
 for(const change of [{accountId:'other'},{packId:'other'},{deltaKm:999}]){const f=extraMileageFixture();Object.assign(f.ledger[0],change);await assert.rejects(guardPackRefund(f.tx,f.payment,100),denied);}
 const own=extraMileageFixture();own.ledger.push({type:'GRANT',sourceKey:'payment:payment',packId:'other'});await assert.rejects(guardPackRefund(own.tx,own.payment,100),denied);
 const absent=extraMileageFixture();absent.ledger.splice(0,1);await assert.rejects(guardPackRefund(absent.tx,absent.payment,100),denied);
});

function extraSwapFixture(){
 const f=pureFixture();f.payment.amount=80000;f.payment.bill.type='SWAP_CREDIT';f.payment.bill.amount=80000;
 const original={...f.payment,id:'original',providerTransactionId:'verified-original',reconciliationRequired:false},purchase:any={id:'purchase',billId:'bill',orderId:'order',customerId:'customer',paymentId:'original',creditId:'credit',status:'CONSUMED',amount:80000,paidAt:new Date()},credit:any={id:'credit',orderId:'order',source:'PAID',sourcePaymentId:'original',status:'ACTIVE',consumedChangeId:'already-used'};
 const ledger:any[]=[{orderId:'order',purchaseId:'purchase',creditId:'credit',source:'PAID',type:'GRANT',sourceKey:'grant:original'}];
 f.tx.payment={findUnique:async()=>original};f.tx.swapCreditPurchase={findUnique:async()=>purchase,findUniqueOrThrow:async()=>purchase,update:async({data}:any)=>Object.assign(purchase,data)};
 f.tx.swapCredit={findUnique:async()=>credit,findUniqueOrThrow:async()=>credit,count:async()=>0,update:async({data}:any)=>Object.assign(credit,data)};
 f.tx.swapLedger={findMany:async({where}:any)=>ledger.filter(row=>!where.type||row.type===where.type),count:async({where}:any)=>ledger.filter(row=>row.sourceKey===where.sourceKey).length,create:async({data}:any)=>ledger.push(data)};f.tx.swapReservation={count:async()=>0};
 return{...f,original,purchase,credit,ledger};
}
const swapDenied=(error:any)=>error.getResponse?.().error?.code==='SWAP_REFUND_REVIEW';
test('pure duplicate swap receipt returns extra cash without altering the original consumed credit',async()=>{
 const f=extraSwapFixture(),before=structuredClone({purchase:f.purchase,credit:f.credit,ledger:f.ledger});
 await guardSwapRefund(f.tx,f.payment,80000);await guardSwapRefund(f.tx,f.payment,80000);
 await settleSwapRefund(f.tx,{id:'extra-refund',paymentId:f.payment.id,payment:f.payment,customerId:'customer',amount:80000});
 assert.deepEqual({purchase:f.purchase,credit:f.credit,ledger:f.ledger},before);await assert.rejects(guardSwapRefund(f.tx,f.original,80000),swapDenied);
});
test('pure extra swap refund rejects partial cash, own credits and unrelated original grant evidence',async()=>{
 for(const change of [{status:'PENDING'},{providerTransactionId:null},{billId:'other'},{customerId:'other'},{amount:1}]){const f=extraSwapFixture();Object.assign(f.original,change);await assert.rejects(guardSwapRefund(f.tx,f.payment,80000),swapDenied);}
 const own=extraSwapFixture();own.tx.swapCredit.count=async()=>1;await assert.rejects(guardSwapRefund(own.tx,own.payment,80000),swapDenied);
 for(const change of [{orderId:'other'},{sourcePaymentId:'other'},{source:'FREE'}]){const f=extraSwapFixture();Object.assign(f.credit,change);await assert.rejects(guardSwapRefund(f.tx,f.payment,80000),swapDenied);}
 const missing=extraSwapFixture();missing.ledger.length=0;await assert.rejects(guardSwapRefund(missing.tx,missing.payment,80000),swapDenied);
 const partial=extraSwapFixture();await assert.rejects(guardSwapRefund(partial.tx,partial.payment,79999),swapDenied);
});
test('pure extra cash refund callbacks recheck original source evidence after approval',async()=>{
 const mileage=extraMileageFixture();await guardPackRefund(mileage.tx,mileage.payment,100,true);mileage.original.status='FAILED';
 const packBefore=structuredClone(mileage.pack),ledgerBefore=structuredClone(mileage.ledger);
 await assert.rejects(settlePackRefund(mileage.tx,{id:'refund',paymentId:mileage.payment.id,payment:mileage.payment,customerId:'customer',amount:100}),denied);
 assert.deepEqual(mileage.pack,packBefore);assert.deepEqual(mileage.ledger,ledgerBefore);
 const swap=extraSwapFixture();await guardSwapRefund(swap.tx,swap.payment,80000);swap.credit.sourcePaymentId='changed';
 const sourceBefore=structuredClone({purchase:swap.purchase,credit:swap.credit,ledger:swap.ledger});
 await assert.rejects(settleSwapRefund(swap.tx,{id:'refund',paymentId:swap.payment.id,payment:swap.payment,customerId:'customer',amount:80000}),swapDenied);
 assert.deepEqual({purchase:swap.purchase,credit:swap.credit,ledger:swap.ledger},sourceBefore);
});
test('pure three never-issued receipts can each retire zero quota without reversing prior refunds',async()=>{
 const f=pureFixture(),refunds=new Map<string,any>();f.tx.refund={findUnique:async({where}:any)=>refunds.get(where.id)};
 for(let index=1;index<=3;index++){
  const payment={...f.payment,id:`payment-${index}`,providerTransactionId:`verified-${index}`};
  await guardPackRefund(f.tx,payment,100);await guardPackRefund(f.tx,payment,100,true);
  if(index>1)assert.equal(f.pack.status,'REFUNDED','Another approval cannot undo the first completed refund');
  const refund={id:`refund-${index}`,paymentId:payment.id,payment,customerId:'customer',amount:100,status:'SUCCEEDED',providerRefundId:`provider-refund-${index}`,requestedBy:'finance',approvedBy:'independent-reviewer'};refunds.set(refund.id,refund);
  await settlePackRefund(f.tx,refund);payment.reconciliationRequired=false;
  assert.equal(f.pack.status,'REFUNDED');assert.equal(f.pack.remainingKm,0);assert.equal(f.pack.paidAt,null);
 }
 assert.equal(f.ledger.length,3);assert.ok(f.ledger.every(row=>row.type==='REFUND'&&row.deltaKm===0));
});
test('pure never-issued refunded state rejects forged zero ledger and unmatched channel refund evidence',async()=>{
 const fixture=()=>{const f=pureFixture();f.pack.status='REFUNDED';const original={...f.payment,id:'original',providerTransactionId:'original-channel',reconciliationRequired:false},refund:any={id:'prior-refund',paymentId:'original',payment:original,customerId:'customer',amount:100,status:'SUCCEEDED',providerRefundId:'provider-original-refund',requestedBy:'maker',approvedBy:'reviewer'};f.ledger.push({packId:'pack',accountId:'account',type:'REFUND',deltaKm:0,sourceKey:'refund:prior-refund'});f.tx.refund={findUnique:async()=>refund};return{...f,refund,original};};
 for(const change of [{status:'PROCESSING'},{providerRefundId:null},{amount:99},{customerId:'other'},{approvedBy:null},{approvedBy:'maker'},{paymentId:'unrelated'}]){const f=fixture();Object.assign(f.refund,change);await assert.rejects(guardPackRefund(f.tx,f.payment,100),denied);}
 for(const change of [{status:'PENDING'},{providerTransactionId:null},{billId:'other'},{customerId:'other'},{amount:99}]){const f=fixture();Object.assign(f.original,change);await assert.rejects(guardPackRefund(f.tx,f.payment,100),denied);}
 for(const change of [{type:'GRANT'},{type:'CONSUME'},{deltaKm:-1},{accountId:'other'},{packId:'other'},{sourceKey:'fake:prior-refund'},{sourceKey:'refund:unrelated'}]){const f=fixture();Object.assign(f.ledger[0],change);await assert.rejects(guardPackRefund(f.tx,f.payment,100),denied);}
 const empty=fixture();empty.ledger.length=0;await assert.rejects(guardPackRefund(empty.tx,empty.payment,100),denied);
});
test('pure extra cash stays refundable while the original grant is frozen, expired or already refunded',async()=>{
 for(const status of ['REFUND_PENDING','EXPIRED','REFUNDED']){
  const mileage=extraMileageFixture();mileage.pack.status=status;if(status!=='REFUND_PENDING')mileage.pack.remainingKm=0;
  const before=structuredClone({pack:mileage.pack,ledger:mileage.ledger});await guardPackRefund(mileage.tx,mileage.payment,100,true);await settlePackRefund(mileage.tx,{id:'extra',paymentId:mileage.payment.id,payment:mileage.payment,customerId:'customer',amount:100});assert.deepEqual({pack:mileage.pack,ledger:mileage.ledger},before);
  const swap=extraSwapFixture();swap.purchase.status=status;swap.credit.status=status==='REFUND_PENDING'?'FROZEN':status;const original=structuredClone({purchase:swap.purchase,credit:swap.credit,ledger:swap.ledger});await guardSwapRefund(swap.tx,swap.payment,80000);await settleSwapRefund(swap.tx,{id:'extra',paymentId:swap.payment.id,payment:swap.payment,customerId:'customer',amount:80000});assert.deepEqual({purchase:swap.purchase,credit:swap.credit,ledger:swap.ledger},original);
 }
});

test('pure ungranted exception path rejects partial, unverified, cross-customer and any prior mileage ledger',async()=>{
 for(const change of [{amount:99},{status:'PENDING'},{providerTransactionId:null},{reconciliationRequired:false},{customerId:'other'},{billId:'other'}]){
  const f=pureFixture();Object.assign(f.payment,change);await assert.rejects(guardPackRefund(f.tx,f.payment,100),denied);
 }
 const partial=pureFixture();await assert.rejects(guardPackRefund(partial.tx,partial.payment,99),denied);
 for(const change of [{remainingKm:1},{paidAt:new Date()},{accountId:'other'},{orderId:'other'},{customerId:'other'}]){
  const f=pureFixture();Object.assign(f.pack,change);await assert.rejects(guardPackRefund(f.tx,f.payment,100),denied);
 }
 for(const type of ['GRANT','CONSUME','EXPIRE','REFUND']){
  const f=pureFixture();f.ledger.push({type,deltaKm:0});await assert.rejects(guardPackRefund(f.tx,f.payment,100),denied);assert.equal(f.pack.status,'PENDING_PAYMENT');
 }
});

for(const duplicate of [false,true])test(`HTTP ${duplicate?'duplicate receipt preserves original mileage quota':'exception receipt for an ungranted mileage pack'} through refund and independent reconciliation`,async()=>{
 const h=new JourneyHarness();let productId:string|undefined;
 try{
  await h.start();
  // Retire only products from this named synthetic fixture, including a prior
  // interrupted run. Do not change the shared catalog ordering for other tests.
  const priorTerms=await h.db.legalDocument.findMany({where:{type:'mileage-pack',title:'合成未发放里程异常退款说明'},select:{id:true}});
  if(priorTerms.length)await h.db.mileagePackProduct.updateMany({where:{OR:priorTerms.map(t=>({purchases:{some:{termsSnapshot:{path:['documentId'],equals:t.id}}}}))},data:{active:false}});
  const f=await offlineOrder(h.db),{archive}=await approvedOfflineArchive(h.db,f.order.id);
  await h.db.order.update({where:{id:f.order.id},data:{status:'ACTIVE'}});
  const token=randomUUID(),customer={id:f.customer.id,headers:{Authorization:`Bearer ${token}`}};
  await h.db.customerSession.create({data:{id:tokenHash(token),customerId:f.customer.id,expiresAt:new Date(Date.now()+3600000)}});
  await h.post('/customer/consents',{consents:['terms','privacy'].map(type=>({documentId:h.docs[type].id,version:h.docs[type].version}))},customer);
  const today=new Date(new Date().toISOString().slice(0,10)),end=new Date(today.getTime()+30*86400000);
  await h.db.usageAccount.create({data:{orderId:f.order.id,customerId:f.customer.id,policyVersion:'USAGE_V1',startedOn:today,periods:{create:{orderId:f.order.id,sequence:1,startDate:today,endDate:end,effectiveEndDate:end,startReadingKm:100}}}});
  const product=await h.db.mileagePackProduct.create({data:{id:`offline-exception-refund-${randomUUID()}`,version:1,km:1000,amount:100}});productId=product.id;
  const version=(await h.db.legalDocument.aggregate({where:{type:'mileage-pack'},_max:{version:true}}))._max.version||0;
  const terms=await h.db.legalDocument.create({data:{type:'mileage-pack',version:version+1,title:'合成未发放里程异常退款说明',content:'仅本地合成回归，禁止真实交易。',status:'PUBLISHED',confirmedAt:new Date(),confirmedBy:h.reviewer.id}});
  const purchase=await h.post(`/customer/orders/${f.order.id}/mileage-packs`,{productId:product.id,termsVersion:'MILEAGE_PACK_V1',termsDocumentId:terms.id,termsDocumentVersion:terms.version,termsHash:hash(terms.content),accepted:true,idempotencyKey:randomUUID()},customer);
  const requested=await h.post(`/customer/bills/${purchase.bill.id}/pay`,{idempotencyKey:randomUUID()},customer);
  let originalPack:any,originalLedger:any[]=[];
  if(duplicate){
   await h.post(`/customer/payments/${requested.paymentId}/close`,{},customer);
   const replacement=await h.post(`/customer/bills/${purchase.bill.id}/pay`,{idempotencyKey:randomUUID()},customer);h.payment.capture(replacement.paymentId);
   const paid=await h.get(`/customer/payments/${replacement.paymentId}`,customer);assert.equal(paid.reconciliationRequired,false);
   originalPack=await h.db.mileagePurchase.findUniqueOrThrow({where:{id:purchase.purchase.id}});originalLedger=await h.db.mileageLedger.findMany({where:{packId:originalPack.id}});
   assert.equal(originalPack.status,'ACTIVE');assert.equal(originalPack.remainingKm,1000);assert.equal(originalLedger.length,1);assert.equal(originalLedger[0].type,'GRANT');
  }else await h.db.documentArchive.update({where:{id:archive.id},data:{currentApprovedVersionId:null}});
  h.payment.capture(requested.paymentId);
  const received=await h.post(`/admin/payments/${requested.paymentId}/sync`,{},h.finance);
  assert.equal(received.status,'SUCCEEDED');assert.equal(received.reconciliationRequired,true);assert.ok(received.providerTransactionId);
  let pack=await h.db.mileagePurchase.findUniqueOrThrow({where:{id:purchase.purchase.id}});
  if(duplicate)assert.deepEqual(pack,originalPack);else{assert.equal(pack.status,'PENDING_PAYMENT');assert.equal(pack.remainingKm,0);assert.equal(await h.db.mileageLedger.count({where:{packId:pack.id}}),0);}
  await h.reject('/admin/refunds',{paymentId:received.id,amount:99,reason:'合成部分退款应拒绝',idempotencyKey:randomUUID()},h.finance,'PACK_REFUND_REVIEW');
  const refundInput={paymentId:received.id,amount:100,reason:'合成异常款全额原路退回',idempotencyKey:randomUUID()};
  const refund=await h.post('/admin/refunds',refundInput,h.finance);assert.equal((await h.post('/admin/refunds',refundInput,h.finance)).id,refund.id);
  await h.reject(`/admin/refunds/${refund.id}/approve`,{},h.finance,'DUAL_APPROVAL');
  const paidRefund=await h.post(`/admin/refunds/${refund.id}/approve`,{},h.reviewer);assert.equal(paidRefund.status,'SUCCEEDED');assert.equal(h.payment.refunds.size,1);
  assert.equal((await h.post(`/admin/refunds/${refund.id}/sync`,{},h.finance)).status,'SUCCEEDED');
  pack=await h.db.mileagePurchase.findUniqueOrThrow({where:{id:pack.id}});
  const ledger=await h.db.mileageLedger.findMany({where:{packId:pack.id}});
  if(duplicate){assert.deepEqual(pack,originalPack);assert.deepEqual(ledger,originalLedger);}else{assert.equal(pack.status,'REFUNDED');assert.equal(pack.remainingKm,0);assert.equal(pack.paidAt,null);assert.equal(ledger.length,1);assert.equal(ledger[0].type,'REFUND');assert.equal(ledger[0].deltaKm,0);}
  assert.equal((await h.db.payment.findUniqueOrThrow({where:{id:received.id}})).reconciliationRequired,true,'Actual refund alone must retain the manual review flag');
  const proof=await h.proof(h.finance),base=`/admin/payments/${received.id}/reconciliations`;
  assert.deepEqual((await h.get(base,h.finance)).allowedResolutions,['REFUNDED']);
  const recon=await h.post(base,{revision:received.revision,idempotencyKey:randomUUID(),resolution:'REFUNDED',note:'本地核对全额渠道退款完成，未发放里程',evidenceFileIds:[proof.id]},h.finance);
  await h.reject(`${base}/${recon.id}/review`,{revision:recon.paymentRevision,idempotencyKey:randomUUID(),decision:'APPROVED',note:'本人不得自审'},h.finance,'SELF_REVIEW');
  await h.post(`${base}/${recon.id}/review`,{revision:recon.paymentRevision,idempotencyKey:randomUUID(),decision:'APPROVED',note:'另一员工核对原款与退款事实'},h.reviewer);
  assert.equal((await h.db.payment.findUniqueOrThrow({where:{id:received.id}})).reconciliationRequired,false);
  assert.equal(await h.db.mileageLedger.count({where:{packId:pack.id,type:'GRANT'}}),duplicate?1:0);assert.equal(h.externalCalls,0);assert.equal(h.esignCalls,0);assert.equal(h.identityCalls,0);
 }finally{try{if(productId)await h.db.mileagePackProduct.update({where:{id:productId},data:{active:false}});}finally{await h.close();}}
});

test('HTTP historical swap duplicate receipt refunds cash while preserving the original credit and ledger',async()=>{
 const h=new JourneyHarness();
 try{
  await h.start();const f=await offlineOrder(h.db);await approvedOfflineArchive(h.db,f.order.id);await h.db.order.update({where:{id:f.order.id},data:{status:'ACTIVE'}});
  const today=new Date(new Date().toISOString().slice(0,10));await h.db.usageAccount.create({data:{orderId:f.order.id,customerId:f.customer.id,policyVersion:'USAGE_V1',startedOn:today}});
  // Seed only historical requests, never money or grant outcomes: new swap
  // purchasing remains disabled in MVP while old callbacks must be recoverable.
  const bill=await h.db.bill.create({data:{orderId:f.order.id,customerId:f.customer.id,type:'SWAP_CREDIT',sequence:1,amount:80000,status:'PENDING',dueDate:today}});
  const purchase=await h.db.swapCreditPurchase.create({data:{orderId:f.order.id,customerId:f.customer.id,billId:bill.id,termsSnapshot:{syntheticHistoricalRequest:true},acceptedAt:today,expiresAt:new Date(today.getTime()+30*86400000),idempotencyKey:randomUUID(),requestHash:randomUUID()}});
  const original=await h.db.payment.create({data:{billId:bill.id,customerId:f.customer.id,amount:80000,status:'PENDING',idempotencyKey:randomUUID()}}),extra=await h.db.payment.create({data:{billId:bill.id,customerId:f.customer.id,amount:80000,status:'CLOSED',idempotencyKey:randomUUID()}});
  for(const payment of [original,extra])h.payment.payments.set(payment.id,{status:'PENDING',amount:80000});
  h.payment.capture(original.id);assert.equal((await h.post(`/admin/payments/${original.id}/sync`,{},h.finance)).reconciliationRequired,false);
  const originalPurchase=await h.db.swapCreditPurchase.findUniqueOrThrow({where:{id:purchase.id}}),originalCredit=await h.db.swapCredit.findUniqueOrThrow({where:{id:originalPurchase.creditId!}}),originalLedger=await h.db.swapLedger.findMany({where:{purchaseId:purchase.id},orderBy:{id:'asc'}});
  assert.equal(originalPurchase.status,'ACTIVE');assert.equal(originalLedger.filter(row=>row.type==='GRANT').length,1);
  h.payment.capture(extra.id);const received=await h.post(`/admin/payments/${extra.id}/sync`,{},h.finance);assert.equal(received.reconciliationRequired,true);
  const request={paymentId:extra.id,amount:80000,reason:'历史额外收款全额原路退回',idempotencyKey:randomUUID()},refund=await h.post('/admin/refunds',request,h.finance);
  assert.equal((await h.post('/admin/refunds',request,h.finance)).id,refund.id);await h.reject(`/admin/refunds/${refund.id}/approve`,{},h.finance,'DUAL_APPROVAL');
  assert.equal((await h.post(`/admin/refunds/${refund.id}/approve`,{},h.reviewer)).status,'SUCCEEDED');assert.equal((await h.post(`/admin/refunds/${refund.id}/sync`,{},h.finance)).status,'SUCCEEDED');
  assert.deepEqual(await h.db.swapCreditPurchase.findUniqueOrThrow({where:{id:purchase.id}}),originalPurchase);assert.deepEqual(await h.db.swapCredit.findUniqueOrThrow({where:{id:originalCredit.id}}),originalCredit);assert.deepEqual(await h.db.swapLedger.findMany({where:{purchaseId:purchase.id},orderBy:{id:'asc'}}),originalLedger);
  const proof=await h.proof(h.finance),base=`/admin/payments/${extra.id}/reconciliations`,recon=await h.post(base,{revision:received.revision,idempotencyKey:randomUUID(),resolution:'REFUNDED',note:'额外收款已完整退回，原权益保留',evidenceFileIds:[proof.id]},h.finance);
  await h.post(`${base}/${recon.id}/review`,{revision:recon.paymentRevision,idempotencyKey:randomUUID(),decision:'APPROVED',note:'独立核对完整原路退款'},h.reviewer);
  assert.equal((await h.db.payment.findUniqueOrThrow({where:{id:extra.id}})).reconciliationRequired,false);assert.equal(await h.db.refund.count({where:{paymentId:original.id}}),0);
  assert.equal(h.externalCalls,0);assert.equal(h.esignCalls,0);assert.equal(h.identityCalls,0);
 }finally{await h.close();}
});

for(const secondPath of ['DIRECT','FAILED','REJECTED'])test(`HTTP never-issued receipts with ${secondPath} second refund and a third late receipt each reconcile`,async()=>{
 const h=new JourneyHarness();let productId:string|undefined;
 try{
  await h.start();const f=await offlineOrder(h.db),{archive}=await approvedOfflineArchive(h.db,f.order.id);await h.db.order.update({where:{id:f.order.id},data:{status:'ACTIVE'}});
  const token=randomUUID(),customer={id:f.customer.id,headers:{Authorization:`Bearer ${token}`}};await h.db.customerSession.create({data:{id:tokenHash(token),customerId:f.customer.id,expiresAt:new Date(Date.now()+3600000)}});
  await h.post('/customer/consents',{consents:['terms','privacy'].map(type=>({documentId:h.docs[type].id,version:h.docs[type].version}))},customer);
  const today=new Date(new Date().toISOString().slice(0,10)),end=new Date(today.getTime()+30*86400000);await h.db.usageAccount.create({data:{orderId:f.order.id,customerId:f.customer.id,policyVersion:'USAGE_V1',startedOn:today,periods:{create:{orderId:f.order.id,sequence:1,startDate:today,endDate:end,effectiveEndDate:end,startReadingKm:100}}}});
  const product=await h.db.mileagePackProduct.create({data:{id:`offline-exception-refund-${randomUUID()}`,version:1,km:1000,amount:100}});productId=product.id;
  const version=(await h.db.legalDocument.aggregate({where:{type:'mileage-pack'},_max:{version:true}}))._max.version||0,terms=await h.db.legalDocument.create({data:{type:'mileage-pack',version:version+1,title:'合成未发放里程异常退款说明',content:'仅本地合成多笔异常收款回归。',status:'PUBLISHED',confirmedAt:new Date(),confirmedBy:h.reviewer.id}});
  const purchase=await h.post(`/customer/orders/${f.order.id}/mileage-packs`,{productId:product.id,termsVersion:'MILEAGE_PACK_V1',termsDocumentId:terms.id,termsDocumentVersion:terms.version,termsHash:hash(terms.content),accepted:true,idempotencyKey:randomUUID()},customer);
  const payments:any[]=[];
  for(let index=0;index<3;index++){const requested=await h.post(`/customer/bills/${purchase.bill.id}/pay`,{idempotencyKey:randomUUID()},customer);payments.push(requested.paymentId);if(index<2)await h.post(`/customer/payments/${requested.paymentId}/close`,{},customer);}
  await h.db.documentArchive.update({where:{id:archive.id},data:{currentApprovedVersionId:null}});
  for(const id of payments.slice(0,2)){h.payment.capture(id);assert.equal((await h.post(`/admin/payments/${id}/sync`,{},h.finance)).reconciliationRequired,true);}
  h.payment.refund=async(input:any)=>{assert.equal((await h.payment.query(input.paymentId)).status,'SUCCEEDED');h.payment.refunds.set(input.refundId,{status:'PROCESSING',paymentId:input.paymentId,amount:input.amount,totalAmount:input.totalAmount});return{status:'PROCESSING'} as any;};
  const refunds:any[]=[];
  for(const id of payments.slice(0,2))refunds.push(await h.post('/admin/refunds',{paymentId:id,amount:100,reason:'合成未授予权益异常全额退款',idempotencyKey:randomUUID()},h.finance));
  await Promise.all(refunds.map(async(refund,index)=>{if(index===1&&secondPath==='REJECTED')assert.equal((await h.post(`/admin/refunds/${refund.id}/reject`,{reason:'合成先拒绝后补充重新申请'},h.reviewer)).status,'REJECTED');else assert.equal((await h.post(`/admin/refunds/${refund.id}/approve`,{},h.reviewer)).status,'PROCESSING');}));
  assert.equal((await h.db.mileagePurchase.findUniqueOrThrow({where:{id:purchase.purchase.id}})).status,'REFUND_PENDING');
  const proof=await h.proof(h.finance);
  const finish=async(refund:any)=>{
   h.payment.refunds.set(refund.id,{...h.payment.refunds.get(refund.id),status:'SUCCEEDED',providerRefundId:`local-refund-${refund.id}`});
   assert.equal((await h.post(`/admin/refunds/${refund.id}/sync`,{},h.finance)).status,'SUCCEEDED');
   assert.equal((await h.post(`/admin/refunds/${refund.id}/sync`,{},h.finance)).status,'SUCCEEDED');
   const payment=await h.db.payment.findUniqueOrThrow({where:{id:refund.paymentId}}),base=`/admin/payments/${payment.id}/reconciliations`;
   const recon=await h.post(base,{revision:payment.revision,idempotencyKey:randomUUID(),resolution:'REFUNDED',note:'独立核对原款全退且始终未授予里程',evidenceFileIds:[proof.id]},h.finance);
   await h.post(`${base}/${recon.id}/review`,{revision:recon.paymentRevision,idempotencyKey:randomUUID(),decision:'APPROVED',note:'另一员工完成核对'},h.reviewer);
   assert.equal((await h.db.payment.findUniqueOrThrow({where:{id:payment.id}})).reconciliationRequired,false);
  };
  if(secondPath==='DIRECT')await Promise.all(refunds.map(finish));
  else{
   await finish(refunds[0]);
   if(secondPath==='FAILED'){h.payment.refunds.set(refunds[1].id,{...h.payment.refunds.get(refunds[1].id),status:'FAILED'});assert.equal((await h.post(`/admin/refunds/${refunds[1].id}/sync`,{},h.finance)).status,'FAILED');}
   const replacement=await h.post('/admin/refunds',{paymentId:payments[1],amount:100,reason:'前笔未退款，补充证据重新申请',idempotencyKey:randomUUID()},h.finance);assert.equal((await h.post(`/admin/refunds/${replacement.id}/approve`,{},h.reviewer)).status,'PROCESSING');await finish(replacement);
  }
  h.payment.capture(payments[2]);assert.equal((await h.post(`/admin/payments/${payments[2]}/sync`,{},h.finance)).reconciliationRequired,true);
  const late=await h.post('/admin/refunds',{paymentId:payments[2],amount:100,reason:'原两笔退款核对后第三笔迟到',idempotencyKey:randomUUID()},h.finance);
  assert.equal((await h.post(`/admin/refunds/${late.id}/approve`,{},h.reviewer)).status,'PROCESSING');assert.equal((await h.db.mileagePurchase.findUniqueOrThrow({where:{id:purchase.purchase.id}})).status,'REFUNDED');await finish(late);
  const pack=await h.db.mileagePurchase.findUniqueOrThrow({where:{id:purchase.purchase.id}}),ledger=await h.db.mileageLedger.findMany({where:{packId:pack.id}});assert.equal(pack.status,'REFUNDED');assert.equal(pack.paidAt,null);assert.equal(pack.remainingKm,0);assert.equal(ledger.length,3);assert.ok(ledger.every(row=>row.type==='REFUND'&&row.deltaKm===0));assert.equal([...h.payment.refunds.values()].filter(row=>row.status==='SUCCEEDED').length,3);assert.equal(h.externalCalls,0);
 }finally{try{if(productId)await h.db.mileagePackProduct.update({where:{id:productId},data:{active:false}});}finally{await h.close();}}
});

