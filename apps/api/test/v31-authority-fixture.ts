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

export async function authorityFixture(h:JourneyHarness){
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
 const grantTask=await h.post('/admin/electronic-documents/prepare',{kind:'COOPERATION_GRANT',resourceId:agreement.latestVersion.id,revision:agreement.revision,templateId:grantTemplate.id,idempotencyKey:randomUUID()});
 return{owner,platform,car,product,subscription,cooperation,agreement,task,grantTask,proof:await h.db.storedFile.findUniqueOrThrow({where:{id:proof.id}})};
}
