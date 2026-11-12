import {assertNotAssetFiles} from '../files/asset-files';
import {Body,Controller,Get,Inject,Param,Post,Req} from '@nestjs/common';
import {z} from 'zod';
import {Db} from '../common/db';
import {ensure} from '../common/errors';
import {audit,hash} from '../common/data';
import {requireCurrentStaff} from '../auth/staff-session';
import {lockOrder,readinessFromArchive} from './readiness';
import {archiveCommand} from './command';
import type {StaffActor} from '../auth/staff.types';
const id=z.string().trim().min(1).max(128),revision=z.number().int().nonnegative(),key=z.string().min(8).max(128),reason=z.string().trim().min(1).max(1000);
const submitInput=z.object({paperStatus:z.enum(['UNSIGNED','SIGNED','UNKNOWN']),reason,evidenceFileIds:z.array(id).max(20).refine(v=>new Set(v).size===v.length).default([]),revision,idempotencyKey:key}).strict();
const reviewInput=z.object({reviewId:id,revision,decision:z.enum(['APPROVED','REJECTED']),reason,idempotencyKey:key}).strict();
type ReviewFact={status:string;paperStatus:string};
export function assertUnsignedEvidence(status:string,hasHistoricalRental:boolean){ensure(status!=='UNSIGNED'||!hasHistoricalRental,409,'PAPER_STATUS_CONFLICT','历史租赁签字资料已经证明签署，不能声明未签');}
export function cancellationGate(review:ReviewFact|null,hasHistoricalRental:boolean,terminationReady:boolean){
 if(!hasHistoricalRental&&(!review||review.status!=='APPROVED'))return{ready:false,code:'CANCELLATION_REVIEW_REQUIRED'};
 if(review?.paperStatus==='UNKNOWN')return{ready:false,code:'PAPER_STATUS_UNKNOWN'};
 if(review?.paperStatus==='UNSIGNED'&&hasHistoricalRental)return{ready:false,code:'PAPER_STATUS_CONFLICT'};
 if((review?.paperStatus==='SIGNED'||hasHistoricalRental)&&!terminationReady)return{ready:false,code:'TERMINATION_REQUIRED'};
 return{ready:true,code:null};
}
async function businessHash(tx:any,order:any){
 if(order.effectiveTermsVersionId){const terms=await tx.orderTermsVersion.findUnique({where:{id:order.effectiveTermsVersionId}});ensure(terms?.orderId===order.id&&terms.hash,409,'TERMS_MISSING','当前商业条款缺失');return terms.hash;}
 ensure(order.finalPlanSnapshot?.commercialHash,409,'TERMS_MISSING','订单商业快照缺失');return order.finalPlanSnapshot.commercialHash;
}
async function historicalRental(tx:any,orderId:string){return !!await tx.archiveVersion.count({where:{archive:{orderId,kind:'RENTAL'},status:{in:['REVIEWED','ARCHIVED','INVALIDATED']}}});}
export async function terminationReady(tx:any,order:any){
 const currentHash=await businessHash(tx,order),archive=await tx.documentArchive.findFirst({where:{orderId:order.id,kind:'TERMINATION'},include:{versions:true}}),ready=readinessFromArchive(archive,currentHash),v=archive?.versions.find((v:any)=>v.id===ready.versionId);
 return ready.ready&&!!v&&['CUSTOMER','OWNER','PLATFORM'].every(role=>v.requiredSigners?.includes(role));
}
/** Read-only facts shared by the cancellation projection and the locked final command. */
export async function readOfflineCancellationFacts(tx:any,order:any){
 const currentHash=await businessHash(tx,order);
 const [review,historical,termination,openFeedback]=await Promise.all([
  tx.offlineCancellationReview.findFirst({where:{orderId:order.id,isCurrent:true}}),historicalRental(tx,order.id),
  tx.documentArchive.findFirst({where:{orderId:order.id,kind:'TERMINATION'},include:{versions:{orderBy:{version:'desc'},include:{files:{select:{uploadedBy:true}},feedback:{where:{status:'OPEN'}}}}}}),
  tx.archiveFeedback.findMany({where:{status:'OPEN',version:{archive:{orderId:order.id}}},select:{version:{select:{archive:{select:{id:true,orderId:true,kind:true,revision:true}}}}}})
 ]);
 await assertNotAssetFiles(tx,review?.evidenceFileIds||[]);
 const ready=readinessFromArchive(termination,currentHash),v=termination?.versions.find((v:any)=>v.id===ready.versionId);
 return{currentHash,review,historical,termination,terminationReady:ready.ready&&!!v&&['CUSTOMER','OWNER','PLATFORM'].every(role=>v.requiredSigners?.includes(role)),openFeedbackArchives:[...new Map(openFeedback.map((item:any)=>[item.version.archive.id,item.version.archive])).values()] as {id:string;orderId:string;kind:string;revision:number}[]};
}
export function offlineCancellationBlockers(f:Awaited<ReturnType<typeof readOfflineCancellationFacts>>){
 const blockers:{code:string;message:string;resource?:string;resourceId?:string}[]=[],review=f.review;
 if(!f.historical&&(!review||review.status!=='APPROVED'))blockers.push({code:'CANCELLATION_REVIEW_REQUIRED',message:'请确认实际签署情况；已签署订单需归档三方终止协议'});
 if(review?.paperStatus==='UNKNOWN')blockers.push({code:'PAPER_STATUS_UNKNOWN',message:'请明确实际签署情况；已签署订单需归档三方终止协议'});
 if(review?.paperStatus==='UNSIGNED'&&f.historical)blockers.push({code:'PAPER_STATUS_CONFLICT',message:'请明确实际签署情况；已签署订单需归档三方终止协议'});
 if((review?.paperStatus==='SIGNED'||f.historical)&&!f.terminationReady)blockers.push({code:'TERMINATION_REQUIRED',message:'请明确实际签署情况；已签署订单需归档三方终止协议'});
 if(review&&review.businessSnapshotHash!==f.currentHash)blockers.push({code:'CANCELLATION_REVIEW_STALE',message:'签署确认对应的商业条款已变化，请重新确认'});
 for(const archive of f.openFeedbackArchives)blockers.push({code:'ARCHIVE_FEEDBACK_OPEN',message:'本单还有未解决的资料反馈',resource:'offline-archives',resourceId:archive.id});
 return blockers;
}
export function assertOfflineCancellationFacts(f:Awaited<ReturnType<typeof readOfflineCancellationFacts>>){const blocker=offlineCancellationBlockers(f)[0];ensure(!blocker,409,blocker?.code||'CANCELLATION_REVIEW_REQUIRED',blocker?.message||'请先确认纸质签署情况');}
export async function requireOfflineCancellation(tx:any,order:any){
 if(order.contractMode!=='OFFLINE')return;
 assertOfflineCancellationFacts(await readOfflineCancellationFacts(tx,order));
}
async function operator(tx:any,actor:StaffActor){await requireCurrentStaff(tx,actor,'orders');ensure(['ADMIN','OPERATIONS'].includes(actor.role),403,'FORBIDDEN','签署确认仅管理员或运营可操作');}
export async function submitOfflineCancellation(tx:any,actor:StaffActor,orderId:string,raw:unknown){
 const input=submitInput.parse(raw);await lockOrder(tx,orderId);await operator(tx,actor);
 const order=await tx.order.findUnique({where:{id:orderId}});ensure(order?.contractMode==='OFFLINE'&&['AWAITING_CONTRACT_REVIEW','AWAITING_SIGNATURE','AWAITING_PAYMENT','AWAITING_HANDOVER'].includes(order.status),409,'ORDER_STATE','仅交车前线下订单可确认取消签署情况');
 const result=await archiveCommand(tx,actor,orderId,'CANCEL_SUBMIT',input,async()=>{
  const old=await tx.offlineCancellationReview.findFirst({where:{orderId,isCurrent:true}});ensure((old?.revision||0)===input.revision,409,'REVISION_CONFLICT','取消审核已更新');
  assertUnsignedEvidence(input.paperStatus,await historicalRental(tx,orderId));
  ensure(await tx.storedFile.count({where:{id:{in:input.evidenceFileIds},customerId:null,purpose:'evidence'}})===input.evidenceFileIds.length,403,'FILE_OWNERSHIP','请上传后台取消核实证据');
  await assertNotAssetFiles(tx,input.evidenceFileIds);
  if(old)await tx.offlineCancellationReview.update({where:{id:old.id},data:{isCurrent:false}});
  const result=await tx.offlineCancellationReview.create({data:{orderId,revision:input.revision+1,paperStatus:input.paperStatus,status:'APPROVED',reviewedBy:actor.id,reviewedAt:new Date(),reviewReason:input.reason,reason:input.reason,evidenceFileIds:input.evidenceFileIds,businessSnapshotHash:await businessHash(tx,order),submittedBy:actor.id,idempotencyKey:input.idempotencyKey,requestHash:hash(input)}});
  await audit(tx,actor.id,'SUBMIT_CANCELLATION_REVIEW','orders',orderId,{reviewId:result.id,paperStatus:input.paperStatus});return result;
 });
 await assertNotAssetFiles(tx,result.evidenceFileIds||[]);return result;
}
export async function reviewOfflineCancellation(tx:any,actor:StaffActor,orderId:string,raw:unknown){
 const input=reviewInput.parse(raw);await lockOrder(tx,orderId);await operator(tx,actor);
 const result=await archiveCommand(tx,actor,orderId,'CANCEL_REVIEW',input,async()=>{
  const review=await tx.offlineCancellationReview.findFirst({where:{id:input.reviewId,orderId,isCurrent:true}});ensure(review?.status==='SUBMITTED'&&review.revision===input.revision,409,'REVISION_CONFLICT','取消审核已处理或更新');
  await assertNotAssetFiles(tx,review.evidenceFileIds||[]);
  const order=await tx.order.findUniqueOrThrow({where:{id:orderId}});ensure(['AWAITING_CONTRACT_REVIEW','AWAITING_SIGNATURE','AWAITING_PAYMENT','AWAITING_HANDOVER'].includes(order.status),409,'ORDER_STATE','订单已推进，不能继续取消审核');
  ensure(await businessHash(tx,order)===review.businessSnapshotHash,409,'CANCELLATION_REVIEW_STALE','商业条款已变化，请重新提交审核');
  if(input.decision==='APPROVED')assertUnsignedEvidence(review.paperStatus,await historicalRental(tx,orderId));
  const result=await tx.offlineCancellationReview.update({where:{id:review.id},data:{status:input.decision,reviewedBy:actor.id,reviewedAt:new Date(),reviewReason:input.reason}});
  await audit(tx,actor.id,'REVIEW_CANCELLATION','orders',orderId,{reviewId:review.id,decision:input.decision});return result;
 });
 await assertNotAssetFiles(tx,result.evidenceFileIds||[]);return result;
}
@Controller('admin/orders/:id/offline-cancellation')
export class OfflineCancellationController{
 constructor(@Inject(Db)private db:Db){}
 @Get() list(@Param('id')id:string,@Req()r:any){return this.db.serial(async tx=>{await operator(tx,r.admin);const items=await tx.offlineCancellationReview.findMany({where:{orderId:id},orderBy:{revision:'desc'}});await assertNotAssetFiles(tx,items.flatMap((item:any)=>item.evidenceFileIds||[]));return items;});}
 @Post('submit') submit(@Param('id')id:string,@Body()b:unknown,@Req()r:any){return this.db.serial(tx=>submitOfflineCancellation(tx,r.admin,id,b));}
 @Post('review') review(@Param('id')id:string,@Body()b:unknown,@Req()r:any){return this.db.serial(tx=>reviewOfflineCancellation(tx,r.admin,id,b));}
}
