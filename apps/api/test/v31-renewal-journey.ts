import {purchaseOriginalRenewalRights} from './v31-renewal-rights-fixture';
import {activateElectronicRenewal} from '../src/order-renewals/electronic-archive';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {OrderRenewalsService} from '../src/order-renewals/service';
import {versionSnapshot} from '../src/products/snapshot';
import {productVersionInclude} from '../src/products/types';
import {v31FixtureContent} from './v31-cooperation-fixture';
import {acceptConsents,currentDocuments} from '../src/auth/consents';
import {prepareElectronicDocument} from '../src/electronic-documents/prepare';
import {publishBillAutomatically} from '../src/billing/auto-publication';
import {readEffectiveContractChain} from '../src/order-changes/agreement-readiness';
import {creditView} from '../src/vehicle-changes/credits';
import {ElectronicDocumentService} from '../src/electronic-documents/service';
import {ownerMobileHash} from '../src/owner-h5/legal-representative';
import {syntheticSigningTime,syntheticFinalVerification,sha} from './electronic-fixtures';
import {canonicalHash} from '../src/customers/types';
import {decryptIdentity} from '../src/esign/fadada/fadada-safety';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {FilesController} from '../src/files/files';
import {readCurrentRenewalVehicleSource} from '../src/order-renewals/effective';
import {readAdminOrders} from '../src/orders/admin-query';


export async function seedRenewalProduct(db:any,f:any,vehicleId=f.vehicle.id){
  for(const ownerId of [f.owner.id,f.platform.id]){const a=await db.ownerESignAccount.findUniqueOrThrow({where:{ownerId}}),manager=await db.customer.findUniqueOrThrow({where:{id:a.managerCustomerId}}),mobileHash=ownerMobileHash(manager.mobile),serial='SYNTHETIC-'+randomUUID();await db.ownerLegalRepresentative.update({where:{ownerId},data:{mobileHash}});await db.ownerMember.create({data:{ownerId,customerId:manager.id,status:'VERIFIED',verifiedAt:new Date(),verifiedSerialNo:serial}});await db.ownerESignAccount.update({where:{ownerId},data:{verifiedAt:new Date(),verificationTransactionNo:serial,consentSnapshot:{ownerId,customerId:manager.id,legalRevision:1,legalName:'合成法人',legalMobileHash:mobileHash,channel:'OWNER_LEGAL_H5'}}});}
  const definition=await db.product.create({data:{name:'合成续期'+randomUUID(),createdBy:f.actor.id}});
  const product=await db.productVersion.create({data:{productId:definition.id,version:1,status:'PUBLISHED',name:'合成三月续期',months:3,minimumTermMonths:3,configurationVersion:2,baseFeeAmount:18000,mileageMonthlyFeeAmount:2000,swapPolicy:{version:2,period:'TERM',includedCount:2,extraFeeAmount:50000},monthlyFeeAmount:20000,mileagePerMonthKm:2000,excessMileagePriceAmount:200,energyDescription:'充换电费用由客户自付',conditions:'合成条件',vehicleIds:[vehicleId],modelDefinitionIds:[],customerBaas:{disposition:'INCLUDED'},createdBy:f.actor.id,items:{create:[{kind:'BASE_SUBSCRIPTION',position:0}]}},include:productVersionInclude});
  const plan=await db.subscriptionPlan.create({data:{vehicleId,productVersionId:product.id,active:true,name:product.name,months:3,monthlyFeeAmount:20000,mileagePerMonthKm:2000,excessMileagePriceAmount:200,energyDescription:product.energyDescription,conditions:product.conditions,benefits:[]}}),snapshot=versionSnapshot(product);
  const listing=await db.vehicleListing.create({data:{vehicleId,subscriptionPlanId:plan.id,productVersionId:product.id,status:'PUBLISHED',visible:true,source:'EXPLICIT',snapshot,productSourceHash:canonicalHash(snapshot),createdBy:f.actor.id}});
  f.v31Sources.productVersionIds.push(product.id);f.v31Sources.productDepositRules.push({...f.v31Sources.productDepositRules[0],productVersionId:product.id});
 return{product,listing};
}
export async function runRenewalJourney(ctx:any,db:any,fixture:any,product:any,listing:any,dates:{start:string;end:string;firstEnd:string;secondEnd:string;expiresAt:string;startAt:string},hooks:{prepared?:(context:any)=>Promise<void>;financePrepared?:(context:any)=>Promise<any>;activationReady?:(context:any)=>Promise<any>}={}){
 const {f,sub,billing,gateway,payingCustomer}=fixture,parties=fixture.parties.map((p:any)=>({...p,certificate:{...p.certificate,checkedAt:new Date().toISOString()}})),service=new OrderRenewalsService(db,()=>new Date()),handoverCount=await db.handover.count({where:{orderId:sub.order.id}}),priorTermsVersionId=(await db.order.findUniqueOrThrow({where:{id:sub.order.id}})).effectiveTermsVersionId;
  const purchased=await purchaseOriginalRenewalRights(db,fixture),originalBills=await db.bill.findMany({where:{orderId:sub.order.id},orderBy:{id:'asc'}}),originalPayments=await db.payment.findMany({where:{billId:{in:originalBills.map((b:any)=>b.id)},status:'SUCCEEDED'},orderBy:{id:'asc'}});
  const context:any=await service.context(sub.order.id,f.actor);assert.equal(context.eligible,true,JSON.stringify(context.blockers));
  const goods:any=await service.goods(sub.order.id,{},f.actor),selected=goods.items.find((p:any)=>p.listingId===listing.id);assert.ok(selected,JSON.stringify(goods));
  const input={listingId:listing.id,listingRevision:selected.listingRevision,productVersionId:product.id,listingSourceHash:selected.sourceHash,orderRevision:context.orderRevision,accountRevision:context.accountRevision,reason:'同车续用三个月',expiresAt:dates.expiresAt,settlementExplanation:'新租期单独计费，原押金保持',cancellationTerms:'按已批准续期约定办理'};
  const preview:any=await service.preview(sub.order.id,input,f.actor);
  await assert.rejects(service.preview(sub.order.id,{...input,listingRevision:input.listingRevision+1},f.actor));
  await assert.rejects(service.preview(sub.order.id,{...input,months:5},f.actor));
  await assert.rejects(service.create(sub.order.id,{...input,previewHash:preview.previewHash,idempotencyKey:randomUUID()},{...f.actor,authVersion:f.actor.authVersion+1}));
  assert.equal(preview.startDate,dates.start);assert.equal(preview.endDate,dates.end);assert.equal(preview.periods[0].endDate,dates.firstEnd);assert.equal(preview.periods[1].endDate,dates.secondEnd);assert.equal(preview.months,3);assert.equal(preview.monthlyFeeAmount,20000);assert.equal(preview.depositAmount,10000);assert.equal(preview.swapPolicy.includedCount,2);
  const command={...input,previewHash:preview.previewHash,idempotencyKey:randomUUID()},created:any=await service.create(sub.order.id,command,f.actor);
  assert.equal(created.status,'DRAFT');assert.deepEqual(await service.create(sub.order.id,command,f.actor),created);
  const change=await db.orderChange.findUniqueOrThrow({where:{id:created.id}});assert.equal(change.kind,'SUBSCRIPTION_EXTENSION');assert.ok(change.originalArchiveVersionId);assert.equal(change.priorTermsVersionId,priorTermsVersionId);
  assert.equal(await db.orderServiceStage.count({where:{orderId:sub.order.id}}),1);assert.equal(await db.handover.count({where:{orderId:sub.order.id}}),handoverCount);
  const updated:any=await service.context(sub.order.id,f.actor,created.id),quoteInput={...input,orderRevision:updated.orderRevision,accountRevision:updated.accountRevision},quotePreview:any=await service.preview(sub.order.id,quoteInput,f.actor,created.id);
  const quoted:any=await service.act(created.id,'quotes',{...quoteInput,previewHash:quotePreview.previewHash,revision:created.revision,idempotencyKey:randomUUID()},f.actor);
  const quote=await db.delayQuote.findUniqueOrThrow({where:{id:quoted.quoteId}}),s:any=quote.snapshot;
  assert.equal(s.renewalTerms.lessorSnapshot.executionMode,'ELECTRONIC','05 must freeze genuine electronic cooperation, never paper lessor proof');
  assert.equal(s.executionMode,'ELECTRONIC');assert.deepEqual(s.renewalTerms.agreedFeeComponents,{baseFeeAmount:18000,mileageMonthlyFeeAmount:2000});
  const finance=await db.adminUser.create({data:{username:randomUUID(),passwordHash:'synthetic',name:'合成财务',role:'FINANCE'}}),financeActor={id:finance.id,role:finance.role,authVersion:finance.authVersion};
  await db.legalDocument.create({data:{type:'ELECTRONIC_V31_RENEWAL',version:Math.floor(Math.random()*1000000000)+1,title:'合成续期05',content:v31FixtureContent('05'),status:'PUBLISHED',confirmedBy:f.actor.id,confirmedAt:new Date()}});
  const reviewed:any=await service.act(created.id,'review',{revision:quoted.revision,idempotencyKey:randomUUID(),decision:'APPROVED',note:'核对真实同车产品'},financeActor);
  const published:any=await service.act(created.id,'publish',{revision:reviewed.revision,idempotencyKey:randomUUID()},f.actor);
  assert.equal(published.status,'AWAITING_CONFIRMATION');
  const contract=await db.contract.findUniqueOrThrow({where:{delayQuoteId:quote.id}});assert.equal(contract.executionMode,'ELECTRONIC');
  assert.equal((await db.delayQuote.findUniqueOrThrow({where:{id:quote.id}})).snapshot.document.type,'ELECTRONIC_V31_RENEWAL');
  await db.serial(async tx=>acceptConsents(tx,sub.customer.id,(await currentDocuments(tx,['terms','privacy'])).map((d:any)=>({documentId:d.id,version:d.version})),['terms','privacy'],'SYNTHETIC_TEST'));
  const publicQuote:any=(await service.detail(created.id,undefined,sub.customer.id)).quote;assert.ok(publicQuote,'customer can read exact safe05 commercial summary');
  const confirmInput={revision:published.revision,idempotencyKey:randomUUID(),quoteId:quote.id,quoteRevision:quote.revision,commercialHash:publicQuote.commercialHash,bodyHash:publicQuote.document.bodyHash,lessorHash:publicQuote.lessorHash,noticeHash:publicQuote.noticeHash,sharingAccepted:true};
  await db.legalDocument.update({where:{id:publicQuote.document.id},data:{status:'DRAFT'}});
  await assert.rejects(service.customerAct(created.id,'confirm',confirmInput,sub.customer.id),(e:any)=>e.getResponse?.().error?.code==='V31_TEMPLATE_CHANGED');
  await db.legalDocument.update({where:{id:publicQuote.document.id},data:{status:'PUBLISHED'}});
  const confirmed:any=await service.customerAct(created.id,'confirm',confirmInput,sub.customer.id);
  assert.equal(confirmed.status,'AWAITING_SIGNATURE');
  const prepared=await db.serial(tx=>prepareElectronicDocument(tx,{kind:'RENEWAL',resourceId:created.id,revision:confirmed.revision,idempotencyKey:randomUUID()},f.actor.id,f.writer,{...f.options,resolveParties:async()=>parties}));
  const task=await db.electronicSigningTask.findUniqueOrThrow({where:{id:prepared.taskId},include:{parties:true}});assert.equal(task.kind,'RENEWAL');assert.equal(await db.electronicSealGrant.count({where:{ownerId:f.owner.id}}),0);assert.deepEqual(task.parties.sort((a,b)=>a.sequence-b.sequence).map(p=>[p.role,p.mode]),[['CUSTOMER','MANUAL'],['OWNER','MANUAL'],['PLATFORM','MANUAL']]);
  const stored=await db.contract.findUniqueOrThrow({where:{id:contract.id}});assert.equal(JSON.parse(stored.body).format,'PRIVATE_ELECTRONIC_PDF');
  await hooks.prepared?.({changeId:created.id,taskId:task.id});
  const waiting:any=await service.detail(created.id,undefined,sub.customer.id);assert.equal(waiting.electronicDocument.id,task.id);assert.equal(waiting.canPrepareElectronic,false);
  assert.equal(await db.orderServiceStage.count({where:{orderId:sub.order.id}}),1);
  let uploads=0;
  const signer=new ElectronicDocumentService(db,{upload:async()=>{uploads++;return{evidenceHash:sha('c')};},manualUrl:async()=>({url:'https://synthetic.invalid/manual'}),querySigner:async()=>({status:'SIGNED',...syntheticSigningTime(new Date()),evidenceHash:sha('b')}),fileContract:async()=>({evidenceHash:sha('d')}),downloadFinal:async()=>({bytes:Buffer.from('%PDF-1.7\nSynthetic05 signed proof boundary\n'+sha('f')+'\n%%EOF')}),verifyFinalFile:async(doc:any,bytes:Buffer)=>syntheticFinalVerification(doc,createHash('sha256').update(bytes).digest('hex'))} as any,f.writer,{resolveParties:async()=>parties,afterArchive:activateElectronicRenewal});
  const admin={kind:'ADMIN' as const,id:f.actor.id};
  const privatePdf=await signer.file({kind:'CUSTOMER',id:sub.customer.id},task.id,'source'),identity=await db.eSignAccount.findUniqueOrThrow({where:{customerId:sub.customer.id}}),privateIdentity=decryptIdentity(identity.identityCiphertext,sub.customer.id,process.env.ESIGN_IDENTITY_ENCRYPTION_KEY||'');
  await assert.rejects(signer.file({kind:'CUSTOMER',id:randomUUID()},task.id,'source'));
  await assert.rejects(new FilesController(db).customerRead(task.sourceFileId,{customer:{id:sub.customer.id}},{setHeader:()=>{},send:()=>{}}));
  const python=process.env.PDF_QA_PYTHON||resolve(process.env.USERPROFILE!,'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'),pdfText=execFileSync(python,['-X','utf8','-c','import sys,io; from pypdf import PdfReader; print("\\n".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(sys.stdin.buffer.read())).pages))'],{input:privatePdf.bytes,encoding:'utf8'}).replace(/\s/g,'');
  for(const value of [privateIdentity.idCardNo,dates.start,dates.end,'原押金','最短3个月','赠送换车2次'])assert.ok(pdfText.includes(value),`05 PDF missing ${value===privateIdentity.idCardNo?'private identity':value}`);
  for(const view of [await service.detail(created.id,f.actor),await service.detail(created.id,undefined,sub.customer.id),await service.list({},undefined,sub.customer.id)]){assert.ok(!JSON.stringify(view).includes(privateIdentity.idCardNo));assert.ok(!JSON.stringify(view).includes('6222000012345678'));assert.ok(!JSON.stringify(view).includes('PRIVATE_ELECTRONIC_PDF'));}
  await db.vehicleListing.update({where:{id:listing.id},data:{visible:false}});
  await assert.rejects(signer.start(admin,task.id,{revision:task.revision,idempotencyKey:randomUUID()}),(e:any)=>e.getResponse?.().error?.code==='GOODS_UNAVAILABLE');assert.equal(uploads,0);
  await db.vehicleListing.update({where:{id:listing.id},data:{visible:true}});
  await signer.start(admin,task.id,{revision:task.revision,idempotencyKey:randomUUID()});assert.equal(uploads,1);
  for(const role of ['CUSTOMER','OWNER','PLATFORM']){
   const state=await db.electronicSigningTask.findUniqueOrThrow({where:{id:task.id}}),ownerId=role==='OWNER'?f.owner.id:f.platform.id;
   const actor=role==='CUSTOMER'?{kind:'CUSTOMER' as const,id:sub.customer.id}:{kind:'OWNER' as const,id:(await db.ownerESignAccount.findUniqueOrThrow({where:{ownerId}})).managerCustomerId!,ownerId};
   await signer.sign(actor,task.id,{revision:state.revision,sourceSha256:task.sourceSha256,accepted:true,idempotencyKey:randomUUID()});ctx.mock.timers.setTime(Date.now()+1000);
   const next=await db.electronicSigningTask.findUniqueOrThrow({where:{id:task.id}});await signer.sync(admin,task.id,{revision:next.revision,idempotencyKey:randomUUID()});
  }
  const signed=await db.electronicSigningTask.findUniqueOrThrow({where:{id:task.id}});assert.equal(signed.status,'ARCHIVED',signed.lastErrorCode??'no error');
  const stoppedRollback=new Error('rollback stopped05 proof probe');await assert.rejects(db.serial(async(tx:any)=>{await tx.electronicSigningTask.update({where:{id:task.id},data:{withdrawnAt:new Date()}});await assert.rejects(activateElectronicRenewal(tx,await tx.electronicSigningTask.findUniqueOrThrow({where:{id:task.id}})));await assert.rejects(new OrderRenewalsService({serial:(fn:any)=>fn(tx)} as any,()=>new Date()).financePreview(created.id,financeActor));assert.equal(await tx.orderServiceStage.count({where:{orderId:sub.order.id}}),1);throw stoppedRollback;}),(e:any)=>e===stoppedRollback);
  await db.vehicleListing.update({where:{id:listing.id},data:{visible:false}}); // Signed history does not acquire today's sale-readiness requirement.
  const financePreview:any=await service.financePreview(created.id,financeActor);assert.equal(financePreview.startDate,dates.start);
  const stagePrepared=await service.prepare(created.id,{revision:financePreview.revision,orderRevision:financePreview.orderRevision,accountRevision:financePreview.accountRevision,previewHash:financePreview.previewHash,idempotencyKey:randomUUID()},financeActor);
  if(hooks.financePrepared)return hooks.financePrepared({service,changeId:created.id,stageId:stagePrepared.stageId,quoteId:quote.id,taskId:task.id,priorTermsVersionId,financeActor,purchased});
  const first=await db.bill.findFirstOrThrow({where:{serviceStageId:stagePrepared.stageId},orderBy:{sequence:'asc'}});
  await publishBillAutomatically(db,first.id,new Date());const payment=await billing.pay(payingCustomer,first.id,randomUUID());gateway.capture(payment.paymentId);await billing.sync(payment.paymentId);
  const schedule:any=await service.schedulePreview(created.id,financeActor);assert.equal(schedule.ready,true,JSON.stringify(schedule.blockers));
  await service.schedule(created.id,{revision:schedule.revision,orderRevision:schedule.orderRevision,accountRevision:schedule.accountRevision,stageId:schedule.stageId,stageRevision:schedule.stageRevision,previewHash:schedule.previewHash,idempotencyKey:randomUUID()},financeActor);
  const activationInput=(p:any)=>({revision:p.revision,orderRevision:p.orderRevision,accountRevision:p.accountRevision,stageId:p.stageId,stageRevision:p.stageRevision,previousStageRevision:p.previousStageRevision,assignmentId:p.assignmentId,previewHash:p.previewHash,idempotencyKey:randomUUID()});
  const early:any=await service.activationPreview(created.id,f.actor);assert.ok(early.blockers.includes('RENEWAL_NOT_STARTED'));
  await assert.rejects(service.activate(created.id,activationInput(early),f.actor),(e:any)=>e.getResponse?.().error?.code==='RENEWAL_NOT_STARTED');
  assert.equal(await db.usagePeriod.count({where:{serviceStageId:stagePrepared.stageId}}),0);assert.equal(await db.swapCredit.count({where:{serviceStageId:stagePrepared.stageId}}),0);
  const oldBills=await db.bill.findMany({where:{orderId:sub.order.id,serviceStageId:null,type:{in:['SUBSCRIPTION','SWAP_ADJUSTMENT']}},orderBy:[{dueDate:'asc'},{sequence:'asc'}]});
  for(const b of oldBills.filter(b=>b.status==='PENDING')){ctx.mock.timers.setTime(new Date(b.dueDate).getTime()+3600000);await publishBillAutomatically(db,b.id,new Date());const p=await billing.pay(payingCustomer,b.id,randomUUID());gateway.capture(p.paymentId);await billing.sync(p.paymentId);}
  ctx.mock.timers.setTime(new Date(dates.startAt).getTime());
  const activation:any=await service.activationPreview(created.id,f.actor);assert.equal(activation.ready,true,JSON.stringify(activation.blockers));const activateCommand=activationInput(activation);
  if(hooks.activationReady)return hooks.activationReady({service,changeId:created.id,stageId:stagePrepared.stageId,quoteId:quote.id,taskId:task.id,priorTermsVersionId,financeActor,purchased,activateCommand});
  const active=await service.activate(created.id,activateCommand,f.actor);assert.equal(active.status,'ACTIVE');assert.deepEqual(await service.activate(created.id,activateCommand,f.actor),active);
  const chain=await readEffectiveContractChain(db,sub.order.id);assert.equal(chain.ready,true,JSON.stringify(chain.blockers));assert.equal(chain.termsVersionId,active.termsVersionId);
  const effective=await db.orderTermsVersion.findUniqueOrThrow({where:{id:active.termsVersionId}}),currentOrder=await db.order.findUniqueOrThrow({where:{id:sub.order.id}}),currentSource=await readCurrentRenewalVehicleSource(db,currentOrder,effective);assert.equal(currentSource.product.productVersionId,product.id);assert.equal(currentSource.product.monthlyFeeAmount,20000);
  const listed=await db.serial((tx:any)=>readAdminOrders(tx,f.actor,{keyword:sub.order.id}));assert.equal(listed.items[0].productName,product.name);assert.equal(listed.items[0].monthlyFeeAmount,20000);assert.equal(listed.items[0].months,3);
  const invalidListRollback=new Error('rollback05 invalid list proof');await assert.rejects(db.serial(async(tx:any)=>{await tx.electronicSigningTask.update({where:{id:task.id},data:{withdrawnAt:new Date()}});const invalid=await readAdminOrders(tx,f.actor,{keyword:sub.order.id});assert.equal(invalid.items[0].productName,null);assert.equal(invalid.items[0].monthlyFeeAmount,null);throw invalidListRollback;}),(e:any)=>e===invalidListRollback);
  const rollback=new Error('rollback05 integrity probe');await assert.rejects(db.serial(async(tx:any)=>{await tx.order.update({where:{id:sub.order.id},data:{effectiveTermsVersionId:priorTermsVersionId}});assert.equal((await readEffectiveContractChain(tx,sub.order.id)).ready,false);throw rollback;}),(e:any)=>e===rollback);
  assert.equal((await readEffectiveContractChain(db,sub.order.id)).ready,true);
  const current=await db.order.findUniqueOrThrow({where:{id:sub.order.id}}),account=await db.usageAccount.findUniqueOrThrow({where:{orderId:sub.order.id}}),rights:any=await creditView(db,current,account,new Date());assert.equal(rights.term.includedCount,2);assert.equal(rights.term.available,2);
  assert.deepEqual(await db.swapCreditPurchase.findUniqueOrThrow({where:{id:purchased.purchase.id}}),purchased.purchase);assert.deepEqual(await db.swapCredit.findUniqueOrThrow({where:{id:purchased.credit.id}}),purchased.credit);assert.deepEqual(await db.mileagePurchase.findUniqueOrThrow({where:{id:purchased.mileagePurchase.id}}),purchased.mileagePurchase);
  assert.ok(new Date(purchased.purchase.expiresAt)<=new Date(dates.startAt));assert.ok(new Date(purchased.mileagePurchase.expiresAt)<new Date(dates.startAt));
  for(const b of originalBills){const after=await db.bill.findUniqueOrThrow({where:{id:b.id}});assert.deepEqual([after.amount,after.dueDate,after.serviceStageId],[b.amount,b.dueDate,b.serviceStageId]);}
  assert.deepEqual(await db.payment.findMany({where:{id:{in:originalPayments.map((p:any)=>p.id)}},orderBy:{id:'asc'}}),originalPayments);
  assert.equal(await db.handover.count({where:{orderId:sub.order.id}}),handoverCount);assert.equal(await db.usagePeriod.count({where:{serviceStageId:stagePrepared.stageId}}),3);
  return {service,changeId:created.id,stageId:stagePrepared.stageId,quoteId:quote.id,taskId:task.id,priorTermsVersionId,financeActor,purchased};
}
