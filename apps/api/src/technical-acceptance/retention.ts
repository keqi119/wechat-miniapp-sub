import {Prisma} from '@prisma/client';
import {Inject,Injectable} from '@nestjs/common';
import {promises as fs} from 'node:fs';
import {resolve,sep} from 'node:path';
import {Db} from '../common/db';
import {audit} from '../common/data';
import {ensure} from '../common/errors';
import {projectRoot} from '../common/config';
import {TechnicalAcceptanceService} from './service';
import {TECHNICAL_KIND,lockTechnical} from './rules';
@Injectable()
export class TechnicalAcceptanceRetention{
 constructor(@Inject(Db)private db:Db,@Inject(TechnicalAcceptanceService)private service:TechnicalAcceptanceService){}
 async review(id:string,actorId:string,input:any){await this.db.serial(async tx=>{const r=await lockTechnical(tx,id);ensure(r&&!r.purgedAt&&!r.purgeStartedAt&&r.retentionDueAt&&r.retentionDueAt<=new Date(),409,'RETENTION_NOT_DUE','独立资料未到复核时间或已清理');if(!await this.service.action(tx,r,actorId,'RETENTION_REVIEW',input))return;await tx.technicalAcceptance.update({where:{id},data:{legalHold:input.legalHold,retentionReviewedAt:new Date(),retentionStatus:input.legalHold?'HELD':'REVIEW_DUE',revision:{increment:1}}});await audit(tx,actorId,'TECHNICAL_RETENTION_REVIEW','technical-acceptances',id,{legalHold:input.legalHold,reason:input.reason});});return this.service.view(id,true);}
 async purge(id:string,actorId:string,input:any){const r=await this.db.serial(async tx=>{const r=await lockTechnical(tx,id);ensure(r,404,'NOT_FOUND','验收文件不存在');const fresh=await this.service.action(tx,r,actorId,'PURGE',input);if(r.purgedAt)return r;ensure(r.retentionDueAt&&r.retentionDueAt<=new Date()&&r.retentionReviewedAt&&!r.legalHold,409,'RETENTION_PROTECTED','尚未到期或人工复核要求保留');const task=await tx.fadadaTask.findFirst({where:{kind:TECHNICAL_KIND,resourceId:id}});ensure((!task||['SIGNED','REJECTED','EXPIRED'].includes(task.status))&&(!r.signingLeaseUntil||r.signingLeaseUntil<=new Date())&&(!task?.processingUntil||task.processingUntil<=new Date()),409,'RETENTION_IN_FLIGHT','渠道任务或处理结果未结束，不能删除');return tx.technicalAcceptance.update({where:{id},data:{purgeStartedAt:r.purgeStartedAt||new Date()}});});
 if(r.purgedAt)return this.service.view(id,true);
 const approvals=await this.db.eSignApproval.findMany({where:{kind:TECHNICAL_KIND,resourceId:id}}),tasks=await this.db.fadadaTask.findMany({where:{kind:TECHNICAL_KIND,resourceId:id}});
 const crashFiles=await this.db.storedFile.findMany({where:{customerId:r.customerId,purpose:'technical-acceptance',name:{in:[id+'-source.pdf',id+'-signed.pdf']}}});
 const ids=[...new Set([...crashFiles.map(f=>f.id),r.sourceFileId,r.signedFileId,...approvals.map(a=>a.sourceFileId),...tasks.flatMap(t=>[t.sourceFileId,t.signedFileId])].filter(Boolean))] as string[];
 const candidates=await this.db.storedFile.findMany({where:{id:{in:ids}}}),root=resolve(process.env.UPLOAD_DIR||resolve(projectRoot,'var/uploads')),files=[];
 for(const file of candidates){const shared=await Promise.all([
 this.db.technicalAcceptance.count({where:{id:{not:id},OR:[{sourceFileId:file.id},{signedFileId:file.id}]}}),
 this.db.fadadaTask.count({where:{NOT:{kind:TECHNICAL_KIND,resourceId:id},OR:[{sourceFileId:file.id},{signedFileId:file.id}]}}),
 this.db.eSignApproval.count({where:{NOT:{kind:TECHNICAL_KIND,resourceId:id},sourceFileId:file.id}}),
 this.db.contract.count({where:{OR:[{sourceFileId:file.id},{signedFileId:file.id}]}}),
 this.db.handover.count({where:{OR:[{signedFileId:file.id},{fileIds:{has:file.id}},{responseFileIds:{has:file.id}}]}}),
 this.db.bill.count({where:{evidenceFileIds:{has:file.id}}}),this.db.enterpriseSeal.count({where:{evidenceFileId:file.id}}),
 this.db.customer.count({where:{legalIdentityFileId:file.id}}),this.db.order.count({where:{terminationFileId:file.id}}),
 this.db.vehicle.count({where:{OR:[{coverFileId:file.id},{mediaFileIds:{has:file.id}}]}}),
 this.db.mileage.count({where:{fileIds:{has:file.id}}}),this.db.serviceRequest.count({where:{fileIds:{has:file.id}}})
 ]);if(!shared.some(Boolean))files.push(file);}
 const deletableIds=files.map(f=>f.id);
 for(const file of files){ensure(file.purpose==='technical-acceptance'&&file.customerId===r.customerId&&resolve(file.storagePath).startsWith(root+sep),409,'RETENTION_FILE_SCOPE','清理文件不属于本验收范围');const shared=await this.db.storedFile.count({where:{storagePath:file.storagePath,id:{notIn:deletableIds}}});if(!shared){try{await fs.unlink(file.storagePath);}catch(e:any){if(e.code!=='ENOENT')throw e;}}}
 await this.db.serial(async tx=>{const current=await lockTechnical(tx,id);ensure(current.purgeStartedAt&&!current.legalHold,409,'RETENTION_PROTECTED','清理状态已变化');await tx.fadadaTask.deleteMany({where:{kind:TECHNICAL_KIND,resourceId:id}});await tx.eSignApproval.deleteMany({where:{kind:TECHNICAL_KIND,resourceId:id}});await tx.storedFile.deleteMany({where:{id:{in:deletableIds},purpose:'technical-acceptance'}});await tx.technicalAcceptanceAction.deleteMany({where:{recordId:id,action:{not:'PURGE'}}});await tx.technicalAcceptance.update({where:{id},data:{customerId:null,body:'',consentSnapshot:Prisma.DbNull,sourceFileId:null,signedFileId:null,slotCoordinates:Prisma.DbNull,providerTaskId:null,purgedAt:new Date(),retentionStatus:'PURGED',revision:{increment:1}}});await audit(tx,actorId,'TECHNICAL_ACCEPTANCE_PURGED','technical-acceptances',id,{reason:input.reason,fileCount:files.length,sharedFilesRetained:candidates.length-files.length,sharedIdentityDeleted:false});});return this.service.view(id,true);
 }
}
