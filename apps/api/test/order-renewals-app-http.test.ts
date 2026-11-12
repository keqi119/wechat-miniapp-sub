import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomInt} from 'node:crypto';
import {JourneyHarness,command,type Login} from './seven-module-journey-fixtures';
import {prepareRenewalCancellationDbFixture} from './order-renewals-cancellation-db-fixture';
import type {OrderRenewalsService} from '../src/order-renewals/service';

/** Full createApp routing/auth/transactions. Only external provider transports are local. */
test('production App exposes renewal creation, cancellation and finance-only late recovery through authenticated HTTP',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const h=new JourneyHarness(),policy=process.env.CUSTOMER_IDENTITY_POLICY;
 try{
  process.env.CUSTOMER_IDENTITY_POLICY='MANUAL_REVIEW';await h.start();
  const registered=await h.raw('/admin/order-renewals?page=1&pageSize=1');
  assert.equal(registered.status,200,'OrderRenewalsController must be registered in actual createApp');
  assert.ok(Array.isArray(registered.data.items));
  let customerLogin:Login|undefined;
  const originalCustomer=h.customer.bind(h);h.customer=async label=>{const customer=await originalCustomer(label);if(!customerLogin)customerLogin=customer;return customer;};
  const staff=(actor:any)=>actor.id===h.finance.id?h.finance:actor.id===h.reviewer.id?h.reviewer:h.maker;
  const f=await prepareRenewalCancellationDbFixture(h,()=>({
   preview:(id:string,body:any,actor:any,changeId?:string)=>h.post(`/admin/orders/${id}/renewals/preview${changeId?'?changeId='+changeId:''}`,body,staff(actor)),
   create:(id:string,body:any,actor:any)=>h.post(`/admin/orders/${id}/renewals`,body,staff(actor)),
   act:(id:string,action:string,body:any,actor:any)=>h.post(`/admin/order-renewals/${id}/${action}`,body,staff(actor)),
   customerAct:(id:string,action:string,body:any,customerId:string)=>{assert.equal(customerLogin?.id,customerId);return h.post(`/customer/order-renewals/${id}/${action}`,body,customerLogin);},
  } as unknown as OrderRenewalsService),{historicalOwnerSharing:true});
  const{order,changeId,quote,customer,account,assignment}=f,root=`/admin/order-renewals/${changeId}`;
  const stranger=await h.customer('续期越权客户');
  const partnerMobile=`139${randomInt(10000000,99999999)}`,companyPath=`/admin/partners/${f.owner.id}/company-admin`,company=await h.get(companyPath);
  const invitation=await h.post(`${companyPath}/invitation`,{...command(company.revision),mobile:partnerMobile,displayName:'四入口合成只读管理员'}),anonymous={id:'anonymous',headers:{Origin:h.origin}};
  const invitationPreview=await h.post('/owner-h5/auth/invitation/preview',{mobile:partnerMobile,invitationCode:invitation.invitationCode},anonymous);
  await h.post('/owner-h5/auth/invitation/confirm',{previewToken:invitationPreview.previewToken,consents:['terms','privacy'].map(type=>({documentId:h.docs[type].id,version:h.docs[type].version}))},anonymous);
  const partner=await h.ownerLogin(partnerMobile),partnerPath=`/owner-h5/owners/${f.owner.id}/orders/${order.id}/workspace`;
  const partnerBefore=await h.get(partnerPath,partner),fieldTasks=await h.db.fieldHandoverTask.count({where:{orderId:order.id}});
  await h.reject(`/customer/order-renewals/${changeId}`,undefined,stranger,'NOT_FOUND');
  const customerView=await h.get(`/customer/order-renewals/${changeId}`,customer);assert.equal(customerView.id,changeId);
  const privateReadPaths=[root,`${root}/cancellation-preview`,`${root}/cancellation-late-payments`];
  for(const who of [h.support,h.field])for(const path of privateReadPaths)await h.reject(path,undefined,who,'FORBIDDEN');
  for(const who of [h.maker,h.support,h.field])await h.reject(`${root}/cancellation-late-refund-preview?paymentId=${randomUUID()}`,undefined,who,'FORBIDDEN');
  const noCsrf={...h.maker,headers:{...h.maker.headers,'X-CSRF-Token':'bad'}},wrongOrigin={...h.maker,headers:{...h.maker.headers,Origin:'https://not-allowed.example.test'}};
  await h.reject(`${root}/cancellation/open`,{},noCsrf,'CSRF_DENIED');await h.reject(`${root}/cancellation/open`,{},wrongOrigin,'ORIGIN_DENIED');
  await h.archive('ORDER_AMENDMENT','ORDER_CHANGE_QUOTE',quote.id);
  const p=await h.get(`${root}/finance-preview`,h.finance);
  const prepared=await h.post(`${root}/finance/prepare`,{...command(p.revision),orderRevision:p.orderRevision,accountRevision:p.accountRevision,previewHash:p.previewHash},h.finance);
  const stageId=prepared.stageId,bills=await h.db.bill.findMany({where:{serviceStageId:stageId},orderBy:{sequence:'asc'}}),first=bills[0];
  const pending=await h.post(`/customer/bills/${first.id}/pay`,{idempotencyKey:randomUUID()},customer);await h.post(`/customer/payments/${pending.paymentId}/close`,{},customer);
  const original={account:await h.db.usageAccount.findUniqueOrThrow({where:{id:account.id}}),assignment:await h.db.vehicleAssignment.findUniqueOrThrow({where:{id:assignment.id}}),periods:await h.db.usagePeriod.findMany({where:{orderId:order.id},orderBy:{id:'asc'}}),terms:await h.db.orderTermsVersion.findMany({where:{orderId:order.id}})};
  const preview=()=>h.get(`${root}/cancellation-preview`),input=async()=>{const v=await preview();return{...command(v.revision),orderRevision:v.orderRevision,cancellationId:v.cancellationId,cancellationRevision:v.cancellationRevision,previewHash:v.previewHash};};
  const opening=await preview(),openBody={...command(opening.revision),orderRevision:opening.orderRevision,previewHash:opening.previewHash,reason:'HTTP合成双方约定取消新期，实收全退无取消费'};
  await h.reject(`${root}/cancellation/open`,openBody,h.finance,'FORBIDDEN');
  const opened=await h.post(`${root}/cancellation/open`,openBody);assert.deepEqual(await h.post(`${root}/cancellation/open`,openBody),opened);
  const mutual=await h.proof(h.maker),signature=await h.proof(h.maker);
  await h.post(`${root}/cancellation/confirm-agreement`,{...await input(),mutuallyAgreedAt:new Date().toISOString(),evidenceFileIds:[mutual.id],note:'HTTP合成双方在起租前实际同意取消'});
  await h.post(`${root}/cancellation/verify-signature`,{...await input(),signatureState:'SIGNED',evidenceFileIds:[signature.id],note:'HTTP合成核实原续期纸签资料'});
  const financePreview=await h.get(`${root}/cancellation-preview`,h.finance);
  for(const key of ['signatureEvidenceFileIds','signatureNote','mutualAgreementEvidenceFileIds','mutualAgreementNote'])assert.equal(Object.hasOwn(financePreview,key),false,key);
  const customerDuring=await h.get(`/customer/order-renewals/${changeId}`,customer);
  assert.deepEqual(customerDuring.cancellation,{id:opened.cancellationId,status:'OPEN',completedAt:null});
  const financeDuring=await h.get(root,h.finance),opsDuring=await h.get(root);
  for(const view of [financeDuring,opsDuring])for(const capability of ['canQuote','canReview','canPublish','canCancel','canPrepareFinance','canSchedule','canActivate','canConfirm','canReject','canSign','canSync'])assert.equal(view[capability],false,capability);
  const billDuring=await h.get(`/customer/records/bills/${first.id}`,customer);assert.equal(billDuring.statusText,'取消处理中');assert.equal(billDuring.cancellation.id,opened.cancellationId);assert.equal(billDuring.actions.some((a:any)=>a.id==='pay'),false);
  const oldBill=await h.db.bill.findFirstOrThrow({where:{orderId:order.id,serviceStageId:null,type:'SUBSCRIPTION',status:'PENDING'},orderBy:{sequence:'asc'}}),oldView=await h.get(`/customer/records/bills/${oldBill.id}`,customer);assert.equal(oldView.cancellation,null);assert.equal(oldView.actions.some((a:any)=>a.id==='pay'),true);
  const workspaceDuring=await h.get(`/customer/orders/${order.id}/workspace`,customer),futureBill=workspaceDuring.billing.find((b:any)=>b.id===first.id);assert.equal(futureBill.canPay,false);assert.equal(futureBill.cancellation.status,'OPEN');assert.equal(workspaceDuring.billing.find((b:any)=>b.id===oldBill.id).canPay,true);assert.equal(workspaceDuring.capabilities.canPay,true);
  const partnerDuring=await h.get(partnerPath,partner);assert.deepEqual(partnerDuring.currentPeriod,partnerBefore.currentPeriod);assert.equal(partnerDuring.futureRenewals.find((r:any)=>r.changeId===changeId).cancellation.status,'OPEN');
  for(const secret of [mutual.id,signature.id,'HTTP合成双方在起租前实际同意取消'])assert.equal(JSON.stringify(customerDuring).includes(secret),false);
  for(const secret of [mutual.id,signature.id,'HTTP合成双方在起租前实际同意取消'])assert.equal(JSON.stringify(partnerDuring).includes(secret),false);
  await h.reject(`/customer/bills/${first.id}/pay`,{idempotencyKey:randomUUID()},customer,'RENEWAL_CANCELLATION_IN_PROGRESS');
  const type='OFFLINE_RENEWAL_CANCELLATION',max=await h.db.legalDocument.aggregate({where:{type},_max:{version:true}});
  const draft=await h.post('/admin/legal-documents',{type,version:(max._max.version||0)+1,title:'HTTP本地合成取消模板',content:'仅本地合成，不用于真实交易。\n{{customerName}}、{{ownerName}}、{{platformName}}\n{{cancellationFacts}}\n{{refundPolicy}}'});
  const {legalContentHash}=await import('../src/operations/legal-template');
  h.docs[type]=await h.post(`/admin/legal-documents/${draft.id}/activate`,{confirmed:true,expectedVersion:draft.version,expectedContentHash:legalContentHash(draft),idempotencyKey:randomUUID()});
  await h.archive('RENEWAL_CANCELLATION','ORDER_RENEWAL_CANCELLATION',opened.cancellationId);
  const completionBody={...await input(),reason:'HTTP核实归档与资金后完成取消'},completed=await h.post(`${root}/cancel-prepared`,completionBody);assert.equal(completed.status,'COMPLETED');
  assert.deepEqual(await h.post(`${root}/cancel-prepared`,completionBody),completed);
  const completion=await h.db.orderRenewalCancellation.findUniqueOrThrow({where:{id:opened.cancellationId}}),stage=await h.db.orderServiceStage.findUniqueOrThrow({where:{id:stageId}});assert.equal(stage.status,'VOIDED');
  const cancelled=await h.get(`/customer/order-renewals/${changeId}`,customer);assert.equal(cancelled.status,'CANCELLED');
  assert.equal(cancelled.cancellation.status,'COMPLETED');assert.equal(cancelled.cancellation.id,opened.cancellationId);
  const cancelledBill=await h.get(`/customer/records/bills/${first.id}`,customer);assert.equal(cancelledBill.status,'VOID');assert.equal(cancelledBill.statusText,'已取消');assert.equal(cancelledBill.actions.some((a:any)=>a.id==='pay'),false);
  await h.reject(`/customer/records/bills/${first.id}`,undefined,stranger,'NOT_FOUND');
  const cancelledWorkspace=await h.get(`/customer/orders/${order.id}/workspace`,customer),voidBill=cancelledWorkspace.billing.find((b:any)=>b.id===first.id);assert.equal(voidBill.status,'VOID');assert.equal(voidBill.cancellation.status,'COMPLETED');assert.equal(voidBill.canPay,false);assert.equal(cancelledWorkspace.billing.find((b:any)=>b.id===oldBill.id).canPay,true);
  const partnerCompleted=await h.get(partnerPath,partner);assert.deepEqual(partnerCompleted.currentPeriod,partnerBefore.currentPeriod);assert.equal(partnerCompleted.futureRenewals.some((r:any)=>r.changeId===changeId),false);assert.equal(partnerCompleted.cancelledRenewals.find((r:any)=>r.changeId===changeId).cancellation.status,'COMPLETED');
  for(const secret of [mutual.id,signature.id,'HTTP合成双方在起租前实际同意取消'])assert.equal(JSON.stringify(partnerCompleted).includes(secret),false);
  assert.equal(await h.db.fieldHandoverTask.count({where:{orderId:order.id}}),fieldTasks,'renewal cancellation must not fabricate FIELD tasks');
  assert.equal((await h.get(`${root}/cancellation-preview`)).status,'COMPLETED');
  h.payment.capture(pending.paymentId);const late=await h.post(`/admin/payments/${pending.paymentId}/sync`,{},h.finance);assert.equal(late.status,'SUCCEEDED');
  const discovered=await h.get(`${root}/cancellation-late-payments?page=1&pageSize=1`,h.finance);assert.equal(discovered.total,1);assert.equal(discovered.items[0].id,late.id);assert.equal(discovered.items[0].eligibleLateReceipt,true);
  for(const key of ['providerTransactionId','sourceSnapshot','completionSnapshot','signatureEvidenceFileIds','mutualAgreementEvidenceFileIds'])assert.equal(JSON.stringify(discovered).includes('"'+key+'"'),false,key);
  await h.reject(`${root}/cancellation-late-payments?page=1&pageSize=101`,undefined,h.finance,'VALIDATION');
  const latePreview=await h.get(`${root}/cancellation-late-refund-preview?paymentId=${late.id}`,h.finance),lateBody={cancellationId:latePreview.cancellationId,cancellationRevision:latePreview.cancellationRevision,orderRevision:latePreview.orderRevision,previewHash:latePreview.previewHash,paymentId:late.id,reason:'HTTP已取消续期原关闭请求晚到，全额退回',idempotencyKey:randomUUID()};
  await h.reject(`${root}/cancellation/late-refunds`,lateBody,h.maker,'FORBIDDEN');
  await h.reject(`${root}/cancellation/late-refunds`,{...lateBody,amount:1},h.finance,'VALIDATION');
  const refund=await h.post(`${root}/cancellation/late-refunds`,lateBody,h.finance);assert.equal(refund.amount,first.amount);assert.equal(refund.status,'PENDING_APPROVAL');
  await h.reject(`/admin/refunds/${refund.refundId}/approve`,{},h.finance,'DUAL_APPROVAL');
  await h.post(`/admin/refunds/${refund.refundId}/approve`,{},h.reviewer);
  const evidence=await h.proof(h.finance),paid=await h.db.payment.findUniqueOrThrow({where:{id:late.id}}),reconciliation=await h.post(`/admin/payments/${late.id}/reconciliations`,{...command(paid.revision),resolution:'REFUNDED',note:'HTTP合成渠道成功原路全额退款',evidenceFileIds:[evidence.id]},h.finance);
  await h.post(`/admin/payments/${late.id}/reconciliations/${reconciliation.id}/review`,{...command(reconciliation.paymentRevision),decision:'APPROVED',note:'HTTP另一员工独立核对实收和原路退款'},h.reviewer);
  assert.equal((await h.get(`${root}/cancellation-late-refund-preview?paymentId=${late.id}`,h.finance)).remainingRefundAmount,0);
  assert.deepEqual(await h.post(`${root}/cancellation/late-refunds`,lateBody,h.finance),refund);assert.equal(await h.db.refund.count({where:{paymentId:late.id}}),1);
  assert.deepEqual(await h.db.orderRenewalCancellation.findUniqueOrThrow({where:{id:completion.id}}),completion);assert.deepEqual(await h.db.orderServiceStage.findUniqueOrThrow({where:{id:stageId}}),stage);
  assert.deepEqual({account:await h.db.usageAccount.findUniqueOrThrow({where:{id:account.id}}),assignment:await h.db.vehicleAssignment.findUniqueOrThrow({where:{id:assignment.id}}),periods:await h.db.usagePeriod.findMany({where:{orderId:order.id},orderBy:{id:'asc'}}),terms:await h.db.orderTermsVersion.findMany({where:{orderId:order.id}})},original);
  await h.db.adminUser.update({where:{id:h.finance.id},data:{authVersion:{increment:1}}});await h.reject(`${root}/cancellation/late-refunds`,lateBody,h.finance,'SESSION_EXPIRED');
  assert.equal(h.externalCalls,0);assert.equal(h.esignCalls,0);assert.equal(h.identityCalls,0);assert.equal(h.realSmsSends,0);
 }finally{await h.close();if(policy===undefined)delete process.env.CUSTOMER_IDENTITY_POLICY;else process.env.CUSTOMER_IDENTITY_POLICY=policy;}
});
