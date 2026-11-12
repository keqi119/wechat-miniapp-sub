import {z} from 'zod';
import {ensure} from '../common/errors';
import {hash} from '../common/data';
import {currentDocuments} from '../auth/consents';
import {readSimpleAgreementSnapshot} from '../partners/simple-agreements';
import {NINDA_PLATFORM_LEGAL_ENTITY} from '../common/platform-legal-entity';
import {requireCurrentVirtualScope} from '../virtual-acceptance/scope';
export const electronicCommercialTermsInput=z.object({vehicleIdentification:z.string().trim().min(1).max(1000),customerAddress:z.string().trim().min(1).max(1000),handoverArrangement:z.string().trim().min(1).max(1500)}).strict();
export const agreedFeeComponentsInput=z.object({baseFeeAmount:z.number().int().nonnegative().max(2147483647),mileageMonthlyFeeAmount:z.number().int().nonnegative().max(2147483647)}).strict();
export function assertAgreedFeeComponents(product:any,input:any){
 const components=input.agreedFeeComponents??(input.monthlyFeeAmount===product.monthlyFeeAmount?{baseFeeAmount:product.baseFeeAmount,mileageMonthlyFeeAmount:product.mileageMonthlyFeeAmount}:null);
 ensure(agreedFeeComponentsInput.safeParse(components).success&&components.baseFeeAmount+components.mileageMonthlyFeeAmount===input.monthlyFeeAmount,409,'V31_PRICE_COMPONENTS_REQUIRED','须填写与确认月费一致的真实基础费和里程费');
 ensure(input.monthlyFeeAmount===product.monthlyFeeAmount||input.priceAdjustmentReason?.trim(),409,'PRODUCT_PRICE_ADJUSTMENT_REQUIRED','月费调整须填写原因');return components;
}
export async function electronicPlatformParty(tx:any){
 const account=process.env.FADADA_PLATFORM_CUSTOMER_ID?await tx.ownerESignAccount.findUnique({where:{providerCustomerId:process.env.FADADA_PLATFORM_CUSTOMER_ID},include:{owner:true}}):null;
 ensure(account?.owner?.name===NINDA_PLATFORM_LEGAL_ENTITY&&account.owner.subjectType==='ENTERPRISE',409,'ELECTRONIC_PLATFORM_MISMATCH','须配置宁达实际企业账号');
 return{role:'PLATFORM',partyId:account.owner.id,name:account.owner.name,subjectType:'ENTERPRISE'};
}
export async function buildElectronicLessorSnapshot(tx:any,vehicleId:string,range:{startDate:string;endDate:string}){
 const virtual=await requireCurrentVirtualScope(tx,{vehicleId,action:'LESSOR'});
 // The existing cooperation may be paper or electronic; this new customer contract remains ELECTRONIC.
 const source=await readSimpleAgreementSnapshot(tx,vehicleId,range);ensure(source,409,'ELECTRONIC_COOPERATION_REQUIRED','须有覆盖本车完整租期的有效合作协议');
 const owner=await tx.vehicleOwner.findUniqueOrThrow({where:{id:source.ownerId}}),binding=await tx.partnerAgreementVehicle.findUniqueOrThrow({where:{vehicleId}});
 const [currentTemplate,notice]=await currentDocuments(tx,['ELECTRONIC_V31_SUBSCRIPTION','owner-data-sharing']),template=virtual?await tx.legalDocument.findUnique({where:{id:virtual.subscriptionTemplateId}}):currentTemplate;ensure(template?.confirmedBy&&notice.confirmedBy,409,'LEGAL_NOT_APPROVED','正文及资料告知须已批准');
 if(virtual)ensure(source.agreementVersionId===virtual.cooperationVersionId&&source.ownerId===virtual.ownerId&&hash(template.content)===virtual.subscriptionTemplateHash,409,'VIRTUAL_COOPERATION_CHANGED','须使用指定测试范围中已签归档合作及精确正文');
 const content=notice.content.replace(/\{\{(\w+)\}\}/g,(m:string,k:string)=>({lessorName:owner.name,lessorCreditCode:owner.creditCode,lessorAddress:owner.address,lessorPhone:owner.contactPhone} as any)[k]||m);ensure(!content.includes('{{'),409,'OWNER_NOTICE_INCOMPLETE','资料告知缺少真实出租方资料');
 return{version:4,mode:'SIMPLE_AGREEMENT',executionMode:'ELECTRONIC',platformLegalEntityName:NINDA_PLATFORM_LEGAL_ENTITY,subjectType:owner.subjectType,ownerId:owner.id,name:owner.name,creditCode:owner.creditCode,address:owner.address,phone:owner.contactPhone,profileRevision:owner.revision,vehicleId,bindingRevision:binding.revision,agreementId:source.agreementId,agreementVersionId:source.agreementVersionId,agreementHash:source.contentHash,partnerRateBps:source.partnerRateBps,leaseRange:range,templateId:template.id,templateVersion:template.version,templateHash:hash(template.content),sharingNotice:{id:notice.id,version:notice.version,title:notice.title,content,contentHash:hash(content),templateHash:hash(notice.content)}};
}
