import {readFileSync} from 'node:fs';
import {randomUUID,randomInt} from 'node:crypto';
import {hash} from '../src/common/data';
import {accountHash} from '../src/partners/revenue-types';
import {seedTrustedCustomerProfile} from './customer-profile-fixture';
import {QualificationService,customerProfileHash} from '../src/customers/qualifications';
import {versionSnapshot} from '../src/products/snapshot';
import {productVersionInclude} from '../src/products/types';
import {canonicalHash} from '../src/customers/types';
export const v31FixtureContent=(id:string)=>readFileSync(`../../docs/legal/drafts/ninda/launch-20261107-v31/${id}.json`,'utf8');
/** Dedicated guarded test DB prerequisites; no external identity or signing call. */
export async function seedV31CooperationSources(db:any,staffId:string,owner:any,platform:any,vehicle:any,options:{countBenefit?:boolean}={}){
 const proof=await db.storedFile.create({data:{adminId:staffId,name:'SYNTHETIC V31 SOURCE',mimeType:'application/pdf',size:10,sha256:'a'.repeat(64),storagePath:'synthetic-never-read',purpose:'evidence'}});
 for(const company of [owner,platform]){
  await db.vehicleOwner.update({where:{id:company.id},data:{status:'VERIFIED',contractProfile:{serviceContactName:'合成联系人',serviceContactChannel:'合成电话',signerAuthorityRole:'LEGAL_REPRESENTATIVE'}}});
  const manager=await db.customer.create({data:{name:'合成法人',mobile:'139'+randomInt(10000000,99999999)}});
  await db.ownerLegalRepresentative.create({data:{ownerId:company.id,name:'合成法人',mobileHash:'a'.repeat(64),maskedMobile:'139****0000',revision:1,evidenceHash:'a'.repeat(64),createdBy:staffId,updatedBy:staffId}});
  const data={managerCustomerId:manager.id,realNameStatus:'VERIFIED',evidenceHash:'b'.repeat(64),checkedAt:new Date(),consentSnapshot:{legalRevision:1,legalName:'合成法人'}};
  await db.ownerESignAccount.upsert({where:{ownerId:company.id},create:{ownerId:company.id,providerCustomerId:'SYN-'+randomUUID(),...data},update:data});
 }
 await db.vehicle.update({where:{id:vehicle.id},data:{plateNumber:'合成测试001'}});
 await db.vehicleAssetProfile.create({data:{vehicleId:vehicle.id,registeredOwnerName:owner.name,batteryOwnership:'OWNED',createdBy:staffId,updatedBy:staffId}});
 await db.vehicleConditionAssessment.create({data:{vehicleId:vehicle.id,fireDamage:false,floodDamage:false,structuralDamage:false,assessedBy:staffId,createdBy:staffId}});
 const bank={accountName:owner.name,bankName:'合成银行',accountNumber:'6222000012345678'};await db.partnerAccountVersion.create({data:{ownerId:owner.id,version:1,status:'APPROVED',...bank,contentHash:accountHash(bank),evidenceFileIds:[proof.id],createdBy:staffId,reviewedBy:staffId,reviewedAt:new Date()}});
 const countBenefit=options.countBenefit?await db.benefitDefinition.create({data:{name:'合成轮胎检查',createdBy:staffId,versions:{create:{version:1,name:'合成轮胎检查',description:'合同期内两次合成轮胎检查',provider:'合成服务商',conditions:'提前预约',kind:'COUNT',unit:'次',totalQuantity:2,validity:'ORDER',createdBy:staffId}}},include:{versions:true}}):null;
 const definition=await db.product.create({data:{name:'合成产品',createdBy:staffId}});
 const product=await db.productVersion.create({data:{productId:definition.id,version:1,status:'PUBLISHED',name:'合成产品',months:6,minimumTermMonths:3,configurationVersion:2,baseFeeAmount:8000,mileageMonthlyFeeAmount:2000,swapPolicy:{version:2,period:'TERM',includedCount:1,extraFeeAmount:50000},monthlyFeeAmount:10000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'充换电费用由客户自付',conditions:'合成条件',vehicleIds:[vehicle.id],modelDefinitionIds:[],customerBaas:{disposition:'INCLUDED'},createdBy:staffId,items:{create:[{kind:'BASE_SUBSCRIPTION',position:0},...(countBenefit?[{kind:'BENEFIT',position:1,benefitVersionId:countBenefit.versions[0].id}]:[])]}}});
 const template=await db.legalDocument.create({data:{type:'ELECTRONIC_V31_SUBSCRIPTION',version:randomInt(10000,2000000000),title:'SYNTHETIC TEST SUBSCRIPTION',content:v31FixtureContent('01'),status:'PUBLISHED',confirmedBy:staffId,confirmedAt:new Date()}});
 Object.assign(process.env,{CONTRACT_CJK_FONT_FACE:'MicrosoftYaHei',CONTRACT_CJK_BOLD_FONT_PATH:'C:/Windows/Fonts/msyhbd.ttc',CONTRACT_CJK_BOLD_FONT_FACE:'MicrosoftYaHei-Bold'});
 return{productVersionIds:[product.id],productDepositRules:[{productVersionId:product.id,rule:{kind:'CREDIT_POLICY',policyVersion:'ZHIMA_MANUAL_V1'}}],templateRefs:[{id:template.id,hash:hash(template.content)}],vehicleScopes:[{vehicleId:vehicle.id,validFrom:'2026-11-01',validUntil:'2027-12-31',authorityEvidenceFileIds:[proof.id],rightsRestrictions:{status:'NONE',evidenceFileIds:[proof.id]},insuranceArrangement:{description:'已确认合成投保安排，尚未出单',evidenceFileIds:[proof.id]}}]};
}
export async function seedV31Subscription(db:any,f:any){
 const customer=await db.customer.create({data:{name:'合成订阅客户',mobile:'138'+randomInt(10000000,99999999),drivingYears:5}});
 const profile=await seedTrustedCustomerProfile(db,customer.id),now=new Date();
 await db.eSignAccount.update({where:{customerId:customer.id},data:{checkedAt:now,certStatus:'BOUND',certSerialNo:'SYN-'+randomUUID(),certValidFrom:new Date(now.getTime()-86400000),certValidUntil:new Date(now.getTime()+86400000),certCheckedAt:now,certEvidenceHash:'c'.repeat(64)}});
 const qualification=new QualificationService();
 const q=await db.serial((tx:any)=>qualification.submit(tx,f.actor,customer.id,{revision:0,idempotencyKey:randomUUID(),profileHash:customerProfileHash(profile.customer),verificationSource:'MANUAL',identityFileIds:profile.files.slice(0,2).map((v:any)=>v.id),drivingLicenseFileIds:[profile.files[2].id],identityLongTerm:true,drivingLicenseLongTerm:true}));
 const reviewer=await db.adminUser.create({data:{username:randomUUID(),passwordHash:'synthetic-no-login',name:'合成资格审核',role:'OPERATIONS'}});
 await db.serial((tx:any)=>qualification.review(tx,{id:reviewer.id,role:reviewer.role,authVersion:reviewer.authVersion},customer.id,{revision:q.revision,qualificationId:q.id,idempotencyKey:randomUUID(),decision:'APPROVED'}));
 const p=await db.productVersion.findUnique({where:{id:f.v31Sources.productVersionIds[0]},include:productVersionInclude}),product=versionSnapshot(p),template=await db.legalDocument.findUnique({where:{id:f.v31Sources.templateRefs[0].id}});
 const plan=await db.subscriptionPlan.create({data:{vehicleId:f.vehicle.id,productVersionId:p.id,name:p.name,months:p.months,monthlyFeeAmount:p.monthlyFeeAmount,mileagePerMonthKm:p.mileagePerMonthKm,excessMileagePriceAmount:p.excessMileagePriceAmount,energyDescription:p.energyDescription,benefits:[],conditions:p.conditions}});
 const application=await db.application.create({data:{customerId:customer.id,vehicleId:f.vehicle.id,subscriptionPlanId:plan.id,profile:{},consents:{},idempotencyKey:randomUUID(),requestHash:'a'.repeat(64)}});
 const v=await db.partnerAgreementVersion.findUnique({where:{id:f.draft.latestVersion.id}}),owner=await db.vehicleOwner.findUnique({where:{id:f.owner.id}});
 const lessor={version:4,mode:'SIMPLE_AGREEMENT',executionMode:'ELECTRONIC',ownerId:owner.id,name:owner.name,subjectType:owner.subjectType,creditCode:owner.creditCode,agreementId:v.agreementId,agreementVersionId:v.id,agreementHash:v.contentHash,partnerRateBps:v.partnerRateBps,vehicleId:f.vehicle.id,leaseRange:{startDate:'2026-11-07',endDate:'2027-05-06'},templateId:template.id,templateHash:hash(template.content)};
 const b:any={months:6,monthlyFeeAmount:p.monthlyFeeAmount,depositAmount:0,mileagePerMonthKm:p.mileagePerMonthKm,excessMileagePriceAmount:p.excessMileagePriceAmount,startDate:'2026-11-07',firstDueDate:'2026-11-07',energyDescription:p.energyDescription,conditions:p.conditions,productSnapshot:product,lessorSnapshot:lessor,revenueRuleSnapshot:{mode:'SIMPLE_AGREEMENT',ownerId:owner.id,vehicleId:f.vehicle.id,agreementId:v.agreementId,agreementVersionId:v.id,versionId:v.id,contentHash:v.contentHash,partnerRateBps:v.partnerRateBps},partiesSnapshot:[{role:'CUSTOMER',partyId:customer.id,subjectType:'INDIVIDUAL'},{role:'OWNER',partyId:owner.id,subjectType:owner.subjectType},{role:'PLATFORM',partyId:f.platform.id,subjectType:'ENTERPRISE'}],commercialTerms:{customerAddress:'合成联系地址',handoverArrangement:'计划2026-11-07于合成测试交付中心交付'}};b.commercialHash=canonicalHash(b);
 const order=await db.order.create({data:{applicationId:application.id,customerId:customer.id,vehicleId:f.vehicle.id,contractMode:'ELECTRONIC',status:'AWAITING_SIGNATURE',confirmedMileageKm:0,finalPlanSnapshot:b}});
 await db.contract.create({data:{orderId:order.id,customerId:customer.id,kind:'SUBSCRIPTION',executionMode:'ELECTRONIC',documentHash:b.commercialHash}});return{order,customer,profile,template};
}
