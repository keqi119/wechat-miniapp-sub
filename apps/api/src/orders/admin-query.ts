import {currentSwapReceipt,swapReceiptMeteringSource} from '../vehicle-changes/swap-receipt';
import {HttpException} from '@nestjs/common';
import {canonicalHash} from '../customers/types';
import {hash} from '../common/data';
import {readServiceStage} from '../order-service-stages/readiness';
import {readSwapStageScope} from '../vehicle-changes/stage-source';
import {readEffectiveContractChain} from '../order-changes/agreement-readiness';
import {OrderStatus,Prisma} from '@prisma/client';
import {z} from 'zod';
import {requireCurrentStaff} from '../auth/staff-session';
import type {StaffActor} from '../auth/staff.types';
import {ensure} from '../common/errors';
const input=z.object({keyword:z.string().trim().max(100).refine(s=>!/[\x00-\x1f\x7f]/.test(s)).default(''),status:z.nativeEnum(OrderStatus).optional(),page:z.coerce.number().int().min(1).max(10000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20)}).strict();
// guardSwapHandover accepts actualAt up to server time + five minutes.
const handoverClockSkewMs=300000;
const positive=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>0&&Number(v)<=2147483647?Number(v):null;
/** Read-only list: one scoped source for display and filtering, no mutable catalog pricing. */
export async function readAdminOrders(tx:Prisma.TransactionClient,actor:StaffActor,query:unknown){
 await requireCurrentStaff(tx,actor,'orders',false);
 const parsed=input.safeParse(query);ensure(parsed.success,400,'VALIDATION','订单查询参数无效');const q=parsed.data;
 const gaps:string[]=[];
 for(const change of await tx.orderChange.findMany({where:{kind:'VEHICLE_CHANGE',status:'SWAP_RETURNED',order:{contractMode:'ELECTRONIC',status:'ACTIVE',currentAssignmentId:null,...(q.keyword?{OR:[{id:{contains:q.keyword,mode:'insensitive'}},{customer:{name:{contains:q.keyword,mode:'insensitive'}}},{vehicle:{OR:[{vin:{contains:q.keyword,mode:'insensitive'}},{plateNumber:{contains:q.keyword,mode:'insensitive'}}]}}]}:{})}}})){
  try{
   const receipt=await currentSwapReceipt(tx,change.id,true);if(!receipt)continue;
   const assignment=await tx.vehicleAssignment.findUnique({where:{id:receipt.assignmentId}});
   if(!assignment||assignment.status!=='CLOSED'||assignment.orderId!==change.orderId||assignment.customerId!==change.customerId||assignment.vehicleId!==receipt.vehicleId||assignment.returnHandoverId!==change.returnHandoverId||!assignment.deliveryHandoverId)continue;
   const segment=await tx.usageSegment.findFirst({where:{assignmentId:assignment.id,endHandoverId:change.returnHandoverId}});
   if(!segment)continue;const source=await swapReceiptMeteringSource(tx,{...segment,assignment});if(source)gaps.push(assignment.id);
  }catch(error){if(error instanceof HttpException&&error.getStatus()>=400&&error.getStatus()<500)continue;throw error;}
 }
 const pattern='%'+q.keyword.replace(/[\\%_]/g,'\\$&')+'%';
 const source=Prisma.sql`
 FROM "Order" o JOIN "Customer" c ON c.id=o."customerId"
 LEFT JOIN LATERAL (
  SELECT a."vehicleId",a.id FROM "VehicleAssignment" a
  JOIN "Handover" delivered ON delivered.id=a."deliveryHandoverId"
   AND delivered."orderId"=a."orderId" AND delivered."customerId"=a."customerId"
   AND delivered."vehicleId"=a."vehicleId" AND delivered."assignmentId"=a.id
   AND delivered.status='COMPLETED' AND delivered."completedAt" IS NOT NULL
   AND isfinite(delivered."completedAt") AND isfinite(delivered."actualAt")
   AND delivered."actualAt"=a."startAt" AND delivered."actualAt"<=delivered."completedAt"+(${handoverClockSkewMs}::double precision * interval '1 millisecond')
   AND delivered."completedAt"<=${new Date()} AND delivered."readingKm"=a."startReadingKm"
   AND ((delivered.type='DELIVERY' AND a."changeId" IS NULL AND delivered."changeId" IS NULL)
    OR (delivered.type='SWAP_DELIVERY' AND a."changeId" IS NOT NULL AND delivered."changeId"=a."changeId"))
  WHERE a."orderId"=o.id AND a."customerId"=o."customerId"
  AND ((o."currentAssignmentId" IS NOT NULL AND a.id=o."currentAssignmentId" AND a.status='ACTIVE' AND a."endAt" IS NULL AND a."vehicleId"=o."vehicleId")
   OR (o."currentAssignmentId" IS NULL AND o.status='ACTIVE' AND a.id IN (${gaps.length?Prisma.join(gaps):Prisma.sql`NULL`}) AND a.status='CLOSED')
   OR (o."currentAssignmentId" IS NULL AND o.status IN ('COMPLETED','SETTLING') AND a.status='CLOSED' AND a."endAt" IS NOT NULL AND isfinite(a."endAt") AND a."endAt">=a."startAt"))
  ORDER BY a."startAt" DESC,a.id DESC LIMIT 1
 ) actual ON true
 LEFT JOIN "Vehicle" v ON v.id=CASE WHEN actual."vehicleId" IS NOT NULL THEN actual."vehicleId"
  WHEN o."currentAssignmentId" IS NULL AND o.status IN ('AWAITING_CONTRACT_REVIEW','AWAITING_SIGNATURE','AWAITING_PAYMENT','AWAITING_HANDOVER')
   AND NOT EXISTS (SELECT 1 FROM "VehicleAssignment" prior WHERE prior."orderId"=o.id) THEN o."vehicleId" END
 WHERE (${q.status??null}::text IS NULL OR o.status::text=${q.status??null})
 AND (${q.keyword}='' OR o.id ILIKE ${pattern} OR c.name ILIKE ${pattern} OR v."plateNumber" ILIKE ${pattern} OR v.vin ILIKE ${pattern})`;
 const rows=await tx.$queryRaw<any[]>(Prisma.sql`SELECT o.id,o.status,o.revision,o."createdAt",c.id AS "customerId",c.name AS "customerName",
 actual.id AS "assignmentId",v.id AS "vehicleId",v."plateNumber",v.brand,v.model,v.vin,
 o."finalPlanSnapshot",o."effectiveTermsVersionId",o."contractMode",o."serviceAnchor"
 ${source} ORDER BY o."createdAt" DESC,o.id DESC OFFSET ${(q.page-1)*q.pageSize} LIMIT ${q.pageSize}`);
 const counts=await tx.$queryRaw<{total:bigint}[]>(Prisma.sql`SELECT count(*) AS total ${source}`);
 return{items:await Promise.all(rows.map(async r=>{const terms=await listTerms(tx,r)??{},product=Object.hasOwn(terms,'currentVehicleProductSnapshot')?terms.currentVehicleProductSnapshot:terms.productSnapshot;return{id:r.id,status:r.status,revision:r.revision,createdAt:r.createdAt,vehicleContext:r.vehicleId?(gaps.includes(r.assignmentId)?'SWAP_RETURNED':['COMPLETED','SETTLING'].includes(r.status)?'LAST':r.status==='ACTIVE'?'CURRENT':'CONFIRMED'):null,customer:{id:r.customerId,name:r.customerName},vehicle:r.vehicleId?{id:r.vehicleId,plateNumber:r.plateNumber,brand:r.brand,model:r.model,vin:r.vin}:null,productName:typeof product?.name==='string'&&product.name.trim()?product.name:null,months:positive(terms.months),monthlyFeeAmount:Number.isSafeInteger(terms.monthlyFeeAmount)&&terms.monthlyFeeAmount>=0&&terms.monthlyFeeAmount<=2147483647?terms.monthlyFeeAmount:null};})),total:Number(counts[0].total),page:q.page,pageSize:q.pageSize};
}

/** Stage identity is immutable; later applied swaps derive from its activation version. */
async function listTerms(tx:Prisma.TransactionClient,order:any):Promise<any|null>{
 if(!order.effectiveTermsVersionId)return order.finalPlanSnapshot;
 const effective=await tx.orderTermsVersion.findFirst({where:{id:order.effectiveTermsVersionId,orderId:order.id,effectiveAt:{lte:new Date()}}});
 if(!effective)return null;
 const terms=effective.snapshot as any;if(!terms||typeof terms!=='object'||Array.isArray(terms))return null;
 try{
  if(order.contractMode==='ELECTRONIC'){
   const chain=await readEffectiveContractChain(tx,order.id);
   if(!chain.ready||chain.termsVersionId!==effective.id)return null;
   if(Object.hasOwn(terms,'serviceStageId')){
    if(typeof terms.serviceStageId!=='string'||!terms.serviceStageId.trim())return null;
    const stage=await readServiceStage(tx,order,terms.serviceStageId);
    if(stage.snapshot.kind!=='RENEWAL'||!['ACTIVE','ENDED'].includes(stage.stage.status))return null;
   }
   return terms;
  }
  if(!Object.hasOwn(terms,'serviceStageId')){if(order.contractMode==='OFFLINE')await readSwapStageScope(tx,order,terms,{historical:false});return terms;}
  if(typeof terms.serviceStageId!=='string'||!terms.serviceStageId.trim())return null;
  const read=await readServiceStage(tx,order,terms.serviceStageId);
  if(!['ACTIVE','ENDED'].includes(read.stage.status)||read.snapshot.kind!=='RENEWAL')return null;
  const scope=await readSwapStageScope(tx,order,terms,{historical:true});
  let current=effective;const visited=new Set<string>();
  while(current.id!==read.stage.termsVersionId){
   if(visited.has(current.id))return null;visited.add(current.id);
   const q=await tx.delayQuote.findUnique({where:{id:current.quoteId},include:{change:true}}),c=q?.change,s=current.snapshot as any,quoted=q?.snapshot as any;
   if(!s||typeof s!=='object'||Array.isArray(s)||!q||!c||c.orderId!==order.id||c.customerId!==order.customerId||c.kind!=='VEHICLE_CHANGE'||c.status!=='APPLIED'||q.status!=='CONFIRMED'||c.activeQuoteId!==q.id||!c.priorTermsVersionId||!c.deliveryHandoverId||current.hash!==q.commercialHash||s.commercialHash!==q.commercialHash||current.offlineArchiveVersionId!==q.approvedArchiveVersionId)return null;
   const prior=await tx.orderTermsVersion.findFirst({where:{id:c.priorTermsVersionId,orderId:order.id}});
   if(!prior||prior.effectiveAt.getTime()>current.effectiveAt.getTime()||prior.version>=current.version||canonicalHash(prior.snapshot)!==canonicalHash(c.priorTerms)||hash(c.priorTerms)!==c.priorTermsHash)return null;
   const a=await tx.vehicleAssignment.findFirst({where:{orderId:order.id,customerId:order.customerId,changeId:c.id,deliveryHandoverId:c.deliveryHandoverId}}),h=await tx.handover.findUnique({where:{id:c.deliveryHandoverId}});
   if(!a||!h||h.type!=='SWAP_DELIVERY'||h.status!=='COMPLETED'||h.orderId!==order.id||h.customerId!==order.customerId||h.vehicleId!==a.vehicleId||h.assignmentId!==a.id||h.changeId!==c.id||a.vehicleId!==c.targetVehicleId||s.vehicleId!==a.vehicleId||!h.actualAt||!h.completedAt||h.actualAt.getTime()!==a.startAt.getTime()||h.readingKm!==a.startReadingKm||!Number.isFinite(h.completedAt.getTime())||h.actualAt.getTime()>h.completedAt.getTime()+handoverClockSkewMs||h.completedAt.getTime()>Date.now()||current.effectiveAt.getTime()!==h.actualAt.getTime()||c.actualCompletedAt?.getTime()!==h.actualAt.getTime())return null;
   if(!s.currentVehicleProductSnapshot||!quoted?.targetSource?.product||!quoted?.serviceStageScope)return null;
   if(canonicalHash(s.currentVehicleProductSnapshot)!==canonicalHash(quoted?.targetSource?.product)||s.monthlyFeeAmount!==quoted?.newMonthlyFeeAmount||canonicalHash(quoted?.serviceStageScope)!==canonicalHash(scope))return null;
   await readSwapStageScope(tx,order,c.priorTerms,{historical:true});
   current=prior;
  }
  return terms;
 }catch(error){if(error instanceof HttpException&&error.getStatus()===409)return null;throw error;}
}
