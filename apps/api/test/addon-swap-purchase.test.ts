import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalHash} from '../src/customers/types';
import {addonTerms} from '../src/addon-products/policy';
import * as policy from '../src/swap-purchases/policy';

const source:any={serviceStageId:null,stageSourceHash:null,policy:null,startAt:new Date('2026-10-01T00:00:00+08:00'),endAt:new Date('2027-10-01T00:00:00+08:00'),stageStatus:'ACTIVE'};
const order={id:'order-1',customerId:'customer-1',status:'ACTIVE',finalPlanSnapshot:{months:12}};
function addonPurchase(service=source){
 const terms=addonTerms('SWAP_CREDIT'),catalog={kind:'SWAP_CREDIT',name:'目标换车一次',scopePrices:[{id:'scope-a',scopes:[{brand:'蔚来',allModels:false,modelDefinitionIds:['et5']}],prices:[{quantity:1,amount:12345}]}],terms};
 const serviceSource={orderId:order.id,customerId:order.customerId,serviceStageId:service.serviceStageId,stageSourceHash:service.stageSourceHash,policy:service.policy,startAt:service.startAt.toISOString(),endAt:service.endAt.toISOString()};
 const pricingSnapshot={serviceSource,serviceSourceHash:canonicalHash(serviceSource),version:3,sku:'SWAP_CREDIT_ADDON_1',policyVersion:'SWAP_ADDON_V1',productId:'addon-1',versionId:'version-1',productVersion:1,sourceHash:canonicalHash(catalog),source:catalog,quote:{quoteId:'scope-a:1',quantity:1,amount:12345,currency:'CNY'},targetModelDefinitionId:'et5',targetBrand:'蔚来',quantity:1,amount:12345,currency:'CNY',serviceStageId:null,stageSourceHash:null,expiresAt:source.endAt.toISOString()};
 return {id:'purchase-1',orderId:order.id,customerId:order.customerId,billId:'bill-1',quantity:1,amount:12345,currency:'CNY',expiresAt:source.endAt,serviceStageId:null,pricingSnapshot,termsSnapshot:{...terms,accepted:true}};
}
test('independent swap purchase accepts frozen catalog price different from historical main package',()=>{
 const p=addonPurchase();assert.equal(policy.validateSwapPurchase(order,p,undefined,undefined,source),12345);
});
test('independent swap purchase rejects price, source hash, target and terms tampering',()=>{
 for(const mutate of [(p:any)=>p.amount++,(p:any)=>p.pricingSnapshot.sourceHash='0'.repeat(64),(p:any)=>p.pricingSnapshot.targetModelDefinitionId='et7',(p:any)=>p.pricingSnapshot.targetBrand='乐道',(p:any)=>p.termsSnapshot.hash='0'.repeat(64)]){
  const p=addonPurchase();mutate(p);assert.throws(()=>policy.validateSwapPurchase(order,p,undefined,undefined,source));
 }
});
test('independent swap source cannot migrate to another order, customer or service term',()=>{
 for(const changed of [{...order,id:'other'},{...order,customerId:'other'}])assert.throws(()=>policy.validateSwapPurchase(changed,addonPurchase(),undefined,undefined,source));
 assert.throws(()=>policy.validateSwapPurchase(order,addonPurchase(),undefined,undefined,{...source,serviceStageId:'renewal-2',stageSourceHash:'new'}));
});
test('historical fixed price remains exact and cannot be silently converted',()=>{
 const legacy={...addonPurchase(),amount:80000,pricingSnapshot:null};assert.equal(policy.validateSwapPurchase(order,legacy,undefined,undefined,source),80000);
 assert.throws(()=>policy.validateSwapPurchase(order,{...legacy,amount:12345},undefined,undefined,source));
});
test('independent paid credit must match actual target model and canonical brand',()=>{
 const match=(policy as any).swapPurchaseTargetMatches;assert.equal(typeof match,'function');
 assert.equal(match(addonPurchase(),{id:'et5',brand:'蔚来'}),true);
 assert.equal(match(addonPurchase(),{id:'et7',brand:'蔚来'}),false);
 assert.equal(match(addonPurchase(),{id:'et5',brand:'乐道'}),false);
 assert.equal(match({...addonPurchase(),pricingSnapshot:null},{id:'et7',brand:'蔚来'}),true);
});

import {readSwapCreditAvailability,reserveCredit,consumeCredit} from '../src/vehicle-changes/credits';
function creditFixture(){
 const account={packStatus:'ACTIVE',id:'account-1',orderId:order.id,customerId:order.customerId,startedOn:new Date('2026-10-01'),returnedOn:null};
 const free={id:'free-1',orderId:order.id,source:'FREE',status:'ACTIVE',cycleSequence:1,termSequence:null,policySnapshot:null,serviceStageId:null,consumedChangeId:'past-change',sourcePaymentId:null};
 const credit={id:'paid-1',orderId:order.id,source:'PAID',status:'ACTIVE',cycleSequence:null,termSequence:null,policySnapshot:null,serviceStageId:null,consumedChangeId:null,sourcePaymentId:'payment-1'};
 const purchase={...addonPurchase(),status:'ACTIVE',creditId:credit.id,paymentId:'payment-1'},bill={id:'bill-1',type:'SWAP_CREDIT',orderId:order.id,customerId:order.customerId,amount:12345};
 const payment={id:'payment-1',billId:bill.id,customerId:order.customerId,amount:12345,status:'SUCCEEDED',bill,refunds:[]};
 const reservations:any[]=[],ledger:any[]=[],models:any={et5:{id:'et5',brand:'蔚来'},et7:{id:'et7',brand:'蔚来'}};
 const tx:any={
  vehicleReceiptEvent:{findFirst:async()=>null},$queryRaw:async()=>[],order:{findUniqueOrThrow:async()=>order},usageAccount:{findUnique:async()=>account,findUniqueOrThrow:async()=>account},
  orderServiceStage:{findMany:async()=>[]},orderChange:{findMany:async()=>[],findUnique:async()=>({id:'change-1',orderId:order.id,customerId:order.customerId,kind:'VEHICLE_CHANGE',targetVehicleId:'vehicle-et5'})},
  vehicle:{findUnique:async({where}:any)=>({id:where.id,modelDefinitionId:where.id.replace('vehicle-','')})},modelDefinition:{findUnique:async({where}:any)=>models[where.id]},
  swapCredit:{findUnique:async({where}:any)=>where.id?credit:free,findUniqueOrThrow:async()=>credit,findMany:async({where}:any)=>where.source==='PAID'?[credit]:[free,credit],update:async({data}:any)=>Object.assign(credit,data)},
  swapCreditPurchase:{findFirst:async()=>purchase,updateMany:async()=>({count:1})},payment:{findUnique:async()=>payment},
  swapReservation:{count:async()=>0,findMany:async()=>reservations.filter(r=>r.status==='RESERVED'),findFirst:async()=>reservations.find(r=>r.status==='RESERVED'),create:async({data}:any)=>{const r={...data,id:'reservation-1',status:'RESERVED',credit};reservations.push(r);return r;},update:async({data}:any)=>Object.assign(reservations[0],data)},
  swapLedger:{findUnique:async()=>ledger.find(l=>l.type==='CONSUME'),create:async({data}:any)=>{ledger.push(data);return data;}}
 };
 return{tx,account,credit,purchase,ledger,models,reservations};
}
test('paid target SKU cannot reserve a different actual vehicle model',async()=>{
 const f=creditFixture();await assert.rejects(()=>reserveCredit(f.tx,order,f.account,'change-1',new Date('2026-11-05'),'vehicle-et7'));
 assert.equal(f.reservations.length,0);assert.equal(f.ledger.length,0);
});
test('actual completion rechecks selected target and preserves the reserved credit on mismatch',async()=>{
 const f=creditFixture();await reserveCredit(f.tx,order,f.account,'change-1',new Date('2026-11-05'),'vehicle-et5');
 await assert.rejects(()=>consumeCredit(f.tx,order,f.account,'change-1',new Date('2026-11-05'),'vehicle-et7'));
 assert.equal(f.credit.consumedChangeId,null);assert.equal(f.reservations[0].status,'RESERVED');
});
test('target SKU completion consumes once and idempotent replay rejects changed target',async()=>{
 const f=creditFixture();await consumeCredit(f.tx,order,f.account,'change-1',new Date('2026-11-05'),'vehicle-et5');
 await consumeCredit(f.tx,order,f.account,'change-1',new Date('2026-11-05'),'vehicle-et5');
 assert.equal(f.ledger.filter(l=>l.type==='CONSUME').length,1);
 await assert.rejects(()=>consumeCredit(f.tx,order,f.account,'change-1',new Date('2026-11-05'),'vehicle-et7'));
});
test('canonical target brand is reloaded from model definition at availability',async()=>{
 const f=creditFixture();f.models.et5.brand='乐道';
 await assert.rejects(()=>readSwapCreditAvailability(f.tx,order,f.account,'change-1',new Date('2026-11-05'),'vehicle-et5'));
});

import {SwapPurchasesController} from '../src/swap-purchases/controller';
test('independent swap creation accepts dedicated consent schema and rejects client price overrides',async()=>{
 const terms=addonTerms('SWAP_CREDIT'),body={sku:'SWAP_CREDIT_ADDON_1',productId:'addon-1',versionId:'version-1',quoteId:'scope-a:1',sourceHash:'a'.repeat(64),targetModelDefinitionId:'et5',termsVersion:terms.version,termsHash:terms.hash,accepted:true,idempotencyKey:'purchase-key-1'};
 // Reach transaction only after request validation; fixture deliberately stops there.
 let called=0;const controller=new SwapPurchasesController({serial:async()=>{called++;return {schemaAccepted:true};}} as any,{} as any,()=>new Date('2026-11-05'));
 assert.deepEqual(await controller.purchase('order-1',body,{}),{schemaAccepted:true});assert.equal(called,1);
 for(const extra of [{amount:1},{quantity:2},{scope:[]},{termsDocumentId:'old-v1'}])await assert.rejects(()=>controller.purchase('order-1',{...body,...extra},{}));
 assert.equal(called,1);
});

import {purchaseView,purchaseAccount} from '../src/swap-purchases/view';
test('independent purchase detail displays its original SKU and dedicated explanation',async()=>{
 const f=creditFixture(),p={...f.purchase,createdAt:new Date('2026-11-05'),acceptedAt:new Date('2026-11-05'),paidAt:new Date('2026-11-05')};
 f.tx.bill={findUniqueOrThrow:async()=>({id:'bill-1',type:'SWAP_CREDIT',orderId:order.id,customerId:order.customerId,amount:p.amount,paidAmount:p.amount,status:'PAID',payments:[{id:'payment-1',billId:'bill-1',customerId:order.customerId,amount:p.amount,status:'SUCCEEDED',refunds:[]}]})};
 const view=await purchaseView(f.tx,p,new Date('2026-11-05'));
 assert.equal(view.sku,'SWAP_CREDIT_ADDON_1');assert.equal(view.policyVersion,'SWAP_ADDON_V1');
 assert.equal(view.targetModelDefinitionId,'et5');assert.equal(view.targetBrand,'蔚来');assert.equal(view.amount,12345);
 assert.equal(view.terms.content,addonTerms('SWAP_CREDIT').content);assert.equal(view.terms.hash,addonTerms('SWAP_CREDIT').hash);
 assert.equal('source' in view,false);
});
test('historical main package price stays exact while independent target SKU freezes another amount',()=>{
 const policySource={...source,policy:{policyVersion:'SWAP_TERM_V2',includedCount:3,extraFeeAmount:80000,sourceHash:'a'.repeat(64)}};
 const original={...addonPurchase(),amount:80000,pricingSnapshot:policy.freezeSwapPricing(order,policySource)};
 assert.equal(policy.validateSwapPurchase(order,original,undefined,undefined,policySource),80000);
 assert.throws(()=>policy.validateSwapPurchase(order,{...original,amount:12345},undefined,undefined,policySource));
 assert.equal(policy.validateSwapPurchase(order,addonPurchase(policySource),undefined,undefined,policySource),12345);
});


import {grantSwapCredit,guardSwapRefund,settleSwapRefund} from '../src/swap-purchases/ledger';
import {BillingService} from '../src/billing/billing';
import {guardPhysicalReceiptBill} from '../src/offline-documents/vehicle-receipt';
import {hash} from '../src/common/data';
function grantFixture(){
 const f=creditFixture(),bill={id:'bill-1',orderId:order.id,customerId:order.customerId,type:'SWAP_CREDIT',amount:12345},payment={id:'payment-1',billId:bill.id,customerId:order.customerId,amount:12345,status:'SUCCEEDED',providerTransactionId:'verified-local-1'};
 Object.assign(f.purchase,{status:'PENDING_PAYMENT',paymentId:null,creditId:null,paidAt:null});
 f.tx.order.update=async()=>order;f.tx.order.updateMany=async()=>({count:0});f.tx.usageAccount.update=async()=>f.account;
 f.tx.payment.findUniqueOrThrow=async()=>payment;f.tx.swapCreditPurchase.findUnique=async()=>f.purchase;f.tx.swapCreditPurchase.findUniqueOrThrow=async()=>f.purchase;
 f.tx.swapCreditPurchase.update=async({data}:any)=>Object.assign(f.purchase,data);
 f.tx.swapCredit.create=async({data}:any)=>Object.assign(f.credit,{...data,id:'paid-1'});
 f.tx.returnSettlement={updateMany:async()=>({count:0})};f.tx.auditLog={create:async({data}:any)=>data};
 f.tx.bill={findUniqueOrThrow:async()=>bill};f.tx.swapCredit.count=async()=>0;f.tx.vehicleReceiptEvent={findFirst:async()=>null};
 return{...f,bill,payment};
}

function billingFixture(){
 const f=grantFixture(),ownedOrder:any={...order,contractMode:'ESIGN'},bill:any={...f.bill,status:'PENDING',paidAmount:0,payments:[]},payment:any={...f.payment,status:'PENDING',bill,revision:0},reviews:any[]=[];
 let physical:any=null,now=new Date('2026-11-05T01:00:00Z');
 const tx=f.tx;Object.assign(f.account,{packStatus:'ACTIVE'});
 tx.order.findUniqueOrThrow=async()=>ownedOrder;tx.order.findUnique=async()=>ownedOrder;tx.order.update=async()=>ownedOrder;
 tx.order.updateMany=async({where,data}:any)=>{if(ownedOrder.status!==where.status)return{count:0};Object.assign(ownedOrder,data);reviews.push({type:'order',data});return{count:1};};
 tx.vehicleReceiptEvent={findFirst:async()=>physical};tx.orderChange.findFirst=async()=>null;
 tx.bill.findFirst=async()=>bill;tx.bill.findUniqueOrThrow=async()=>bill;tx.bill.update=async({data}:any)=>Object.assign(bill,data);
 tx.payment.findUnique=async({where}:any)=>where.customerId_idempotencyKey?null:payment;tx.payment.findUniqueOrThrow=async()=>payment;tx.payment.findFirst=async()=>null;
 tx.payment.create=async({data}:any)=>Object.assign(payment,data,{status:'CREATING'});tx.payment.update=async({data}:any)=>Object.assign(payment,data);
 tx.payment.updateMany=async({data}:any)=>{Object.assign(payment,data);return{count:1};};
 tx.returnSettlement.updateMany=async({data}:any)=>{reviews.push({type:'return',data});return{count:1};};tx.notification={create:async()=>({})};tx.serviceObligation={findFirst:async()=>null};
 const db:any={serial:(work:any)=>work(tx),payment:tx.payment};
 return{...f,tx,db,bill,payment,ownedOrder,reviews,setPhysical:(v:any)=>{physical=v;},setNow:(v:Date)=>{now=v;},service:(gateway:any={})=>new BillingService(db,gateway,()=>now)};
}
async function enabledSwap(work:()=>Promise<void>){const old=process.env.SWAP_CREDIT_PURCHASE_ENABLED,oldMvp=process.env.MVP_V2_ENABLED;process.env.SWAP_CREDIT_PURCHASE_ENABLED='true';delete process.env.MVP_V2_ENABLED;try{await work();}finally{if(old===undefined)delete process.env.SWAP_CREDIT_PURCHASE_ENABLED;else process.env.SWAP_CREDIT_PURCHASE_ENABLED=old;if(oldMvp===undefined)delete process.env.MVP_V2_ENABLED;else process.env.MVP_V2_ENABLED=oldMvp;}}

test('V3 payment created across service-term boundary retains request but withholds parameters',async()=>enabledSwap(async()=>{
 const f=billingFixture();f.setNow(new Date('2027-09-30T15:59:59Z'));
 const service=f.service({create:async()=>{f.setNow(new Date('2027-09-30T16:00:00Z'));return{package:'synthetic-expired-request'};}});
 await assert.rejects(service.pay({id:order.customerId,openId:'synthetic-openid'},f.bill.id,'swap-ready-boundary'),(e:any)=>e.getResponse()?.error?.code==='SWAP_NOT_PAYABLE');
 assert.equal(f.payment.status,'PENDING');assert.equal(f.payment.clientParameters.package,'synthetic-expired-request');assert.equal(f.bill.status,'PENDING');
}));

test('V3 payment created while physical receipt arrives retains request without returning pay parameters',async()=>enabledSwap(async()=>{
 const f=billingFixture(),service=f.service({create:async()=>{f.setPhysical({id:'receipt',evidenceFileIds:[]});return{package:'synthetic-returned-request'};}});
 await assert.rejects(service.pay({id:order.customerId,openId:'synthetic-openid'},f.bill.id,'swap-ready-receipt'),(e:any)=>e.getResponse()?.error?.code==='PHYSICAL_RETURN_BILL_PAUSED');
 assert.equal(f.payment.status,'PENDING');assert.equal(f.payment.clientParameters.package,'synthetic-returned-request');
}));

test('V3 trusted success after physical receipt records money for review with no usable right and supports refund',async()=>{
 const f=billingFixture();f.setPhysical({id:'receipt',evidenceFileIds:[]});Object.assign(f.account,{packStatus:'FROZEN'});
 await assert.rejects(guardPhysicalReceiptBill(f.tx,f.bill));
 const service=f.service(),event={status:'SUCCEEDED' as const,amount:12345,transactionId:'synthetic-received',succeededAt:'2026-11-05T00:59:59Z'};
 await service.settle(f.payment.id,event);await service.settle(f.payment.id,event);
 assert.equal(f.payment.status,'SUCCEEDED');assert.equal(f.payment.reconciliationRequired,true);assert.equal(f.payment.reconciliationReason,'SWAP_ADDON_PHYSICAL_RETURN');assert.equal(f.credit.status,'FROZEN');assert.equal(f.purchase.status,'PAYMENT_REVIEW');assert.equal(f.ledger.filter(l=>l.type==='GRANT').length,1);
 await guardSwapRefund(f.tx,f.payment,12345);await settleSwapRefund(f.tx,{id:'refund-received',paymentId:f.payment.id,customerId:order.customerId,amount:12345,payment:{...f.payment,bill:f.bill}});assert.equal(f.credit.status,'REFUNDED');
});

test('V3 extra trusted receipt on paid completed order reopens review once without granting another right',async()=>{
 const f=billingFixture();Object.assign(f.ownedOrder,{status:'COMPLETED'});Object.assign(f.bill,{status:'PAID',paidAmount:12345});Object.assign(f.purchase,{status:'CONSUMED',paymentId:'original-payment',creditId:f.credit.id});
 const service=f.service(),event={status:'SUCCEEDED' as const,amount:12345,transactionId:'synthetic-extra',succeededAt:'2026-11-05T00:59:59Z'};
 await service.settle(f.payment.id,event);await service.settle(f.payment.id,event);
 assert.equal(f.payment.status,'SUCCEEDED');assert.equal(f.payment.reconciliationRequired,true);assert.equal(f.ownedOrder.status,'SETTLING');assert.equal(f.reviews.filter(r=>r.type==='return').length,1);assert.equal(f.ledger.length,0);assert.equal(f.purchase.paymentId,'original-payment');assert.equal(f.bill.paidAmount,12345);
});

test('legacy swap new intent is rejected after current-session and order checks while old same-key replay remains',async()=>enabledSwap(async()=>{
 const f=billingFixture(),input={productId:'SWAP_CREDIT_1',termsVersion:'SWAP_CREDIT_V1',termsDocumentId:'legacy-document',termsDocumentVersion:1,termsHash:'a'.repeat(64),accepted:true,idempotencyKey:'legacy-swap-key'},request={customer:{id:order.customerId},session:{id:'synthetic-session'}};
 let old:any=null;f.tx.customerSession={findUnique:async()=>({customerId:order.customerId,expiresAt:new Date('2030-01-01')})};f.tx.order.findFirst=async()=>f.ownedOrder;f.tx.swapCreditPurchase.findUnique=async()=>old;
 const controller=new SwapPurchasesController(f.db,{} as any,()=>new Date('2026-11-05T01:00:00Z'));
 for(const legacy of [input,{...input,productId:'SWAP_CREDIT_TERM_1',termsVersion:'SWAP_CREDIT_V2',pricingHash:'b'.repeat(64)}])await assert.rejects(controller.purchase(order.id,legacy,request),(e:any)=>e.getResponse?.()?.error?.code==='SWAP_ADDON_CATALOG_REQUIRED');
 Object.assign(f.purchase,{amount:80000,quantity:1,currency:'CNY',pricingSnapshot:null,termsSnapshot:{version:'SWAP_CREDIT_V1',documentId:'legacy-document',documentVersion:1,hash:'a'.repeat(64),content:'历史说明',accepted:true},requestHash:hash({termsDocumentId:input.termsDocumentId,termsDocumentVersion:input.termsDocumentVersion,termsHash:input.termsHash,accepted:input.accepted,idempotencyKey:input.idempotencyKey,productId:input.productId,termsVersion:input.termsVersion}),status:'PENDING_PAYMENT'});Object.assign(f.bill,{amount:80000});old=f.purchase;
 assert.equal((await controller.purchase(order.id,input,request)).purchase.id,f.purchase.id);
 f.tx.customerSession.findUnique=async()=>null;await assert.rejects(controller.purchase(order.id,input,request),(e:any)=>e.getResponse?.()?.error?.code==='SESSION_EXPIRED');
}));

test('historical swap account never offers legacy new sale even with current source and approved terms',async()=>enabledSwap(async()=>{
 const f=billingFixture();f.tx.swapCreditPurchase.findMany=async()=>[];f.tx.legalDocument={findFirst:async()=>({id:'legacy-document',version:1,content:'原已批准换车说明',confirmedAt:new Date(),confirmedBy:'staff',status:'PUBLISHED',type:'vehicle-change'})};
 const view=await purchaseAccount(f.tx,f.ownedOrder,f.account,new Date('2026-11-05T01:00:00Z'));
 assert.equal(view.canPurchase,false);assert.equal(view.product.id,'SWAP_CREDIT_1');assert.match(view.purchaseCatalogPath,/addon-products\?kind=SWAP_CREDIT/);
}));

test('legacy already frozen pending bill can still pay and grant exactly its original unrestricted credit',async()=>enabledSwap(async()=>{
 const f=billingFixture();Object.assign(f.purchase,{amount:80000,pricingSnapshot:null});Object.assign(f.bill,{amount:80000});Object.assign(f.payment,{amount:80000});
 const service=f.service({create:async()=>({package:'synthetic-legacy-pending'})});
 assert.equal((await service.pay({id:order.customerId,openId:'synthetic-openid'},f.bill.id,'legacy-frozen-pay')).package,'synthetic-legacy-pending');
 const event={status:'SUCCEEDED' as const,amount:80000,transactionId:'synthetic-legacy-success',succeededAt:'2026-11-05T00:59:59Z'};await service.settle(f.payment.id,event);await service.settle(f.payment.id,event);
 assert.equal(f.purchase.status,'ACTIVE');assert.equal(f.credit.status,'ACTIVE');assert.equal(f.payment.reconciliationRequired,false);assert.equal(f.ledger.filter(l=>l.type==='GRANT').length,1);assert.equal(f.purchase.amount,80000);
}));
test('independent expired receipt creates no available credit and returns reconciliation reason',async()=>{
 const f=grantFixture(),reason=await grantSwapCredit(f.tx,f.bill,'payment-1',new Date('2027-10-02'));
 assert.equal(reason,'SWAP_ADDON_EXPIRED');assert.equal(f.purchase.status,'PAYMENT_REVIEW');assert.equal(f.credit.status,'FROZEN');
 assert.equal(f.ledger.filter(l=>l.type==='GRANT').length,1);
 await grantSwapCredit(f.tx,f.bill,'payment-1',new Date('2027-10-02'));assert.equal(f.ledger.filter(l=>l.type==='GRANT').length,1);
});
test('independent receipt with unavailable historical stage is preserved for review and full refund',async()=>{
 const f=grantFixture(),serviceSource={orderId:order.id,customerId:order.customerId,serviceStageId:'renewal-1',stageSourceHash:'b'.repeat(64),policy:null,startAt:source.startAt.toISOString(),endAt:source.endAt.toISOString()};
 Object.assign(f.purchase,{serviceStageId:serviceSource.serviceStageId});Object.assign(f.purchase.pricingSnapshot,{serviceStageId:serviceSource.serviceStageId,stageSourceHash:serviceSource.stageSourceHash,serviceSource,serviceSourceHash:canonicalHash(serviceSource)});
 f.tx.orderServiceStage.findUnique=async()=>null;
 const reason=await grantSwapCredit(f.tx,f.bill,'payment-1',new Date('2026-11-05'));
 assert.equal(reason,'SWAP_ADDON_SOURCE_INVALID');assert.equal(f.purchase.status,'PAYMENT_REVIEW');assert.equal(f.credit.status,'FROZEN');
 await guardSwapRefund(f.tx,f.payment,12345);assert.equal(f.purchase.status,'REFUND_PENDING');
 await settleSwapRefund(f.tx,{id:'refund-1',paymentId:f.payment.id,customerId:order.customerId,amount:12345,payment:{...f.payment,bill:f.bill}});
 assert.equal(f.purchase.status,'REFUNDED');assert.equal(f.credit.status,'REFUNDED');
});

test('main package gift remains first even when a paid SKU targets another model',async()=>{
 const f=creditFixture(),free=await f.tx.swapCredit.findUnique({where:{orderId_cycleSequence:{orderId:order.id,cycleSequence:1}}});free.consumedChangeId=null;
 const r=await reserveCredit(f.tx,order,f.account,'change-1',new Date('2026-11-05'),'vehicle-et7');
 assert.equal(r.creditId,free.id);assert.equal(f.purchase.status,'ACTIVE');assert.equal(f.credit.consumedChangeId,null);
});
test('frozen exception source never authorizes new availability or restoration',async()=>{
 const f=grantFixture(),serviceSource={orderId:order.id,customerId:order.customerId,serviceStageId:'renewal-1',stageSourceHash:'b'.repeat(64),policy:null,startAt:source.startAt.toISOString(),endAt:source.endAt.toISOString()};
 Object.assign(f.purchase,{serviceStageId:serviceSource.serviceStageId});Object.assign(f.purchase.pricingSnapshot,{serviceStageId:serviceSource.serviceStageId,stageSourceHash:serviceSource.stageSourceHash,serviceSource,serviceSourceHash:canonicalHash(serviceSource)});
 f.tx.orderServiceStage.findUnique=async()=>null;await grantSwapCredit(f.tx,f.bill,'payment-1',new Date('2026-11-05'));
 assert.equal(policy.frozenAddonSwapSource(order,f.purchase).stageStatus,'ENDED');
 await assert.rejects(()=>readSwapCreditAvailability(f.tx,order,f.account,'change-1',new Date('2026-11-05'),'vehicle-et5'));
 const {restoreState}=await import('../src/swap-purchases/restore');await assert.rejects(()=>restoreState(f.tx,f.purchase,new Date('2026-11-05')));
});
