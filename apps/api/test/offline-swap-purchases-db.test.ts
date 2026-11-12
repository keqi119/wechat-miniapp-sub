import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {JourneyHarness,command} from './seven-module-journey-fixtures';
import {persistedOfflineSwapPurchase,persistedZeroGiftRenewalPurchase,offlineSwapPurchaseCoverage,payOfflineSwapPurchaseBill} from './offline-swap-purchases-fixture';
import {hash} from '../src/common/data';
import {canonicalHash} from '../src/customers/types';
import {snapshotProduct} from '../src/products/snapshot';
import {readEffectiveContractChain} from '../src/order-changes/agreement-readiness';

test('OFFLINE MVP actual HTTP purchase, exact-price verified payment, independent full refund and closed-payment late receipt', {skip:process.env.NODE_ENV!=='test'},async t=>{
 const h=new JourneyHarness(),saved={CUSTOMER_IDENTITY_POLICY:process.env.CUSTOMER_IDENTITY_POLICY,SWAP_CREDIT_PURCHASE_ENABLED:process.env.SWAP_CREDIT_PURCHASE_ENABLED};
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-31T04:00:00.000Z')});
 try{
  process.env.CUSTOMER_IDENTITY_POLICY='MANUAL_REVIEW';process.env.SWAP_CREDIT_PURCHASE_ENABLED='true';
  const f=await persistedOfflineSwapPurchase(h),customer=f.customer,root=`/customer/orders/${f.order.id}`,outsider=await h.customer('无权购买客户');
  const account=await h.get(root+'/swap-account',customer);
  assert.equal(process.env.MVP_V2_ENABLED,'true');assert.equal(account.canPurchase,true);assert.equal(account.canRequest,true);assert.equal(account.term.includedCount,0);assert.equal(account.term.available,0);assert.equal(account.product.amount,50000);assert.equal(account.purchaseTerms.version,'SWAP_CREDIT_V2');
  assert.equal(await h.db.swapCredit.count({where:{orderId:f.order.id}}),0);assert.equal(await h.db.orderChange.count({where:{orderId:f.order.id}}),0);
  const original=structuredClone((await h.db.order.findUniqueOrThrow({where:{id:f.order.id}})).finalPlanSnapshot);
  const purchaseInput=()=>({productId:account.product.id,pricingHash:account.product.pricingHash,termsVersion:account.purchaseTerms.version,termsDocumentId:account.purchaseTerms.documentId,termsDocumentVersion:account.purchaseTerms.documentVersion,termsHash:account.purchaseTerms.hash,accepted:true,idempotencyKey:randomUUID()});
  await h.reject(root+'/swap-credits',purchaseInput(),outsider,'NOT_FOUND');
  await h.reject(root+'/swap-credits',{...purchaseInput(),termsHash:'f'.repeat(64)},customer,'SWAP_PURCHASE_CONSENT');
  await h.reject(root+'/swap-credits',{...purchaseInput(),pricingHash:'f'.repeat(64)},customer,'SWAP_PURCHASE_PRICE');
  assert.equal(await h.db.swapCreditPurchase.count({where:{orderId:f.order.id}}),0);
  const input=purchaseInput(),results=await Promise.all([h.post(root+'/swap-credits',input,customer),h.post(root+'/swap-credits',input,customer)]),first=results[0];
  assert.equal(results[1].purchase.id,first.purchase.id);assert.equal(await h.db.swapCreditPurchase.count({where:{orderId:f.order.id}}),1);assert.equal(await h.db.bill.count({where:{orderId:f.order.id,type:'SWAP_CREDIT'}}),1);
  assert.equal(first.purchase.canPay,true);assert.equal(first.bill.amount,50000);assert.equal(first.purchase.expiresOn,'2027-09-30');assert.equal(await h.db.swapCredit.count({where:{orderId:f.order.id}}),0);
  const payInput={idempotencyKey:randomUUID()},pay=await h.post(`/customer/bills/${first.bill.id}/pay`,payInput,customer),cached=await h.post(`/customer/bills/${first.bill.id}/pay`,payInput,customer);
  assert.equal(pay.paymentId,cached.paymentId);assert.equal(await h.db.payment.count({where:{billId:first.bill.id}}),1);assert.equal(await h.db.swapCredit.count({where:{orderId:f.order.id}}),0);
  h.payment.capture(pay.paymentId);await h.post(`/admin/payments/${pay.paymentId}/sync`,{},h.finance);await h.post(`/admin/payments/${pay.paymentId}/sync`,{},h.finance);
  const paid=await h.get('/customer/swap-credit-purchases/'+first.purchase.id,customer),stored=await h.db.swapCreditPurchase.findUniqueOrThrow({where:{id:first.purchase.id}});
  assert.equal(paid.status,'ACTIVE');assert.equal(paid.bill.status,'PAID');assert.equal(paid.bill.paidAmount,50000);assert.equal(paid.amount,50000);assert.equal(stored.expiresAt.toISOString(),'2027-09-30T16:00:00.000Z');
  assert.equal(await h.db.swapCredit.count({where:{orderId:f.order.id,source:'PAID'}}),1);assert.equal(await h.db.swapCredit.count({where:{orderId:f.order.id,source:'FREE'}}),0);assert.equal(await h.db.swapLedger.count({where:{sourceKey:'grant:'+pay.paymentId}}),1);
  const refundable={paymentId:pay.paymentId,amount:50000,reason:'仅合成未使用次数例外全额退款',idempotencyKey:randomUUID()};
  await h.reject('/admin/refunds',{...refundable,amount:25000},h.finance,'SWAP_REFUND_REVIEW');
  const refund=await h.post('/admin/refunds',refundable,h.finance);assert.equal(refund.status,'PENDING_APPROVAL');
  assert.equal((await h.post('/admin/refunds',refundable,h.finance)).id,refund.id);await h.reject('/admin/refunds/'+refund.id+'/approve',{},h.finance,'DUAL_APPROVAL');
  assert.equal((await h.get('/customer/swap-credit-purchases/'+first.purchase.id,customer)).status,'REFUND_PENDING');
  await h.post('/admin/refunds/'+refund.id+'/approve',{},h.reviewer);await h.post('/admin/refunds/'+refund.id+'/sync',{},h.finance);
  assert.equal((await h.db.refund.findUniqueOrThrow({where:{id:refund.id}})).amount,50000);assert.equal((await h.db.refund.findUniqueOrThrow({where:{id:refund.id}})).status,'SUCCEEDED');assert.equal((await h.get('/customer/swap-credit-purchases/'+first.purchase.id,customer)).status,'REFUNDED');
  assert.equal(await h.db.swapLedger.count({where:{sourceKey:'swap-refund:'+refund.id}}),1);

  const second=await h.post(root+'/swap-credits',purchaseInput(),customer),latePay=await h.post(`/customer/bills/${second.bill.id}/pay`,{idempotencyKey:randomUUID()},customer);
  await h.post(`/customer/swap-credit-purchases/${second.purchase.id}/close`,{idempotencyKey:randomUUID()},customer);
  assert.equal((await h.db.payment.findUniqueOrThrow({where:{id:latePay.paymentId}})).status,'CLOSED');assert.equal((await h.db.swapCreditPurchase.findUniqueOrThrow({where:{id:second.purchase.id}})).status,'VOID');
  process.env.SWAP_CREDIT_PURCHASE_ENABLED='false';const blocked=await h.raw(root+'/swap-credits',purchaseInput(),customer);assert.equal(blocked.status,503);assert.equal(blocked.data.error.code,'SWAP_PURCHASE_DISABLED');
  h.payment.capture(latePay.paymentId);await h.post(`/admin/payments/${latePay.paymentId}/sync`,{},h.finance);await h.post(`/admin/payments/${latePay.paymentId}/sync`,{},h.finance);
  const late=await h.get('/customer/swap-credit-purchases/'+second.purchase.id,customer),lateRecord=await h.db.payment.findUniqueOrThrow({where:{id:latePay.paymentId}});
  assert.equal(lateRecord.status,'SUCCEEDED');assert.ok(lateRecord.providerTransactionId);assert.equal(late.status,'PAYMENT_REVIEW');assert.equal(late.amount,50000);assert.equal(late.expiresOn,'2027-09-30');assert.equal(late.usable,false);assert.equal((await h.db.swapCredit.findUniqueOrThrow({where:{id:late.creditId}})).status,'FROZEN');
  assert.equal(await h.db.swapLedger.count({where:{sourceKey:'grant:'+latePay.paymentId}}),1);
  const lateRefund=await h.post('/admin/refunds',{paymentId:latePay.paymentId,amount:50000,reason:'关闭后可信迟到款全额例外退款',idempotencyKey:randomUUID()},h.finance);await h.post('/admin/refunds/'+lateRefund.id+'/approve',{},h.reviewer);
  assert.equal((await h.get('/customer/swap-credit-purchases/'+second.purchase.id,customer)).status,'REFUNDED');assert.equal((await h.get(root+'/swap-account',customer)).canPurchase,false);
  assert.deepEqual((await h.db.order.findUniqueOrThrow({where:{id:f.order.id}})).finalPlanSnapshot,original);assert.equal(await h.db.orderChange.count({where:{orderId:f.order.id}}),0);assert.equal(await h.db.swapCredit.count({where:{orderId:f.order.id,source:'FREE'}}),0);
  assert.equal(h.esignCalls,0);assert.equal(h.externalCalls,0);assert.equal(h.identityCalls,0);
 }finally{await h.close();for(const [key,value]of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});

test('new own-stage PAID credit is reserved by real strict quote and consumed exactly once by archived FIELD delivery; upgrade is a separate bill',{skip:process.env.NODE_ENV!=='test'},async t=>{
 const h=new JourneyHarness(),saved={CUSTOMER_IDENTITY_POLICY:process.env.CUSTOMER_IDENTITY_POLICY,SWAP_CREDIT_PURCHASE_ENABLED:process.env.SWAP_CREDIT_PURCHASE_ENABLED};
 try{
  process.env.CUSTOMER_IDENTITY_POLICY='MANUAL_REVIEW';process.env.SWAP_CREDIT_PURCHASE_ENABLED='true';
  const f=await persistedZeroGiftRenewalPurchase(h),{customer,owner,order,account,assignment,stageId,stage,terms:baseTerms}=f;
  const expiresAt=new Date('2099-01-01');await h.db.adminSession.updateMany({where:{adminId:{in:[h.maker.id,h.reviewer.id,h.finance.id,h.field.id]}},data:{expiresAt}});await h.db.customerSession.updateMany({where:{customerId:customer.id},data:{expiresAt}});
  t.mock.timers.enable({apis:['Date'],now:new Date('2027-10-31T04:00:00Z')});
  const accountPath=`/customer/orders/${order.id}/swap-account`,rights=await h.get(accountPath,customer);
  assert.equal(rights.serviceStageId,stageId);assert.equal(rights.term.includedCount,0);assert.equal(rights.term.available,0);assert.equal(rights.product.amount,55000);assert.equal(f.snapshot.productSnapshot.swapPolicy.extraFeeAmount,50000);
  const purchaseBody={productId:rights.product.id,pricingHash:rights.product.pricingHash,termsVersion:rights.purchaseTerms.version,termsDocumentId:rights.purchaseTerms.documentId,termsDocumentVersion:rights.purchaseTerms.documentVersion,termsHash:rights.purchaseTerms.hash,accepted:true,idempotencyKey:randomUUID()};
  const purchase=await h.post(`/customer/orders/${order.id}/swap-credits`,purchaseBody,customer),paid=await payOfflineSwapPurchaseBill(h,customer,purchase.bill.id);
  const storedPurchase=await h.db.swapCreditPurchase.findUniqueOrThrow({where:{id:purchase.purchase.id}}),creditId=storedPurchase.creditId!;
  assert.equal(storedPurchase.amount,55000);assert.equal(storedPurchase.serviceStageId,stageId);assert.equal(storedPurchase.expiresAt.toISOString(),'2028-09-30T16:00:00.000Z');assert.equal(await h.db.swapCredit.count({where:{orderId:order.id,source:'FREE'}}),0);assert.equal((await h.get(accountPath,customer)).paidAvailable,1);

  const model=await h.db.modelDefinition.create({data:{brand:'合成',name:'付费次数消费换入车型'}}),target=await h.db.vehicle.create({data:{brand:'合成',model:'EV',title:'付费次数升级换入车',modelDefinitionId:model.id,vin:'L'+randomUUID().replaceAll('-','').slice(0,16).toUpperCase(),year:2026,city:'上海',mileageKm:200,status:'PUBLISHED'}});
  const proof=await h.proof(h.maker,'contract');await h.post(`/admin/partners/${owner.id}/agreements`,{...command(),status:'ACTIVE',title:'换入车本服务段完整合作范围',fileIds:[proof.id],partnerRateBps:8000,vehicleIds:[target.id],validFrom:'2027-10-30',validUntil:'2028-09-30'});
  await offlineSwapPurchaseCoverage(h,target.id,model.id,owner.name);
  const pd=await h.post('/admin/products',{configurationVersion:2,name:'付费次数升级目标',months:12,baseFeeAmount:28000,mileageMonthlyFeeAmount:2000,mileagePerMonthKm:900,excessMileagePriceAmount:999,swapPolicy:{version:2,period:'TERM',includedCount:99,extraFeeAmount:99000},conditions:'目标商品不改变原段次数与里程政策',vehicleIds:[target.id],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'}],...command()}),product=await h.post(`/admin/products/${pd.productId}/publish`,{...command(pd.revision),versionId:pd.id}),plan=await h.publishGoods(target.id,product.id),source=await h.db.serial(tx=>snapshotProduct(tx,plan.id));
  const context=await h.get(`/admin/orders/${order.id}/vehicle-change-context`);assert.equal(context.canCreate,true,JSON.stringify(context.blockers));
  const create={expectedOrderRevision:context.orderRevision,priorTermsHash:context.priorTermsHash,reason:'客户使用本段真实购买次数升级',idempotencyKey:randomUUID()},createPath=`/admin/orders/${order.id}/vehicle-changes`;
  const created=await Promise.all([h.post(createPath,create),h.post(createPath,create)]),change=created[0];assert.equal(created[1].id,change.id);assert.equal(await h.db.orderChange.count({where:{orderId:order.id,kind:'VEHICLE_CHANGE'}}),1);
  const actualChange=await h.db.orderChange.findUniqueOrThrow({where:{id:change.id}});assert.equal(actualChange.priorTermsVersionId,baseTerms.id);assert.equal(actualChange.priorTermsHash,hash(baseTerms.snapshot));assert.deepEqual(actualChange.priorTerms,baseTerms.snapshot);
  const path=`/admin/order-changes/${change.id}`,targets=await h.get(path+'/offline/targets?keyword='+encodeURIComponent(target.vin!)+'&page=1&pageSize=20'),selected=targets.items.find((row:any)=>row.targetListingId===source.listingId);assert.ok(selected);assert.equal(selected.targetSourceHash,source.sourceHash);
  const input={revision:change.revision,pricingVersion:2,targetListingId:selected.targetListingId,targetListingRevision:selected.targetListingRevision,targetSourceHash:selected.targetSourceHash,plannedReturnAt:'2027-10-30T09:00:00+08:00',plannedDeliveryAt:'2027-10-30T10:00:00+08:00',depositAmount:0,depositBasis:'原押金不变为零',insuranceResponsibility:'实际目标车保障责任',downtimeArrangement:'当天交接安排',settlementExplanation:'额外次数550元已独立购买；升级差价另按剩余原期限计价',handoverArrangement:'分别确认两侧实际查验',cancellationTerms:'沿用本补充协议约定',reason:'同服务段升级',expiresAt:'2099-12-31T00:00:00Z',externalCompensationRequired:false};
  const beforePreview=(await h.db.order.findUniqueOrThrow({where:{id:order.id}})).revision,preview=await h.post(path+'/offline/quote-preview',input);
  assert.equal(preview.serviceStageScope.serviceStageId,stageId);assert.equal(preview.periods[0].sequence,13);assert.equal(preview.periods[0].amount,20645);assert.equal((await h.db.order.findUniqueOrThrow({where:{id:order.id}})).revision,beforePreview);assert.equal(await h.db.swapReservation.count({where:{changeId:change.id}}),0,'read preview does not reserve');
  const quoteInput={...input,previewHash:preview.previewHash,idempotencyKey:randomUUID()};let view=await h.post(path+'/offline/quotes',quoteInput);const quoteId=view.quote.id;
  assert.equal((await h.post(path+'/offline/quotes',quoteInput)).quote.id,quoteId);assert.equal(view.quote.periods[0].amount,20645);assert.equal(view.quote.pricingHash,canonicalHash(view.quote.pricing));
  // Required quoted capacity must be real, not fabricated here or deferred to consumption.
  const reserved=await h.db.swapReservation.findMany({where:{changeId:change.id,status:'RESERVED'}});assert.equal(reserved.length,1);assert.equal(reserved[0].creditId,creditId);assert.equal(await h.db.swapLedger.count({where:{creditId,type:'RESERVE'}}),1);assert.equal(await h.db.swapLedger.count({where:{creditId,type:'CONSUME'}}),0);
  const reservedView=await h.get(accountPath,customer);assert.equal(reservedView.paidAvailable,0);assert.equal(reservedView.paidReserved,1);
  await h.reject('/admin/refunds',{paymentId:paid.id,amount:55000,reason:'预占后不得退款',idempotencyKey:randomUUID()},h.finance,'CHANGE_REFUND_MANAGED');
  view=await h.post(path+'/review',{...command(view.revision),decision:'APPROVED',note:'独立核清额外次数费和本期645分升级补差'},h.finance);view=await h.post(path+'/publish',command(view.revision));view=await h.post('/customer/order-changes/'+change.id+'/confirm',{...command(view.revision),commercialHash:view.quote.commercialHash},customer);
  const amendment=await h.archive('ORDER_AMENDMENT','ORDER_CHANGE_QUOTE',quoteId);view=await h.get(path);await h.post(path+'/prepare-finance',command(view.revision),h.finance);
  const obligation=await h.db.serviceObligation.findUniqueOrThrow({where:{quoteId_sequence:{quoteId,sequence:13}}});assert.equal(obligation.chargeAmount,645);assert.ok(obligation.chargeBillId);assert.notEqual(obligation.chargeBillId,purchase.bill.id);
  const upgrade=await payOfflineSwapPurchaseBill(h,customer,obligation.chargeBillId);assert.equal(upgrade.amount,645);assert.equal((await h.db.bill.findUniqueOrThrow({where:{id:upgrade.billId}})).type,'SWAP_ADJUSTMENT');assert.equal((await h.db.bill.findUniqueOrThrow({where:{id:purchase.bill.id}})).amount,55000);
  assert.equal((await h.get(path)).canCreateReturn,true);
  const makeSide=async(side:'RETURN'|'DELIVERY',actualAt:string,readingKm:number)=>{
   let task=await h.post('/admin/handover-tasks',{orderId:order.id,changeId:change.id,type:'SWAP_'+side,assigneeId:h.field.id,note:'购买次数完整真实现场链'});
   const uploaded=await h.post(`/admin/field-tasks/${task.id}/files`,h.form({version:task.version},'paid-swap-'+side,true),h.field);task=uploaded.task;
   task=await h.post(`/admin/field-tasks/${task.id}/draft`,{version:task.version,draft:{actualAt,readingKm,batteryPercent:80,place:'合成本地查验场所',accessories:'钥匙齐全',condition:'现场查验',openItems:'无',resolutionPlan:'无',fileIds:[uploaded.id]}},h.field);
   task=await h.post(`/admin/field-tasks/${task.id}/publish`,{version:task.version,idempotencyKey:randomUUID(),checked:true},h.field);
   const fact=await h.get('/customer/handovers/'+task.handover.id,customer);await h.post('/customer/handovers/'+fact.id+'/confirm',{manifestHash:fact.manifestHash,readFileIds:fact.fileIds,fileIds:[],reason:'',idempotencyKey:randomUUID()},customer);
   await h.reject('/admin/handovers/'+fact.id+'/complete',command(fact.revision),h.maker,'OFFLINE_ARCHIVE_REQUIRED');await h.archive(side==='RETURN'?'RETURN_RECEIPT':'DELIVERY_RECEIPT','HANDOVER',fact.id,undefined,{id:task.id,version:task.version});return{task,fact};
  };
  const returned=await makeSide('RETURN',input.plannedReturnAt,300);await h.post('/admin/handovers/'+returned.fact.id+'/complete',command(returned.fact.revision));
  assert.equal((await h.db.vehicleAssignment.findUniqueOrThrow({where:{id:assignment.id}})).status,'CLOSED');assert.equal((await h.db.usageAccount.findUniqueOrThrow({where:{id:account.id}})).returnedOn,null);assert.equal(await h.db.swapLedger.count({where:{creditId,type:'CONSUME'}}),0);assert.equal(await h.db.swapReservation.count({where:{changeId:change.id,creditId,status:'RESERVED'}}),1);
  const incoming=await makeSide('DELIVERY',input.plannedDeliveryAt,250),complete=command(incoming.fact.revision);const results=await Promise.all([h.post('/admin/handovers/'+incoming.fact.id+'/complete',complete),h.post('/admin/handovers/'+incoming.fact.id+'/complete',complete)]);assert.equal(results[0].id,results[1].id);
  const credit=await h.db.swapCredit.findUniqueOrThrow({where:{id:creditId}}),afterPurchase=await h.db.swapCreditPurchase.findUniqueOrThrow({where:{id:storedPurchase.id}}),final=await h.db.order.findUniqueOrThrow({where:{id:order.id}}),terms=await h.db.orderTermsVersion.findUniqueOrThrow({where:{id:final.effectiveTermsVersionId!}});
  assert.equal(credit.consumedChangeId,change.id);assert.equal(afterPurchase.status,'CONSUMED');assert.equal(afterPurchase.amount,55000);assert.deepEqual(afterPurchase.pricingSnapshot,storedPurchase.pricingSnapshot);assert.equal(afterPurchase.expiresAt.getTime(),storedPurchase.expiresAt.getTime());assert.equal(afterPurchase.serviceStageId,stageId);
  assert.equal(await h.db.swapLedger.count({where:{creditId,type:'GRANT'}}),1);assert.equal(await h.db.swapLedger.count({where:{creditId,type:'RESERVE'}}),1);assert.equal(await h.db.swapLedger.count({where:{creditId,type:'CONSUME'}}),1);assert.equal(await h.db.swapReservation.count({where:{creditId,changeId:change.id,status:'CONSUMED'}}),1);assert.equal(await h.db.swapCredit.count({where:{orderId:order.id,source:'FREE'}}),0);
  assert.equal(final.vehicleId,target.id);assert.equal(terms.offlineArchiveVersionId,amendment.versionId);assert.equal((await h.db.fieldHandoverTask.findUniqueOrThrow({where:{id:incoming.task.id}})).status,'COMPLETED');assert.equal((await h.get(path)).status,'APPLIED');assert.equal((await h.get(accountPath,customer)).paidConsumed,1);
  assert.deepEqual(final.finalPlanSnapshot,f.snapshot);assert.deepEqual((terms.snapshot as any).usagePolicy,(baseTerms.snapshot as any).usagePolicy);assert.deepEqual((terms.snapshot as any).productSnapshot,(baseTerms.snapshot as any).productSnapshot);assert.equal((terms.snapshot as any).currentVehicleProductSnapshot.productVersionId,product.id);assert.deepEqual((await h.db.orderServiceStage.findUniqueOrThrow({where:{id:stageId}})).snapshot,stage.snapshot);assert.equal((await readEffectiveContractChain(h.db,order.id)).ready,true);
  await h.reject('/admin/refunds',{paymentId:paid.id,amount:55000,reason:'已实际消费不得退款',idempotencyKey:randomUUID()},h.finance,'SWAP_REFUND_REVIEW');assert.equal(h.esignCalls,0);assert.equal(h.identityCalls,0);assert.equal(h.externalCalls,0);
 }finally{await h.close();for(const[key,value]of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
