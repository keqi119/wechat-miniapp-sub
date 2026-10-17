import {z} from 'zod';
import {ensure} from '../common/errors';
import {hash} from '../common/data';
import {currentDocuments} from '../auth/consents';
export function lessorIdentityHash(s:any){return hash({ownerId:s.ownerId,name:s.name,creditCode:s.creditCode,address:s.address,phone:s.phone,vehicleId:s.vehicleId,bindingId:s.bindingId,bindingRevision:s.bindingRevision,evidenceHash:s.evidenceHash,templateId:s.templateId,templateVersion:s.templateVersion,templateHash:s.templateHash,noticeId:s.sharingNotice?.id,noticeVersion:s.sharingNotice?.version,noticeHash:s.sharingNotice?.contentHash});}
export async function buildLessorSnapshot(tx:any,vehicleId:string){
 const binding=await tx.ownerVehicle.findUnique({where:{vehicleId},include:{owner:{include:{esignAccount:true,seals:{where:{status:'ACTIVE'}}}}}});
 if(!binding&&process.env.OWNER_CONTRACTS_ENABLED!=='true')return null;
 ensure(process.env.OWNER_CONTRACTS_ENABLED==='true',503,'OWNER_CONTRACTS_DISABLED','实际车主合同入口尚未开放');
 ensure(binding?.status==='APPROVED'&&binding.reviewedAt&&binding.reviewedBy,409,'OWNER_VEHICLE_REQUIRED','车辆须先完成实际车主归属资料审核');
 const owner=binding.owner,account=owner.esignAccount;
 ensure(owner.status==='VERIFIED'&&account?.realNameStatus==='VERIFIED'&&account.certStatus==='BOUND'&&account.certSerialNo&&account.checkedAt&&Date.now()-account.checkedAt.getTime()<86400000&&!account.leaseToken&&owner.seals.length===1&&owner.seals[0].providerCustomerId===account.providerCustomerId,409,'OWNER_NOT_READY','实际车主企业、证书及印章尚未核验');
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
