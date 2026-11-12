import {ensure} from '../common/errors';
import type {Prisma} from '@prisma/client';
import {readPeriodServiceStage} from '../order-service-stages/readiness';
import {day,shanghaiDay} from '../usage/rules';

const validDate=(value:any):value is Date=>value instanceof Date&&Number.isFinite(value.getTime());
const reading=(value:any)=>Number.isInteger(value)&&value>=0&&value<=2147483647;
const id=(value:any)=>typeof value==='string'&&value.length>0&&value.trim()===value&&!value.includes('\0');
const requireSource=(condition:unknown)=>ensure(condition,409,'LEGACY_STAGE_READING_SOURCE','续期起点须核对紧邻已结算旧月的同车读数与本人月界照片');
const evidenceSelect={id:true,customerId:true,purpose:true,mimeType:true,size:true,sha256:true,assetPrivateFile:{select:{fileId:true}}} satisfies Prisma.StoredFileSelect;

/** Read-only bridge. The caller holds the account lock and supplies its actual preceding service month. */
export async function legacyStageStartReading(tx:any,p:any,first:any,previous:any):Promise<number|null>{
 if(!p.serviceStageId||p.stageSequence!==1||first.startReadingKm!==null)return null;
 const account=p.account,order=account?.order;
 requireSource(order&&account.id===p.accountId&&account.orderId===p.orderId&&account.customerId===order.customerId&&order.id===p.orderId);
 const source=await readPeriodServiceStage(tx,order,account,p);
 if(source.snapshot.kind!=='RENEWAL')return null;
 requireSource(previous&&previous.id!==p.id&&previous.orderId===p.orderId&&previous.accountId===p.accountId&&Number.isInteger(previous.sequence)&&previous.sequence<p.sequence);
 // A genuinely segmented or linked predecessor continues through the existing segment path.
 if(previous.serviceStageId!=null)return null;
 requireSource(previous.stageSequence==null);
 if((await tx.usageSegment.findMany({where:{periodId:previous.id}})).length)return null;

 requireSource(previous.status==='SETTLED'&&validDate(previous.settledAt)&&id(previous.settlementKey)&&validDate(previous.startDate)&&validDate(previous.endDate)&&validDate(previous.effectiveEndDate)&&validDate(p.startDate));
 requireSource(previous.startDate<previous.endDate&&previous.endDate.getTime()===p.startDate.getTime()&&previous.effectiveEndDate.getTime()===previous.endDate.getTime());
 const oldStart=new Date(day(previous.startDate)+'T00:00:00+08:00'),boundary=new Date(day(p.startDate)+'T00:00:00+08:00');
 requireSource(first.periodId===p.id&&validDate(first.startAt)&&first.startAt.getTime()===boundary.getTime()&&p.sequence===source.snapshot.period.firstPeriodSequence&&day(p.startDate)===source.snapshot.period.startDate);
 requireSource(reading(previous.startReadingKm)&&reading(previous.endReadingKm)&&previous.endReadingKm>=previous.startReadingKm);

 const assignment=await tx.vehicleAssignment.findUnique({where:{id:first.assignmentId}});
 requireSource(assignment&&assignment.id===source.snapshot.identity.assignmentId&&assignment.vehicleId===source.snapshot.identity.vehicleId&&assignment.id===first.assignmentId&&assignment.vehicleId===first.vehicleId&&assignment.orderId===p.orderId&&assignment.customerId===account.customerId);
 requireSource(validDate(assignment.startAt)&&assignment.startAt<=oldStart&&reading(assignment.startReadingKm)&&assignment.startReadingKm<=previous.startReadingKm);
 requireSource(assignment.status==='ACTIVE'&&assignment.endAt===null||assignment.status==='CLOSED'&&validDate(assignment.endAt)&&assignment.endAt>boundary&&reading(assignment.endReadingKm)&&assignment.endReadingKm>=previous.endReadingKm);
 const overlaps=await tx.vehicleAssignment.findMany({where:{orderId:p.orderId,startAt:{lt:boundary},OR:[{endAt:null},{endAt:{gt:oldStart}}]}});
 requireSource(overlaps.length===1&&overlaps[0].id===assignment.id&&overlaps[0].vehicleId===assignment.vehicleId&&overlaps[0].customerId===account.customerId&&overlaps[0].orderId===p.orderId);

 requireSource(id(previous.readingId));
 const mileage=await tx.mileage.findUnique({where:{id:previous.readingId}});
 requireSource(mileage&&mileage.id===previous.readingId&&mileage.status==='APPROVED'&&mileage.periodId===previous.id&&mileage.orderId===p.orderId&&mileage.customerId===account.customerId&&mileage.segmentId==null&&(mileage.assignmentId==null||mileage.assignmentId===assignment.id)&&mileage.readingKm===previous.endReadingKm);
 requireSource(validDate(mileage.recordedAt)&&shanghaiDay(mileage.recordedAt)===day(previous.endDate)&&id(mileage.reviewedBy));
 const reviewer=await tx.adminUser.findUnique({where:{id:mileage.reviewedBy},select:{id:true}});
 // Historical approval is not revoked merely because its reviewer later changed role or left.
 requireSource(reviewer?.id===mileage.reviewedBy&&Array.isArray(mileage.fileIds)&&mileage.fileIds.length>0&&mileage.fileIds.every(id));
 const fileIds=[...new Set<string>(mileage.fileIds)],files=await tx.storedFile.findMany({where:{id:{in:fileIds}},select:evidenceSelect});
 requireSource(files.length===fileIds.length&&files.every((file:any)=>fileIds.includes(file.id)&&file.customerId===account.customerId&&file.purpose==='mileage'&&['image/jpeg','image/png','image/webp'].includes(file.mimeType)&&Number.isInteger(file.size)&&file.size>0&&/^[a-f0-9]{64}$/.test(file.sha256)&&file.assetPrivateFile==null));
 return previous.endReadingKm;
}
