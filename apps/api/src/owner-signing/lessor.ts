import {z} from 'zod';
import {ensure} from '../common/errors';
import {hash} from '../common/data';
import {currentDocuments} from '../auth/consents';
import {approvedPartner} from '../partners/types';
import {ownerCooperationReady} from '../offline-documents/readiness';
import {platformLegalEntity,NINDA_PLATFORM_LEGAL_ENTITY} from '../common/platform-legal-entity';
import {hasSimpleAgreementScope,readSimpleAgreementSnapshot} from '../partners/simple-agreements';
import {assertNotAssetFiles} from '../files/asset-files';
export function lessorIdentityHash(s:any){
 if(s.version===4&&s.mode==='SIMPLE_AGREEMENT')return hash({snapshotVersion:4,mode:s.mode,executionMode:s.executionMode,ownerId:s.ownerId,name:s.name,subjectType:s.subjectType,creditCode:s.creditCode,address:s.address,phone:s.phone,profileRevision:s.profileRevision,vehicleId:s.vehicleId,bindingRevision:s.bindingRevision,agreementId:s.agreementId,agreementVersionId:s.agreementVersionId,agreementHash:s.agreementHash,partnerRateBps:s.partnerRateBps,platformLegalEntityName:s.platformLegalEntityName,leaseRange:{startDate:s.leaseRange?.startDate,endDate:s.leaseRange?.endDate},templateId:s.templateId,templateVersion:s.templateVersion,templateHash:s.templateHash,noticeId:s.sharingNotice?.id,noticeVersion:s.sharingNotice?.version,noticeHash:s.sharingNotice?.contentHash});
 return hash({ownerId:s.ownerId,name:s.name,creditCode:s.creditCode,address:s.address,phone:s.phone,vehicleId:s.vehicleId,bindingId:s.bindingId,bindingRevision:s.bindingRevision,evidenceHash:s.evidenceHash,templateId:s.templateId,templateVersion:s.templateVersion,templateHash:s.templateHash,noticeId:s.sharingNotice?.id,noticeVersion:s.sharingNotice?.version,noticeHash:s.sharingNotice?.contentHash,...(s.executionMode==='OFFLINE'?{platformLegalEntityName:s.platformLegalEntityName,subjectType:s.subjectType,profileRevision:s.profileRevision,verificationId:s.verificationId,verificationRevision:s.verificationRevision,identityBindingId:s.identityBindingId,identityBindingRevision:s.identityBindingRevision,cooperationVersionId:s.cooperationVersionId,leaseRange:{startDate:s.leaseRange?.startDate,endDate:s.leaseRange?.endDate}}:{}),...(s.executionMode==='OFFLINE'&&s.version===3?{snapshotVersion:3,cooperationSubmissionId:s.cooperationSubmissionId,cooperationSubmissionRevision:s.cooperationSubmissionRevision,cooperationSubmissionHash:s.cooperationSubmissionHash}:{})});}

const leaseDate=z.iso.date().refine(value=>!value.startsWith('0000-'),'日期无效');
const leaseInput=z.object({startDate:leaseDate,endDate:leaseDate}).strict().refine(v=>v.endDate>=v.startDate,'租期无效');
export async function buildOfflineLessorSnapshot(tx:any,vehicleId:string,leaseRange:{startDate:string;endDate:string}):Promise<any>{
 const range=leaseInput.parse(leaseRange),platformLegalEntityName=platformLegalEntity();ensure(platformLegalEntityName===NINDA_PLATFORM_LEGAL_ENTITY,409,'PLATFORM_ENTITY_MISMATCH','本版线下合同平台主体须为上海宁达信息科技有限公司');
 await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${vehicleId} FOR UPDATE`;
 const simple=await readSimpleAgreementSnapshot(tx,vehicleId,range);
 if(simple){
  await tx.$queryRaw`SELECT id FROM "VehicleOwner" WHERE id = ${simple.ownerId} FOR UPDATE`;
  const owner=await tx.vehicleOwner.findUnique({where:{id:simple.ownerId}}),binding=await tx.partnerAgreementVehicle.findUnique({where:{vehicleId}});
  ensure(owner&&owner.status!=='SUSPENDED',409,'SIMPLE_AGREEMENT_REQUIRED','合作商档案不可用');
  const [template,notice]=await currentDocuments(tx,['OFFLINE_RENTAL','owner-data-sharing']);ensure(template.confirmedBy&&notice.confirmedBy,409,'LEGAL_NOT_APPROVED','租赁合同与出租方资料告知须已审定');
  const fields:Record<string,string>={lessorName:owner.name,lessorCreditCode:owner.creditCode||'未登记',lessorAddress:owner.address||'未登记',lessorPhone:owner.contactPhone||'未登记'};
  const content=notice.content.replace(/\{\{(\w+)\}\}/g,(match:string,key:string)=>fields[key]??match);ensure(content.trim()&&!/\{\{|\}\}/.test(content),409,'OWNER_NOTICE_INCOMPLETE','出租方告知仍有未填充字段');
  return{version:4,mode:'SIMPLE_AGREEMENT',executionMode:'OFFLINE',platformLegalEntityName,subjectType:owner.subjectType,ownerId:owner.id,name:owner.name,creditCode:owner.creditCode,address:owner.address,phone:owner.contactPhone,profileRevision:owner.revision,vehicleId,bindingRevision:binding.revision,agreementId:simple.agreementId,agreementVersionId:simple.agreementVersionId,agreementHash:simple.contentHash,partnerRateBps:simple.partnerRateBps,leaseRange:{...range},templateId:template.id,templateVersion:template.version,templateHash:hash(template.content),sharingNotice:{id:notice.id,version:notice.version,title:notice.title,content,contentHash:hash(content),templateHash:hash(notice.content)}};
 }
 ensure(!await hasSimpleAgreementScope(tx,vehicleId),409,'SIMPLE_AGREEMENT_REQUIRED','车辆须登记覆盖完整租期的有效合作协议');
 const binding=await tx.ownerVehicle.findUnique({where:{vehicleId},include:{owner:true}});
 ensure(binding?.status==='APPROVED'&&binding.reviewedBy&&binding.reviewedAt,409,'OWNER_VEHICLE_REQUIRED','车辆归属须独立审核');
 await assertNotAssetFiles(tx,[binding.evidenceFileId]);
 const owner=binding.owner;
 await tx.$queryRaw`SELECT id FROM "VehicleOwner" WHERE id = ${owner.id} FOR UPDATE`;
 const currentOwner=await tx.vehicleOwner.findUnique({where:{id:owner.id}});
 ensure(currentOwner,409,'OWNER_BUSINESS_UNVERIFIED','合作商档案不可用');
 const {verification}=await approvedPartner(tx,currentOwner);
 const cooperation=await ownerCooperationReady(tx,currentOwner.id,vehicleId,range.startDate,range.endDate);
 ensure(cooperation.ready,409,cooperation.blockers[0]||'OWNER_COOPERATION_REQUIRED','合作协议须已归档并覆盖本车及完整租期');
 ensure(currentOwner.address?.trim()&&/^[+\d ()-]{5,30}$/.test(currentOwner.contactPhone||''),409,'OWNER_CONTACT_REQUIRED','请补齐实际出租方的地址及联系方式');
 const evidence=await tx.storedFile.findUnique({where:{id:binding.evidenceFileId}});ensure(evidence&&/^[a-f0-9]{64}$/.test(evidence.sha256),409,'OWNER_EVIDENCE_REQUIRED','车辆权属材料缺失');
 const [template,notice]=await currentDocuments(tx,['OFFLINE_RENTAL','owner-data-sharing']);ensure(template.confirmedBy&&notice.confirmedBy,409,'LEGAL_NOT_APPROVED','租赁合同与出租方资料告知须已审定');
 const fields:Record<string,string>={lessorName:currentOwner.name,lessorCreditCode:currentOwner.creditCode||'个人出租方',lessorAddress:currentOwner.address,lessorPhone:currentOwner.contactPhone};const content=notice.content.replace(/\{\{(\w+)\}\}/g,(m:string,k:string)=>fields[k]||m);ensure(!content.includes('{{')&&content.trim(),409,'OWNER_NOTICE_INCOMPLETE','出租方告知不完整');
 return{version:3,executionMode:'OFFLINE',platformLegalEntityName,subjectType:currentOwner.subjectType,ownerId:currentOwner.id,name:currentOwner.name,creditCode:currentOwner.creditCode,address:currentOwner.address,phone:currentOwner.contactPhone,profileRevision:currentOwner.revision,vehicleId,bindingId:binding.id,bindingRevision:binding.revision,evidenceHash:evidence.sha256,cooperationSubmissionId:verification.id,cooperationSubmissionRevision:verification.revision,cooperationSubmissionHash:verification.submissionHash,cooperationArchiveId:cooperation.archiveId,cooperationVersionId:cooperation.versionId,leaseRange:{...range},templateId:template.id,templateVersion:template.version,templateHash:hash(template.content),sharingNotice:{id:notice.id,version:notice.version,title:notice.title,content,contentHash:hash(content),templateHash:hash(notice.content)}};
}
export async function confirmOfflineLessor(tx:any,customerId:string,vehicleId:string,snapshot:any,raw:unknown){
 const input=z.object({accepted:z.literal(true),lessorHash:z.string().length(64),noticeHash:z.string().length(64)}).strict().parse(raw);
 ensure(snapshot?.executionMode==='OFFLINE',409,'OWNER_LESSOR_CHANGED','出租方线下快照缺失');const current=await buildOfflineLessorSnapshot(tx,vehicleId,snapshot.leaseRange);
 ensure(lessorIdentityHash(current)===lessorIdentityHash(snapshot),409,'OWNER_LESSOR_CHANGED','出租方资料、合作范围或告知已变化，请重新确认');
 ensure(input.lessorHash===lessorIdentityHash(snapshot)&&input.noticeHash===snapshot.sharingNotice.contentHash,409,'OWNER_SHARING_CONSENT','请单独同意向本单实际出租方提供必要合同资料');return{ownerId:snapshot.ownerId,customerId,acceptedAt:new Date().toISOString(),lessorHash:input.lessorHash,notice:snapshot.sharingNotice};
}
export async function buildLessorSnapshot(tx:any,vehicleId:string){
 const binding=await tx.ownerVehicle.findUnique({where:{vehicleId},include:{owner:{include:{esignAccount:true,seals:{where:{status:'ACTIVE'}}}}}});
 if(!binding&&process.env.OWNER_CONTRACTS_ENABLED!=='true')return null;
 ensure(process.env.OWNER_CONTRACTS_ENABLED==='true',503,'OWNER_CONTRACTS_DISABLED','实际车主合同入口尚未开放');
 ensure(binding?.status==='APPROVED'&&binding.reviewedAt&&binding.reviewedBy,409,'OWNER_VEHICLE_REQUIRED','车辆须先完成实际车主归属资料审核');
 await assertNotAssetFiles(tx,[binding.evidenceFileId]);
 const owner=binding.owner,account=owner.esignAccount;
 ensure(owner.status==='VERIFIED'&&account?.realNameStatus==='VERIFIED',409,'OWNER_NOT_READY','实际车主企业或法人实名认证尚未核验，请由法人本人在企业与印章页查询认证结果');
 ensure(account.certStatus==='BOUND'&&account.certSerialNo,409,'OWNER_NOT_READY','尚未确认有效的实际车主企业签署证书，请由法人本人重新核验企业与证书状态');
 ensure(account.checkedAt&&Date.now()-account.checkedAt.getTime()<86400000,409,'OWNER_NOT_READY',account.checkedAt?'实际车主企业核验记录已超过24小时，请由法人本人在企业与印章页重新核验企业与证书状态后，再发布最终方案':'实际车主企业缺少当前核验记录，请由法人本人在企业与印章页重新核验企业与证书状态');
 ensure(!account.leaseToken,409,'OWNER_NOT_READY','实际车主企业仍有未完成的核验任务，请稍后重新读取企业资料再发布最终方案');
 ensure(owner.seals.length===1,409,'OWNER_NOT_READY',owner.seals.length?'实际车主企业存在多枚已选印章，请联系运营核对':'实际车主企业尚未选用印章，请由法人本人核验后选用本企业印章');
 ensure(owner.seals[0].providerCustomerId===account.providerCustomerId,409,'OWNER_NOT_READY','实际车主已选印章与认证企业归属不匹配，请由法人本人重新核验并联系运营核对');
 ensure(owner.address.trim()&&/^[+\d ()-]{5,30}$/.test(owner.contactPhone),409,'OWNER_CONTACT_REQUIRED','请补齐实际出租方的注册地址和对外联系方式');
 const evidence=await tx.storedFile.findUnique({where:{id:binding.evidenceFileId}});ensure(evidence&&/^[a-f0-9]{64}$/.test(evidence.sha256),409,'OWNER_EVIDENCE_REQUIRED','车主归属审核资料缺失');
 const [template,notice]=await currentDocuments(tx,['owner-rental-contract','owner-data-sharing']);ensure(template.confirmedBy&&notice.confirmedBy,409,'LEGAL_NOT_APPROVED','车主签约文案尚未审定');
 const fields:Record<string,string>={lessorName:owner.name,lessorCreditCode:owner.creditCode,lessorAddress:owner.address,lessorPhone:owner.contactPhone};const content=notice.content.replace(/\{\{(\w+)\}\}/g,(m:string,k:string)=>fields[k]||m);ensure(!content.includes('{{')&&content.trim(),409,'OWNER_NOTICE_INCOMPLETE','出租方信息告知不完整');
 return{version:1,ownerId:owner.id,name:owner.name,creditCode:owner.creditCode,address:owner.address,phone:owner.contactPhone,vehicleId,bindingId:binding.id,bindingRevision:binding.revision,evidenceHash:evidence.sha256,templateId:template.id,templateVersion:template.version,templateHash:hash(template.content),sharingNotice:{id:notice.id,version:notice.version,title:notice.title,content,contentHash:hash(content),templateHash:hash(notice.content)}};
}
export async function confirmLessor(tx:any,customerId:string,vehicleId:string,snapshot:any,raw:unknown){
 const input=z.object({accepted:z.literal(true),lessorHash:z.string().length(64),noticeHash:z.string().length(64)}).strict().parse(raw);
 const current=await buildLessorSnapshot(tx,vehicleId);ensure(current&&snapshot&&lessorIdentityHash(current)===lessorIdentityHash(snapshot),409,'OWNER_LESSOR_CHANGED','实际出租方或告知文本已变化，请重新确认最终方案');
 ensure(input.lessorHash===lessorIdentityHash(snapshot)&&input.noticeHash===snapshot.sharingNotice.contentHash,409,'OWNER_SHARING_CONSENT','请单独阅读并同意向本单实际出租方提供必要合同资料');
 return{ownerId:snapshot.ownerId,customerId,acceptedAt:new Date().toISOString(),lessorHash:input.lessorHash,notice:snapshot.sharingNotice};
}
