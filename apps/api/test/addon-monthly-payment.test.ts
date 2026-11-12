import test from 'node:test';
import assert from 'node:assert/strict';
import {BillingService} from '../src/billing/billing';
import {guardPackPayment} from '../src/usage/ledger';
import {expireMonthlyPeriodPacks} from '../src/usage/monthly-pack';
import {addonTerms,versionSource,versionHash} from '../src/addon-products/policy';
import {guardPackRefund,settlePackRefund} from '../src/usage/refunds';
import {hash} from '../src/common/data';
import {mileagePackView} from '../src/usage/usage.service';
function fixture(){
 const account:any={id:'account',orderId:'order',customerId:'customer',packStatus:'ACTIVE',returnedOn:null};
 const order:any={id:'order',customerId:'customer',status:'ACTIVE',contractMode:'ESIGN'};
 const bill:any={id:'bill',orderId:'order',customerId:'customer',type:'MILEAGE_PACK',status:'PENDING',paidAmount:0,amount:100000};
 const period:any={id:'period',accountId:'account',orderId:'order',sequence:1,serviceStageId:null,startDate:new Date('2026-01-15'),endDate:new Date('2026-02-15'),effectiveEndDate:new Date('2026-02-15'),status:'READY'};
 const version:any={id:'addon-v1',productId:'addon',version:1,kind:'MILEAGE_PACK',name:'月包',scopePrices:[{id:'scope',scopes:[{brand:'蔚来',allModels:false,modelDefinitionIds:['model']}],prices:[{km:1000,amount:100000},{km:1500,amount:140000},{km:2000,amount:180000}]}]};version.sourceHash=versionHash(version);
 const quote={km:1000,amount:100000,quoteId:'scope:1000',currency:'CNY'},expiresAt='2026-02-14T16:00:00.000Z';
 const p:any={id:'purchase',ruleVersion:'MILEAGE_PACK_V2',productVersion:1,accountId:'account',orderId:'order',customerId:'customer',billId:'bill',applicablePeriodId:'period',applicableFromSequence:1,serviceStageId:null,assignmentId:'assignment',modelDefinitionId:'model',addonVersionId:'addon-v1',sourceHash:version.sourceHash,expiresAt:new Date(expiresAt),createdAt:new Date('2026-01-15T00:00:00Z'),km:1000,amount:100000,remainingKm:0,status:'PENDING_PAYMENT',sourcePaymentId:null,paidAt:null,termsSnapshot:{...addonTerms('MILEAGE_PACK'),accepted:true},pricingSnapshot:{version:2,source:versionSource(version),quote,versionId:'addon-v1',productId:'addon',productVersion:1,sourceHash:version.sourceHash,periodId:'period',assignmentId:'assignment',modelDefinitionId:'model',brand:'蔚来',serviceStageId:null,expiresAt}};
 const payment:any={id:'payment',billId:'bill',customerId:'customer',amount:100000,status:'PENDING',bill};
 const ledger:any[]=[],updates:any[]=[];let physical:any=null;
 const tx:any={
  $queryRaw:async()=>[],order:{findUnique:async()=>order,findUniqueOrThrow:async()=>order,update:async()=>order,updateMany:async(args:any)=>{updates.push(args);return{count:0};}},
  usageAccount:{findUnique:async()=>account,update:async()=>account},usagePeriod:{findUnique:async()=>period},
  mileagePurchase:{findUnique:async()=>p,findUniqueOrThrow:async()=>p,update:async({data}:any)=>Object.assign(p,data),findMany:async()=>p.status==='ACTIVE'?[p]:[]},
  mileageLedger:{create:async({data}:any)=>{assert.equal(ledger.some(l=>l.sourceKey===data.sourceKey),false);ledger.push(data);return data;},findMany:async()=>ledger,count:async({where}:any)=>ledger.filter(l=>(!where.type||where.type===l.type)&&(!where.sourceKey||where.sourceKey===l.sourceKey)).length},
  vehicleAssignment:{findUnique:async()=>({id:'assignment',orderId:'order',customerId:'customer',vehicle:{modelDefinitionId:'model'}})},modelDefinition:{findUnique:async()=>({id:'model',brand:'蔚来'})},vehicleReceiptEvent:{findFirst:async()=>physical},
  bill:{update:async({data}:any)=>Object.assign(bill,data),findUniqueOrThrow:async()=>bill},payment:{findUnique:async()=>payment,update:async({data}:any)=>Object.assign(payment,data)},
  auditLog:{create:async({data}:any)=>data},notification:{create:async()=>({})},returnSettlement:{updateMany:async(args:any)=>{updates.push(args);return{count:0};}},serviceObligation:{findFirst:async()=>null},
 };
 return{tx,account,order,bill,period,p,payment,ledger,updates,setPhysical:(v:any)=>{physical=v;},service:(at:Date)=>new BillingService({serial:(f:any)=>f(tx)} as any,{} as any,()=>at)};
}
test('trusted late notification grants only original unclosed month; duplicate is one grant',async()=>{
 const f=fixture(),service=f.service(new Date('2026-02-16T00:00:00Z')),event={status:'SUCCEEDED' as const,amount:100000,transactionId:'channel',succeededAt:'2026-02-14T15:59:59Z'};
 await service.settle('payment',event);await service.settle('payment',event);
 assert.equal(f.payment.status,'SUCCEEDED');assert.equal(f.payment.reconciliationRequired,false);assert.equal(f.p.remainingKm,1000);assert.equal(f.ledger.length,1);assert.equal(f.ledger[0].periodId,'period');
});
test('late success, settled month, returned vehicle and invalid frozen source keep money without quota',async()=>{
 for(const mode of ['LATE','SETTLED','RETURNED','TAMPER','VOID']){
  const f=fixture();if(mode==='SETTLED')f.period.status='SETTLED';if(mode==='RETURNED')f.setPhysical({id:'receipt'});if(mode==='TAMPER')f.p.pricingSnapshot.quote.amount=1;if(mode==='VOID'){f.p.status='VOID';f.bill.status='VOID';}
  await f.service(new Date('2026-02-16T00:00:00Z')).settle('payment',{status:'SUCCEEDED',amount:100000,transactionId:'channel',succeededAt:mode==='LATE'?'2026-02-14T16:00:00Z':'2026-02-14T15:59:59Z'});
  assert.equal(f.payment.status,'SUCCEEDED',mode);assert.equal(f.payment.reconciliationRequired,true,mode);assert.equal(f.p.remainingKm,0,mode);assert.equal(f.ledger.length,0,mode);
 }
});
test('month boundary blocks new pay; expiry after settlement records one unique remainder event',async()=>{
 const f=fixture();await assert.rejects(guardPackPayment(f.tx,f.bill,new Date('2026-02-14T16:00:00Z')));
 f.p.status='ACTIVE';f.p.remainingKm=456;await expireMonthlyPeriodPacks(f.tx,f.account,'period');await expireMonthlyPeriodPacks(f.tx,f.account,'period');
 assert.equal(f.p.remainingKm,0);assert.equal(f.p.status,'EXPIRED');assert.equal(f.ledger.length,1);assert.equal(f.ledger[0].deltaKm,-456);
});
test('unissued anomalous V2 receipt follows approved full refund with zero quota entry',async()=>{
 const f=fixture();f.p.status='VOID';f.payment.status='SUCCEEDED';f.payment.reconciliationRequired=true;f.payment.providerTransactionId='channel';
 await guardPackRefund(f.tx,f.payment,100000,true);assert.equal(f.p.status,'REFUND_PENDING');
 await settlePackRefund(f.tx,{id:'refund',payment:f.payment,paymentId:'payment',customerId:'customer',amount:100000});assert.equal(f.p.status,'REFUNDED');assert.equal(f.ledger[0].deltaKm,0);
});
test('provider request created across month boundary is retained but client pay parameters are withheld',async()=>{
 const f=fixture();let now=new Date('2026-02-14T15:59:59Z');
 f.tx.bill.findFirst=async()=>f.bill;f.tx.orderChange={findFirst:async()=>null};
 f.tx.payment.findUnique=async({where}:any)=>where.customerId_idempotencyKey?null:f.payment;
 f.tx.payment.findUniqueOrThrow=async()=>f.payment;f.tx.payment.findFirst=async()=>null;
 f.tx.payment.create=async({data}:any)=>Object.assign(f.payment,data,{status:'CREATING'});
 f.tx.payment.updateMany=async({data}:any)=>{Object.assign(f.payment,data);return{count:1};};
 const service=new BillingService({serial:(work:any)=>work(f.tx),payment:f.tx.payment} as any,{create:async()=>{now=new Date('2026-02-14T16:00:00Z');return{timeStamp:'123',package:'provider-request'};}} as any,()=>now);
 await assert.rejects(service.pay({id:'customer',openId:'openid'},'bill','payment-key'),(e:any)=>e.getResponse().error.code==='PACK_NOT_PAYABLE');
 assert.equal(f.payment.status,'PENDING');assert.equal(f.payment.clientParameters.package,'provider-request');assert.equal(f.p.remainingKm,0);
});
test('historical V1 pending bill retains original consent and subscription grant semantics',async()=>{
 const f=fixture(),content='已确认的旧订阅期里程包说明';f.p.ruleVersion='MILEAGE_PACK_V1';f.p.termsSnapshot={version:'MILEAGE_PACK_V1',documentId:'document',documentVersion:1,hash:hash(content),accepted:true};
 f.tx.legalDocument={findUnique:async()=>({id:'document',type:'mileage-pack',version:1,confirmedAt:new Date(),content})};
 await f.service(new Date('2026-02-16T00:00:00Z')).settle('payment',{status:'SUCCEEDED',amount:100000,transactionId:'channel'});
 assert.equal(f.payment.status,'SUCCEEDED');assert.equal(f.payment.reconciliationRequired,false);assert.equal(f.p.remainingKm,1000);assert.equal(f.ledger[0].periodId,undefined);
});
test('V2 extra trusted receipt on completed return reopens review once without changing original quota',async()=>{
 const f=fixture();Object.assign(f.order,{status:'COMPLETED'});Object.assign(f.bill,{status:'PAID',paidAmount:100000});Object.assign(f.p,{status:'EXPIRED',paidAt:new Date('2026-01-20'),sourcePaymentId:'original-payment'});
 let reopened=0;f.tx.returnSettlement.updateMany=async()=>{reopened++;return{count:1};};f.tx.order.updateMany=async({where,data}:any)=>{if(where.status===f.order.status){Object.assign(f.order,data);return{count:1};}return{count:0};};
 const service=f.service(new Date('2026-02-16T00:00:00Z')),event={status:'SUCCEEDED' as const,amount:100000,transactionId:'extra-channel',succeededAt:'2026-02-14T15:59:59Z'};
 await service.settle('payment',event);await service.settle('payment',event);
 assert.equal(f.order.status,'SETTLING');assert.equal(reopened,1);assert.equal(f.payment.reconciliationRequired,true);assert.equal(f.p.sourcePaymentId,'original-payment');assert.equal(f.ledger.length,0);
});
test('late first monthly receipt projects real paid bill and payment review instead of raw pending purchase',async()=>{
 const f=fixture(),now=new Date('2026-02-16T00:00:00Z');
 await f.service(now).settle('payment',{status:'SUCCEEDED',amount:100000,transactionId:'private-channel-id',succeededAt:'2026-02-14T16:00:00Z'});
 const view=mileagePackView(f.p,{...f.bill,payments:[{...f.payment,refunds:[]}]},now,undefined,true);
 assert.equal(f.p.status,'PENDING_PAYMENT');assert.equal(view.status,'PENDING_PAYMENT');assert.equal(view.effectiveStatus,'PAYMENT_REVIEW');assert.equal(view.bill.status,'PAID');assert.equal(view.paymentReview.required,true);assert.equal(view.paymentReview.reason,'MILEAGE_MONTH_CLOSED');assert.equal(view.paymentFacts.receivedAmount,100000);assert.equal(view.canPay,false);assert.equal(view.remainingKm,0);
 assert.equal(JSON.stringify(view).includes('private-channel-id'),false);
});
test('second monthly receipt projects unresolved extra cash without hiding or refreezing original paid quota',async()=>{
 const f=fixture(),now=new Date('2026-01-20T02:00:00Z');Object.assign(f.bill,{status:'PAID',paidAmount:100000});Object.assign(f.p,{status:'ACTIVE',paidAt:new Date('2026-01-16'),sourcePaymentId:'original-payment',remainingKm:1000});
 const original={id:'original-payment',billId:'bill',customerId:'customer',status:'SUCCEEDED',amount:100000,providerTransactionId:'original-private',reconciliationRequired:false,refunds:[]};
 await f.service(now).settle('payment',{status:'SUCCEEDED',amount:100000,transactionId:'extra-private',succeededAt:'2026-01-20T01:59:59Z'});
 const view=mileagePackView(f.p,{...f.bill,payments:[original,{...f.payment,refunds:[]}]},now,'period',true);
 assert.equal(view.effectiveStatus,'ACTIVE');assert.equal(view.paymentReview.required,true);assert.equal(view.paymentReview.unresolvedReceiptCount,1);assert.equal(view.paymentFacts.receiptCount,2);assert.equal(view.paymentFacts.receivedAmount,200000);assert.equal(view.bill.paidAmount,100000);assert.equal(view.canPay,false);assert.equal(view.remainingKm,1000);assert.equal(view.canUseNow,true);
 const afterExtraRefund=mileagePackView(f.p,{...f.bill,payments:[original,{...f.payment,refunds:[{paymentId:f.payment.id,customerId:'customer',amount:100000,status:'SUCCEEDED',providerRefundId:'extra-refund-private'}]}]},now,'period',true);
 assert.equal(afterExtraRefund.effectiveStatus,'ACTIVE');assert.equal(afterExtraRefund.paymentReview.required,false);assert.equal(afterExtraRefund.paymentFacts.netReceivedAmount,100000);assert.equal(afterExtraRefund.remainingKm,1000);assert.equal(afterExtraRefund.canUseNow,true);
});
test('monthly paid review projection follows trusted actual refund and never relies on original pending bill cache',async()=>{
 const f=fixture(),now=new Date('2026-02-16T00:00:00Z');await f.service(now).settle('payment',{status:'SUCCEEDED',amount:100000,transactionId:'late-private',succeededAt:'2026-02-14T16:00:00Z'});
 await guardPackRefund(f.tx,f.payment,100000,true);
 const refund={id:'refund',paymentId:'payment',customerId:'customer',amount:100000,status:'PROCESSING',providerRefundId:null};
 let view=mileagePackView(f.p,{...f.bill,payments:[{...f.payment,refunds:[refund]}]},now,undefined,false);assert.equal(view.effectiveStatus,'REFUND_PENDING');assert.equal(view.paymentFacts.pendingRefundCount,1);assert.equal(view.paymentFacts.refundedAmount,0);
 Object.assign(refund,{status:'SUCCEEDED',providerRefundId:'private-refund'});await settlePackRefund(f.tx,{...refund,payment:f.payment});
 view=mileagePackView(f.p,{...f.bill,payments:[{...f.payment,refunds:[refund]}]},now,undefined,false);assert.equal(view.effectiveStatus,'REFUNDED');assert.equal(view.paymentReview.required,false);assert.equal(view.paymentFacts.refundedAmount,100000);assert.equal(view.paymentFacts.netReceivedAmount,0);assert.equal(view.canPay,false);assert.equal(JSON.stringify(view).includes('private-refund'),false);
});
test('old active V1 historical quota is preserved but unavailable after freeze, physical return or absent current service month',()=>{
 const f=fixture(),now=new Date('2026-01-20');Object.assign(f.p,{ruleVersion:'MILEAGE_PACK_V1',status:'ACTIVE',remainingKm:1000});Object.assign(f.bill,{status:'PAID',paidAmount:100000});
 const bill={...f.bill,payments:[{...f.payment,status:'SUCCEEDED',providerTransactionId:'old-private',refunds:[]}]};
 for(const [periodId,activeScope]of [['period',false],[undefined,true]] as const){const view=mileagePackView(f.p,bill,now,periodId,activeScope);assert.equal(view.status,'ACTIVE');assert.equal(view.effectiveStatus,'ACTIVE');assert.equal(view.remainingKm,1000);assert.equal(view.canUseNow,false);assert.equal(view.canPay,false);}
 assert.equal(mileagePackView(f.p,bill,now,'period',true).canUseNow,true);
});
test('monthly customer money projection rejects cross-bill sources and excludes foreign or unverified receipts',()=>{
 const f=fixture();assert.throws(()=>mileagePackView(f.p,{...f.bill,customerId:'other'},new Date('2026-01-20'),'period',true));
 const view=mileagePackView(f.p,{...f.bill,payments:[{...f.payment,status:'SUCCEEDED',providerTransactionId:'foreign',customerId:'other'},{...f.payment,status:'SUCCEEDED',providerTransactionId:'wrong-bill',billId:'other-bill'},{...f.payment,status:'SUCCEEDED'}]},new Date('2026-01-20'),'period',true);
 assert.equal(view.paymentFacts.receiptCount,0);assert.equal(view.paymentFacts.receivedAmount,0);assert.equal(view.effectiveStatus,'PENDING_PAYMENT');assert.equal(view.paymentReview.required,false);
});
