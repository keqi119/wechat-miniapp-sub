import {tokenHash} from '../src/auth/auth.service';
import {canonicalHash} from '../src/customers/types';
import {OwnerAuthorizationService} from '../src/owner-signing/authorization';
import {OwnerService} from '../src/owner-signing/owner.service';
import {OwnerH5Service} from '../src/owner-h5/service';
import {currentDocuments} from '../src/auth/consents';
import {syntheticSigningTime,syntheticFinalVerification} from './electronic-fixtures';
import {activateElectronicCooperation} from '../src/electronic-documents/cooperation';
import {archiveSealGrant} from '../src/electronic-documents/seal-authorization';
import {seedV31Subscription} from './v31-cooperation-fixture';
import {readAutomaticSigningAuthority} from '../src/electronic-documents/authorization';
import {resolveSigningParties} from '../src/electronic-documents/identities';
import {createHash} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {JourneyHarness,command} from './seven-module-journey-fixtures';
import {authorityFixture} from './v31-authority-fixture';
import {ElectronicDocumentService} from '../src/electronic-documents/service';
import {ContractPdfArtifactWriterService} from '../src/contract/contract-pdf-artifact-writer.service';
import * as authority from '../src/electronic-documents/authority-commands';

test('authority maintenance requires real independent archive and enterprise actor, never admin self-grant',async()=>{
 const h=new JourneyHarness(),saved={...process.env};try{
 await h.start();Object.assign(process.env,{NEW_ORDER_CONTRACT_MODE:'ELECTRONIC',CONTRACT_CJK_FONT_PATH:'C:/Windows/Fonts/msyh.ttc',CONTRACT_CJK_FONT_FACE:'MicrosoftYaHei',CONTRACT_CJK_BOLD_FONT_PATH:'C:/Windows/Fonts/msyhbd.ttc',CONTRACT_CJK_BOLD_FONT_FACE:'MicrosoftYaHei-Bold'});
 const f=await authorityFixture(h),fn=(authority as any).confirmV31Authority;assert.equal(typeof fn,'function');
 const input={...command(),grantId:(await h.db.electronicSigningTask.findUniqueOrThrow({where:{id:f.grantTask.id}})).sealGrantId,providerAuthorityId:'missing',sourceHash:'a'.repeat(64)};
 await assert.rejects(h.db.serial(tx=>fn(tx,{kind:'ADMIN',id:h.maker.id},input)),(e:any)=>e.getResponse?.().error?.code==='ELECTRONIC_PERSONAL_SIGNER_REQUIRED');
 await assert.rejects(h.db.serial(tx=>fn(tx,{kind:'OWNER',id:f.owner.person.id,ownerId:f.owner.owner.id},input)),(e:any)=>e.getResponse?.().error?.code==='V31_INDEPENDENT_GRANT_REQUIRED');
 const signed=new Set<string>(),writer=new ContractPdfArtifactWriterService(h.db);
 const provider:any={upload:async()=>({evidenceHash:'a'.repeat(64)}),manualUrl:async()=>({url:'https://synthetic.invalid/'}),querySigner:async(_d:any,p:any)=>({...syntheticSigningTime(new Date()),status:signed.has(p.transactionId)?'SIGNED':'ABSENT',evidenceHash:'b'.repeat(64)}),fileContract:async()=>({evidenceHash:'c'.repeat(64)}),downloadFinal:async()=>({bytes:Buffer.from('%PDF-1.7\nSynthetic independently signed test document '+randomUUID()+'\n%%EOF')}),verifyFinalFile:async(task:any,bytes:Buffer)=>syntheticFinalVerification(task,createHash('sha256').update(bytes).digest('hex'))};
 let signingNow:Date|undefined;
 const service=new ElectronicDocumentService(h.db,provider,writer,{clock:()=>signingNow??new Date(),afterArchive:async(tx:any,t:any)=>t.kind==='COOPERATION_GRANT'?archiveSealGrant(tx,t):t.kind==='COOPERATION'?activateElectronicCooperation(tx,t):Promise.resolve()});
 const actor=(company:any)=>({kind:'OWNER' as const,id:company.person.id,ownerId:company.owner.id});
 async function finish(task:any){
  let current=await h.db.electronicSigningTask.findUniqueOrThrow({where:{id:task.id}});await service.start({kind:'ADMIN',id:h.maker.id},task.id,command(current.revision));
  for(const company of [f.owner,f.platform]){current=await h.db.electronicSigningTask.findUniqueOrThrow({where:{id:task.id}});await service.sign(actor(company),task.id,{...command(current.revision),sourceSha256:task.sourceSha256,accepted:true});const party=await h.db.electronicSigningParty.findFirstOrThrow({where:{taskId:task.id,subjectId:company.owner.id}});signed.add(party.transactionId);current=await h.db.electronicSigningTask.findUniqueOrThrow({where:{id:task.id}});await service.sync(actor(company),task.id,command(current.revision));}
  assert.equal((await h.db.electronicSigningTask.findUniqueOrThrow({where:{id:task.id}})).status,'ARCHIVED');
 }
 await finish(f.grantTask);assert.equal((await h.db.partnerAgreement.findUniqueOrThrow({where:{id:f.agreement.id}})).status,'DRAFT');
 await finish(f.task);assert.equal((await h.db.partnerAgreement.findUniqueOrThrow({where:{id:f.agreement.id}})).status,'ACTIVE');
 const grantView:any=await service.detail(actor(f.owner),f.grantTask.id);assert.ok(grantView.grant?.id);assert.match(grantView.grant.sourceHash,/^[a-f0-9]{64}$/);assert.equal('sourceSnapshot' in grantView.grant,false);
 const grant=await h.db.electronicSealGrant.findFirstOrThrow({where:{mainTaskId:f.task.id}}),rows:any[]=[],companyLogins=new Map<string,any>();
 const internalApplicability={kind:'EXACT_FROZEN_SCOPE',sourceHash:grant.sourceHash,signingValidFrom:new Date(Date.now()-86400000).toISOString(),signingValidUntil:new Date(Date.now()+86400000).toISOString()};
 process.env.ESIGN_NEW_REQUESTS_ENABLED='true';
 for(const company of [f.owner,f.platform]){
  const technical=await h.db.ownerAutoAuthority.create({data:{ownerId:company.owner.id,sealId:company.seal.id,providerCustomerId:company.account.providerCustomerId!,providerSignatureId:company.seal.providerSignatureId,certificateSerialNo:company.account.certSerialNo!,providerContractId:randomUUID(),providerTransactionId:randomUUID(),requestedBy:company.person.id,idempotencyKey:randomUUID(),requestHash:'a'.repeat(64),scope:{},scopeHash:'a'.repeat(64),consentSnapshot:{},method:'PROVIDER_AUTO_GRANT',status:'AUTHORIZED',enabled:true,checkedAt:new Date()}});
  const ci={...command(grant.revision),grantId:grant.id,sourceHash:grant.sourceHash,providerAuthorityId:technical.id,...(company===f.platform?{internalEvidenceFileId:f.proof.id,internalEvidenceHash:f.proof.sha256,internalApplicability}:{})};
  const token=createHash('sha256').update(randomUUID()).digest('hex'),csrf=randomUUID(),legal=await h.db.ownerLegalRepresentative.findUniqueOrThrow({where:{ownerId:company.owner.id}});
  await h.db.ownerH5Session.create({data:{id:tokenHash(token),customerId:company.person.id,csrfToken:csrf,expiresAt:new Date(Date.now()+3600000),identitySnapshot:{mode:'ELECTRONIC_LEGAL',owners:[{ownerId:company.owner.id,legalRevision:legal.revision,legalMobileHash:legal.mobileHash}]}}});
  const login={id:company.person.id,headers:{Cookie:`owner_h5_session=${token}`,Origin:h.origin,'X-CSRF-Token':csrf}},root=`/owner-h5/owners/${company.owner.id}/electronic-documents`;
  companyLogins.set(company.owner.id,login);
  await h.reject(`${root}/authorities/confirm`,ci,{...login,headers:{...login.headers,'X-CSRF-Token':'wrong'}},'CSRF_DENIED');
  await h.reject(`/owner-h5/owners/${company===f.owner?f.platform.owner.id:f.owner.owner.id}/electronic-documents/authorities/confirm`,ci,login,'NOT_FOUND');
  assert.equal((await h.reject(`${root}/authorities/anything/enable`,ci,login)).status,404);
  const legacyToken=createHash('sha256').update(randomUUID()).digest('hex');await h.db.ownerH5Session.create({data:{id:tokenHash(legacyToken),customerId:company.person.id,csrfToken:csrf,expiresAt:new Date(Date.now()+3600000),identitySnapshot:[]}});
  await h.reject(`${root}/authorities/confirm`,ci,{...login,headers:{...login.headers,Cookie:`owner_h5_session=${legacyToken}`}},'SESSION_EXPIRED');
  if(company===f.platform){
   const {internalApplicability:omitted,...missing}=ci as any;
   await h.reject(`${root}/authorities/confirm`,missing,login,'V31_INTERNAL_APPLICABILITY_REQUIRED');
   await h.reject(`${root}/authorities/confirm`,{...ci,idempotencyKey:randomUUID(),internalApplicability:{...internalApplicability,sourceHash:'0'.repeat(64)}},login,'V31_INTERNAL_APPLICABILITY_REQUIRED');
   await h.reject(`${root}/authorities/confirm`,{...ci,idempotencyKey:randomUUID(),internalApplicability:{...internalApplicability,kind:'NARROWER_VEHICLES',vehicleIds:[f.car.id]}},login,'VALIDATION');
   await assert.rejects(service.confirmAuthority(actor(company),missing),(e:any)=>e.getResponse?.().error?.code==='V31_INTERNAL_APPLICABILITY_REQUIRED');
   await assert.rejects(service.confirmAuthority(actor(company),{...ci,idempotencyKey:randomUUID(),internalApplicability:{...internalApplicability,sourceHash:'0'.repeat(64)}}),(e:any)=>e.getResponse?.().error?.code==='V31_INTERNAL_APPLICABILITY_REQUIRED');
   await assert.rejects(service.confirmAuthority(actor(company),{...ci,idempotencyKey:randomUUID(),internalApplicability:{...internalApplicability,kind:'NARROWER_VEHICLES',vehicleIds:[f.car.id]}}));
  }
  const accepted=await h.post(`${root}/authorities/confirm`,ci,login);assert.equal((await service.confirmAuthority(actor(company),ci)).id,accepted.id);
  await assert.rejects(service.switchAuthority({kind:'ADMIN',id:h.maker.id},accepted.id,{...command(accepted.revision),scopeHash:accepted.scopeHash,enabled:true}));
  const reviewed=await h.post(`/admin/electronic-documents/authorities/${accepted.id}/review`,{...command(accepted.revision),channelEvidenceFileId:f.proof.id,channelEvidenceHash:f.proof.sha256,granteeName:'上海宁达信息科技有限公司',noticeOwnerId:f.platform.owner.id,archiveOwnerId:f.platform.owner.id,identityIsolated:true,manualIsolated:true,internalBasisVerified:true});
  await assert.rejects(h.db.electronicAutoAuthority.update({where:{id:accepted.id},data:{businessEvidenceHash:'0'.repeat(64)}}));
  const enabled=await h.post(`${root}/authorities/${accepted.id}/switch`,{...command(reviewed.revision),scopeHash:reviewed.scopeHash,enabled:true},login);assert.ok((await h.get(`${root}/authorities/list`,login)).items.some((r:any)=>r.id===accepted.id));rows.push(enabled);const listed=await h.get(`/admin/electronic-documents/authorities/${company.owner.id}`);assert.ok(listed.items.some((r:any)=>r.id===accepted.id&&r.automaticReady===null));
 }
 const subscription=await seedV31Subscription(h.db,{actor:await h.db.adminUser.findUniqueOrThrow({where:{id:h.maker.id}}),owner:f.owner.owner,platform:f.platform.owner,vehicle:f.car,draft:{latestVersion:f.agreement.latestVersion},v31Sources:{productVersionIds:[f.product.id],templateRefs:[{id:f.subscription.id}]}});
 const plan:any=(await h.db.order.findUniqueOrThrow({where:{id:subscription.order.id}})).finalPlanSnapshot;plan.agreedFeeComponents={baseFeeAmount:plan.productSnapshot.baseFeeAmount,mileageMonthlyFeeAmount:plan.productSnapshot.mileageMonthlyFeeAmount};plan.creditBand='GE750';plan.creditRuleVersion='ZHIMA_MANUAL_V1';
 await h.db.order.update({where:{id:subscription.order.id},data:{finalPlanSnapshot:plan}});
 const parties=await resolveSigningParties(h.db,f.grantTask.archiveVersionId),context={kind:'SUBSCRIPTION' as const,orderId:subscription.order.id,platformSubjectId:f.platform.owner.id,cooperationVersionId:grant.cooperationVersionId,vehicleIds:[f.car.id]};
 for(const party of parties)assert.ok(await readAutomaticSigningAuthority(h.db,party,context),party.role);
 assert.equal((await readAutomaticSigningAuthority(h.db,parties[1],context))?.validUntil,internalApplicability.signingValidUntil,'returned current authority evidence must carry the independent signing expiry');
 const actualOwnerBusiness=await h.db.electronicAutoAuthority.findUniqueOrThrow({where:{id:rows[0].id}}),actualTechnical=await h.db.ownerAutoAuthority.findUniqueOrThrow({where:{id:actualOwnerBusiness.providerAuthorityId!}});
 // Each channel guard has its own genuine ready control; changing one fact must revoke readiness.
 for(const mutation of ['WRONG_GRANTEE','UNILATERAL','STALE_QUERY'] as const){
  assert.ok(await readAutomaticSigningAuthority(h.db,parties[0],context),mutation+' ready control');
  let reader:any=h.db;
  if(mutation==='WRONG_GRANTEE'){
   // Persistence rejects this corruption already. Exercise the defensive reader with only
   // that field replaced on the REAL queried row; every other delegate/fact stays real.
   await h.reject(`/admin/electronic-documents/authorities/${actualOwnerBusiness.id}/review`,{...command(actualOwnerBusiness.revision),channelEvidenceFileId:f.proof.id,channelEvidenceHash:f.proof.sha256,granteeName:'合成错误渠道受权主体',noticeOwnerId:f.platform.owner.id,archiveOwnerId:f.platform.owner.id,identityIsolated:true,manualIsolated:true,internalBasisVerified:true},h.maker,'VALIDATION');
   await assert.rejects(h.db.electronicAutoAuthority.update({where:{id:actualOwnerBusiness.id},data:{channelGranteeName:'合成错误渠道受权主体'}}));
   assert.deepEqual(await h.db.electronicAutoAuthority.findUniqueOrThrow({where:{id:actualOwnerBusiness.id}}),actualOwnerBusiness,'invalid review/write cannot change the valid authority');
   reader=new Proxy(h.db,{get(target,property){if(property==='electronicAutoAuthority')return{findMany:async(args:any)=>(await target.electronicAutoAuthority.findMany(args)).map(r=>({...r,channelGranteeName:'合成错误渠道受权主体'}))};return Reflect.get(target,property,target);}});
  }else if(mutation==='UNILATERAL')await h.db.ownerAutoAuthority.update({where:{id:actualTechnical.id},data:{method:'UNILATERAL_LETTER'}});
  else await h.db.ownerAutoAuthority.update({where:{id:actualTechnical.id},data:{checkedAt:new Date(Date.now()-60001)}});
  assert.equal(await readAutomaticSigningAuthority(reader,parties[0],context),null,mutation);
  await h.db.ownerAutoAuthority.update({where:{id:actualTechnical.id},data:{method:actualTechnical.method,checkedAt:new Date()}});
  assert.ok(await readAutomaticSigningAuthority(h.db,parties[0],context),mutation+' restored control');
 }
 const changed=structuredClone(plan);changed.agreedFeeComponents.baseFeeAmount++;await h.db.order.update({where:{id:subscription.order.id},data:{finalPlanSnapshot:changed}});assert.equal(await readAutomaticSigningAuthority(h.db,parties[0],context),null);await h.db.order.update({where:{id:subscription.order.id},data:{finalPlanSnapshot:plan}});


 // Independent signing periods are evidence-bound; configured/enabled is never per-order readiness.
 await switchBusiness(1,false);
 const platformBusiness=await h.db.electronicAutoAuthority.findUniqueOrThrow({where:{id:rows[1].id}});
 for(const [from,until] of [[-172800000,-86400000],[86400000,172800000]]){
  const binding={...internalApplicability,signingValidFrom:new Date(Date.now()+from).toISOString(),signingValidUntil:new Date(Date.now()+until).toISOString()};
  const confirmed=await service.confirmAuthority(actor(f.platform),{...command(grant.revision),grantId:grant.id,sourceHash:grant.sourceHash,providerAuthorityId:platformBusiness.providerAuthorityId,internalEvidenceFileId:f.proof.id,internalEvidenceHash:f.proof.sha256,internalApplicability:binding});
  const reviewed=await service.reviewAuthority({kind:'ADMIN',id:h.maker.id},confirmed.id,{...command(confirmed.revision),channelEvidenceFileId:f.proof.id,channelEvidenceHash:f.proof.sha256,granteeName:'上海宁达信息科技有限公司',noticeOwnerId:f.platform.owner.id,archiveOwnerId:f.platform.owner.id,identityIsolated:true,manualIsolated:true,internalBasisVerified:true});
  const enabled=await service.switchAuthority(actor(f.platform),reviewed.id,{...command(reviewed.revision),scopeHash:reviewed.scopeHash,enabled:true});
  const persisted:any=await h.db.electronicAutoAuthority.findUniqueOrThrow({where:{id:enabled.id}});assert.deepEqual(persisted.basis.internalApplicability,binding);
  await assert.rejects(h.db.electronicAutoAuthority.update({where:{id:enabled.id},data:{basis:{...persisted.basis,internalApplicability}}}));
  assert.equal(await readAutomaticSigningAuthority(h.db,parties[1],context),null,from<0?'expired independent internal permission':'not-yet-effective independent internal permission');
  assert.ok(await readAutomaticSigningAuthority(h.db,parties[0],context),'partner grant independently stays ready');
  await service.switchAuthority(actor(f.platform),enabled.id,{...command(enabled.revision),scopeHash:enabled.scopeHash,enabled:false});
 }
 await switchBusiness(1,true);assert.ok(await readAutomaticSigningAuthority(h.db,parties[1],context),'exact internal basis allows the frozen full service term while signing permission is current');
 // Production identities/readiness with independent enterprise grants, and actual accepted OWNER proof.
 const autoCalls:string[]=[],originalAuto=provider.autoSign;
 provider.autoSign=async(_d:any,p:any)=>{autoCalls.push(p.role);signed.add(p.transactionId);return{evidenceHash:'d'.repeat(64)};};
 async function subscriptionTask(){
  const sub=await seedV31Subscription(h.db,{actor:await h.db.adminUser.findUniqueOrThrow({where:{id:h.maker.id}}),owner:f.owner.owner,platform:f.platform.owner,vehicle:f.car,draft:{latestVersion:f.agreement.latestVersion},v31Sources:{productVersionIds:[f.product.id],templateRefs:[{id:f.subscription.id}]}});
  await h.db.eSignAccount.update({where:{customerId:sub.customer.id},data:{certSubjectHash:canonicalHash({customerId:sub.customer.id})}});
  const b:any=sub.order.finalPlanSnapshot;b.agreedFeeComponents={baseFeeAmount:b.productSnapshot.baseFeeAmount,mileageMonthlyFeeAmount:b.productSnapshot.mileageMonthlyFeeAmount};b.creditBand='GE750';b.creditRuleVersion='ZHIMA_MANUAL_V1';delete b.commercialHash;b.commercialHash=canonicalHash(b);
  await h.db.order.update({where:{id:sub.order.id},data:{finalPlanSnapshot:b}});await h.db.contract.updateMany({where:{orderId:sub.order.id},data:{documentHash:b.commercialHash}});
  const prepared=await service.prepare({kind:'ADMIN',id:h.maker.id},{kind:'SUBSCRIPTION',resourceId:sub.order.id,revision:sub.order.revision,idempotencyKey:randomUUID()});
  const cmd=async()=>command((await h.db.electronicSigningTask.findUniqueOrThrow({where:{id:prepared.id}})).revision);
  await service.start({kind:'ADMIN',id:h.maker.id},prepared.id,await cmd());
  await service.sign({kind:'CUSTOMER',id:sub.customer.id},prepared.id,{...await cmd(),sourceSha256:prepared.sourceSha256,accepted:true});
  const customer=await h.db.electronicSigningParty.findFirstOrThrow({where:{taskId:prepared.id,role:'CUSTOMER'}});signed.add(customer.transactionId);assert.equal(await (service as any).query(prepared.id,'QUERY','CUSTOMER'),true);
  assert.equal(await (service as any).dispatch(prepared.id,'SIGN','OWNER'),true);assert.equal(await (service as any).query(prepared.id,'QUERY','OWNER'),true);
  const ownerProof=await h.db.electronicSigningParty.findFirstOrThrow({where:{taskId:prepared.id,role:'OWNER'}});assert.equal(ownerProof.status,'SIGNED');assert.ok(ownerProof.queryEvidenceHash);
  return{prepared,cmd,ownerProof};
 }
 async function switchBusiness(index:number,enabled:boolean){const r=await h.db.electronicAutoAuthority.findUniqueOrThrow({where:{id:rows[index].id}});return service.switchAuthority(actor(index===0?f.owner:f.platform),r.id,{...command(r.revision),scopeHash:r.scopeHash,enabled});}
 const technicalService=new OwnerAuthorizationService(h.db,new OwnerService(h.db),{} as any),ownerBusiness=await h.db.electronicAutoAuthority.findUniqueOrThrow({where:{id:rows[0].id}});
 for(const pause of ['BUSINESS','TECHNICAL','RESERVATION'] as const){
  await h.db.ownerAutoAuthority.updateMany({where:{id:{in:[ownerBusiness.providerAuthorityId!,platformBusiness.providerAuthorityId!]}},data:{checkedAt:new Date()}});
  const current=await subscriptionTask(),beforeCalls=autoCalls.length;
  const pauseOwner=async()=>pause==='TECHNICAL'?technicalService.pause(h.maker.id,f.owner.owner.id,ownerBusiness.providerAuthorityId!):switchBusiness(0,false);
  if(pause==='RESERVATION'){
   const reserve=(service as any).reserve.bind(service);(service as any).reserve=async(...args:any[])=>{const reserved=await reserve(...args);await pauseOwner();return reserved;};
   try{assert.equal(await (service as any).dispatch(current.prepared.id,'SIGN','PLATFORM'),false);}finally{(service as any).reserve=reserve;}
   const reserved=await h.db.electronicSigningParty.findFirstOrThrow({where:{taskId:current.prepared.id,role:'PLATFORM'}});assert.equal(reserved.status,'UNKNOWN');assert.ok(reserved.attemptedAt);assert.equal((await h.db.electronicSigningTask.findUniqueOrThrow({where:{id:current.prepared.id}})).lastErrorCode,'ELECTRONIC_AUTO_AUTHORITY_REQUIRED');
   // The old transaction is still queried; no new manual/auto transaction is invented.
   await service.sync({kind:'ADMIN',id:h.maker.id},current.prepared.id,await current.cmd());
  }else{
   await pauseOwner();assert.ok(await readAutomaticSigningAuthority(h.db,parties[1],context),'PLATFORM independent authority stays ready');
   await service.sync({kind:'ADMIN',id:h.maker.id},current.prepared.id,await current.cmd());
   const pending=await h.db.electronicSigningParty.findFirstOrThrow({where:{taskId:current.prepared.id,role:'PLATFORM'}});assert.equal(pending.mode,'MANUAL',pause);assert.equal(pending.attemptedAt,null);
  }
  assert.equal(autoCalls.length,beforeCalls,'OWNER-only pause must prevent PLATFORM auto dispatch');
  assert.deepEqual(await h.db.electronicSigningParty.findUniqueOrThrow({where:{id:current.ownerProof.id}}),current.ownerProof,'accepted OWNER identity/transaction/proof is immutable');
  if(pause==='BUSINESS'){
   await service.sign(actor(f.platform),current.prepared.id,{...await current.cmd(),sourceSha256:current.prepared.sourceSha256,accepted:true});
   const platformParty=await h.db.electronicSigningParty.findFirstOrThrow({where:{taskId:current.prepared.id,role:'PLATFORM'}});signed.add(platformParty.transactionId);
   await service.sync(actor(f.platform),current.prepared.id,await current.cmd());assert.equal((await h.db.electronicSigningTask.findUniqueOrThrow({where:{id:current.prepared.id}})).status,'ARCHIVED','OWNER authority pause does not block original query/archive after manual fallback');
   assert.deepEqual(await h.db.electronicSigningParty.findUniqueOrThrow({where:{id:current.ownerProof.id}}),current.ownerProof);
  }
  if(pause==='TECHNICAL')await h.db.ownerAutoAuthority.update({where:{id:ownerBusiness.providerAuthorityId!},data:{enabled:true,checkedAt:new Date()}});else await switchBusiness(0,true);
 }

 // An independently confirmed signing window expires before the next company's dispatch.
 await h.db.ownerAutoAuthority.updateMany({where:{id:{in:[ownerBusiness.providerAuthorityId!,platformBusiness.providerAuthorityId!]}},data:{checkedAt:new Date()}});
 const expiryTask=await subscriptionTask(),expiry=new Date(Date.now()+5000),beforeExpiryCalls=autoCalls.length;
 await switchBusiness(1,false);
 const expiring=await service.confirmAuthority(actor(f.platform),{...command(grant.revision),grantId:grant.id,sourceHash:grant.sourceHash,providerAuthorityId:platformBusiness.providerAuthorityId,internalEvidenceFileId:f.proof.id,internalEvidenceHash:f.proof.sha256,internalApplicability:{...internalApplicability,signingValidUntil:expiry.toISOString()}});
 const expiryReview=await service.reviewAuthority({kind:'ADMIN',id:h.maker.id},expiring.id,{...command(expiring.revision),channelEvidenceFileId:f.proof.id,channelEvidenceHash:f.proof.sha256,granteeName:'上海宁达信息科技有限公司',noticeOwnerId:f.platform.owner.id,archiveOwnerId:f.platform.owner.id,identityIsolated:true,manualIsolated:true,internalBasisVerified:true});
 const expiryEnabled=await service.switchAuthority(actor(f.platform),expiring.id,{...command(expiryReview.revision),scopeHash:expiryReview.scopeHash,enabled:true});
 assert.ok(await readAutomaticSigningAuthority(h.db,parties[1],context));
 signingNow=expiry;
 assert.equal(await readAutomaticSigningAuthority(h.db,parties[1],context,expiry),null);assert.ok(await readAutomaticSigningAuthority(h.db,parties[0],context,expiry));
 await service.sync({kind:'ADMIN',id:h.maker.id},expiryTask.prepared.id,await expiryTask.cmd());
 assert.equal((await h.db.electronicSigningParty.findFirstOrThrow({where:{taskId:expiryTask.prepared.id,role:'PLATFORM'}})).mode,'MANUAL');assert.equal(autoCalls.length,beforeExpiryCalls);
 assert.deepEqual(await h.db.electronicSigningParty.findUniqueOrThrow({where:{id:expiryTask.ownerProof.id}}),expiryTask.ownerProof);
 signingNow=undefined;await service.switchAuthority(actor(f.platform),expiring.id,{...command(expiryEnabled.revision),scopeHash:expiryEnabled.scopeHash,enabled:false});await switchBusiness(1,true);
 provider.autoSign=originalAuto;
 let task=await h.db.electronicSigningTask.findUniqueOrThrow({where:{id:f.grantTask.id}});await h.post(`/owner-h5/owners/${f.owner.owner.id}/electronic-documents/${task.id}/revoke-grant`,{...command(task.revision),reason:'合成完整签后撤权'},companyLogins.get(f.owner.owner.id));
 for(const party of parties)assert.equal(await readAutomaticSigningAuthority(h.db,party,context),null);
 const agreement=await h.db.partnerAgreement.findUniqueOrThrow({where:{id:f.agreement.id}}),next=await service.prepare({kind:'ADMIN',id:h.maker.id},{kind:'COOPERATION_GRANT',resourceId:grant.cooperationVersionId,revision:agreement.revision,idempotencyKey:randomUUID()});assert.notEqual(next.id,f.grantTask.id);assert.equal((await h.db.electronicSealGrant.findFirstOrThrow({where:{cooperationVersionId:grant.cooperationVersionId},orderBy:{version:'desc'}})).previousGrantId,grant.id);
 await service.start({kind:'ADMIN',id:h.maker.id},next.id,command(next.revision));let pending=await h.db.electronicSigningTask.findUniqueOrThrow({where:{id:next.id}});await service.sign(actor(f.owner),next.id,{...command(pending.revision),sourceSha256:next.sourceSha256,accepted:true});pending=await h.db.electronicSigningTask.findUniqueOrThrow({where:{id:next.id}});await service.revokeGrant(actor(f.owner),next.id,{...command(pending.revision),reason:'合成已发起未知结果撤权'});
 await assert.rejects(service.prepare({kind:'ADMIN',id:h.maker.id},{kind:'COOPERATION_GRANT',resourceId:grant.cooperationVersionId,revision:agreement.revision,idempotencyKey:randomUUID()}),(e:any)=>e.getResponse?.().error?.code==='ELECTRONIC_STOP_REVIEW_REQUIRED');
 const owners=new OwnerService(h.db);let urls=0,queries=0,revocations=0;
 const api:any={createAuthorizationUrl:()=>{urls++;return{url:'https://synthetic.invalid/grant'};},assertAvailable:()=>{},queryAuthorization:async()=>{queries++;return{authorized:true};},queryCertificate:async()=>({bound:true,serialNo:f.owner.account.certSerialNo}),createRevocationUrl:()=>{revocations++;return{url:'https://synthetic.invalid/revoke'};}};
 const providerAuthority=new OwnerAuthorizationService(h.db,owners,api),h5=new OwnerH5Service(h.db,owners,{startLegal:async()=>({syntheticIdentityEntry:true})} as any,providerAuthority,{} as any);
 assert.deepEqual(await h5.verification(f.owner.person.id,f.owner.owner.id,{}),{syntheticIdentityEntry:true});
 const max=await h.db.legalDocument.aggregate({where:{type:'owner-auto-sign'},_max:{version:true}});await h.db.legalDocument.create({data:{type:'owner-auto-sign',version:Math.max(3,(max._max.version??0)+1),title:'SYNTHETIC channel notice',content:'合成渠道告知凭据，仅本地测试',status:'PUBLISHED',confirmedBy:h.reviewer.id,confirmedAt:new Date()}});
 Object.assign(process.env,{OWNER_AUTHORIZATION_ENABLED:'true',OWNER_AUTHORIZATION_SCOPE_VERSION:'2',OWNER_AUTHORIZATION_METHOD:'PROVIDER_AUTO_GRANT'});
 const consents=(await currentDocuments(h.db,['terms','privacy','owner-auto-sign'])).map(d=>({documentId:d.id,version:d.version}));
 const request={scope:{version:2,validFrom:new Date(Date.now()-1000).toISOString(),validUntil:new Date(Date.now()+86400000).toISOString(),delegates:[{id:'PLATFORM_OPERATOR',name:'上海宁达信息科技有限公司'}],documentKinds:['SUBSCRIPTION_WITH_FEES']},sealId:f.owner.seal.id,accepted:true,consents,idempotencyKey:randomUUID()};
 await assert.rejects(h.db.$transaction(async(tx:any)=>{
  await tx.legalDocument.updateMany({where:{type:'ELECTRONIC_V31_SUBSCRIPTION'},data:{status:'DRAFT'}});
  const legacy=await tx.legalDocument.aggregate({where:{type:'owner-rental-contract'},_max:{version:true}});await tx.legalDocument.create({data:{type:'owner-rental-contract',version:(legacy._max.version??0)+1,title:'SYNTHETIC legacy',content:'synthetic legacy must not authorize V31',status:'PUBLISHED',confirmedBy:h.maker.id,confirmedAt:new Date()}});
  const bound=new OwnerAuthorizationService({serial:(fn:any)=>fn(tx)} as any,owners,api);
  await assert.rejects(bound.request(f.owner.person.id,f.owner.owner.id,{...request,idempotencyKey:randomUUID()}),(e:any)=>e.getResponse?.().error?.code==='OWNER_TEMPLATE_SCOPE');
  throw new Error('ROLLBACK_TEMPLATE_TEST');
 },{timeout:30000}),/ROLLBACK_TEMPLATE_TEST/);
 const issued=await h5.requestAuthority(f.owner.person.id,f.owner.owner.id,request);assert.equal(urls,1);
 process.env.ESIGN_NEW_REQUESTS_ENABLED='false';await providerAuthority.refresh(f.owner.person.id,f.owner.owner.id,issued.id);await h5.revokeAuthority(f.owner.person.id,f.owner.owner.id,issued.id);assert.equal(queries,1);assert.equal(revocations,1);
 await assert.rejects(h5.requestAuthority(f.owner.person.id,f.owner.owner.id,{...request,idempotencyKey:randomUUID()}));
 assert.equal(h.externalCalls+h.identityCalls+h.esignCalls,0);
 }finally{await h.close();for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});


