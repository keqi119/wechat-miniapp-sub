import {OwnerAuthorizationService} from '../src/owner-signing/authorization';
import {OwnerService} from '../src/owner-signing/owner.service';
import {syntheticSigningTime} from './electronic-fixtures';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,randomInt} from 'node:crypto';
import {JourneyHarness,command} from './seven-module-journey-fixtures';
import {ownerMobileHash} from '../src/owner-h5/legal-representative';
import {hash} from '../src/common/data';
import {accountHash} from '../src/partners/revenue-types';
import {ElectronicDocumentService} from '../src/electronic-documents/service';
import {ContractPdfArtifactWriterService} from '../src/contract/contract-pdf-artifact-writer.service';

test('actual V31 create/activate/prepare freezes sources, changed source blocks start but trusted query and withdraw survive',async()=>{
 const h=new JourneyHarness(),saved=Object.fromEntries(['FADADA_PLATFORM_CUSTOMER_ID','FADADA_PLATFORM_SIGNATURE_ID','CONTRACT_CJK_FONT_PATH','CONTRACT_CJK_FONT_FACE','CONTRACT_CJK_BOLD_FONT_PATH','CONTRACT_CJK_BOLD_FONT_FACE','NEW_ORDER_CONTRACT_MODE'].map(k=>[k,process.env[k]]));
 try{await h.start();Object.assign(process.env,{NEW_ORDER_CONTRACT_MODE:'ELECTRONIC',CONTRACT_CJK_FONT_PATH:'C:/Windows/Fonts/msyh.ttc',CONTRACT_CJK_FONT_FACE:'MicrosoftYaHei',CONTRACT_CJK_BOLD_FONT_PATH:'C:/Windows/Fonts/msyhbd.ttc',CONTRACT_CJK_BOLD_FONT_FACE:'MicrosoftYaHei-Bold'});
 const proof=await h.proof(h.maker),now=new Date();
 async function enterprise(name:string){
  const person=await h.db.customer.create({data:{name:'合成测试法人',mobile:'139'+randomInt(10000000,99999999)}}),mobileHash=ownerMobileHash(person.mobile),serial=randomUUID();
  const owner=await h.db.vehicleOwner.create({data:{name,subjectType:'ENTERPRISE',status:'VERIFIED',creditCode:'SYN'+randomUUID().replaceAll('-','').slice(0,15).toUpperCase(),address:'合成测试住所',createdBy:h.maker.id,contractProfile:{serviceContactName:'合成联系人',serviceContactChannel:'合成电话留痕',signerAuthorityRole:'LEGAL_REPRESENTATIVE'}}});
  await h.db.ownerLegalRepresentative.create({data:{ownerId:owner.id,name:person.name,mobileHash,maskedMobile:'139****0000',evidenceHash:'a'.repeat(64),revision:1,createdBy:h.maker.id,updatedBy:h.maker.id}});
  await h.db.ownerMember.create({data:{ownerId:owner.id,customerId:person.id,status:'VERIFIED',verifiedAt:now,verifiedSerialNo:serial}});
  const account=await h.db.ownerESignAccount.create({data:{ownerId:owner.id,providerCustomerId:'SYN-'+randomUUID(),realNameStatus:'VERIFIED',managerCustomerId:person.id,verificationTransactionNo:serial,evidenceHash:'b'.repeat(64),checkedAt:now,verifiedAt:now,consentSnapshot:{ownerId:owner.id,customerId:person.id,legalRevision:1,legalName:person.name,legalMobileHash:mobileHash,channel:'OWNER_LEGAL_H5'},certStatus:'BOUND',certSerialNo:serial,certValidFrom:new Date(now.getTime()-86400000),certValidUntil:new Date(now.getTime()+86400000),certEvidenceHash:'c'.repeat(64),certSubjectHash:hash('SYNTHETIC VERIFIED CERTIFICATE SUBJECT '+serial),certCheckedAt:now}});
  const seal=await h.db.ownerSeal.create({data:{ownerId:owner.id,providerCustomerId:account.providerCustomerId!,providerSignatureId:'SYN-SEAL-'+randomUUID(),status:'ACTIVE',imageHash:'d'.repeat(64),imageCiphertext:'SYNTHETIC-NOT-REAL-SEAL',selectedBy:person.id,selectedAt:now,checkedAt:now}});
  return{owner,person,account,seal};
 }
 const owner=await enterprise('合成V31出租方-'+h.prefix),platform=await enterprise('上海宁达信息科技有限公司');process.env.FADADA_PLATFORM_CUSTOMER_ID=platform.account.providerCustomerId!;process.env.FADADA_PLATFORM_SIGNATURE_ID=platform.seal.providerSignatureId;
 const car=await h.db.vehicle.create({data:{brand:'合成',model:'V31',title:'合成V31测试车辆',vin:'SYN'+randomUUID().replaceAll('-','').slice(0,14).toUpperCase(),plateNumber:'合成测试001',year:2026,city:'上海',mileageKm:0}});
 await h.db.vehicleAssetProfile.create({data:{vehicleId:car.id,registeredOwnerName:owner.owner.name,batteryOwnership:'OWNED',createdBy:h.maker.id,updatedBy:h.maker.id}});
 await h.db.vehicleConditionAssessment.create({data:{vehicleId:car.id,fireDamage:false,floodDamage:false,structuralDamage:false,assessedBy:h.maker.id,createdBy:h.maker.id}});
 const product=await h.post('/admin/products',{name:'合成V31产品-'+h.prefix,months:6,minimumTermMonths:3,configurationVersion:2,baseFeeAmount:200000,mileageMonthlyFeeAmount:50000,mileagePerMonthKm:2000,excessMileagePriceAmount:100,swapPolicy:{version:2,period:'TERM',includedCount:1,extraFeeAmount:50000},conditions:'合成测试条件',vehicleIds:[car.id],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'}],customerBaas:{disposition:'NOT_APPLICABLE'},...command()});
 await h.post(`/admin/products/${product.productId}/publish`,{...command(product.revision),versionId:product.id});
 async function template(artifact:string,kind:string){
  const content=readFileSync(`../../docs/legal/drafts/ninda/launch-20261107-v31/${artifact}.json`,'utf8');
  const draft=await h.post('/admin/legal-documents',{type:'ELECTRONIC_V31_'+kind,version:randomInt(10000,2000000000),title:'SYNTHETIC LOCAL TEST '+kind,content});
  assert.equal(draft.status,'DRAFT');const published=await h.post(`/admin/legal-documents/${draft.id}/activate`,{confirmed:true,expectedVersion:draft.version,expectedContentHash:draft.contentHash,idempotencyKey:randomUUID()});return published;
 }
 const subscription=await template('01','SUBSCRIPTION'),cooperation=await template('02-main','COOPERATION'),grantTemplate=await template('02-grant','COOPERATION_GRANT');
 const bank={accountName:owner.owner.name,bankName:'合成测试银行',accountNumber:'6222000012345678'};
 await h.db.partnerAccountVersion.create({data:{ownerId:owner.owner.id,version:1,status:'APPROVED',...bank,contentHash:accountHash(bank),evidenceFileIds:[proof.id],createdBy:h.maker.id,reviewedBy:h.reviewer.id,reviewedAt:now}});
 const sources={productVersionIds:[product.id],productDepositRules:[{productVersionId:product.id,rule:{kind:'CREDIT_POLICY',policyVersion:'ZHIMA_MANUAL_V1'}}],templateRefs:[{id:subscription.id,hash:hash(subscription.content)}],vehicleScopes:[{vehicleId:car.id,validFrom:'2026-01-01',validUntil:'2028-12-31',authorityEvidenceFileIds:[proof.id],rightsRestrictions:{status:'NONE',evidenceFileIds:[proof.id]},insuranceArrangement:{description:'已确认交强险和商业险投保安排，尚未出单',evidenceFileIds:[proof.id]}}]};
 const incomplete=await h.post(`/admin/partners/${owner.owner.id}/agreements`,{status:'DRAFT',vehicleIds:[car.id],partnerRateBps:8000,validFrom:'2026-01-01',validUntil:'2028-12-31',v31Sources:{...sources,productDepositRules:undefined,templateRefs:[{id:h.docs.terms.id,hash:hash(h.docs.terms.content)}]},...command()});
 const incompleteReady=await h.get(`/admin/partners/${owner.owner.id}/agreements/${incomplete.latestVersion.id}/contract-readiness`);
 assert.ok(incompleteReady.missing.some((m:any)=>m.field==='cooperation.productDepositRules'));assert.ok(incompleteReady.missing.some((m:any)=>m.field===`template.${h.docs.terms.id}`));
 const agreement=await h.post(`/admin/partners/${owner.owner.id}/agreements`,{status:'DRAFT',agreementId:incomplete.id,vehicleIds:[car.id],partnerRateBps:8000,validFrom:'2026-01-01',validUntil:'2028-12-31',v31Sources:sources,...command(incomplete.revision)});
 const ready=await h.get(`/admin/partners/${owner.owner.id}/agreements/${agreement.latestVersion.id}/contract-readiness`);assert.equal(ready.ready,true,JSON.stringify(ready.missing));
 const input={kind:'COOPERATION',resourceId:agreement.latestVersion.id,revision:agreement.revision,templateId:cooperation.id,idempotencyKey:randomUUID()};
 const task=await h.post('/admin/electronic-documents/prepare',input);assert.equal(task.status,'PREPARED');assert.equal((await h.post('/admin/electronic-documents/prepare',input)).id,task.id);
 // Main cooperation activation changes its bookkeeping revision, not the signed scope.
 await h.db.partnerAgreement.update({where:{id:agreement.id},data:{revision:{increment:1}}});
 const grantInput={kind:'COOPERATION_GRANT',resourceId:agreement.latestVersion.id,revision:agreement.revision+1,templateId:grantTemplate.id,idempotencyKey:randomUUID()};
 const grantTask=await h.post('/admin/electronic-documents/prepare',grantInput);
 assert.notEqual(grantTask.id,task.id);assert.equal(grantTask.kind,'COOPERATION_GRANT');assert.ok(grantTask.parties.every((p:any)=>p.mode==='MANUAL'));
 assert.equal((await h.post('/admin/electronic-documents/prepare',grantInput)).id,grantTask.id);
 const grantArchive=await h.db.archiveVersion.findUniqueOrThrow({where:{id:grantTask.archiveVersionId}});
 assert.equal((grantArchive.scopeSnapshot as any).v31Sources.hash,ready.hash);
 assert.equal((await h.db.partnerAgreement.findUniqueOrThrow({where:{id:agreement.id}})).status,'DRAFT');
 const archive=await h.db.archiveVersion.findUniqueOrThrow({where:{id:task.archiveVersionId}}),scope=archive.scopeSnapshot as any;assert.equal(scope.v31Sources.hash,ready.hash);assert.equal(JSON.stringify(scope).includes(bank.accountNumber),false);assert.equal(scope.electronicDocument.pageCount>1,true);
 await h.db.partnerAgreement.update({where:{id:agreement.id},data:{revision:agreement.revision}});
 const writer=new ContractPdfArtifactWriterService(h.db);let queries=0,uploads=0;
 const service=new ElectronicDocumentService(h.db,{upload:async()=>{uploads++;return{evidenceHash:'a'.repeat(64)};},manualUrl:async()=>({url:'https://synthetic.invalid/local-only'}),querySigner:async()=>{queries++;return{...syntheticSigningTime(new Date()),status:'SIGNED',evidenceHash:'b'.repeat(64)};}} as any,writer);
 await (service as any).revokeGrant({kind:'OWNER',id:owner.person.id,ownerId:owner.owner.id},grantTask.id,{...command(grantTask.revision),reason:'合成撤销独立用印授权'});
 await assert.rejects(()=>service.start({kind:'ADMIN',id:h.maker.id},grantTask.id,command(grantTask.revision)),(e:any)=>e.getResponse?.().error?.code==='V31_GRANT_REVOKED');
 const renewedGrant=await h.post('/admin/electronic-documents/prepare',{...grantInput,revision:agreement.revision,idempotencyKey:randomUUID()});assert.notEqual(renewedGrant.id,grantTask.id);
 assert.equal((await h.db.partnerAgreement.findUniqueOrThrow({where:{id:agreement.id}})).status,'DRAFT');
 // Provider refresh increments only the enterprise row bookkeeping revision.
 const technical=await h.db.ownerAutoAuthority.create({data:{ownerId:owner.owner.id,sealId:owner.seal.id,providerCustomerId:owner.account.providerCustomerId!,providerSignatureId:owner.seal.providerSignatureId,certificateSerialNo:owner.account.certSerialNo!,providerContractId:randomUUID(),providerTransactionId:randomUUID(),requestedBy:owner.person.id,idempotencyKey:randomUUID(),requestHash:'a'.repeat(64),scope:{},scopeHash:'a'.repeat(64),consentSnapshot:{},method:'PROVIDER_AUTO_GRANT',status:'AUTHORIZED',enabled:true,checkedAt:new Date()}});
 await new OwnerAuthorizationService(h.db,new OwnerService(h.db),{assertAvailable:()=>{},queryAuthorization:async()=>({authorized:true}),queryCertificate:async()=>({bound:true,serialNo:owner.account.certSerialNo})} as any).refresh(owner.person.id,owner.owner.id,technical.id);
 await service.start({kind:'ADMIN',id:h.maker.id},task.id,command(task.revision));
 let current=await h.db.electronicSigningTask.findUniqueOrThrow({where:{id:task.id}});
 await service.sign({kind:'OWNER',id:owner.person.id,ownerId:owner.owner.id},task.id,{...command(current.revision),sourceSha256:task.sourceSha256,accepted:true});
 await h.db.vehicleOwner.update({where:{id:owner.owner.id},data:{address:'合成资料变更地址',revision:{increment:1}}});
 await h.reject('/admin/electronic-documents/prepare',{...input,idempotencyKey:randomUUID()},h.maker,'V31_SOURCES_CHANGED');
 current=await h.db.electronicSigningTask.findUniqueOrThrow({where:{id:task.id}});await h.reject(`/admin/electronic-documents/${task.id}/start`,command(current.revision),h.maker,'V31_SOURCES_CHANGED');assert.equal(uploads,1);
 await service.sync({kind:'ADMIN',id:h.maker.id},task.id,command(current.revision));assert.equal(queries,1);assert.equal((await h.db.electronicSigningParty.findFirstOrThrow({where:{taskId:task.id,role:'OWNER'}})).status,'SIGNED');
 current=await h.db.electronicSigningTask.findUniqueOrThrow({where:{id:task.id}});await h.post(`/admin/electronic-documents/${task.id}/withdraw`,{...command(current.revision),reason:'合成来源变更停止'});
 assert.equal(h.externalCalls+h.identityCalls+h.esignCalls,0);
 }finally{await h.close();for(const[k,v]of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
