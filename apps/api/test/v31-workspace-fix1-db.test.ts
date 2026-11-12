import {SimpleAgreementService} from '../src/partners/simple-agreements';
import {canonicalHash} from '../src/customers/types';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {prepareFixture,syntheticArchive} from './v31-initial-fixture';
import {seedV31Subscription,v31FixtureContent} from './v31-cooperation-fixture';
import {prepareElectronicDocument,resolveElectronicPreparation} from '../src/electronic-documents/prepare';
import {readContractWorkspace} from '../src/electronic-documents/workspace';
import {Cancellation04Service} from '../src/orders/cancellation04';
import {TerminationService} from '../src/orders/termination';
import {ElectronicDocumentService} from '../src/electronic-documents/service';
import {ownerMobileHash} from '../src/owner-h5/legal-representative';
import {signingParties,sha} from './electronic-fixtures';
import {activeSwapFixture} from './v31-swap-fixture';
import {seedRenewalProduct} from './v31-renewal-journey';
import {OrderRenewalsService} from '../src/order-renewals/service';
import {VehicleChangesService} from '../src/vehicle-changes/service';
import {OrderChangesService} from '../src/order-changes/service';
import {listOfflineSwapTargets,readOfflineSwapQuotePreview} from '../src/vehicle-changes/offline-quote-preview';
import {acceptConsents,currentDocuments} from '../src/auth/consents';

const channel={configured:true,signingEnabled:true},dependenciesOnly=process.env.TASK10B_FIX1_SCOPE==='dependencies';
async function identities(db:any,f:any,customerId:string){
 const now=new Date();
 for(const ownerId of [f.owner.id,f.platform.id]){
  const a=await db.ownerESignAccount.findUniqueOrThrow({where:{ownerId}}),person=await db.customer.findUniqueOrThrow({where:{id:a.managerCustomerId}}),mobileHash=ownerMobileHash(person.mobile),serial=randomUUID();
  await db.ownerLegalRepresentative.update({where:{ownerId},data:{mobileHash}});
  await db.ownerMember.upsert({where:{ownerId_customerId:{ownerId,customerId:person.id}},create:{ownerId,customerId:person.id,status:'VERIFIED',verifiedAt:now,verifiedSerialNo:serial},update:{status:'VERIFIED',verifiedAt:now,verifiedSerialNo:serial}});
  await db.ownerESignAccount.update({where:{ownerId},data:{checkedAt:now,verifiedAt:now,verificationTransactionNo:serial,consentSnapshot:{ownerId,customerId:person.id,legalRevision:1,legalName:person.name,legalMobileHash:mobileHash,channel:'OWNER_LEGAL_H5'},certStatus:'BOUND',certSerialNo:serial,certSubjectHash:sha(ownerId===f.owner.id?'2':'3'),certEvidenceHash:sha('a'),certValidFrom:new Date(now.getTime()-86400000),certValidUntil:new Date(now.getTime()+86400000),certCheckedAt:now}});
  const seal=await db.ownerSeal.findFirst({where:{ownerId}});if(!seal)await db.ownerSeal.create({data:{ownerId,providerCustomerId:a.providerCustomerId,providerSignatureId:randomUUID(),status:'ACTIVE',imageHash:sha('a'),imageCiphertext:'synthetic-only',selectedBy:person.id,selectedAt:now,checkedAt:now}});
 }
 const a=await db.ownerESignAccount.findUniqueOrThrow({where:{ownerId:f.platform.id}}),seal=await db.ownerSeal.findFirstOrThrow({where:{ownerId:f.platform.id}});process.env.FADADA_PLATFORM_SIGNATURE_ID=seal.providerSignatureId;
 await db.eSignAccount.update({where:{customerId},data:{checkedAt:now,certSubjectHash:sha('1'),certCheckedAt:now}});
}
async function template(db:any,f:any,kind:string,file:string){return db.legalDocument.create({data:{type:'ELECTRONIC_V31_'+kind,version:Math.floor(Math.random()*1000000000)+1,title:'synthetic local '+kind,content:v31FixtureContent(file),status:'PUBLISHED',confirmedBy:f.actor.id,confirmedAt:new Date()}});}
const proxy=(tx:any)=>new Proxy(tx,{get:(target,key)=>key==='serial'?(fn:any)=>fn(tx):Reflect.get(target,key)});
async function rollback(db:Db,fn:(tx:any)=>Promise<void>){const stop=new Error('bounded branch rollback');await assert.rejects(db.$transaction(async tx=>{await fn(tx);throw stop;},{timeout:30000}),e=>e===stop);}
async function binding(db:any,f:any,orderId:string,kind:string,id:string){
 const source=await resolveElectronicPreparation(db,kind as any,id),view=await readContractWorkspace(db,{kind:'ADMIN',...f.actor},orderId,channel),r=view.readiness.find((r:any)=>r.kind===kind&&r.resourceId===id)!;
 assert.ok(r);assert.equal(r.revision,source.revision);assert.equal(r.businessHash,source.businessHash);assert.equal(r.canPrepare,true,JSON.stringify(r.missing));
 const prepared=await prepareElectronicDocument(db,{kind,resourceId:id,revision:r.revision,idempotencyKey:randomUUID()},f.actor.id,f.writer,f.options);
 assert.equal((await db.electronicSigningTask.findUniqueOrThrow({where:{id:prepared.taskId}})).businessHash,source.businessHash);
}

test('bounded confirmed04 readiness command, signer eligibility and later source routing',async ctx=>{
 ctx.mock.timers.enable({apis:['Date'],now:new Date('2026-11-13T04:00:00Z')});const db=new Db(),saved={...process.env};process.env.NEW_ORDER_CONTRACT_MODE='ELECTRONIC';process.env.SESSION_SECRET='synthetic-task10b-history-member-secret-at-least32';try{
 const f=await prepareFixture(db);await db.adminUser.update({where:{id:f.actor.id},data:{role:'ADMIN'}});f.actor.role='ADMIN';await db.legalDocument.update({where:{id:f.template.id},data:{status:'PUBLISHED',confirmedBy:f.actor.id,confirmedAt:new Date()}});await syntheticArchive(db,f,await db.serial(tx=>prepareElectronicDocument(tx,f.input,f.actor.id,f.writer,f.options)));
 const sub=await seedV31Subscription(db,f);await identities(db,f,sub.customer.id);
 const parties=signingParties().map(p=>({...p,subjectId:p.role==='CUSTOMER'?sub.customer.id:p.role==='OWNER'?f.owner.id:f.platform.id,autoAuthority:null,certificate:{...p.certificate,checkedAt:new Date().toISOString()}}));f.options={...f.options,resolveParties:async()=>parties} as any;
 await syntheticArchive(db,f,await db.serial(tx=>prepareElectronicDocument(tx,{kind:'SUBSCRIPTION',resourceId:sub.order.id,revision:0,idempotencyKey:randomUUID()},f.actor.id,f.writer,f.options)));
 await template(db,f,'PRE_DELIVERY_CANCELLATION','04');const evidence=await db.storedFile.create({data:{adminId:f.actor.id,name:'synthetic fact',storagePath:'synthetic',mimeType:'application/pdf',size:10,sha256:sha('a'),purpose:'evidence'}});
 const service=new Cancellation04Service(db),view:any=await service.read(sub.order.id,f.actor),p:any=await service.propose(sub.order.id,{revision:view.orderRevision,sourceHash:view.sourceHash,idempotencyKey:randomUUID(),reason:'客户取消未交付',responsibility:'CUSTOMER',neverDeliveredEvidenceFileIds:[evidence.id],costs:[]},f.actor),r:any=await service.review(p.id,{revision:p.revision,idempotencyKey:randomUUID(),decision:'VERIFIED',note:'合成事实审核'},f.actor);
 await service.confirm(p.id,{revision:r.revision,proposalHash:p.proposalHash,idempotencyKey:randomUUID(),accepted:true},sub.customer.id);
 await ctx.test('04 returns command revision/hash accepted by actual prepare',{skip:dependenciesOnly},()=>rollback(db,tx=>binding(tx,f,sub.order.id,'PRE_DELIVERY_CANCELLATION',p.id)));
 await ctx.test('later PLATFORM profile gap has exact subject role and authorized destination',{skip:dependenciesOnly},()=>rollback(db,async tx=>{
  await tx.vehicleOwner.update({where:{id:f.platform.id},data:{contractProfile:{}}});const result=await readContractWorkspace(tx,{kind:'ADMIN',...f.actor},sub.order.id,channel),item=result.readiness.find((i:any)=>i.kind==='PRE_DELIVERY_CANCELLATION')!,gate=item.missing.find((g:any)=>g.field==='PLATFORM.contractProfile');assert.ok(gate,JSON.stringify(item.missing));assert.deepEqual(gate.sourceResource,{type:'VEHICLE_OWNER',id:f.platform.id});assert.equal(gate.responsibleRole,'PLATFORM_LEGAL');assert.equal(gate.action.route,'/admin/vehicle-owners/'+f.platform.id);
 }));
 await ctx.test('ineligible signing member blocks subject without rejecting current staff reader',{skip:dependenciesOnly},()=>rollback(db,async tx=>{
  const a=await tx.ownerESignAccount.findUniqueOrThrow({where:{ownerId:f.owner.id}});await tx.ownerMember.update({where:{ownerId_customerId:{ownerId:f.owner.id,customerId:a.managerCustomerId!}},data:{status:'SUSPENDED'}});
  const result=await readContractWorkspace(tx,{kind:'ADMIN',...f.actor},sub.order.id,channel),item=result.readiness.find((i:any)=>i.kind==='PRE_DELIVERY_CANCELLATION')!,gate=item.missing.find((g:any)=>g.field==='OWNER_LEGAL_REQUIRED');assert.ok(gate);assert.equal(gate.responsibleRole,'OWNER_LEGAL');assert.equal(gate.sourceResource.id,f.owner.id);assert.equal(gate.action.enabled,false);assert.equal(item.canPrepare,false);
 }));
 await ctx.test('real current member reads history after certificate expiry and suspended or foreign membership cannot',{skip:process.env.TASK10B_FIX1_SKIP_HISTORY==='1'},async()=>{
  const service=new ElectronicDocumentService(db,{} as any,f.writer),a=await db.ownerESignAccount.findUniqueOrThrow({where:{ownerId:f.owner.id}}),original=await db.electronicSigningTask.findFirstOrThrow({where:{cooperationVersionId:f.draft.latestVersion.id}}),actor={kind:'OWNER' as const,id:a.managerCustomerId!,ownerId:f.owner.id};
  await rollback(db,async tx=>{await tx.ownerESignAccount.update({where:{ownerId:f.owner.id},data:{certValidUntil:new Date(Date.now()-1),checkedAt:new Date('2026-01-01')}});const historical=new ElectronicDocumentService(proxy(tx),{} as any,f.writer);assert.equal((await historical.detail(actor,original.id)).id,original.id);await historical.file(actor,original.id,'source');await assert.rejects(historical.detail({...actor,id:sub.customer.id},original.id));await tx.ownerMember.update({where:{ownerId_customerId:{ownerId:f.owner.id,customerId:actor.id}},data:{status:'SUSPENDED'}});await assert.rejects(historical.detail(actor,original.id));});
 });
 await ctx.test('selected older cooperation and saved authority grant remain bound after newer versions exist',()=>rollback(db,async tx=>{
  const oldMain=await tx.electronicSigningTask.findFirstOrThrow({where:{cooperationVersionId:f.draft.latestVersion.id},include:{archiveVersion:true}}),grantTemplate=await template(tx,f,'COOPERATION_GRANT','02-grant'),pair=parties.filter(p=>p.role!=='CUSTOMER'),agreement=await tx.partnerAgreement.findUniqueOrThrow({where:{id:f.draft.id}});
  const old=await prepareElectronicDocument(tx,{kind:'COOPERATION_GRANT',resourceId:f.draft.latestVersion.id,revision:agreement.revision,templateId:grantTemplate.id,idempotencyKey:randomUUID()},f.actor.id,f.writer,{...f.options,resolveParties:async()=>pair});
  const oldTask=await tx.electronicSigningTask.findUniqueOrThrow({where:{id:old.taskId}}),grant=await tx.electronicSealGrant.findUniqueOrThrow({where:{id:oldTask.sealGrantId!}});
  const provider=await tx.ownerAutoAuthority.create({data:{ownerId:f.owner.id,sealId:'synthetic-seal',providerCustomerId:pair[0].providerCustomerId,providerSignatureId:pair[0].signatureId!,certificateSerialNo:pair[0].certificate.serialNo,providerContractId:randomUUID(),providerTransactionId:randomUUID(),requestedBy:f.actor.id,idempotencyKey:randomUUID(),requestHash:sha('a'),scope:{synthetic:true},scopeHash:sha('a'),consentSnapshot:{synthetic:true}}});
  const basis={version:1,kind:'PARTNER_SIGNED_GRANT',grantId:grant.id,sourceHash:grant.sourceHash,legalRevision:1,original:null},scope={version:1,subjectId:f.owner.id,delegateSubjectId:f.platform.id,documentKinds:['SUBSCRIPTION'],cooperationVersionIds:[f.draft.latestVersion.id],vehicleIds:[f.vehicle.id],validFrom:'2026-11-01T00:00:00Z',validUntil:'2027-12-31T00:00:00Z'},acceptedAt=new Date(),businessEvidenceHash=canonicalHash({scope,basis,acceptedBy:f.actor.id,acceptedAt:acceptedAt.toISOString()}),authority=await tx.electronicAutoAuthority.create({data:{ownerId:f.owner.id,providerAuthorityId:provider.id,scope,basis,scopeHash:canonicalHash({scope,basis}),acceptedBy:f.actor.id,acceptedAt,businessEvidenceHash}});
  const selected=await seedV31Subscription(proxy(tx),f),selectedParties=parties.map(p=>({...p,subjectId:p.role==='CUSTOMER'?selected.customer.id:p.subjectId,...(p.role==='OWNER'?{autoAuthority:{...signingParties()[1].autoAuthority!,id:authority.id,subjectId:f.owner.id,delegateSubjectId:f.platform.id,businessEvidenceHash,checkedAt:new Date().toISOString()}}:{})}));
  const task=await prepareElectronicDocument(tx,{kind:'SUBSCRIPTION',resourceId:selected.order.id,revision:0,idempotencyKey:randomUUID()},f.actor.id,f.writer,{...f.options,resolveParties:async()=>selectedParties});
  await tx.electronicSealGrant.update({where:{id:grant.id},data:{revokedAt:new Date()}});
  const newerGrant=await prepareElectronicDocument(tx,{kind:'COOPERATION_GRANT',resourceId:f.draft.latestVersion.id,revision:agreement.revision,templateId:grantTemplate.id,idempotencyKey:randomUUID()},f.actor.id,f.writer,{...f.options,resolveParties:async()=>pair});
  const newer=await new SimpleAgreementService().save(tx,f.actor,f.owner.id,{status:'DRAFT',agreementId:f.draft.id,partnerRateBps:7500,validFrom:'2026-11-01',validUntil:'2027-12-31',vehicleIds:[f.vehicle.id],revision:agreement.revision,idempotencyKey:randomUUID(),v31Sources:f.v31Sources});assert.notEqual(newer.latestVersion.id,f.draft.latestVersion.id);
  const a=await tx.ownerESignAccount.findUniqueOrThrow({where:{ownerId:f.owner.id}}),reader={kind:'OWNER' as const,id:a.managerCustomerId!,ownerId:f.owner.id},service=new ElectronicDocumentService(proxy(tx),{} as any,f.writer),refs=await service.dependencies(reader,task.taskId);
  assert.ok(refs.items.some(i=>i.id===oldMain.id));assert.ok(refs.items.some(i=>i.id===oldTask.id));assert.equal(refs.items.some(i=>i.id===newerGrant.taskId),false);assert.equal((await service.dependency(reader,task.taskId,oldTask.id)).grant?.id,grant.id);
  await assert.rejects(service.dependency(reader,task.taskId,newerGrant.taskId));
 }));
 }finally{await db.$disconnect();for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);ctx.mock.timers.reset();}
});

test('one delivered source, isolated03/05/06 readiness-to-prepare bindings',{skip:dependenciesOnly},async ctx=>{
 ctx.mock.timers.enable({apis:['Date'],now:new Date('2026-11-13T04:00:00Z')});const db=new Db(),saved={...process.env};process.env.SESSION_SECRET='synthetic-task10b-history-member-secret-at-least32';try{
 let renewal:any;const fixture=await activeSwapFixture(db,{initialMonths:3,configureSources:async(db,f)=>{renewal=await seedRenewalProduct(db,f);}}),{f,sub,target,parties}=fixture;await identities(db,f,sub.customer.id);await db.adminUser.update({where:{id:f.actor.id},data:{role:'ADMIN'}});f.actor.role='ADMIN';f.options={...f.options,resolveParties:async()=>parties} as any;
 const finance=await db.adminUser.create({data:{username:randomUUID(),passwordHash:'synthetic',name:'合成财务复核',role:'FINANCE',staffPersonId:randomUUID()}}),reviewer={id:finance.id,role:finance.role,authVersion:finance.authVersion};
 await db.serial(async tx=>acceptConsents(tx,sub.customer.id,(await currentDocuments(tx,['terms','privacy'])).map((d:any)=>({documentId:d.id,version:d.version})),['terms','privacy'],'SYNTHETIC_TEST'));
 await template(db,f,'VEHICLE_SWAP','03');await template(db,f,'RENEWAL','05');await template(db,f,'EARLY_TERMINATION','06');
 await ctx.test('03 distinguishes change command revision from quote source revision',()=>rollback(db,async tx=>{
  const local=proxy(tx),service=new VehicleChangesService(local,()=>new Date()),context=await service.adminContext(tx,sub.order.id,f.actor),created=await service.create(sub.order.id,{reason:'合成同商换车',idempotencyKey:randomUUID(),expectedOrderRevision:context.orderRevision,priorTermsHash:context.priorTermsHash},f.actor),row=await tx.orderChange.findUniqueOrThrow({where:{id:created.id}});
  const targets=await listOfflineSwapTargets(tx,created.id,{keyword:target.vin},f.actor),selected=targets.items.find((v:any)=>v.vehicle.id===target.id)!;
  const quote={pricingVersion:3,revision:row.revision,targetListingId:selected.targetListingId,targetListingRevision:selected.targetListingRevision,targetSourceHash:selected.targetSourceHash,plannedReturnAt:'2026-11-14T01:00:00Z',plannedDeliveryAt:'2026-11-14T02:00:00Z',handoverArrangement:'合成换车地点',reason:'同商换车',expiresAt:'2026-11-15T02:00:00Z'},preview=await readOfflineSwapQuotePreview(tx,created.id,quote,f.actor),changes=new OrderChangesService(local,()=>new Date());
  await changes.act(created.id,'quotes',{...quote,previewHash:preview.previewHash,idempotencyKey:randomUUID()},f.actor);let c=await tx.orderChange.findUniqueOrThrow({where:{id:created.id}});
  await changes.act(c.id,'review',{revision:c.revision,decision:'APPROVED',note:'合成复核',idempotencyKey:randomUUID()},reviewer);c=await tx.orderChange.findUniqueOrThrow({where:{id:c.id}});await changes.act(c.id,'publish',{revision:c.revision,idempotencyKey:randomUUID()},f.actor);c=await tx.orderChange.findUniqueOrThrow({where:{id:c.id}});let q=await tx.delayQuote.findUniqueOrThrow({where:{id:c.activeQuoteId!}});
  await changes.act(c.id,'confirm',{revision:c.revision,commercialHash:q.commercialHash,idempotencyKey:randomUUID()},undefined,sub.customer.id);c=await tx.orderChange.findUniqueOrThrow({where:{id:c.id}});q=await tx.delayQuote.findUniqueOrThrow({where:{id:c.activeQuoteId!}});assert.notEqual(c.revision,q.revision);await binding(tx,f,sub.order.id,'VEHICLE_SWAP',c.id);
 }));
 await ctx.test('05 distinguishes change command revision from quote source revision',()=>rollback(db,async tx=>{
  const service=new OrderRenewalsService(proxy(tx),()=>new Date()),context:any=await service.context(sub.order.id,f.actor),goods:any=await service.goods(sub.order.id,{},f.actor),selected=goods.items.find((g:any)=>g.listingId===renewal.listing.id)!;
  const input={listingId:renewal.listing.id,listingRevision:selected.listingRevision,productVersionId:renewal.product.id,listingSourceHash:selected.sourceHash,orderRevision:context.orderRevision,accountRevision:context.accountRevision,reason:'同车续用三个月',expiresAt:'2026-11-15T02:00:00Z',settlementExplanation:'新租期单独计费原押金不变',cancellationTerms:'按已批准续期约定'},preview:any=await service.preview(sub.order.id,input,f.actor),created:any=await service.create(sub.order.id,{...input,previewHash:preview.previewHash,idempotencyKey:randomUUID()},f.actor);
  const current:any=await service.context(sub.order.id,f.actor,created.id),quoteInput={...input,orderRevision:current.orderRevision,accountRevision:current.accountRevision},qp:any=await service.preview(sub.order.id,quoteInput,f.actor,created.id),quoted:any=await service.act(created.id,'quotes',{...quoteInput,previewHash:qp.previewHash,revision:created.revision,idempotencyKey:randomUUID()},f.actor),reviewed:any=await service.act(created.id,'review',{revision:quoted.revision,idempotencyKey:randomUUID(),decision:'APPROVED',note:'核对同车产品'},reviewer),published:any=await service.act(created.id,'publish',{revision:reviewed.revision,idempotencyKey:randomUUID()},f.actor),q=await tx.delayQuote.findUniqueOrThrow({where:{id:quoted.quoteId}}),publicQuote:any=(await service.detail(created.id,undefined,sub.customer.id)).quote;
  await service.customerAct(created.id,'confirm',{revision:published.revision,idempotencyKey:randomUUID(),quoteId:q.id,quoteRevision:q.revision,commercialHash:publicQuote.commercialHash,bodyHash:publicQuote.document.bodyHash,lessorHash:publicQuote.lessorHash,noticeHash:publicQuote.noticeHash,sharingAccepted:true},sub.customer.id);
  const confirmed=await tx.orderChange.findUniqueOrThrow({where:{id:created.id}});assert.notEqual(confirmed.revision,q.revision);await binding(tx,f,sub.order.id,'RENEWAL',created.id);
 }));
 await ctx.test('06 confirmed proposal supplies hash, confirmation source revision and prepare command revision',()=>rollback(db,async tx=>{
  const service=new TerminationService(proxy(tx)),view:any=await service.read(sub.order.id,f.actor),evidence=await tx.storedFile.create({data:{name:'合成原因',storagePath:'synthetic',mimeType:'application/pdf',size:10,sha256:sha('a'),purpose:'evidence',adminId:f.actor.id}}),p:any=await service.propose(sub.order.id,{revision:view.orderRevision,sourceHash:view.sourceHash,idempotencyKey:randomUUID(),reasonKind:'PERSONAL',reason:'客户个人用车需求变化',plannedReturnAt:'2026-11-14T04:00:00Z',returnPlace:'原交付点',evidenceFileIds:[evidence.id]},f.actor),r:any=await service.review(p.id,{revision:p.revision,idempotencyKey:randomUUID(),decision:'VERIFIED',note:'核对原始来源'},f.actor);
  await service.confirm(p.id,{revision:r.revision,proposalHash:p.proposalHash,accepted:true,idempotencyKey:randomUUID()},sub.customer.id);await binding(tx,f,sub.order.id,'EARLY_TERMINATION',p.id);
 }));
 }finally{await db.$disconnect();for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);ctx.mock.timers.reset();}
});
