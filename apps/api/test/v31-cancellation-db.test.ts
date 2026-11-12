import {BillingController,BillingService} from '../src/billing/billing';
import {HttpException} from '@nestjs/common';
import {ownerMobileHash} from '../src/owner-h5/legal-representative';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {ElectronicDocumentService} from '../src/electronic-documents/service';
import {syntheticSigningTime,syntheticFinalVerification,sha} from './electronic-fixtures';
import {FilesController} from '../src/files/files';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {guardCancellation04Refund,guardCancellation04Delivery} from '../src/orders/cancellation04-gates';
import {activateElectronicSubscription} from '../src/electronic-documents/subscription';
import {Db} from '../src/common/db';
import {prepareFixture} from './v31-initial-fixture';
import {seedV31Subscription} from './v31-cooperation-fixture';
import {OrderActionsController} from '../src/orders/order-actions';
test('electronic cancellation rejects generic uploaded PDF as legal authority',async()=>{
 const db=new Db();const mode=process.env.NEW_ORDER_CONTRACT_MODE;process.env.NEW_ORDER_CONTRACT_MODE='ELECTRONIC';try{
 const f=await prepareFixture(db),sub=await seedV31Subscription(db,f);
 await db.vehicle.update({where:{id:f.vehicle.id},data:{status:'RESERVED',reservedOrderId:sub.order.id}});
 await db.contract.updateMany({where:{orderId:sub.order.id},data:{status:'SIGNED'}});
 const file=await db.storedFile.create({data:{name:'synthetic.pdf',storagePath:'synthetic',mimeType:'application/pdf',size:50,sha256:'a'.repeat(64),purpose:'evidence',adminId:f.actor.id}});
 await assert.rejects(new OrderActionsController(db).cancel(sub.order.id,{reason:'合成取消',terminationFileId:file.id,revision:0,idempotencyKey:randomUUID()},{admin:f.actor}),(e:any)=>e.getResponse?.().error?.code==='CANCELLATION_04_REQUIRED');
 assert.notEqual((await db.order.findUniqueOrThrow({where:{id:sub.order.id}})).status,'CANCELLED');
 }finally{if(mode===undefined)delete process.env.NEW_ORDER_CONTRACT_MODE;else process.env.NEW_ORDER_CONTRACT_MODE=mode;await db.$disconnect();}
});



import {syntheticArchive} from './v31-initial-fixture';
import {v31FixtureContent} from './v31-cooperation-fixture';
import {prepareElectronicDocument} from '../src/electronic-documents/prepare';
import {signingParties} from './electronic-fixtures';
import {finalizeElectronicArchive} from '../src/electronic-documents/archive';
import {Cancellation04Service,activateCancellation04} from '../src/orders/cancellation04';
const code=(s:string)=>(e:any)=>e.getResponse?.().error?.code===s;
test('04 actual proposal review customer confirmation protected manual document legal archive and net refund provenance',async ctx=>{
 ctx.mock.timers.enable({apis:['Date'],now:new Date()});
 const db=new Db(),mode=process.env.NEW_ORDER_CONTRACT_MODE;process.env.NEW_ORDER_CONTRACT_MODE='ELECTRONIC';
 try{
 const f=await prepareFixture(db);await db.adminUser.update({where:{id:f.actor.id},data:{role:'ADMIN'}});f.actor.role='ADMIN';
 await db.legalDocument.update({where:{id:f.template.id},data:{status:'PUBLISHED',confirmedBy:f.actor.id,confirmedAt:new Date()}});
 await syntheticArchive(db,f,await db.serial(tx=>prepareElectronicDocument(tx,f.input,f.actor.id,f.writer,f.options)));
 const sub=await seedV31Subscription(db,f),parties=signingParties().map(p=>({...p,subjectId:p.role==='CUSTOMER'?sub.customer.id:p.role==='OWNER'?f.owner.id:f.platform.id,autoAuthority:null,certificate:{...p.certificate,checkedAt:new Date().toISOString()}}));
 await db.vehicle.update({where:{id:f.vehicle.id},data:{status:'RESERVED',reservedOrderId:sub.order.id}});
 const original=await db.serial(tx=>prepareElectronicDocument(tx,{kind:'SUBSCRIPTION',resourceId:sub.order.id,revision:0,idempotencyKey:randomUUID()},f.actor.id,f.writer,{...f.options,resolveParties:async()=>parties}));await syntheticArchive(db,f,original);
 await db.legalDocument.create({data:{type:'ELECTRONIC_V31_PRE_DELIVERY_CANCELLATION',version:Math.floor(Math.random()*1000000000)+1,title:'合成04',content:v31FixtureContent('04'),status:'PUBLISHED',confirmedBy:f.actor.id,confirmedAt:new Date()}});
 const evidence=await db.storedFile.create({data:{name:'真实调运及独立约定合成证据.pdf',storagePath:'synthetic',mimeType:'application/pdf',size:50,sha256:'b'.repeat(64),purpose:'evidence',adminId:f.actor.id}});
 const bill=await db.bill.create({data:{orderId:sub.order.id,customerId:sub.customer.id,type:'DEPOSIT',sequence:0,amount:10000,paidAmount:10000,status:'PAID',dueDate:new Date()}});
 const payment=await db.payment.create({data:{billId:bill.id,customerId:sub.customer.id,amount:10000,status:'SUCCEEDED',idempotencyKey:randomUUID(),providerTransactionId:'SYNTHETIC-RECEIPT-'+randomUUID()}});
 const lateBill=await db.bill.create({data:{orderId:sub.order.id,customerId:sub.customer.id,type:'DEPOSIT',sequence:88,amount:500,status:'PENDING',dueDate:new Date()}}),late=await db.payment.create({data:{billId:lateBill.id,customerId:sub.customer.id,amount:500,status:'FAILED',idempotencyKey:randomUUID()}});
 const service=new Cancellation04Service(db),view:any=await service.read(sub.order.id,f.actor);
 const input={revision:view.orderRevision,sourceHash:view.sourceHash,idempotencyKey:randomUUID(),reason:'客户取消，未交付',responsibility:'CUSTOMER',neverDeliveredEvidenceFileIds:[evidence.id],costs:[]};
 const bad={...input,costs:[{kind:'PREPARATION_FEE',amount:1000}]};await assert.rejects(service.propose(sub.order.id,bad,f.actor));
 const proposed:any=await service.propose(sub.order.id,{...input,costs:[{kind:'PERFORMED_INDEPENDENT_SERVICE',amount:1000,paymentId:payment.id,creditorOwnerId:f.owner.id,description:'已履行独立调运服务',agreement:'此前明确协商的实际调运费',responsibility:'客户取消承担真实独立调运',performedAt:new Date(Date.now()-60000).toISOString(),evidenceFileIds:[evidence.id]}]},f.actor);
 assert.equal(proposed.netRefundAmount,9000);assert.ok(proposed.costs[0].itemId);assert.match(proposed.costs[0].sourceHash,/^[a-f0-9]{64}$/);assert.equal(proposed.costs[0].accountingNature,'INDEPENDENT_SERVICE_FEE');const proposalId=proposed.id;
 await assert.rejects(service.confirm(proposalId,{revision:proposed.revision,proposalHash:proposed.proposalHash,idempotencyKey:randomUUID(),accepted:true},sub.customer.id),code('CANCELLATION_REVIEW_REQUIRED'));
 const reviewed:any=await service.review(proposalId,{revision:proposed.revision,idempotencyKey:randomUUID(),decision:'VERIFIED',note:'核对真实未交付和独立费用凭据'},f.actor);
 await assert.rejects(service.confirm(proposalId,{revision:reviewed.revision,proposalHash:proposed.proposalHash,idempotencyKey:randomUUID(),accepted:true},'foreign'),code('NOT_FOUND'));
 const confirmed:any=await service.confirm(proposalId,{revision:reviewed.revision,proposalHash:proposed.proposalHash,idempotencyKey:randomUUID(),accepted:true},sub.customer.id);
 const prepare={kind:'PRE_DELIVERY_CANCELLATION',resourceId:proposalId,revision:confirmed.revision,idempotencyKey:randomUUID()};
 const prepared=await db.serial(tx=>prepareElectronicDocument(tx,prepare,f.actor.id,f.writer,{...f.options,resolveParties:async()=>parties}));
 const task=await db.electronicSigningTask.findUniqueOrThrow({where:{id:prepared.taskId},include:{parties:true}});assert.deepEqual(task.parties.map(p=>p.role).sort(),['CUSTOMER','OWNER','PLATFORM']);assert.ok(task.parties.every(p=>p.mode==='MANUAL'));
 const contract=await db.contract.findUniqueOrThrow({where:{id:task.contractId!}});assert.equal(JSON.parse(contract.body!).format,'PRIVATE_ELECTRONIC_PDF');assert.ok(!JSON.stringify(await service.read(sub.order.id,f.actor)).includes('identityNumber'));
  for(const ownerId of [f.owner.id,f.platform.id]){const a=await db.ownerESignAccount.findUniqueOrThrow({where:{ownerId}}),manager=await db.customer.findUniqueOrThrow({where:{id:a.managerCustomerId}}),mobileHash=ownerMobileHash(manager.mobile),serial='SYNTHETIC-'+randomUUID();await db.ownerLegalRepresentative.update({where:{ownerId},data:{mobileHash}});await db.ownerMember.create({data:{ownerId,customerId:manager.id,status:'VERIFIED',verifiedAt:new Date(),verifiedSerialNo:serial}});await db.ownerESignAccount.update({where:{ownerId},data:{verifiedAt:new Date(),verificationTransactionNo:serial,consentSnapshot:{ownerId,customerId:manager.id,legalRevision:1,legalName:'合成法人',legalMobileHash:mobileHash,channel:'OWNER_LEGAL_H5'}}});}
 let filingAttempts=0;const signer=new ElectronicDocumentService(db,{upload:async()=>({evidenceHash:sha('c')}),manualUrl:async()=>({url:'https://synthetic.invalid/manual'}),querySigner:async()=>({status:'SIGNED',...syntheticSigningTime(new Date()),evidenceHash:sha('b')}),fileContract:async()=>{filingAttempts++;throw new Error('Synthetic filing delayed');},queryFiling:async()=>({filed:true,evidenceHash:sha('d')}),downloadFinal:async()=>({bytes:Buffer.from('%PDF-1.7\nSynthetic04 verified final\n'+sha('f')+'\n%%EOF')}),verifyFinalFile:async(doc:any,bytes:Buffer)=>syntheticFinalVerification(doc,createHash('sha256').update(bytes).digest('hex'))} as any,f.writer,{resolveParties:async()=>parties,afterArchive:activateCancellation04});
 const admin={kind:'ADMIN' as const,id:f.actor.id};
 const pdf=await signer.file({kind:'CUSTOMER',id:sub.customer.id},task.id,'source');
 await assert.rejects(signer.file({kind:'CUSTOMER',id:randomUUID()},task.id,'source'));
 await assert.rejects(new FilesController(db).customerRead(task.sourceFileId,{customer:sub.customer},{setHeader:()=>{},send:()=>{}}));
 const python=process.env.PDF_QA_PYTHON||resolve(process.env.USERPROFILE!,'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
 const pdfText=execFileSync(python,['-X','utf8','-c','import io,sys; from pypdf import PdfReader; print("".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(sys.stdin.buffer.read())).pages))'],{input:pdf.bytes,encoding:'utf8'}).replace(/\s/g,'');
 for(const value of ['解除协议','从未实际交付','三个工作日','90.00元','已履行独立调运服务'])assert.ok(pdfText.includes(value),value);
 await signer.start(admin,task.id,{revision:task.revision,idempotencyKey:randomUUID()});
 for(const role of ['CUSTOMER','OWNER','PLATFORM']){
  const current=await db.electronicSigningTask.findUniqueOrThrow({where:{id:task.id}}),ownerId=role==='OWNER'?f.owner.id:f.platform.id;
  const actor=role==='CUSTOMER'?{kind:'CUSTOMER' as const,id:sub.customer.id}:{kind:'OWNER' as const,id:(await db.ownerESignAccount.findUniqueOrThrow({where:{ownerId}})).managerCustomerId!,ownerId};
  await signer.sign(actor,task.id,{revision:current.revision,sourceSha256:task.sourceSha256,accepted:true,idempotencyKey:randomUUID()});ctx.mock.timers.setTime(Date.now()+1000);
  await signer.sync(admin,task.id,{revision:(await db.electronicSigningTask.findUniqueOrThrow({where:{id:task.id}})).revision,idempotencyKey:randomUUID()});
 }
 assert.equal(filingAttempts,1);const legal:any=await service.read(sub.order.id,f.actor);assert.ok(legal.case.effectiveAt);assert.equal(legal.case.archivedAt,null);assert.equal(legal.case.netRefundAmount,9000);assert.equal(legal.case.paymentReferences[0].paymentId,payment.id);
 await signer.sync(admin,task.id,{revision:(await db.electronicSigningTask.findUniqueOrThrow({where:{id:task.id}})).revision,idempotencyKey:randomUUID()});
 assert.equal((await db.electronicSigningTask.findUniqueOrThrow({where:{id:task.id}})).status,'ARCHIVED');
 assert.equal((await db.order.findUniqueOrThrow({where:{id:sub.order.id}})).status,'CANCELLED');assert.equal((await db.payment.findUniqueOrThrow({where:{id:payment.id}})).amount,10000);assert.equal((await db.bill.findUniqueOrThrow({where:{id:bill.id}})).status,'PAID');assert.equal(await db.refund.count({where:{paymentId:payment.id}}),0);
 const done:any=await service.read(sub.order.id,f.actor);assert.equal(done.case.effectiveAt,legal.case.effectiveAt);assert.ok(done.case.archivedAt);
 const financialGateway={queryRefund:async()=>{throw new HttpException({error:{code:'REFUND_NOT_FOUND'}},409);},refund:async()=>({status:'PROCESSING',providerRefundId:'SYNTHETIC-'+randomUUID()})} as any,billing=new BillingService(db,financialGateway),controller=new BillingController(db,billing,financialGateway);
 await db.adminUser.update({where:{id:f.actor.id},data:{staffPersonId:'financial-maker'}});
 await assert.rejects(controller.requestRefund({paymentId:payment.id,amount:10000,reason:'错误全额',idempotencyKey:randomUUID()},{admin:f.actor}),code('CANCELLATION04_REFUND_LIMIT'));
 const refundInput={paymentId:payment.id,amount:9000,reason:'04已确认净退款',idempotencyKey:randomUUID()},refund=await controller.requestRefund(refundInput,{admin:f.actor});assert.equal(refund.status,'PENDING_APPROVAL');assert.equal((await controller.requestRefund(refundInput,{admin:f.actor})).id,refund.id);
 await assert.rejects(controller.approve(refund.id,{admin:f.actor}),code('DUAL_APPROVAL'));
 const finance=await db.adminUser.create({data:{username:randomUUID(),passwordHash:'synthetic',name:'合成财务',role:'FINANCE',staffPersonId:'financial-maker'}}),financeActor={id:finance.id,role:finance.role,authVersion:finance.authVersion};
 await assert.rejects(controller.approve(refund.id,{admin:financeActor}),code('DUAL_APPROVAL'));
 await db.adminUser.update({where:{id:finance.id},data:{staffPersonId:'financial-reviewer'}});assert.equal((await controller.approve(refund.id,{admin:financeActor})).status,'PROCESSING');
 ctx.mock.timers.setTime(Date.now()+60000);await db.adminUser.update({where:{id:finance.id},data:{active:false}});
 await assert.rejects(billing.retryRefund(refund.id,financeActor.id,financeActor),code('STAFF_SESSION_CHANGED'));
 await db.adminUser.update({where:{id:finance.id},data:{active:true}});
 await billing.settle(late.id,{status:'SUCCEEDED',amount:500,transactionId:'SYNTHETIC-LATE-'+randomUUID(),succeededAt:new Date().toISOString()});
 const latePaid=await db.payment.findUniqueOrThrow({where:{id:late.id}});assert.equal(latePaid.status,'SUCCEEDED');assert.equal(latePaid.reconciliationRequired,true);assert.equal((await db.order.findUniqueOrThrow({where:{id:sub.order.id}})).status,'CANCELLED');
 await assert.rejects(controller.requestRefund({paymentId:late.id,amount:500,reason:'late amount not yet confirmed',idempotencyKey:randomUUID()},{admin:f.actor}),code('CANCELLATION04_LATE_PAYMENT_REVIEW'));
 const afterLate:any=await service.read(sub.order.id,f.actor);assert.equal(afterLate.case.effectiveAt,done.case.effectiveAt);assert.equal(afterLate.case.netRefundAmount,9000);assert.equal(afterLate.currentPayments.length,2);
 const beforeCount=await db.preDeliveryCancellationFact.count({where:{cancellationId:proposalId}});await signer.sync(admin,task.id,{revision:(await db.electronicSigningTask.findUniqueOrThrow({where:{id:task.id}})).revision,idempotencyKey:randomUUID()});assert.equal(await db.preDeliveryCancellationFact.count({where:{cancellationId:proposalId}}),beforeCount);
 const finalOrder=await db.order.findUniqueOrThrow({where:{id:sub.order.id}}),cancelInput={reason:'04完成记录重放',revision:finalOrder.revision,idempotencyKey:randomUUID()},actions=new OrderActionsController(db);assert.deepEqual(await actions.cancel(sub.order.id,cancelInput,{admin:f.actor}),await actions.cancel(sub.order.id,cancelInput,{admin:f.actor}));
 }finally{if(mode===undefined)delete process.env.NEW_ORDER_CONTRACT_MODE;else process.env.NEW_ORDER_CONTRACT_MODE=mode;await db.$disconnect();}
});
