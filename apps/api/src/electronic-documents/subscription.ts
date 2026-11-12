import {readCase04} from '../orders/cancellation04';
import {HttpException} from '@nestjs/common';
import {ensure} from '../common/errors';
import {audit,notify} from '../common/data';
import {canonicalHash} from '../customers/types';
import {loadElectronicArchiveProof} from './archive';
import {requireElectronicSwapChain} from '../vehicle-changes/electronic-source';

/** Current main-contract proof. A status label or an old dual-sign task is insufficient. */
export type ElectronicSubscriptionReadiness={ready:boolean;archiveId:string|null;versionId:string|null;blockers:string[];taskId?:string;contractId?:string;finalFileId?:string;legalSigningStatus?:string;filingStatus?:string};
export async function readElectronicSubscriptionOrigin(tx:any,orderId:string):Promise<ElectronicSubscriptionReadiness>{
 const missing={ready:false,archiveId:null as string|null,versionId:null as string|null,blockers:['ELECTRONIC_ARCHIVE_REQUIRED']};
 const order=await tx.order.findUnique({where:{id:orderId}});
 if(!order||order.contractMode!=='ELECTRONIC')return{...missing,blockers:['ELECTRONIC_BUSINESS_CHANGED']};
 // Effective amendment chains have their own proof check; never silently use the old quote.
 const archive=await tx.documentArchive.findUnique({where:{subjectType_subjectId_kind:{subjectType:'ORDER',subjectId:orderId,kind:'RENTAL'}}});
 if(!archive?.currentApprovedVersionId){const latest=archive?await tx.archiveVersion.findFirst({where:{archiveId:archive.id},orderBy:{version:'desc'},include:{electronicTask:{include:{parties:true}}}}):null;const t=latest?.electronicTask;return{...missing,archiveId:archive?.id??null,legalSigningStatus:t?.parties?.length===3&&t.parties.every((p:any)=>p.status==='SIGNED'&&p.providerSignedAt&&p.verifiedAt)?'SIGNED':'PENDING',filingStatus:t?.filingStatus??'NOT_STARTED'};}
 const version=await tx.archiveVersion.findUnique({where:{id:archive.currentApprovedVersionId},include:{electronicTask:{include:{parties:true}}}}),latest=await tx.archiveVersion.findFirst({where:{archiveId:archive.id},orderBy:{version:'desc'},select:{id:true}});
 const base={...missing,archiveId:archive.id};
 if(!version||version.archiveId!==archive.id||latest?.id!==version.id||version.executionMode!=='ELECTRONIC'||version.status!=='ARCHIVED'||version.invalidatedAt)return base;
 const task=version.electronicTask,plan=order.finalPlanSnapshot,lessor=plan?.lessorSnapshot;
 const contract=task?.contractId?await tx.contract.findUnique({where:{id:task.contractId}}):null;
 const expected=plan?.partiesSnapshot;
 if(!task||task.kind!=='SUBSCRIPTION'||task.orderId!==order.id||task.customerId!==order.customerId||task.retiredAt||task.withdrawnAt||task.businessHash!==plan?.commercialHash||version.businessSnapshotHash!==plan?.commercialHash||archive.orderId!==order.id||archive.ownerId!==lessor?.ownerId||task.ownerId!==lessor?.ownerId||!contract||contract.executionMode!=='ELECTRONIC'||contract.kind!=='SUBSCRIPTION'||contract.orderId!==order.id||contract.customerId!==order.customerId||contract.documentHash!==plan?.commercialHash||contract.sourceFileId!==task.sourceFileId||version.scopeSnapshot?.vehicleId!==lessor?.vehicleId||version.scopeSnapshot?.lessorHash!==canonicalHash(lessor)||!Array.isArray(expected)||expected.length!==3||!['CUSTOMER','OWNER','PLATFORM'].every(role=>expected.filter((p:any)=>p.role===role).length===1&&task.parties.some((p:any)=>p.role===role&&p.subjectId===expected.find((e:any)=>e.role===role)?.partyId&&p.subjectType===expected.find((e:any)=>e.role===role)?.subjectType)))return{...base,blockers:['ELECTRONIC_BUSINESS_CHANGED']};
 try{
  const proof=await loadElectronicArchiveProof(tx,version.id);
  if(!proof||proof.taskId!==task.id||proof.kind!=='SUBSCRIPTION')return base;
  return{ready:true,legalSigningStatus:'SIGNED',filingStatus:'CONFIRMED',archiveId:archive.id,versionId:version.id,blockers:[] as string[],taskId:task.id,contractId:contract.id,finalFileId:proof.finalFile.id};
 }catch(error){
  if(error instanceof HttpException&&[400,403,404,409].includes(error.getStatus()))return{...base,blockers:[(error.getResponse() as any)?.error?.code||'ELECTRONIC_ARCHIVE_REQUIRED']};
  throw error;
 }
}

export async function readElectronicSubscriptionReady(tx:any,orderId:string):Promise<ElectronicSubscriptionReadiness>{
 const origin=await readElectronicSubscriptionOrigin(tx,orderId);if(!origin.ready)return origin;
 try{await requireElectronicSwapChain(tx,await tx.order.findUniqueOrThrow({where:{id:orderId}}));return origin;}
 catch(error){if(error instanceof HttpException&&[400,403,404,409].includes(error.getStatus()))return{...origin,ready:false,blockers:[(error.getResponse() as any)?.error?.code||'ELECTRONIC_EFFECTIVE_CHAIN_REQUIRED']};throw error;}
}

/** Run in the archive transaction. Signing completion advances to payment only. */
export async function activateElectronicSubscription(tx:any,task:any){
 ensure(task?.kind==='SUBSCRIPTION'&&task.orderId&&task.contractId,409,'ELECTRONIC_BUSINESS_CHANGED','签署任务不是订阅主合同');
 await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${task.orderId} FOR UPDATE`;
 const order=await tx.order.findUnique({where:{id:task.orderId}});
 let cancelledBy04=false;
 if(order?.status==='CANCELLED'){const c=await tx.orderPreDeliveryCancellation.findFirst({where:{orderId:order.id,originalTaskId:task.id},orderBy:{version:'desc'}});if(c)cancelledBy04=(await readCase04(tx,c.id)).facts.some((f:any)=>f.kind==='EFFECTIVE');}
 ensure(order?.contractMode==='ELECTRONIC'&&(cancelledBy04||!['CANCELLED','RETIRED'].includes(order.status)),409,'ELECTRONIC_BUSINESS_CHANGED','订单已停止办理，不可因签署结果恢复');
 const ready=await readElectronicSubscriptionReady(tx,order.id);
 ensure(ready.ready&&ready.taskId===task.id&&ready.contractId===task.contractId,409,ready.blockers[0]||'ELECTRONIC_ARCHIVE_REQUIRED','三方签署和完整签后归档尚未核验');
 const contract=await tx.contract.findUniqueOrThrow({where:{id:task.contractId}});
 if(contract.status!=='SIGNED'||contract.signedFileId!==ready.finalFileId)await tx.contract.update({where:{id:contract.id},data:{status:'SIGNED',signedFileId:ready.finalFileId,signingLeaseUntil:null}});
 const advanced=await tx.order.updateMany({where:{id:order.id,status:{in:['AWAITING_CONTRACT_REVIEW','AWAITING_SIGNATURE']}},data:{status:'AWAITING_PAYMENT',revision:{increment:1}}});
 if(advanced.count){
  await audit(tx,'electronic-verified','ELECTRONIC_SUBSCRIPTION_ARCHIVED','orders',order.id,{taskId:task.id,archiveVersionId:ready.versionId,finalFileId:ready.finalFileId},'SYSTEM');
  await notify(tx,order.customerId,'订阅合同已签署归档','三方签署及签后文件已核验，请按账单支付约定押金和首期费用。','orders',order.id);
 }
 return ready;
}
