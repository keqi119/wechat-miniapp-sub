import {ownerMobileHash} from '../src/owner-h5/legal-representative';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {JourneyHarness} from './seven-module-journey-fixtures';
import {cancellationFixture} from './v31-cancellation-fixture';
import {tokenHash} from '../src/auth/auth.service';
test('actual04 HTTP source proposal review customer confirmation and protected preparation enforce routes and sessions',async()=>{
 const h=new JourneyHarness(),mode=process.env.NEW_ORDER_CONTRACT_MODE;
 try{
 await h.start();process.env.NEW_ORDER_CONTRACT_MODE='ELECTRONIC';process.env.CONTRACT_CJK_FONT_PATH='C:/Windows/Fonts/msyh.ttc';const {f,sub,input}=await cancellationFixture(h.db),token=randomUUID(),csrf=randomUUID();
 await h.db.adminSession.create({data:{id:tokenHash(token),adminId:f.actor.id,authVersion:f.actor.authVersion,csrfToken:csrf,expiresAt:new Date(Date.now()+3600000)}});
 const operator={id:f.actor.id,headers:{Origin:h.origin,Cookie:`admin_session=${token}`,'X-CSRF-Token':csrf}},customerToken=randomUUID();
 await h.db.customerSession.create({data:{id:tokenHash(customerToken),customerId:sub.customer.id,expiresAt:new Date(Date.now()+3600000)}});const customer={id:sub.customer.id,headers:{Authorization:`Bearer ${customerToken}`}};
 await h.reject(`/admin/orders/${sub.order.id}/cancellation04`,input,h.finance,'FORBIDDEN');
 const view=await h.get(`/admin/orders/${sub.order.id}/cancellation04`,operator);assert.equal(view.canPropose,true);
 const proposal=await h.post(`/admin/orders/${sub.order.id}/cancellation04`,input,operator);assert.equal(proposal.netRefundAmount,10000);
 const readiness=await h.get(`/admin/orders/${sub.order.id}/cancellation-readiness`,operator);assert.equal(readiness.version,2);assert.equal(readiness.executionMode,'ELECTRONIC');assert.equal(readiness.canCancel,false);assert.equal(readiness.case.id,proposal.id);
 const review=await h.post(`/admin/cancellations04/${proposal.id}/review`,{revision:proposal.revision,idempotencyKey:randomUUID(),decision:'VERIFIED',note:'合成HTTP核对真实来源'},operator);
 const foreign=await h.customer('foreign-cancellation');await h.reject(`/customer/cancellations04/${proposal.id}/confirm`,{revision:review.revision,proposalHash:proposal.proposalHash,idempotencyKey:randomUUID(),accepted:true},foreign,'NOT_FOUND');
 const confirmed=await h.post(`/customer/cancellations04/${proposal.id}/confirm`,{revision:review.revision,proposalHash:proposal.proposalHash,idempotencyKey:randomUUID(),accepted:true},customer);assert.equal(confirmed.state,'CONFIRMED');
 const detail=await h.get(`/customer/orders/${sub.order.id}/cancellation04`,customer);assert.equal(detail.case.proposalHash,proposal.proposalHash);assert.equal(detail.case.effectiveAt,null);
 // Real production party resolver: independent technical certificate/seal prerequisites, no auto grant.
  for(const ownerId of [f.owner.id,f.platform.id]){const a=await h.db.ownerESignAccount.findUniqueOrThrow({where:{ownerId}}),manager=await h.db.customer.findUniqueOrThrow({where:{id:a.managerCustomerId}}),mobileHash=ownerMobileHash(manager.mobile),serial='SYNTHETIC-'+randomUUID();await h.db.ownerLegalRepresentative.update({where:{ownerId},data:{mobileHash}});await h.db.ownerMember.create({data:{ownerId,customerId:manager.id,status:'VERIFIED',verifiedAt:new Date(),verifiedSerialNo:serial}});await h.db.ownerESignAccount.update({where:{ownerId},data:{verifiedAt:new Date(),verificationTransactionNo:serial,consentSnapshot:{ownerId,customerId:manager.id,legalRevision:1,legalName:'合成法人',legalMobileHash:mobileHash,channel:'OWNER_LEGAL_H5'}}});}
 const now=new Date();for(const ownerId of [f.owner.id,f.platform.id]){const a=await h.db.ownerESignAccount.findUniqueOrThrow({where:{ownerId}});await h.db.ownerESignAccount.update({where:{ownerId},data:{certStatus:'BOUND',certSerialNo:'SYN-'+randomUUID(),certValidFrom:new Date(now.getTime()-86400000),certValidUntil:new Date(now.getTime()+86400000),certEvidenceHash:'c'.repeat(64),certSubjectHash:'d'.repeat(64),certCheckedAt:now}});const seal=await h.db.ownerSeal.create({data:{ownerId,providerCustomerId:a.providerCustomerId!,providerSignatureId:'SYN-'+randomUUID(),status:'ACTIVE',imageHash:'e'.repeat(64),imageCiphertext:'SYNTHETIC',selectedBy:a.managerCustomerId!,selectedAt:now,checkedAt:now}});if(ownerId===f.platform.id)process.env.FADADA_PLATFORM_SIGNATURE_ID=seal.providerSignatureId;}
 await h.db.eSignAccount.update({where:{customerId:sub.customer.id},data:{certSubjectHash:'f'.repeat(64)}});
 const prepareInput={kind:'PRE_DELIVERY_CANCELLATION',resourceId:proposal.id,revision:confirmed.revision,idempotencyKey:randomUUID()};
 const prepared=await h.post('/admin/electronic-documents/prepare',prepareInput,operator);assert.equal(prepared.kind,'PRE_DELIVERY_CANCELLATION');assert.ok(prepared.parties.every((p:any)=>p.mode==='MANUAL'));
 const file=await fetch(h.base+`/api/customer/electronic-documents/${prepared.id}/files/source`,{headers:customer.headers});assert.equal(file.status,200);assert.equal(file.headers.get('content-type'),'application/pdf');assert.match(file.headers.get('cache-control')??'',/no-store/);assert.ok((await file.arrayBuffer()).byteLength>1000);
 const denied=await fetch(h.base+`/api/customer/electronic-documents/${prepared.id}/files/source`,{headers:foreign.headers});assert.equal(denied.status,404);
 await h.db.adminUser.update({where:{id:f.actor.id},data:{authVersion:{increment:1}}});const stale=await fetch(h.base+`/api/admin/orders/${sub.order.id}/cancellation04`,{headers:operator.headers});assert.equal(stale.status,401);
 assert.equal(h.externalCalls+h.esignCalls+h.identityCalls,0);
 }finally{await h.close();if(mode===undefined)delete process.env.NEW_ORDER_CONTRACT_MODE;else process.env.NEW_ORDER_CONTRACT_MODE=mode;}
});
