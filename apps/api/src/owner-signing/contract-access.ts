import {Db} from '../common/db';
import {ensure} from '../common/errors';
import {OwnerService} from './owner.service';
import {OwnerSigningTasks} from './tasks';
import {ContractPdfArtifactWriterService} from '../contract/contract-pdf-artifact-writer.service';
import {lessorIdentityHash} from './lessor';
import {requireOwnerContractCurrent} from './contract-state';
const safeAmount=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
export class OwnerContractAccess {
 private tasks:OwnerSigningTasks;
 constructor(private db:Db,private owners:OwnerService,private writer:ContractPdfArtifactWriterService){this.tasks=new OwnerSigningTasks(db,owners);}
 async list(customerId:string,ownerId:string){await this.owners.requireSigningMember(customerId,ownerId);return this.db.ownerSigningTask.findMany({where:{ownerId},orderBy:{createdAt:'desc'},take:100,select:{id:true,resourceId:true,documentHash:true,sourceSha256:true,status:true,ownerMode:true,reviewedAt:true,createdAt:true,archivedAt:true,parties:{select:{role:true,status:true}}}});}
 async detail(customerId:string,ownerId:string,id:string){
  await this.owners.requireSigningMember(customerId,ownerId);
  const t=await this.db.ownerSigningTask.findFirst({where:{id,ownerId},include:{parties:{select:{role:true,status:true}}}});ensure(t,404,'NOT_FOUND','本企业合同不存在');
  const c=await this.db.contract.findUnique({where:{id:t.resourceId},include:{order:{include:{vehicle:{select:{title:true}}}},delayQuote:{include:{change:true}}}}),s=c?.order.finalPlanSnapshot as any,snapshot=t.snapshot as any;
  ensure(c&&c.kind===t.kind&&c.customerId===t.customerId&&c.order.customerId===t.customerId&&c.providerTaskId===id&&c.documentHash===t.documentHash&&c.sourceFileId===t.sourceFileId&&s?.lessorSnapshot?.ownerId===ownerId&&s.ownerDataConsent?.ownerId===ownerId&&s.ownerDataConsent?.customerId===t.customerId&&s.ownerDataConsent?.lessorHash===lessorIdentityHash(s.lessorSnapshot)&&s.ownerDataConsent?.notice?.contentHash===s.lessorSnapshot.sharingNotice?.contentHash,409,'OWNER_SHARING_CONSENT','本单客户资料提供同意或文件绑定尚未核验');
  const {blockers}=await this.tasks.manualReadiness(customerId,ownerId,id);
  if(c.status!=='PENDING')blockers.push(c.status==='DRAFT'?'等待客户开始签署本份合同':'本份合同当前不能继续签署');
  try{requireOwnerContractCurrent(c);}catch{blockers.push('订单或补充协议已不处于当前待签署版本');}
  return{id:t.id,resourceId:t.resourceId,kind:t.kind,documentHash:t.documentHash,sourceSha256:t.sourceSha256,status:t.status,ownerMode:t.ownerMode,createdAt:t.createdAt,reviewedAt:t.reviewedAt,archivedAt:t.archivedAt,parties:t.parties,orderId:c.orderId,vehicleTitle:typeof snapshot?.vehicleTitle==='string'?snapshot.vehicleTitle:c.order.vehicle?.title??null,monthlyFeeAmount:safeAmount(snapshot?.monthlyFeeAmount),depositAmount:safeAmount(snapshot?.depositAmount),months:typeof snapshot?.months==='number'&&Number.isSafeInteger(snapshot.months)&&snapshot.months>0?snapshot.months:null,sourceAvailable:!!t.sourceFileId&&!!t.sourceSha256,signedAvailable:!!t.signedFileId&&!!t.signedPdfHash,canSign:blockers.length===0,canQuery:t.status!=='CANCELLED',blockers,canChooseManual:!t.ownerDispatchAt&&!['ARCHIVED','REJECTED','EXPIRED','CANCELLED'].includes(t.status),body:c.body,sourceFileId:t.sourceFileId,signedFileId:t.signedFileId,signedPdfHash:t.signedPdfHash};
 }
 async file(customerId:string,ownerId:string,id:string,kind:string){ensure(['source','signed'].includes(kind),404,'NOT_FOUND','文件不存在');const t=await this.detail(customerId,ownerId,id),fileId=kind==='source'?t.sourceFileId:t.signedFileId,sha=kind==='source'?t.sourceSha256:t.signedPdfHash;ensure(fileId&&sha,404,'NOT_FOUND','文件尚未就绪');return this.writer.readVerified(fileId,sha);}
}
