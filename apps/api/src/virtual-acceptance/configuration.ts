import {ensure} from '../common/errors';
import {hash} from '../common/data';
import {canonicalHash} from '../customers/types';
import {versionSnapshot,validatePublishedVersion} from '../products/snapshot';
import {productVersionInclude} from '../products/types';
import {cooperationContentHash} from '../electronic-documents/cooperation';
import {validateV31Template} from '../contract-terms/template-map';
import {VIRTUAL_WRAPPER_HASH,VIRTUAL_WRAPPER_VERSION} from './wrapper';
import {VIRTUAL_NOTICE_HASH} from './scope';
export const VIRTUAL_FACTS={schema:'NINDA_VIRTUAL_FACTS_V1',vehicle:'VIRTUAL_NOT_A_REAL_VEHICLE',vin:'NOT_APPLICABLE',title:'NOT_APPLICABLE',insurance:'NOT_APPLICABLE',condition:'NOT_APPLICABLE',driverQualification:'NOT_APPLICABLE_NO_DRIVING',collectionAccount:'NOT_APPLICABLE_NO_PAYOUT',revenue:'NOT_APPLICABLE_NO_PAYOUT'} as const;
export const VIRTUAL_FACTS_HASH=canonicalHash(VIRTUAL_FACTS);
const keys=['id','revision','expiresAt','customerId','ownerId','ownerActorCustomerId','platformId','platformActorCustomerId','vehicleId','productVersionId','productHash','cooperationVersionId','cooperationHash','subscriptionTemplateId','subscriptionTemplateHash','cooperationTemplateId','cooperationTemplateHash','grantTemplateId','grantTemplateHash','wrapperVersion','wrapperHash','wrapperApprovedBy','wrapperApprovedAt','testFactsHash','noticeHash','months','monthlyFeeAmount','depositKind','depositAmount'];
export function virtualConfigurationHash(s:any){return canonicalHash(JSON.parse(JSON.stringify(Object.fromEntries(keys.map(k=>[k,s[k]])))));}
export async function validateVirtualConfiguration(tx:any,s:any){
 ensure(s.configurationHash===virtualConfigurationHash(s),409,'VIRTUAL_CONFIGURATION_CHANGED','虚拟验收冻结配置摘要不匹配');
 ensure(s.wrapperHash===VIRTUAL_WRAPPER_HASH&&s.wrapperVersion===VIRTUAL_WRAPPER_VERSION&&s.wrapperApprovedBy&&s.wrapperApprovedAt&&s.testFactsHash===VIRTUAL_FACTS_HASH&&s.noticeHash===VIRTUAL_NOTICE_HASH,409,'VIRTUAL_WRAPPER_NOT_APPROVED','须审定准确的虚拟验收说明及事实范围');
 ensure(s.months===12&&s.monthlyFeeAmount===100&&s.depositKind==='FIXED'&&s.depositAmount===100,409,'VIRTUAL_PRICE_CHANGED','测试价格固定为12期每期100分及100分押金');
 const p=await tx.productVersion.findUnique({where:{id:s.productVersionId},include:productVersionInclude});
 ensure(p?.status==='PUBLISHED'&&canonicalHash(versionSnapshot(p))===s.productHash,409,'VIRTUAL_PRODUCT_CHANGED','测试产品版本已变化');
 validatePublishedVersion(p,true);ensure(p.months===12&&p.monthlyFeeAmount===100&&p.configurationVersion===2&&p.vehicleIds.length===1&&p.vehicleIds[0]===s.vehicleId&&!p.modelDefinitionIds.length,409,'VIRTUAL_PRODUCT_CHANGED','测试产品仅可绑定指定虚拟车及固定测试价格');
 const a=await tx.partnerAgreementVersion.findUnique({where:{id:s.cooperationVersionId}}),terms=a?.electronicTerms?.v31Sources;
 ensure(a?.executionMode==='ELECTRONIC'&&a.ownerId===s.ownerId&&a.contentHash===s.cooperationHash&&cooperationContentHash(a)===s.cooperationHash&&!['VOID','RETIRED','TERMINATED'].includes(a.status),409,'VIRTUAL_COOPERATION_CHANGED','测试合作版本已变化');
 const agreement=await tx.partnerAgreement.findUnique({where:{id:a.agreementId}}),latest=await tx.partnerAgreementVersion.findFirst({where:{agreementId:a.agreementId},orderBy:{version:'desc'}});
 ensure(agreement?.ownerId===s.ownerId&&!['STOPPED','RETIRED'].includes(agreement.status)&&latest?.id===a.id&&a.vehicleIds.length===1&&a.vehicleIds[0]===s.vehicleId&&a.partnerRateBps===0&&terms?.virtualAcceptanceScopeId===s.id&&terms.productVersionIds.length===1&&terms.productVersionIds[0]===s.productVersionId&&terms.productDepositRules?.length===1&&terms.productDepositRules[0].productVersionId===s.productVersionId&&terms.productDepositRules[0].rule.kind==='FIXED'&&terms.productDepositRules[0].rule.amount===100&&terms.templateRefs?.length===1&&terms.templateRefs[0].id===s.subscriptionTemplateId&&terms.templateRefs[0].hash===s.subscriptionTemplateHash,409,'VIRTUAL_COOPERATION_CHANGED','合作范围或押金规则超出指定验收');
 for(const [prefix,kind] of [['subscription','SUBSCRIPTION'],['cooperation','COOPERATION'],['grant','COOPERATION_GRANT']]){
  const t=await tx.legalDocument.findUnique({where:{id:s[prefix+'TemplateId']}});
  ensure(t?.type==='ELECTRONIC_V31_'+kind&&t.status==='PUBLISHED'&&t.confirmedBy&&t.confirmedAt&&hash(t.content)===s[prefix+'TemplateHash']&&validateV31Template(JSON.parse(t.content)).kind===kind,409,'VIRTUAL_TEMPLATE_CHANGED','初始测试文书批准版本已变化');
 }
 return{product:p,cooperation:a};
}
