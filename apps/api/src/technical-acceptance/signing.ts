import {Inject,Injectable} from '@nestjs/common';
import {Db} from '../common/db';
import {ESignGateway} from '../common/gateways';
import {audit,hash} from '../common/data';
import {ensure} from '../common/errors';
import {TechnicalAcceptanceService} from './service';
import {TECHNICAL_KIND,technicalEnabled,retentionDue,lockTechnical} from './rules';
import {claimSigning,finishSigning,failSigning,recoverSigning} from '../orders/signature-preparation';
import {MINIAPP_RETURN,runNativeSigning} from '../esign/native-signing';
@Injectable()
export class TechnicalAcceptanceSigning{
 constructor(@Inject(Db)private db:Db,@Inject(ESignGateway)private gateway:ESignGateway,@Inject(TechnicalAcceptanceService)private service:TechnicalAcceptanceService){}
 async sign(id:string,customerId:string,input:any){await this.service.owned(id,customerId);ensure(technicalEnabled(),503,'TECHNICAL_SIGNING_DISABLED','本次技术验收签署尚未开放');
 const prepared=await this.db.serial(async tx=>{const r=await lockTechnical(tx,id);ensure(r?.customerId===customerId,404,'NOT_FOUND','验收文件不存在');ensure(!r.stoppedAt&&!r.purgedAt&&!r.purgeStartedAt&&r.confirmedAt&&['DRAFT','PENDING'].includes(r.status),409,'ACCEPTANCE_STATE','本次验收不可发起签署');await this.service.action(tx,r,customerId,'SIGN',input);return claimSigning(tx,TECHNICAL_KIND,r);});
 try{const r=prepared.item,customer=await this.db.customer.findUniqueOrThrow({where:{id:customerId}});const result=await runNativeSigning(()=>this.gateway.create({contractId:id,customerId,kind:TECHNICAL_KIND,documentHash:r.documentHash,customerName:'',mobile:customer.mobile,returnUrl:MINIAPP_RETURN}));await finishSigning(this.db,TECHNICAL_KIND,r,prepared.leaseUntil,result.taskId);return result;}catch(error){await failSigning(this.db,TECHNICAL_KIND,prepared.item,prepared.leaseUntil);throw error;}
 }
 async sync(id:string,customerId:string,input:any){await this.service.owned(id,customerId);await this.db.serial(async tx=>{const r=await lockTechnical(tx,id);ensure(!r.purgedAt&&!r.purgeStartedAt,409,'ACCEPTANCE_STATE','资料已进入清理');await this.service.action(tx,r,customerId,'SYNC',input);});const recovered=await recoverSigning(this.db,TECHNICAL_KIND,id,customerId);if(recovered.item.providerTaskId&&!recovered.pendingPreparation){const event=await this.gateway.query(recovered.item.providerTaskId);await this.settle(id,{...event,taskId:recovered.item.providerTaskId});}return this.service.view(id,false,customerId);}
 async settle(id:string,event:{taskId:string;documentHash:string;status:'PENDING'|'SIGNED'|'REJECTED'|'EXPIRED';signedFileId?:string}){
 return this.db.serial(async tx=>{const r=await lockTechnical(tx,id);ensure(r&&!r.purgedAt&&!r.purgeStartedAt,404,'NOT_FOUND','验收记录不存在');ensure(r.documentHash===event.documentHash&&r.providerTaskId===event.taskId,409,'SIGNATURE_MISMATCH','签署任务或文档版本不一致');if(r.status==='SIGNED')return r;ensure(r.status==='PENDING',409,'SIGNATURE_STATE','验收签署状态不匹配');if(event.status==='PENDING')return r;
 if(event.status==='SIGNED'){ensure(event.signedFileId,409,'SIGNATURE_ARCHIVE_REQUIRED','双方签署文件尚未归档');const task=await tx.fadadaTask.findUnique({where:{id:event.taskId}});ensure(task?.kind===TECHNICAL_KIND&&task.resourceId===id&&task.customerId===r.customerId&&task.status==='SIGNED'&&task.customerSignedAt&&task.platformSignedAt&&task.sealRequestedAt&&task.signedFileId===event.signedFileId&&task.signedPdfHash,409,'SIGNATURE_ARCHIVE_REQUIRED','双方可信签署及归档证据未完整');const file=await tx.storedFile.findFirst({where:{id:event.signedFileId,customerId:r.customerId,purpose:'technical-acceptance',sha256:task.signedPdfHash}});ensure(file,409,'SIGNATURE_ARCHIVE_REQUIRED','归档文件归属不符');await this.service.writer.readVerified(file.id,file.sha256);}
 const finishedAt=new Date();
 const item=await tx.technicalAcceptance.update({where:{id},data:{status:event.status,signedFileId:event.signedFileId||null,completedAt:event.status==='SIGNED'?finishedAt:null,retentionDueAt:new Date(Math.max(r.retentionDueAt?.getTime()||0,retentionDue(finishedAt).getTime())),revision:{increment:1}}});await audit(tx,'fadada','TECHNICAL_ACCEPTANCE_RESULT','technical-acceptances',id,{status:event.status,documentHash:event.documentHash,signedFileId:event.signedFileId},'PROVIDER');return item;});
 }
}
