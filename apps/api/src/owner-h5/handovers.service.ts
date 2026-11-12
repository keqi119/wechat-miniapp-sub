import {assertNewEsignAllowed,newOrderContractMode} from '../offline-documents/mode';
import {z} from 'zod';
import {Db} from '../common/db';
import {ensure} from '../common/errors';
import {ContractPdfArtifactWriterService} from '../contract/contract-pdf-artifact-writer.service';
import {FadadaESignGateway} from '../esign/fadada/fadada-esign.provider';
import {FadadaSettings} from '../esign/esign.settings';
import {manualHandoverEnabled,platformHandoverRecord,platformLegalIdentity} from '../esign/platform-handover';
import {runOwnerH5} from '../owner-signing/fadada-owner.client';
import {SignatureService} from '../orders/signature.service';
export class OwnerH5HandoversService {
 constructor(private db:Db,private gateway:FadadaESignGateway,private writer:ContractPdfArtifactWriterService,private signatures:SignatureService,private config:FadadaSettings){}
 async list(customerId:string,ownerId:string){return runOwnerH5(async()=>{
  const identity=await platformLegalIdentity(this.db,this.config,customerId,ownerId),enabled=identity.isPlatform&&manualHandoverEnabled(this.config);
  const rows=identity.isPlatform?await this.db.fadadaTask.findMany({where:{kind:'HANDOVER',platformSigningMode:'MANUAL',platformProviderId:this.config.platformCustomerId},select:{id:true},orderBy:{createdAt:'desc'},take:100}):[];
  const items=[];
  for(const row of rows){const {body,...item}=await this.detail(customerId,ownerId,row.id);items.push(item);}
  return{items,enabled:identity.isPlatform,signingMode:'MANUAL' as const,manualSigningEnabled:enabled,automaticSigningEnabled:false as const};
 });}
 async detail(customerId:string,ownerId:string,id:string){return runOwnerH5(async()=>{
  const {task,resource}=await platformHandoverRecord(this.db,this.config,customerId,ownerId,id),blockers:string[]=[];
  try{await this.gateway.platformManualReadiness(customerId,ownerId,id);}catch(error:any){const detail=error.getResponse?.()?.error;if(!detail)throw error;blockers.push(detail.message);}
  const approval=await this.db.eSignApproval.findUnique({where:{id:task.approvalId}});
  return{id:task.id,resourceId:task.resourceId,kind:'HANDOVER' as const,documentDomain:'PLATFORM_HANDOVER' as const,handoverType:resource.type,documentHash:task.documentHash,sourceSha256:task.sourcePdfHash,status:task.status==='SIGNED'?'ARCHIVED':task.status,ownerMode:'MANUAL',createdAt:task.createdAt,reviewedAt:approval?.approvedAt??null,archivedAt:task.status==='SIGNED'?task.platformSignedAt:null,parties:[{role:'CUSTOMER',status:task.customerSignedAt?'SIGNED':task.status==='REJECTED'?'REJECTED':'PENDING'},{role:'PLATFORM',status:task.platformSignedAt?'SIGNED':task.status==='REJECTED'&&task.customerSignedAt?'REJECTED':'PENDING'}],orderId:resource.orderId,vehicleTitle:resource.order.vehicle.title,monthlyFeeAmount:null,depositAmount:null,months:null,sourceAvailable:!!task.sourceFileId&&!!task.sourcePdfHash,signedAvailable:!!task.signedFileId&&!!task.signedPdfHash,canSign:newOrderContractMode()!=='OFFLINE'&&blockers.length===0,canQuery:!!task.uploadedAt,blockers,body:''};
 });}
 async file(customerId:string,ownerId:string,id:string,variant:string){return runOwnerH5(async()=>{
  ensure(['source','signed'].includes(variant),404,'NOT_FOUND','文件不存在');const {task}=await platformHandoverRecord(this.db,this.config,customerId,ownerId,id),fileId=variant==='source'?task.sourceFileId:task.signedFileId,sha=variant==='source'?task.sourcePdfHash:task.signedPdfHash;
  ensure(fileId&&sha,404,'NOT_FOUND','文件尚未就绪');return this.writer.readVerified(fileId,sha);
 });}
 async sign(customerId:string,ownerId:string,id:string,raw:unknown){assertNewEsignAllowed({executionMode:newOrderContractMode()});return this.gateway.platformManualSign(customerId,ownerId,id,raw);}
 async sync(customerId:string,ownerId:string,id:string,raw:unknown){return runOwnerH5(async()=>{
  z.object({}).strict().parse(raw);const {task,resource}=await platformHandoverRecord(this.db,this.config,customerId,ownerId,id);
  const event=await this.gateway.query(id);
  if(!(['REJECTED','EXPIRED'].includes(event.status)&&resource.signatureStatus===event.status))await this.signatures.settleHandover(task.resourceId,{...event,taskId:task.id});
  return this.detail(customerId,ownerId,id);
 });}
}

