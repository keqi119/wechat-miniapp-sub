import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {activeSwapFixture} from './v31-swap-fixture';
import {VehicleChangesService} from '../src/vehicle-changes/service';
import {readOfflineSwapQuotePreview,listOfflineSwapTargets} from '../src/vehicle-changes/offline-quote-preview';
import {OrderChangesService} from '../src/order-changes/service';
import {v31FixtureContent} from './v31-cooperation-fixture';
import {prepareElectronicDocument} from '../src/electronic-documents/prepare';
import {acceptConsents,currentDocuments} from '../src/auth/consents';
import {syntheticArchive} from './v31-initial-fixture';
import {finalizeElectronicArchive} from '../src/electronic-documents/archive';
import {activateElectronicSwap} from '../src/vehicle-changes/electronic-archive';
import {ElectronicDocumentService} from '../src/electronic-documents/service';
import {decryptIdentity} from '../src/esign/fadada/fadada-safety';
import {FieldHandoverService} from '../src/field-handover/service';
import {VehicleReceiptController} from '../src/offline-documents/vehicle-receipt';
import {saveFile} from '../src/files/storage';
import {segmentUsage,noVehicleUsage} from '../src/vehicle-changes/segments';
import {FilesController} from '../src/files/files';
import {readEffectiveContractChain} from '../src/order-changes/agreement-readiness';
import {AddonProductsController} from '../src/addon-products/controller';
import {SwapPurchasesController} from '../src/swap-purchases/controller';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {UsageController} from '../src/usage/usage.controller';
import {UsageService} from '../src/usage/usage.service';
import {swapFactFinanceView,respondSwapSettlement} from '../src/vehicle-changes/fact-settlement';
export async function runSwapCommandJourney(ctx:any,scenario:'delay'|'upgrade'|'gap'='delay',continuation?:{configureDb?:(db:Db)=>void;configureSources:(db:any,f:any,target:any)=>Promise<void>;run:(ctx:any,db:any,fixture:any)=>Promise<void>;partial?:(ctx:any,db:any,fixture:any)=>Promise<void>;beforeFinance?:(ctx:any,db:any,fixture:any)=>Promise<void>;stopAfterBeforeFinance?:boolean;preserveFailedOriginalRequest?:boolean}){
 ctx.mock.timers.enable({apis:['Date'],now:new Date('2026-11-12T02:00:00Z')});
 const db=new Db(),saved={...process.env},sourceFailures:string[]=[];
 continuation?.configureDb?.(db);
 try{
  const {f,sub,target,listing:originalTargetListing,parties,controller,model,billing,gateway,payingCustomer,lateFailedPayment}=await activeSwapFixture(db,{configureSources:continuation?.configureSources,preserveFailedOriginalRequest:continuation?.preserveFailedOriginalRequest,includedCount:0,...(scenario==='delay'?{}:{targetFee:30000})}),service=new VehicleChangesService(db,()=>new Date());
  await db.adminUser.update({where:{id:f.actor.id},data:{staffPersonId:'synthetic-person-'+f.actor.id}});
  process.env.SWAP_CREDIT_PURCHASE_ENABLED='true';
  await db.serial(async tx=>acceptConsents(tx,sub.customer.id,(await currentDocuments(tx,['terms','privacy'])).map((d:any)=>({documentId:d.id,version:d.version})),['terms','privacy'],'SYNTHETIC_TEST'));
  const session=await db.customerSession.create({data:{id:randomUUID(),customerId:sub.customer.id,expiresAt:new Date('2026-11-20')}}),customerRequest={customer:{id:sub.customer.id},session:{id:session.id}};
  const addons=new AddonProductsController(db,()=>new Date()),addon=await addons.create({kind:'SWAP_CREDIT',name:'合成单次服务费',scopePrices:[{id:'target',scopes:[{brand:model.brand,allModels:false,modelDefinitionIds:[model.id]}],prices:[{quantity:1,amount:50000}]}],revision:0,idempotencyKey:randomUUID()},{admin:f.actor});
  await addons.publish(addon.productId,{versionId:addon.id,revision:addon.revision,idempotencyKey:randomUUID()},{admin:f.actor});
  const catalog:any=await addons.catalog(sub.order.id,{kind:'SWAP_CREDIT',targetModelDefinitionId:model.id},customerRequest),product=catalog.products[0];assert.ok(product);
  const purchases=new SwapPurchasesController(db,billing,()=>new Date()),purchase=await purchases.purchase(sub.order.id,{sku:'SWAP_CREDIT_ADDON_1',productId:product.productId,versionId:product.versionId,quoteId:product.quotes[0].quoteId,sourceHash:product.sourceHash,targetModelDefinitionId:model.id,termsVersion:catalog.terms.version,termsHash:catalog.terms.hash,accepted:true,idempotencyKey:randomUUID()},customerRequest);
  const purchasePayment=await billing.pay(payingCustomer,purchase.bill.id,randomUUID());gateway.capture(purchasePayment.paymentId);await billing.sync(purchasePayment.paymentId);
  assert.equal((await db.swapCreditPurchase.findUniqueOrThrow({where:{id:purchase.purchase.id}})).status,'ACTIVE');
  const context=await service.adminContext(db,sub.order.id,f.actor);
  assert.equal(context.canCreate,true,JSON.stringify(context.blockers));
  const input={reason:'合成同商换车',idempotencyKey:randomUUID(),expectedOrderRevision:context.orderRevision,priorTermsHash:context.priorTermsHash};
  await assert.rejects(service.create(sub.order.id,input,{...f.actor,authVersion:f.actor.authVersion+1}));
  await assert.rejects(service.create(sub.order.id,input,undefined,randomUUID()));
  const change=await service.create(sub.order.id,input,f.actor);
  assert.equal((await service.create(sub.order.id,input,f.actor)).id,change.id);
  const row=await db.orderChange.findUniqueOrThrow({where:{id:change.id}});
  assert.ok(row.originalArchiveVersionId);assert.equal(row.priorTermsHash,context.priorTermsHash);
  const targets=await db.serial(tx=>listOfflineSwapTargets(tx,change.id,{keyword:target.id},f.actor));
  // Listing search includes real vehicle title; select the exact server-returned source.
  const all=await db.serial(tx=>listOfflineSwapTargets(tx,change.id,{keyword:target.vin},f.actor)),selected=all.items.find((v:any)=>v.vehicle.id===target.id&&v.targetListingId===originalTargetListing.id);assert.ok(selected);
  const quote={pricingVersion:3,revision:row.revision,targetListingId:selected.targetListingId,targetListingRevision:selected.targetListingRevision,targetSourceHash:selected.targetSourceHash,plannedReturnAt:'2026-11-12T01:30:00Z',plannedDeliveryAt:scenario==='delay'?'2026-11-12T01:45:00Z':scenario==='upgrade'?'2026-11-14T01:45:00Z':'2027-01-15T01:45:00Z',handoverArrangement:'合成换车地点及联系渠道',reason:'合成同商同价换车',expiresAt:'2026-11-13T02:00:00Z'};
  const preview=await db.serial(tx=>readOfflineSwapQuotePreview(tx,change.id,quote,f.actor));assert.equal(preview.depositAmount,10000);
  await assert.rejects(db.serial(tx=>readOfflineSwapQuotePreview(tx,change.id,{...quote,targetListingRevision:quote.targetListingRevision+1},f.actor)));
  await assert.rejects(db.serial(tx=>readOfflineSwapQuotePreview(tx,change.id,{...quote,depositAmount:0},f.actor)));
  const changes=new OrderChangesService(db,()=>new Date());
  await changes.act(change.id,'quotes',{...quote,previewHash:preview.previewHash,idempotencyKey:randomUUID()},f.actor);
  const quoted=await db.orderChange.findUniqueOrThrow({where:{id:change.id}}),q=await db.delayQuote.findUniqueOrThrow({where:{id:quoted.activeQuoteId!}});
  assert.equal(quoted.status,'REVIEW_PENDING');assert.equal((q.snapshot as any).depositAmount,10000);assert.ok((q.snapshot as any).electronicTerms.hash);
  const cancelRollback=new Error('rollback genuinely unperformed cancellation');
  await assert.rejects(db.serial(async tx=>{
   const local=new OrderChangesService({serial:(fn:any)=>fn(tx)} as any,()=>new Date());
   const cancelled=await local.act(change.id,'cancel',{revision:quoted.revision,reason:'尚未履行真实取消',idempotencyKey:randomUUID()},f.actor);assert.equal(cancelled.status,'CANCELLED');
   assert.equal(await tx.swapReservation.count({where:{changeId:change.id,status:'RESERVED'}}),0);assert.equal(await tx.swapLedger.count({where:{changeId:change.id,type:'CONSUME'}}),0);assert.equal(await tx.swapLedger.count({where:{changeId:change.id,type:'RELEASE'}}),1);throw cancelRollback;
  }),e=>e===cancelRollback);
  const reviewer=await db.adminUser.create({data:{username:randomUUID(),passwordHash:'synthetic-only',name:'合成财务复核',role:'FINANCE',staffPersonId:'synthetic-person-'+randomUUID()}});
  await db.legalDocument.create({data:{type:'ELECTRONIC_V31_VEHICLE_SWAP',version:Math.floor(Math.random()*1000000000)+1,title:'合成独立03',content:v31FixtureContent('03'),status:'PUBLISHED',confirmedBy:f.actor.id,confirmedAt:new Date()}});
  await changes.act(change.id,'review',{revision:quoted.revision,decision:'APPROVED',note:'合成独立复核',idempotencyKey:randomUUID()},reviewer);
  await changes.act(change.id,'publish',{revision:quoted.revision+1,idempotencyKey:randomUUID()},f.actor);
  const published=await db.orderChange.findUniqueOrThrow({where:{id:change.id}}),publishedQuote=await db.delayQuote.findUniqueOrThrow({where:{id:published.activeQuoteId!}});
  assert.equal((await changes.view(db,change.id,undefined,sub.customer.id)).canConfirm,true);
  await db.serial(async tx=>acceptConsents(tx,sub.customer.id,(await currentDocuments(tx,['terms','privacy'])).map((d:any)=>({documentId:d.id,version:d.version})),['terms','privacy'],'SYNTHETIC_TEST'));
  await changes.act(change.id,'confirm',{revision:published.revision,commercialHash:publishedQuote.commercialHash,idempotencyKey:randomUUID()},undefined,sub.customer.id);
  const confirmed=await db.orderChange.findUniqueOrThrow({where:{id:change.id}});
  const prepared=await db.serial(tx=>prepareElectronicDocument(tx,{kind:'VEHICLE_SWAP',resourceId:change.id,revision:confirmed.revision,idempotencyKey:randomUUID()},f.actor.id,f.writer,{...f.options,resolveParties:async()=>parties}));
  await assert.rejects(db.serial(tx=>prepareElectronicDocument(tx,{kind:'VEHICLE_SWAP',resourceId:change.id,revision:confirmed.revision-1,idempotencyKey:randomUUID()},f.actor.id,f.writer,{...f.options,resolveParties:async()=>parties})));
  const task=await db.electronicSigningTask.findUniqueOrThrow({where:{id:prepared.taskId},include:{parties:true}});
  assert.equal(task.kind,'VEHICLE_SWAP');assert.equal(task.orderId,sub.order.id);assert.ok(task.parties.every(p=>p.mode==='MANUAL'));assert.equal(task.parties.length,3);
  assert.equal(await db.electronicSealGrant.count({where:{ownerId:f.owner.id}}),0);
  const document=await db.contract.findUniqueOrThrow({where:{id:task.contractId!}});
  assert.equal(JSON.parse(document.body).format,'PRIVATE_ELECTRONIC_PDF');
  const publicView=await changes.view(db,change.id,undefined,sub.customer.id);assert.equal(publicView.quote?.v31Sources,undefined);assert.ok(!JSON.stringify(publicView).includes('identityNumber'));
  assert.equal((await changes.view(db,change.id,f.actor)).canCreateReturn,true);
  const identity=await db.eSignAccount.findUniqueOrThrow({where:{customerId:sub.customer.id}}),privateIdentity=decryptIdentity(identity.identityCiphertext!,sub.customer.id,process.env.ESIGN_IDENTITY_ENCRYPTION_KEY||'');
  assert.ok(!JSON.stringify(publicView).includes(privateIdentity.idCardNo));assert.ok(!JSON.stringify(await changes.view(db,change.id,f.actor)).includes(privateIdentity.idCardNo));
  // The actual return remains recordable before03 archive and before any finance preparation.
  const field=await db.adminUser.create({data:{username:randomUUID(),passwordHash:'synthetic-only',name:'合成接收员工',role:'FIELD'}}),fields=new FieldHandoverService(db);
  let returnTask=await fields.create({orderId:sub.order.id,type:'SWAP_RETURN',changeId:change.id,assigneeId:field.id},f.actor);
  const bytes=Buffer.from('89504e470d0a1a0a0000000049454e44ae426082','hex');
  const uploaded=await fields.upload(returnTask.id,returnTask.version,{buffer:bytes,mimetype:'image/png',originalname:'synthetic-swap.png',size:bytes.length} as any,field);
  returnTask=await fields.save(returnTask.id,{version:uploaded.task.version,draft:{actualAt:'2026-11-12T01:30:00Z',readingKm:220,batteryPercent:50,place:'合成库房',accessories:'齐全',condition:'正常',openItems:'无',resolutionPlan:'无',fileIds:[uploaded.id]}},field);
  returnTask=await fields.publish(returnTask.id,{version:returnTask.version,checked:true,idempotencyKey:randomUUID()},field);
  const receipts=new VehicleReceiptController(db),receiptInput={receivedAt:'2026-11-12T01:30:00Z',readingKm:220,storageLocation:'合成库房',evidenceFileIds:[uploaded.id],revision:0,handoverRevision:returnTask.handover!.revision,manifestHash:returnTask.handover!.manifestHash,taskVersion:returnTask.version,idempotencyKey:randomUUID()};
  assert.equal((await db.delayQuote.findUniqueOrThrow({where:{id:q.id}})).financePreparedAt,null);assert.equal(task.uploadedAt,null);assert.ok(task.parties.every(p=>p.status!=='SIGNED'));
  const receipt=await receipts.field(returnTask.id,receiptInput,{admin:field});
  assert.equal((await db.delayQuote.findUniqueOrThrow({where:{id:q.id}})).financePreparedAt,null);assert.equal((await db.contract.findUniqueOrThrow({where:{id:task.contractId!}})).status,'DRAFT');assert.equal((await db.electronicSigningTask.findUniqueOrThrow({where:{id:task.id}})).uploadedAt,null);
  assert.equal((await receipts.field(returnTask.id,receiptInput,{admin:field})).id,receipt.id);
  assert.equal((await db.order.findUniqueOrThrow({where:{id:sub.order.id}})).currentAssignmentId,null);
  assert.equal((await db.handover.findUniqueOrThrow({where:{id:returnTask.handoverId!}})).status,'PUBLISHED');
  assert.equal((await db.usageAccount.findUniqueOrThrow({where:{orderId:sub.order.id}})).packStatus,'ACTIVE');
  assert.equal((await fields.detail(returnTask.id,field,true)).contextChanged,false);
  await assert.rejects(receipts.field(returnTask.id,{...receiptInput,readingKm:221},{admin:field}));
  await assert.rejects(receipts.field(returnTask.id,{...receiptInput,idempotencyKey:randomUUID()},{admin:{...field,authVersion:field.authVersion+1}}));
  await controller.objectHandover(returnTask.handoverId!,{revision:returnTask.handover!.revision,manifestHash:returnTask.handover!.manifestHash,reason:'合成收车读数待核',readFileIds:[],fileIds:[],idempotencyKey:randomUUID()},{customer:{id:sub.customer.id}});
  await receipts.respond(change.id,{eventId:receipt.id,factHash:receipt.factHash,decision:'OBJECT',reason:'合成收车读数待核',idempotencyKey:randomUUID()},{customer:{id:sub.customer.id}});
  const correctionActor=await db.adminUser.create({data:{username:randomUUID(),passwordHash:'synthetic-only',name:'合成收车核验',role:'OPERATIONS'}});
  const correctedPhoto=await db.storedFile.create({data:{...await saveFile({buffer:bytes,mimetype:'image/png',originalname:'corrected-reading.png',size:bytes.length} as any),purpose:'handover',adminId:correctionActor.id}});
  const propose=async(revision:number,actor:any=correctionActor)=>receipts.received(returnTask.handoverId!,{...receiptInput,evidenceFileIds:[correctedPhoto.id],revision,previousEventId:receipt.id,receivedAt:'2026-11-12T01:35:00Z',readingKm:225,correctionReason:'根据追加证据核验收车时间及读数',idempotencyKey:randomUUID()},{admin:actor});
  for(const decision of ['REJECT','REQUEST_EVIDENCE'] as const){
   const pending=await propose(decision==='REJECT'?1:2),reviewInput={eventId:pending.id,revision:pending.revision,factHash:pending.factHash,decision,reason:'合成独立核验结论',idempotencyKey:randomUUID()};
   await assert.rejects(receipts.review(change.id,reviewInput,{admin:correctionActor}));
   await receipts.review(change.id,reviewInput,{admin:f.actor});
   assert.equal((await receipts.customerRead(change.id,{customer:{id:sub.customer.id}})).currentEventId,receipt.id);
  }
  const receiptAdmin=await db.adminUser.create({data:{username:randomUUID(),passwordHash:'synthetic-only',name:'合成管理员事实自审',role:'ADMIN',staffPersonId:'synthetic-person-'+randomUUID()}});
  const correction=await propose(3,receiptAdmin),reviewInput={eventId:correction.id,revision:correction.revision,factHash:correction.factHash,decision:'APPROVE',reason:'管理员事实自审，不批准任何资金',idempotencyKey:randomUUID()};
  if(scenario==='delay'){
   const replacement=await saveFile({buffer:Buffer.concat([bytes,Buffer.from('different synthetic evidence')]),mimetype:'image/png',originalname:'replacement-reading.png',size:bytes.length+28} as any),rollbackEvidence=new Error('rollback evidence-source probe');
   try{await db.serial(async tx=>{await tx.storedFile.update({where:{id:correctedPhoto.id},data:{storagePath:replacement.storagePath,sha256:replacement.sha256,size:replacement.size}});await new VehicleReceiptController({serial:(fn:any)=>fn(tx)} as any).review(change.id,reviewInput,{admin:receiptAdmin});throw rollbackEvidence;});}
   catch(e:any){if(e===rollbackEvidence)sourceFailures.push('receipt review accepted replacement bytes instead of proposed digest');else assert.equal(e.getResponse?.().error?.code,'RECEIPT_EVIDENCE_CHANGED');}
  }
  const reviewed=await receipts.review(change.id,reviewInput,{admin:receiptAdmin});assert.equal(reviewed.disposition,'APPLIED');assert.equal((await receipts.review(change.id,reviewInput,{admin:receiptAdmin})).id,reviewed.id);
  assert.equal((await db.vehicleAssignment.findUniqueOrThrow({where:{id:receipt.assignmentId!}})).endReadingKm,225);
  assert.equal((await db.handover.findUniqueOrThrow({where:{id:returnTask.handoverId!}})).readingKm,220);
  assert.equal((await fields.detail(returnTask.id,field,true)).contextChanged,false);
  await receipts.respond(change.id,{eventId:correction.id,factHash:correction.factHash,decision:'CONFIRM',idempotencyKey:randomUUID()},{customer:{id:sub.customer.id}});
  const receiptView=await receipts.customerRead(change.id,{customer:{id:sub.customer.id}});assert.equal(receiptView.currentEventId,correction.id);assert.equal(receiptView.pendingReviewIds.length,0);
  await assert.rejects(receipts.customerRead(change.id,{customer:{id:randomUUID()}}));
  await assert.rejects(db.swapReceiptEvent.update({where:{id:receipt.id},data:{readingKm:999}}));
  let streamed=0;await receipts.customerFile(change.id,correction.id,correctedPhoto.id,{customer:{id:sub.customer.id}},{setHeader:()=>{},send:()=>{streamed++;}});assert.equal(streamed,1);
  const segment=await db.usageSegment.findFirstOrThrow({where:{assignmentId:receipt.assignmentId!,endHandoverId:receipt.handoverId}}),period=await db.usagePeriod.findUniqueOrThrow({where:{id:segment.periodId}}),rollback=new Error('rollback metering assertion');
  await assert.rejects(db.serial(async tx=>{const used=await segmentUsage(tx,period);assert.equal(used?.used,25);assert.deepEqual(used?.evidence,[correctedPhoto.id]);const log=await tx.auditLog.findFirstOrThrow({where:{resourceId:segment.id,action:'FREEZE_SWAP_RECEIPT_METERING'}});assert.equal((log.data as any).receipt.eventId,correction.id);assert.equal((log.data as any).receipt.factHash,correction.factHash);assert.equal((log.data as any).originalHandover.readingKm,220);throw rollback;}),e=>e===rollback);
  for(const stale of [{endReadingKm:220},{endHandoverId:prepared.taskId}])await assert.rejects(db.serial(async tx=>{await tx.usageSegment.update({where:{id:segment.id},data:stale});await segmentUsage(tx,period);}));
  const partial=await db.orderChange.findUniqueOrThrow({where:{id:change.id}});await assert.rejects(changes.act(change.id,'cancel',{revision:partial.revision,idempotencyKey:randomUUID()},f.actor));
  assert.equal(await db.swapReservation.count({where:{changeId:change.id,status:'RESERVED'}}),1);
  let uploads=0;const service03=new ElectronicDocumentService(db,{upload:async()=>{uploads++;return{evidenceHash:'a'.repeat(64)};}} as any,f.writer,{resolveParties:async()=>parties,afterArchive:activateElectronicSwap});
  const privatePdf=await service03.file({kind:'CUSTOMER',id:sub.customer.id},task.id,'source');
  await assert.rejects(service03.file({kind:'CUSTOMER',id:randomUUID()},task.id,'source'));await assert.rejects(new FilesController(db).customerRead(task.sourceFileId,{customer:{id:sub.customer.id}},{setHeader:()=>{},send:()=>{}}));
  const python=process.env.PDF_QA_PYTHON||resolve(process.env.USERPROFILE!,'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'),pdfText=execFileSync(python,['-X','utf8','-c','import sys,io; from pypdf import PdfReader; print("\\n".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(sys.stdin.buffer.read())).pages))'],{input:privatePdf.bytes,encoding:'utf8'}).replace(/\s/g,'');
  assert.ok(pdfText.includes(privateIdentity.idCardNo));assert.ok(pdfText.includes('当前及后续服务月沿用原月含'));assert.ok(pdfText.includes('新车BaaS安排'));assert.ok(pdfText.includes('使用本单已付次数抵用，不重复收取'));
  await service03.start({kind:'ADMIN',id:f.actor.id},task.id,{revision:task.revision,idempotencyKey:randomUUID()});assert.equal(uploads,1);
  ctx.mock.timers.setTime(new Date('2026-11-12T02:01:00Z').getTime());
  await syntheticArchive(db,f,{...prepared,deferArchive:true});
  await db.serial(async tx=>{await finalizeElectronicArchive(tx,task.id);await activateElectronicSwap(tx,await tx.electronicSigningTask.findUniqueOrThrow({where:{id:task.id}}));});
  const archived=await db.orderChange.findUniqueOrThrow({where:{id:change.id}});
  if(continuation?.partial){await continuation.partial(ctx,db,{f,sub,target,parties,controller,billing,gateway,payingCustomer,change,receipt:correction,receiptAdmin});return;}
  assert.equal(archived.status,'SWAP_RETURNED');assert.equal((await db.order.findUniqueOrThrow({where:{id:sub.order.id}})).vehicleId,f.vehicle.id);
  assert.equal(await db.swapLedger.count({where:{changeId:change.id,type:'CONSUME'}}),0);
  await db.serial(tx=>activateElectronicSwap(tx,task));assert.equal((await db.orderChange.findUniqueOrThrow({where:{id:change.id}})).revision,archived.revision);
  const financialBefore=await db.bill.findMany({where:{orderId:sub.order.id},orderBy:{id:'asc'}});
  await assert.rejects(changes.act(change.id,'prepare-finance',{revision:archived.revision,idempotencyKey:randomUUID()},reviewer),(e:any)=>e.getResponse?.().error?.code==='SWAP_FACT_SETTLEMENT_REQUIRED');
  assert.deepEqual(await db.bill.findMany({where:{orderId:sub.order.id},orderBy:{id:'asc'}}),financialBefore);
  const deliveredAt=scenario==='delay'?'2026-11-14T01:50:00Z':scenario==='upgrade'?'2026-11-12T01:50:00Z':'2027-01-14T01:50:00Z';ctx.mock.timers.setTime(new Date(new Date(deliveredAt).getTime()+3600000).getTime());
  await db.eSignAccount.update({where:{customerId:sub.customer.id},data:{checkedAt:new Date()}});await db.ownerESignAccount.updateMany({where:{ownerId:{in:[f.owner.id,f.platform.id]}},data:{checkedAt:new Date()}});
  assert.equal((await changes.view(db,change.id,f.actor)).canCreateDelivery,true);
  let deliveryTask=await fields.create({orderId:sub.order.id,type:'SWAP_DELIVERY',changeId:change.id,assigneeId:field.id},f.actor);
  const deliveryPhoto=await fields.upload(deliveryTask.id,deliveryTask.version,{buffer:bytes,mimetype:'image/png',originalname:'synthetic-delivery.png',size:bytes.length} as any,field);
  deliveryTask=await fields.save(deliveryTask.id,{version:deliveryPhoto.task.version,draft:{actualAt:deliveredAt,readingKm:300,batteryPercent:50,place:'合成交付点',accessories:'齐全',condition:'正常',openItems:'无',resolutionPlan:'无',fileIds:[deliveryPhoto.id]}},field);
  const deliveryPolicy=await db.insurancePolicy.create({data:{insurer:'合成换入车保险',policyNumber:randomUUID(),createdBy:f.actor.id}});
  await db.insurancePolicyVersion.create({data:{policyId:deliveryPolicy.id,version:1,status:'APPROVED',effectiveAt:new Date('2026-11-01'),startAt:new Date('2026-11-01'),endAt:new Date('2027-11-01'),policyholder:'合成',insuredParty:'合成',vehicleIds:[target.id],coverageItems:[{code:'THIRD_PARTY',label:'三者',amount:100000000,deductible:'无',terms:'合成保险'}],terms:'合成保险',fileIds:[correctedPhoto.id],requirementVersionIds:[],reviewChecks:[{vehicleId:target.id,fileId:correctedPhoto.id,confirmed:true,note:'核对合成保单'}],createdBy:f.actor.id,reviewedBy:receiptAdmin.id,reviewedAt:new Date()}});
  deliveryTask=await fields.publish(deliveryTask.id,{version:deliveryTask.version,checked:true,idempotencyKey:randomUUID()},field);
  const delivery=await db.handover.findUniqueOrThrow({where:{id:deliveryTask.handoverId!}}),online=delivery.onlineRecordSnapshot as any;
  await new FilesController(db).customerRead(deliveryPhoto.id,{customer:{id:sub.customer.id}},{setHeader:()=>{},send:()=>{}});
  await controller.confirmHandover(delivery.id,{revision:delivery.revision,manifestHash:delivery.manifestHash,readFileIds:[deliveryPhoto.id],fileIds:[],idempotencyKey:randomUUID(),documentId:online.documentId,termsVersion:online.termsVersion,termsHash:online.termsHash,termsAccepted:true},{customer:{id:sub.customer.id}});
  assert.equal((await db.order.findUniqueOrThrow({where:{id:sub.order.id}})).currentAssignmentId,null);
  assert.equal(await db.swapLedger.count({where:{changeId:change.id,type:'CONSUME'}}),0);
  const {SwapSettlementController}=await import('../src/vehicle-changes/settlement-controller');
  const settlementApi=new SwapSettlementController(db),liveChange=await db.orderChange.findUniqueOrThrow({where:{id:change.id}});
  const settleInput={revision:liveChange.revision,receiptEventId:correction.id,deliveryHandoverId:delivery.id,idempotencyKey:randomUUID()};
  const settlement=await settlementApi.prepare(change.id,settleInput,{admin:receiptAdmin});
  assert.equal((await settlementApi.prepare(change.id,settleInput,{admin:receiptAdmin})).id,settlement.id);
  const amounts=await settlementApi.customer(settlement.id,{customer:{id:sub.customer.id}});
  assert.equal(amounts.result.depositAmount,10000);assert.equal(amounts.result.serviceFeeAmount,50000);assert.equal(amounts.sourceSnapshot.serviceFeeSource.paymentId,purchasePayment.paymentId);if(scenario==='delay'){assert.equal(amounts.result.shareableUpgradeRentAmount,0);assert.equal(amounts.result.periods[0].chargeAmount,0);}else assert.ok(amounts.result.shareableUpgradeRentAmount>0);assert.ok(amounts.result.periods.slice(1).some((p:any)=>p.chargeAmount>0));
  if(scenario==='delay'){assert.equal(amounts.result.periods[0].gapDays,2);assert.ok(amounts.result.rentRefundAmount>0);}if(scenario==='gap'){assert.equal(amounts.result.periods[1].amount,0);assert.ok(amounts.result.rentRefundAmount>0);}
  await assert.rejects(settlementApi.customer(settlement.id,{customer:{id:randomUUID()}}));
  const amountResponse={sourceHash:settlement.sourceHash,fundsHash:amounts.fundsHash,amountHash:amounts.amountHash,responseRevision:0,previousResponseId:null as string|null,decision:'CONFIRM',reason:'已核对真实车辆和逐期金额',idempotencyKey:randomUUID()};
  const responseError=(code:string)=>(e:any)=>e.getResponse?.().error?.code===code;
  assert.equal(amounts.responseRevision,0);assert.equal(amounts.currentResponse,null);
  await assert.rejects(settlementApi.respond(settlement.id,{...amountResponse,amountHash:'f'.repeat(64)},{customer:{id:sub.customer.id}}),responseError('SWAP_AMOUNT_CHANGED'));
  const objectionInput={...amountResponse,decision:'OBJECT',reason:'请解释无车期间减租算法',idempotencyKey:randomUUID()};
  const objectedAmount=await settlementApi.respond(settlement.id,objectionInput,{customer:{id:sub.customer.id}});
  assert.equal(objectedAmount.decision,'OBJECT');assert.equal(objectedAmount.revision,1);assert.equal(objectedAmount.previousResponseId,null);
  assert.equal((await changes.view(db,change.id,reviewer)).canPrepareFinance,false);
  await assert.rejects(changes.act(change.id,'prepare-finance',{revision:liveChange.revision,idempotencyKey:randomUUID()},reviewer),responseError('SWAP_AMOUNT_CONFIRMATION_REQUIRED'));
  const explained=await settlementApi.customer(settlement.id,{customer:{id:sub.customer.id}});
  assert.deepEqual(explained.result,amounts.result);assert.equal(explained.amountHash,amounts.amountHash);assert.equal(explained.fundsHash,amounts.fundsHash);
  assert.equal(explained.currentResponse.id,objectedAmount.id);assert.equal(explained.responseRevision,1);assert.equal(explained.responseHistory[0].reason,objectionInput.reason);
  const resolution={...amountResponse,responseRevision:explained.responseRevision,previousResponseId:explained.currentResponse.id,reason:'已逐期核对原金额、实际无车天数及减租算法，原异议已解决，同意不变金额'};
  await assert.rejects(settlementApi.respond(settlement.id,resolution,{customer:{id:randomUUID()}}),responseError('NOT_FOUND'));
  await assert.rejects(Promise.resolve().then(()=>settlementApi.respond(settlement.id,resolution,{admin:f.actor})),responseError('UNAUTHENTICATED'));
  await assert.rejects(Promise.resolve().then(()=>settlementApi.respond(settlement.id,{...resolution,customerId:sub.customer.id},{customer:{id:sub.customer.id}})));
  await assert.rejects(settlementApi.respond(settlement.id,{...resolution,sourceHash:'e'.repeat(64)},{customer:{id:sub.customer.id}}),responseError('SWAP_AMOUNT_CHANGED'));
  await assert.rejects(settlementApi.respond(settlement.id,{...resolution,fundsHash:'e'.repeat(64)},{customer:{id:sub.customer.id}}),responseError('SWAP_AMOUNT_CHANGED'));
  await assert.rejects(settlementApi.respond(settlement.id,{...resolution,previousResponseId:randomUUID()},{customer:{id:sub.customer.id}}),responseError('SWAP_AMOUNT_RESPONSE_CONFLICT'));
  await assert.rejects(settlementApi.respond(settlement.id,{...resolution,reason:''},{customer:{id:sub.customer.id}}),responseError('RESOLUTION_REASON_REQUIRED'));
  const originalRent=await db.payment.findFirstOrThrow({where:{customerId:sub.customer.id,bill:{orderId:sub.order.id,type:'SUBSCRIPTION'},status:'SUCCEEDED'}});
  await assert.rejects(db.serial(async tx=>{await tx.payment.update({where:{id:originalRent.id},data:{amount:{increment:1}}});await respondSwapSettlement(tx,settlement.id,sub.customer.id,resolution);}),responseError('SWAP_AMOUNT_CHANGED'));
  // Competing real transactions share a current predecessor; exactly one may append.
  const competing=[resolution,{...resolution,idempotencyKey:randomUUID()}];
  const raced=await Promise.allSettled(competing.map(body=>settlementApi.respond(settlement.id,body,{customer:{id:sub.customer.id}})));
  assert.equal(raced.filter(r=>r.status==='fulfilled').length,1);assert.equal(raced.filter(r=>r.status==='rejected').length,1);
  const winner=raced.findIndex(r=>r.status==='fulfilled'),confirmedAmount=(raced[winner] as PromiseFulfilledResult<any>).value,confirmedInput=competing[winner];
  assert.ok(responseError('SWAP_AMOUNT_RESPONSE_CONFLICT')((raced[1-winner] as PromiseRejectedResult).reason));
  assert.equal(confirmedAmount.revision,2);assert.equal(confirmedAmount.previousResponseId,objectedAmount.id);assert.equal(confirmedAmount.amountHash,objectedAmount.amountHash);
  assert.deepEqual(await db.swapFactAmountResponse.findUniqueOrThrow({where:{id:objectedAmount.id}}),objectedAmount);
  assert.equal((await settlementApi.respond(settlement.id,objectionInput,{customer:{id:sub.customer.id}})).id,objectedAmount.id,'old exact retry is historical only');
  const consent=await settlementApi.customer(settlement.id,{customer:{id:sub.customer.id}});assert.equal(consent.currentResponse.id,confirmedAmount.id);assert.equal(consent.responseHistory.length,2);
  await assert.rejects(settlementApi.respond(settlement.id,{...objectionInput,idempotencyKey:randomUUID()},{customer:{id:sub.customer.id}}),responseError('SWAP_AMOUNT_RESPONSE_CONFLICT'));
  await assert.rejects(settlementApi.respond(settlement.id,{...resolution,idempotencyKey:randomUUID()},{customer:{id:sub.customer.id}}),responseError('SWAP_AMOUNT_RESPONSE_CONFLICT'));
  const currentConfirmation={...confirmedInput,responseRevision:2,previousResponseId:confirmedAmount.id,idempotencyKey:randomUUID()};
  await assert.rejects(settlementApi.respond(settlement.id,{...currentConfirmation,decision:'OBJECT',reason:'冲突改写'},{customer:{id:sub.customer.id}}),responseError('SWAP_AMOUNT_RESPONSE_FROZEN'));
  await assert.rejects(settlementApi.respond(settlement.id,{...confirmedInput,reason:'重用键改请求'},{customer:{id:sub.customer.id}}),responseError('IDEMPOTENCY_CONFLICT'));
  ctx.mock.timers.setTime(Date.now()+60000);
  for(const replay of [confirmedInput,currentConfirmation]){const repeated=await settlementApi.respond(settlement.id,replay,{customer:{id:sub.customer.id}});assert.equal(repeated.id,confirmedAmount.id);assert.equal(repeated.createdAt.toISOString(),confirmedAmount.createdAt.toISOString());}
  assert.equal(await db.swapFactAmountResponse.count({where:{settlementId:settlement.id}}),2);
  assert.equal((await changes.view(db,change.id,reviewer)).canPrepareFinance,true);
  await assert.rejects(controller.complete(delivery.id,{admin:f.actor},{revision:delivery.revision,idempotencyKey:randomUUID()}));
  await assert.rejects(changes.act(change.id,'prepare-finance',{revision:liveChange.revision,idempotencyKey:randomUUID()},receiptAdmin),(e:any)=>e.getResponse?.().error?.code==='TWO_PERSON_REQUIRED');
  if(continuation?.beforeFinance)await continuation.beforeFinance(ctx,db,{f,sub,change,settlement,confirmedAmount,reviewer,billing,gateway,payingCustomer,lateFailedPayment});
  if(continuation?.stopAfterBeforeFinance)return;
  await changes.act(change.id,'prepare-finance',{revision:liveChange.revision,idempotencyKey:randomUUID()},reviewer);
  const preparedFinance=await db.swapFactFinance.findUniqueOrThrow({where:{settlementId:settlement.id}});
  assert.equal(preparedFinance.responseId,confirmedAmount.id);assert.equal((preparedFinance.plan as any).amountConfirmedAt,confirmedAmount.createdAt.toISOString());
  assert.equal((await settlementApi.respond(settlement.id,confirmedInput,{customer:{id:sub.customer.id}})).id,confirmedAmount.id);
  await assert.rejects(settlementApi.respond(settlement.id,{...currentConfirmation,idempotencyKey:randomUUID()},{customer:{id:sub.customer.id}}),responseError('SWAP_FACT_FINANCE_IMMUTABLE'));

  if(scenario!=='delay'){
   assert.equal((await changes.view(db,change.id,f.actor)).canComplete,false);
   await assert.rejects(controller.complete(delivery.id,{admin:f.actor},{revision:delivery.revision,idempotencyKey:randomUUID()}));
   const actualDay=deliveredAt.slice(0,10),due=await db.serviceObligation.findMany({where:{quoteId:q.id,chargeAmount:{gt:0}},orderBy:{sequence:'asc'}});
   for(const obligation of due.filter(o=>o.dueDate.toISOString().slice(0,10)<=actualDay||o.startDate.toISOString().slice(0,10)<=actualDay&&actualDay<o.endDate.toISOString().slice(0,10))){
    const pay=await billing.pay(payingCustomer,obligation.chargeBillId!,randomUUID());
    await billing.sync(pay.paymentId);assert.equal((await db.payment.findUniqueOrThrow({where:{id:pay.paymentId}})).status,'PENDING');
    assert.equal((await changes.view(db,change.id,f.actor)).canComplete,false);
    await assert.rejects(controller.complete(delivery.id,{admin:f.actor},{revision:delivery.revision,idempotencyKey:randomUUID()}));
    assert.equal((await db.order.findUniqueOrThrow({where:{id:sub.order.id}})).currentAssignmentId,null);
    assert.equal(await db.swapLedger.count({where:{changeId:change.id,type:'CONSUME'}}),0);
    assert.equal(await db.paymentAllocation.count({where:{paymentId:pay.paymentId,obligationId:obligation.id,releasedAt:null}}),0);
    gateway.capture(pay.paymentId);await billing.sync(pay.paymentId);
    assert.equal((await db.payment.findUniqueOrThrow({where:{id:pay.paymentId}})).status,'SUCCEEDED');
    assert.equal(await db.paymentAllocation.count({where:{paymentId:pay.paymentId,obligationId:obligation.id,releasedAt:null}}),1);
    await billing.sync(pay.paymentId);assert.equal(await db.paymentAllocation.count({where:{paymentId:pay.paymentId,obligationId:obligation.id,releasedAt:null}}),1);
   }
   assert.ok(await db.bill.count({where:{orderId:sub.order.id,type:'SWAP_ADJUSTMENT',status:'PENDING'}})>0,'future rent is not accelerated');
   const stable=await settlementApi.customer(settlement.id,{customer:{id:sub.customer.id}});assert.equal(stable.sourceHash,settlement.sourceHash);assert.equal(stable.amountHash,amounts.amountHash);
  }
  assert.equal((await changes.view(db,change.id,f.actor)).canComplete,true);
  assert.equal(await db.serviceObligation.count({where:{quoteId:q.id,swapSettlementId:settlement.id}}),(q.snapshot as any).months);
  assert.equal(await db.bill.count({where:{orderId:sub.order.id,type:'DEPOSIT_ADJUSTMENT'}}),0);
  assert.equal((await db.delayQuote.findUniqueOrThrow({where:{id:q.id}})).commercialHash,publishedQuote.commercialHash);
  assert.deepEqual((await settlementApi.customer(settlement.id,{customer:{id:sub.customer.id}})).sourceHash,settlement.sourceHash);
  if(scenario!=='gap'){
   const carry=await db.paymentAllocation.findFirstOrThrow({where:{obligation:{quoteId:q.id},payment:{bill:{type:'SUBSCRIPTION'}},releasedAt:null}}),depositPaid=await db.payment.findFirstOrThrow({where:{customerId:sub.customer.id,bill:{orderId:sub.order.id,type:'DEPOSIT'},status:'SUCCEEDED'}});
   await assert.rejects(db.serial(async tx=>{await tx.paymentAllocation.update({where:{id:carry.id},data:{paymentId:depositPaid.id}});await swapFactFinanceView(tx,await tx.orderChange.findUniqueOrThrow({where:{id:change.id}}));}),(e:any)=>e.getResponse?.().error?.code==='SWAP_PAYMENT_SOURCE');
  }
  const completeInput={revision:delivery.revision,idempotencyKey:randomUUID()};
  const delivered=await controller.complete(delivery.id,{admin:f.actor},completeInput);assert.equal(delivered.status,'COMPLETED');
  assert.equal((await controller.complete(delivery.id,{admin:f.actor},completeInput)).id,delivered.id);
  const appliedOrder=await db.order.findUniqueOrThrow({where:{id:sub.order.id}});assert.equal(appliedOrder.vehicleId,target.id);assert.ok(appliedOrder.currentAssignmentId&&appliedOrder.effectiveTermsVersionId);
  assert.equal(await db.swapLedger.count({where:{changeId:change.id,type:'CONSUME'}}),1);
  assert.equal(await db.bill.count({where:{orderId:sub.order.id,type:'SWAP_CREDIT'}}),1);assert.equal(await db.bill.count({where:{orderId:sub.order.id,type:'SWAP_HANDOVER_FEE'}}),0);assert.equal((await db.swapCreditPurchase.findUniqueOrThrow({where:{id:purchase.purchase.id}})).status,'CONSUMED');
  const chain=await readEffectiveContractChain(db,appliedOrder.id);assert.equal(chain.ready,true,JSON.stringify(chain.blockers));assert.equal(chain.termsVersionId,appliedOrder.effectiveTermsVersionId);
  assert.equal((await service.adminContext(db,appliedOrder.id,f.actor)).canCreate,true);
  if(scenario==='delay'){
   const rollbackLineage=new Error('rollback initial delivery lineage probe');let linked=true;
   await assert.rejects(db.serial(async tx=>{await tx.vehicleAssignment.update({where:{id:receipt.assignmentId},data:{deliveryHandoverId:receipt.handoverId}});linked=(await readEffectiveContractChain(tx,appliedOrder.id)).ready;throw rollbackLineage;}),e=>e===rollbackLineage);
   if(linked)sourceFailures.push('effective chain accepted borrowed initial delivery link');
  }

  if(scenario==='gap'){
   const emptyPeriod=await db.usagePeriod.findFirstOrThrow({where:{orderId:sub.order.id,sequence:2}}),zero=await db.serial(tx=>noVehicleUsage(tx,emptyPeriod));
   assert.equal(zero?.used,0);assert.equal((zero as any).receiptEventId,correction.id);assert.equal((zero as any).settlementId,settlement.id);
   assert.ok(zero?.evidence.includes(correctedPhoto.id));assert.ok(zero?.evidence.includes(deliveryPhoto.id));
   const usageApi=new UsageController(db,new UsageService(db,()=>new Date()),()=>new Date()),first=await db.usagePeriod.findFirstOrThrow({where:{orderId:sub.order.id,sequence:1}});
   assert.equal((await usageApi.settle(first.id,{revision:first.revision,idempotencyKey:randomUUID()},{admin:reviewer})).usedKm,25);
   const freshEmpty=await db.usagePeriod.findUniqueOrThrow({where:{id:emptyPeriod.id}}),zeroInput={revision:freshEmpty.revision,idempotencyKey:randomUUID()};
   assert.equal((await usageApi.settle(emptyPeriod.id,zeroInput,{admin:reviewer})).usedKm,0);assert.equal((await usageApi.settle(emptyPeriod.id,zeroInput,{admin:reviewer})).usedKm,0);
   const zeroAudit=await db.auditLog.findFirstOrThrow({where:{resourceId:emptyPeriod.id,action:'SETTLE_USAGE_PERIOD'}});assert.equal((zeroAudit.data as any).noVehicleSource.settlementId,settlement.id);

  }
  const activeTerms=await db.orderTermsVersion.findUniqueOrThrow({where:{id:appliedOrder.effectiveTermsVersionId!}});assert.equal((activeTerms.snapshot as any).mileagePerMonthKm,1500);assert.equal((activeTerms.snapshot as any).excessMileagePriceAmount,150);
  const originalAssignment=await db.vehicleAssignment.findUniqueOrThrow({where:{id:receipt.assignmentId}});
  const lateCorrection=await receipts.received(receipt.handoverId,{...receiptInput,evidenceFileIds:[correctedPhoto.id],revision:4,previousEventId:correction.id,receivedAt:'2026-11-12T01:37:00Z',readingKm:227,correctionReason:'交付后补充核验原收车时间读数',idempotencyKey:randomUUID()},{admin:receiptAdmin});
  const financialReview=await receipts.review(change.id,{eventId:lateCorrection.id,revision:lateCorrection.revision,factHash:lateCorrection.factHash,decision:'APPROVE',reason:'原事实核验通过，资金差异仍须独立财务处理',idempotencyKey:randomUUID()},{admin:receiptAdmin});assert.equal(financialReview.disposition,'REQUIRES_FINANCIAL_REVIEW');assert.equal((financialReview.sourceSnapshot as any).financialSource.settlementId,settlement.id);assert.equal((financialReview.sourceSnapshot as any).financialSource.correctedAmountsConfirmed,false);
  assert.deepEqual(await db.vehicleAssignment.findUniqueOrThrow({where:{id:receipt.assignmentId}}),originalAssignment);assert.equal((await db.order.findUniqueOrThrow({where:{id:sub.order.id}})).currentAssignmentId,appliedOrder.currentAssignmentId);
  const frozenFinance=await settlementApi.customer(settlement.id,{customer:{id:sub.customer.id}});assert.equal(frozenFinance.sourceHash,settlement.sourceHash);assert.equal(frozenFinance.responseId,confirmedAmount.id);assert.equal(await db.swapLedger.count({where:{changeId:change.id,type:'CONSUME'}}),1);
  assert.deepEqual(sourceFailures,[]);
  if(continuation)await continuation.run(ctx,db,{f,sub,target,parties,controller,model,billing,gateway,payingCustomer});
 }finally{await db.$disconnect();ctx.mock.timers.reset();for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
}
