import {resolveAddonQuote} from '../addon-products/catalog';
import {requireAddonCustomer} from '../addon-products/customer';
import {requireCurrentConsents} from '../auth/consents';
import {versionSource} from '../addon-products/policy';
import {packApplicableToPeriod,packBalanceProjection,expireMonthlyPeriodPacks,isMonthlyPack} from './monthly-pack';
import { currentPhysicalReceipt,guardPhysicalReceiptPeriod } from '../offline-documents/vehicle-receipt';
import {segmentsView,segmentUsage,noVehicleUsage,submitSegment,requestSegmentEvidence} from '../vehicle-changes/segments';
import {currentAssignment,assignmentView} from '../vehicle-changes/assignments';
import { Prisma } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';
import { Db } from '../common/db';
import { audit, hash } from '../common/data';
import { ensure } from '../common/errors';
import { day, shanghaiDay, lockAccount, PACK_TERMS, USAGE_CLOCK } from './rules';
import { expireRemainingPacks, voidUnpaidQuotes } from './ledger';
import { readUsagePricing, usageExcessAmount, usagePricingView, UsagePricing } from './pricing';
import {readAccountPricing} from './account-pricing';
export async function packTerms(tx:any){const doc=await tx.legalDocument.findFirst({where:{type:'mileage-pack',status:'PUBLISHED',confirmedAt:{not:null},confirmedBy:{not:null}},orderBy:{version:'desc'}});return doc?{version:PACK_TERMS,documentId:doc.id,documentVersion:doc.version,hash:hash(doc.content),content:doc.content}:null;}
async function historicalPeriodView(tx:any,a:any,p:any,now:Date,financial:boolean,operational:boolean){
 const stage=p.serviceStageId?await tx.orderServiceStage.findUnique({where:{id:p.serviceStageId}}):null;
 if(stage?.status==='VOIDED'&&stage.termsVersionId){
  const source=await(await import('../order-renewals/cancellation-v31')).requireV31CorrectedTerms(tx,stage.changeId,await tx.orderTermsVersion.findUniqueOrThrow({where:{id:stage.termsVersionId}}));
  return{...periodView(p,now,a.order.status,financial,operational,source.stage.snapshot.usagePricing),serviceEffect:'NEVER_EFFECTIVE',cancellationId:source.record.id,canSubmit:false,canSettle:false,canRequestEvidence:false,segments:(await segmentsView(tx,p,now,operational)).map((s:any)=>({...s,canSubmit:false,canSettle:false,canRequestEvidence:false}))};
 }
 return{...periodView(p,now,a.order.status,financial,operational,await readUsagePricing(tx,a.order,a,p,now)),segments:await segmentsView(tx,p,now,operational)};
}
export function periodView(period:any,now:Date,orderStatus:string,financial=false,operational=false,pricing?:UsagePricing){
 const due=day(period.effectiveEndDate)<=shanghaiDay(now),active=['ACTIVE','SETTLING'].includes(orderStatus);
 const fields=['id','orderId','sequence','serviceStageId','stageSequence','revision','startReadingKm','endReadingKm','usedKm','baseUsedKm','packUsedKm','excessKm','excessAmount','billId','readingId','reviewNote','settledAt','createdAt'] as const;
 return {...Object.fromEntries(fields.map(k=>[k,period[k]])) as Record<(typeof fields)[number],any>,...(pricing?usagePricingView(pricing):{}),startDate:day(period.startDate),endDate:day(period.endDate),effectiveEndDate:day(period.effectiveEndDate),status:period.status==='OPEN'&&due?'AWAITING_READING':period.status,canSubmit:['OPEN','AWAITING_READING'].includes(period.status)&&due&&active,canSettle:financial&&period.status==='READY'&&due&&active,canRequestEvidence:operational&&active&&['READY','REVIEW_PENDING'].includes(period.status)};
}
/** Customer-safe money facts are read from this purchase's bill, never a cached create response. */
export function mileagePackView(p:any,bill:any,now:Date,currentPeriodId:string|undefined,activeScope:boolean){
 ensure(bill&&bill.id===p.billId&&bill.orderId===p.orderId&&bill.customerId===p.customerId&&bill.type==='MILEAGE_PACK',409,'PACK_PAYMENT_SOURCE','里程包账单归属异常，请联系平台核对');
 const cents=(value:any)=>Number.isSafeInteger(value)&&value>0&&value<=2147483647;
 const ownPayments=(bill.payments||[]).filter((v:any)=>v.billId===p.billId&&v.customerId===p.customerId),receipts=ownPayments.filter((v:any)=>v.status==='SUCCEEDED'&&typeof v.providerTransactionId==='string'&&v.providerTransactionId.length>0&&cents(v.amount));
 const reasons=new Set<string>();let received=0n,refunded=0n,unresolvedReceiptCount=0,pendingRefundCount=0;
 for(const payment of receipts){
  received+=BigInt(payment.amount);let returned=0n;
  for(const refund of payment.refunds||[]){
   if(refund.paymentId!==payment.id||refund.customerId!==p.customerId||!cents(refund.amount))continue;
   if(['PENDING_APPROVAL','PROCESSING'].includes(refund.status))pendingRefundCount++;
   if(refund.status==='SUCCEEDED'&&typeof refund.providerRefundId==='string'&&refund.providerRefundId.length>0)returned+=BigInt(refund.amount);
  }
  refunded+=returned;
  if(returned>BigInt(payment.amount))reasons.add('MILEAGE_REFUND_REVIEW');
  if(returned<BigInt(payment.amount)&&(payment.reconciliationRequired||['PENDING_PAYMENT','VOID'].includes(p.status))){unresolvedReceiptCount++;reasons.add(payment.reconciliationReason||'MILEAGE_GRANT_REVIEW');}
 }
 const number=(value:bigint)=>{ensure(value<=BigInt(Number.MAX_SAFE_INTEGER),409,'PACK_PAYMENT_SOURCE','里程包累计收退款金额需要核对');return Number(value);},net=received>refunded?received-refunded:0n;
 const paymentReview={required:unresolvedReceiptCount>0||reasons.size>0,reason:[...reasons][0]||null,reasons:[...reasons],unresolvedReceiptCount};
 const unissued=['PENDING_PAYMENT','VOID'].includes(p.status),effectiveStatus=unissued?(pendingRefundCount>0?'REFUND_PENDING':paymentReview.required?'PAYMENT_REVIEW':receipts.length>0&&net===0n?'REFUNDED':p.status):p.status;
 const inScope=activeScope&&!!currentPeriodId&&(!isMonthlyPack(p)||p.applicablePeriodId===currentPeriodId&&p.expiresAt>now);
 return{id:p.id,km:p.km,amount:p.amount,status:p.status,effectiveStatus,billId:p.billId,bill:{id:bill.id,type:bill.type,amount:bill.amount,paidAmount:bill.paidAmount,status:bill.status},remainingKm:p.remainingKm,ruleVersion:p.ruleVersion||'MILEAGE_PACK_V1',periodId:p.applicablePeriodId,expiresAt:p.expiresAt,
  canUseNow:inScope&&p.status==='ACTIVE'&&p.remainingKm>0,canPay:inScope&&p.status==='PENDING_PAYMENT'&&effectiveStatus==='PENDING_PAYMENT'&&bill.status==='PENDING'&&bill.paidAmount===0&&receipts.length===0,paymentReview,
  paymentFacts:{receiptCount:receipts.length,receivedAmount:number(received),refundedAmount:number(refunded),netReceivedAmount:number(net),pendingRefundCount}};
}

@Injectable()
export class UsageService {
  constructor(@Inject(Db)private db:Db,@Inject(USAGE_CLOCK)private clock:()=>Date){}
  async account(orderId:string,customerId?:string,financial=false,operational=false){
    return this.db.serial(async tx=>{const a=await tx.usageAccount.findFirst({where:{orderId,...(customerId?{customerId}:{})},include:{order:true,periods:{orderBy:{sequence:'asc'}},purchases:{orderBy:{createdAt:'asc'}},ledger:{orderBy:{createdAt:'asc'}},settlement:true}});ensure(a,404,'NOT_FOUND','月度用量账户不存在');
      const {pricing,initialPricing,servicePeriod}=await readAccountPricing(tx,a.order,a,a.periods,this.clock()),physicalReceipt=await currentPhysicalReceipt(tx,orderId);const terms=await packTerms(tx),current=servicePeriod.status==='CURRENT'?a.periods.find(p=>p.id===servicePeriod.periodId):null;
      const packBills=await tx.bill.findMany({where:{id:{in:a.purchases.map(p=>p.billId)},orderId,customerId:a.customerId,type:'MILEAGE_PACK'},include:{payments:{include:{refunds:true},orderBy:{createdAt:'asc'}}}}),packBillMap=new Map(packBills.map(b=>[b.id,b])),packs=a.purchases.map((p:any)=>mileagePackView(p,packBillMap.get(p.billId),this.clock(),current?.id,!physicalReceipt&&a.order.status==='ACTIVE'&&a.packStatus==='ACTIVE'));
      return {orderId,physicalReceipt:physicalReceipt?{id:physicalReceipt.id,receivedAt:physicalReceipt.receivedAt,readingKm:physicalReceipt.readingKm,verificationPending:a.order.status==='ACTIVE'}:null,orderStatus:a.order.status,servicePeriod,initialPricing:usagePricingView(initialPricing),...usagePricingView(pricing),startedOn:day(a.startedOn),returnedOn:a.returnedOn?day(a.returnedOn):null,...packBalanceProjection(a.purchases,!physicalReceipt&&a.order.status==='ACTIVE'&&a.packStatus==='ACTIVE'?current?.id:undefined,this.clock()),availablePackBalanceKm:packs.filter(p=>p.canUseNow).reduce((total,p)=>total+p.remainingKm,0),packStatus:a.packStatus,
        currentAssignment:assignmentView(await currentAssignment(tx,a.order)),assignments:(await tx.vehicleAssignment.findMany({where:{orderId},include:{vehicle:true},orderBy:{startAt:'asc'}})).map(assignmentView),periods:await Promise.all(a.periods.map(p=>historicalPeriodView(tx,a,p,this.clock(),financial,operational))),packs,ledger:a.ledger.map(l=>({id:l.id,type:l.type,periodId:l.periodId,packId:l.packId,deltaKm:l.deltaKm,createdAt:l.createdAt})),products:[],purchaseTerms:terms,canPurchase:false,returnSettlement:a.settlement?{id:a.settlement.id,status:a.settlement.status,revision:a.settlement.revision}:null};});
  }
  async purchase(orderId:string,customerId:string,input:any,sessionId?:string){return this.db.serial(async tx=>{
    await requireAddonCustomer(tx,customerId,sessionId);
    const order=await tx.order.findFirst({where:{id:orderId,customerId}});ensure(order,404,'NOT_FOUND','订单不存在');const account=await lockAccount(tx,orderId),requestHash=hash(input);
    const existing=await tx.mileagePurchase.findUnique({where:{orderId_idempotencyKey:{orderId,idempotencyKey:input.idempotencyKey}}});if(existing){ensure(existing.requestHash===requestHash,409,'IDEMPOTENCY_CONFLICT','购买请求编号与内容冲突');return this.purchaseResult(tx,existing);}
    ensure(input.termsVersion==='MILEAGE_PACK_V2',409,'PACK_CATALOG_REQUIRED','请从当前独立里程包目录重新选择');
    await requireCurrentConsents(tx,customerId,['terms','privacy']);
    const resolved=await resolveAddonQuote(tx,order,'MILEAGE_PACK',input,this.clock()),{product,version,quote,context,terms}=resolved;
    const max=await tx.bill.aggregate({where:{orderId,type:'MILEAGE_PACK'},_max:{sequence:true}}),today=new Date(shanghaiDay(this.clock()));
    const bill=await tx.bill.create({data:{orderId,customerId,type:'MILEAGE_PACK',sequence:(max._max.sequence||0)+1,amount:quote.amount,dueDate:today,status:'PENDING',description:`加购${quote.km}公里；仅本计费月${context.startDate}至${context.endDate}有效，月底不结转`}});
    const period=await tx.usagePeriod.findUniqueOrThrow({where:{id:context.periodId}}),model=await tx.modelDefinition.findUniqueOrThrow({where:{id:context.modelDefinitionId}});
    const pricingSnapshot={version:2,source:versionSource(version),quote,versionId:version.id,productId:product.productId,productVersion:version.version,sourceHash:version.sourceHash,periodId:context.periodId,assignmentId:context.assignmentId,modelDefinitionId:context.modelDefinitionId,brand:model.brand,serviceStageId:context.serviceStageId,expiresAt:context.expiresAt};
    const p=await tx.mileagePurchase.create({data:{accountId:account.id,orderId,customerId,productVersion:version.version,ruleVersion:'MILEAGE_PACK_V2',applicableFromSequence:period.sequence,applicablePeriodId:period.id,serviceStageId:context.serviceStageId,assignmentId:context.assignmentId,modelDefinitionId:context.modelDefinitionId,addonVersionId:version.id,sourceHash:version.sourceHash,pricingSnapshot,expiresAt:new Date(context.expiresAt),km:quote.km,amount:quote.amount,billId:bill.id,termsSnapshot:{...terms,accepted:true},acceptedAt:this.clock(),createdAt:this.clock(),idempotencyKey:input.idempotencyKey,requestHash}});
    await audit(tx,customerId,'PURCHASE_MONTHLY_MILEAGE_PACK','orders',orderId,{purchaseId:p.id,billId:bill.id,periodId:period.id,sourceHash:version.sourceHash,termsHash:terms.hash},'CUSTOMER');return this.purchaseResult(tx,p);

  });}
  private async purchaseResult(tx:any,p:any){const bill=await tx.bill.findUniqueOrThrow({where:{id:p.billId}});return{purchase:{id:p.id,status:p.status,billId:p.billId,km:p.km,amount:p.amount,ruleVersion:p.ruleVersion||'MILEAGE_PACK_V1',periodId:p.applicablePeriodId,expiresAt:p.expiresAt},bill:{id:bill.id,amount:bill.amount,status:bill.status}};}
  async submit(periodId:string,customerId:string,input:any){return this.db.serial(async tx=>{
    const p=await tx.usagePeriod.findUnique({where:{id:periodId},include:{account:{include:{order:true}}}});ensure(p&&p.account.customerId===customerId,404,'NOT_FOUND','本人的订阅月不存在');
    await lockAccount(tx,p.orderId);await guardPhysicalReceiptPeriod(tx,p.orderId,p.startDate);const prior=await tx.mileage.findUnique({where:{customerId_idempotencyKey:{customerId,idempotencyKey:input.idempotencyKey}}});
    if(prior){ensure(prior.periodId===periodId&&prior.readingKm===input.readingKm&&prior.recordedAt.toISOString()===new Date(input.recordedAt).toISOString()&&hash(prior.fileIds)===hash(input.fileIds),409,'IDEMPOTENCY_CONFLICT','月读数编号与内容冲突');return prior;}
    const segments=await tx.usageSegment.findMany({where:{periodId},include:{assignment:true}});if(segments.length){ensure(segments.length===1&&!segments[0].assignment.changeId,409,'SEGMENT_READING_REQUIRED','请按对应车辆分段申报');return submitSegment(tx,segments[0].id,customerId,input,this.clock());}
    ensure(periodView(p,this.clock(),p.account.order.status).canSubmit,409,'PERIOD_NOT_REPORTABLE','该订阅月尚未到期或已有待核验记录');
    const recordedAt=new Date(input.recordedAt);ensure(shanghaiDay(recordedAt)===day(p.effectiveEndDate)&&recordedAt.getTime()<=this.clock().getTime()+300000,409,'BOUNDARY_EVIDENCE','照片时间必须对应本订阅月界或归还日，不能推算跨月读数');
    ensure(input.readingKm>=(p.startReadingKm||0),409,'MILEAGE_REGRESSION','仪表读数不可低于月初读数');
    if(p.account.returnedOn&&day(p.effectiveEndDate)===day(p.account.returnedOn))ensure(input.readingKm===p.account.returnReadingKm,409,'RETURN_READING_MISMATCH','末期读数必须与已确认归还交接一致');
    ensure(await tx.storedFile.count({where:{id:{in:input.fileIds},customerId,purpose:'mileage',mimeType:{in:['image/jpeg','image/png','image/webp']}}})===new Set(input.fileIds).size,403,'FILE_OWNERSHIP','请上传本人仪表照片');
    const row=await tx.mileage.create({data:{...input,recordedAt,periodId,customerId,orderId:p.orderId}});await tx.usagePeriod.update({where:{id:periodId},data:{status:'REVIEW_PENDING',readingId:row.id,revision:{increment:1}}});await audit(tx,customerId,'SUBMIT_MONTHLY_READING','usage-periods',periodId,{mileageId:row.id},'CUSTOMER');return row;
  });}
  async requestEvidence(id:string,input:any,actorId:string){return this.db.serial(async tx=>{
    const p=await tx.usagePeriod.findUnique({where:{id},include:{account:{include:{order:true}}}});ensure(p,404,'NOT_FOUND','订阅月不存在');const account=await lockAccount(tx,p.orderId),pricing=await readUsagePricing(tx,p.account.order,account,p);
    const previous=await tx.auditLog.findFirst({where:{resourceType:'usage-periods',resourceId:id,action:'REQUEST_EVIDENCE',data:{path:['idempotencyKey'],equals:input.idempotencyKey}}});
    if(previous){ensure((previous.data as any).requestHash===hash(input),409,'IDEMPOTENCY_CONFLICT','补证编号与内容冲突');return periodView(p,this.clock(),p.account.order.status,false,true,pricing);}
    const segments=await tx.usageSegment.findMany({where:{periodId:id},include:{assignment:true}});if(segments.length){ensure(segments.length===1&&!segments[0].assignment.changeId,409,'SEGMENT_READING_REQUIRED','请按对应车辆分段请求补证');ensure(p.revision===input.revision,409,'REVISION_CONFLICT','月读数已更新');await requestSegmentEvidence(tx,segments[0].id,{...input,revision:segments[0].revision},actorId,this.clock());await audit(tx,actorId,'REQUEST_EVIDENCE','usage-periods',id,{...input,requestHash:hash(input),previousReadingId:segments[0].readingId});return periodView(await tx.usagePeriod.findUniqueOrThrow({where:{id}}),this.clock(),p.account.order.status,false,true,pricing);}
    ensure(p.revision===input.revision&&periodView(p,this.clock(),p.account.order.status,false,true,pricing).canRequestEvidence,409,'PERIOD_NOT_CORRECTABLE','仅尚未结算的当前读数可以请求补证，请刷新');
    const updated=await tx.usagePeriod.update({where:{id},data:{status:'AWAITING_READING',readingId:null,endReadingKm:null,reviewNote:input.reason,revision:{increment:1}}});
    await audit(tx,actorId,'REQUEST_EVIDENCE','usage-periods',id,{...input,requestHash:hash(input),previousReadingId:p.readingId,previousEndReadingKm:p.endReadingKm});return periodView(updated,this.clock(),p.account.order.status,false,true,pricing);
  });}
  async settle(id:string,input:any,actorId:string){return this.db.serial(async tx=>{
    const p=await tx.usagePeriod.findUnique({where:{id},include:{account:{include:{order:true}}}});ensure(p,404,'NOT_FOUND','订阅月不存在');const account=await lockAccount(tx,p.orderId);
    const pricing=await readUsagePricing(tx,p.account.order,account,p);
    if(p.status==='SETTLED'){ensure(p.settlementKey===input.idempotencyKey&&p.revision===input.revision+1,409,'IDEMPOTENCY_CONFLICT','该月已结算，不可再次计费');return periodView(p,this.clock(),p.account.order.status,true,false,pricing);}
    await guardPhysicalReceiptPeriod(tx,p.orderId,p.startDate);
    const changing=await tx.orderChange.findFirst({where:{orderId:p.orderId,kind:'VEHICLE_CHANGE',status:{notIn:['APPLIED','CANCELLED','REJECTED']}}});if(changing?.activeQuoteId){const q=await tx.delayQuote.findUniqueOrThrow({where:{id:changing.activeQuoteId}});ensure(day(p.endDate)<=shanghaiDay(new Date((q.snapshot as any).plannedReturnAt)),409,'SWAP_USAGE_PENDING','本月换车尚未完成，分段用量未固定');}
    const gap=await noVehicleUsage(tx,p);ensure(['ACTIVE','SETTLING'].includes(p.account.order.status)&&p.status==='READY'&&p.revision===input.revision&&(p.endReadingKm!==null||gap)&&day(p.effectiveEndDate)<=shanghaiDay(this.clock()),409,'PERIOD_NOT_READY','须有当前月界确认读数及最新版本');
    ensure(!await tx.usagePeriod.count({where:{orderId:p.orderId,sequence:{lt:p.sequence},status:{notIn:['SETTLED','CANCELLED']}}}),409,'MISSING_PRIOR_READING','之前月份尚未结算，不可跨月估算');
    const previous=p.sequence>1?await tx.usagePeriod.findFirst({where:{orderId:p.orderId,accountId:account.id,sequence:{lt:p.sequence},status:{not:'CANCELLED'}},orderBy:{sequence:'desc'}}):null;
    if(p.sequence>1)ensure(previous&&previous.status==='SETTLED'&&previous.endDate.getTime()===p.startDate.getTime()&&previous.effectiveEndDate.getTime()===previous.endDate.getTime(),409,'USAGE_PERIOD_CONTINUITY','前一实际服务月与本月日期不连续，请先核对已生效租期');
    const segmented=(await segmentUsage(tx,p,previous))||gap,start=segmented?segmented.start:previous?.endReadingKm??p.startReadingKm;ensure(segmented||start!==null&&p.endReadingKm!==null&&p.endReadingKm>=start,409,'MILEAGE_REGRESSION','月界读数不完整或倒退');
    ensure(!await tx.mileagePurchase.count({where:{accountId:account.id,status:'REFUND_PENDING'}}),409,'PACK_REFUND_PENDING','里程包退款待核实，额度已冻结，请先核对渠道退款结果');
    await voidUnpaidQuotes(tx,account.id,account.returnedOn?undefined:p.sequence);
    const used=segmented?segmented.used:p.endReadingKm!-start!,base=Math.min(pricing.baseAllowanceKm,used);let rest=used-base,packUsed=0;
    const packs=(await tx.mileagePurchase.findMany({where:{accountId:account.id,status:'ACTIVE',remainingKm:{gt:0},applicableFromSequence:{lte:p.sequence}},orderBy:[{paidAt:'asc'},{id:'asc'}]})).filter(pack=>packApplicableToPeriod(pack,p));
    for(const pack of packs){const take=Math.min(rest,pack.remainingKm);if(!take)continue;await tx.mileagePurchase.update({where:{id:pack.id},data:{remainingKm:{decrement:take}}});await tx.mileageLedger.create({data:{accountId:account.id,packId:pack.id,periodId:id,type:'CONSUME',deltaKm:-take,sourceKey:`period:${id}:pack:${pack.id}`}});rest-=take;packUsed+=take;}
    const amount=usageExcessAmount(rest,pricing.excessPriceAmount);let billId:string|null=null;
    if(amount){const bill=await tx.bill.create({data:{orderId:p.orderId,customerId:account.customerId,type:'MILEAGE_EXCESS',sequence:p.sequence,amount,dueDate:new Date(shanghaiDay(this.clock())),description:`第${p.sequence}订阅月：已核验${used}公里，基础${base}公里，加购${packUsed}公里，超额${rest}公里×${pricing.excessPriceAmount}分`,createdBy:actorId,evidenceFileIds:segmented?segmented.evidence:(await tx.mileage.findUniqueOrThrow({where:{id:p.readingId!}})).fileIds}});billId=bill.id;}
    const settled=await tx.usagePeriod.update({where:{id},data:{status:'SETTLED',revision:{increment:1},startReadingKm:start,usedKm:used,baseUsedKm:base,packUsedKm:packUsed,excessKm:rest,excessAmount:amount,billId,settlementKey:input.idempotencyKey,settledAt:this.clock()}});
    if(!segmented&&p.account.order.status==='ACTIVE'){ensure(p.endReadingKm!==null,409,'MILEAGE_REGRESSION','月界读数缺失');const vehicle=await tx.vehicle.findUniqueOrThrow({where:{id:p.account.order.vehicleId}});ensure(vehicle.reservedOrderId===p.orderId&&vehicle.status==='IN_USE',409,'VEHICLE_OWNERSHIP','车辆已不属于当前订单');if(p.endReadingKm>vehicle.mileageKm)await tx.vehicle.update({where:{id:vehicle.id},data:{mileageKm:p.endReadingKm}});if(p.endReadingKm>p.account.order.confirmedMileageKm)await tx.order.update({where:{id:p.orderId},data:{confirmedMileageKm:p.endReadingKm}});}
    await expireMonthlyPeriodPacks(tx,account,id);await expireRemainingPacks(tx,account);await audit(tx,actorId,'SETTLE_USAGE_PERIOD','usage-periods',id,{usedKm:used,baseUsedKm:base,packUsedKm:packUsed,excessKm:rest,amount,billId,...(gap?{noVehicleSource:gap}:{})});return periodView(settled,this.clock(),p.account.order.status,true,false,pricing);
  });}
}
export async function reviewUsageReading(tx:Prisma.TransactionClient,item:any,input:any,actorId:string){
  const p=await tx.usagePeriod.findUniqueOrThrow({where:{id:item.periodId},include:{account:{include:{order:true}}}});await lockAccount(tx,p.orderId);ensure(p.status==='REVIEW_PENDING'&&p.readingId===item.id&&['ACTIVE','SETTLING'].includes(p.account.order.status),409,'READING_STATE','本月读数已更换或订单已结束');
  if(input.decision==='APPROVED'){
    ensure(input.boundaryConfirmed===true,400,'BOUNDARY_CONFIRMATION','请明确核验照片对应月界事实，不能分摊推算');
    const known=await tx.usagePeriod.findMany({where:{orderId:p.orderId,endReadingKm:{not:null},id:{not:p.id}}});ensure(known.every(other=>other.sequence<p.sequence?other.endReadingKm!<=item.readingKm:other.endReadingKm!>=item.readingKm),409,'MILEAGE_REGRESSION','读数与已核验的前后月份冲突');
    const first=await tx.usagePeriod.findUniqueOrThrow({where:{orderId_sequence:{orderId:p.orderId,sequence:1}}});
    ensure(item.readingKm>=Math.max(first.startReadingKm||0,p.startReadingKm||0),409,'MILEAGE_REGRESSION','读数低于月初');
    if(p.account.order.status==='ACTIVE'){const vehicle=await tx.vehicle.findUniqueOrThrow({where:{id:p.account.order.vehicleId}});ensure(vehicle.reservedOrderId===p.orderId&&vehicle.status==='IN_USE',409,'VEHICLE_OWNERSHIP','车辆已不属于当前订单');}
  }
  await tx.usagePeriod.update({where:{id:p.id},data:{status:input.decision==='APPROVED'?'READY':'AWAITING_READING',...(input.decision==='APPROVED'?{endReadingKm:item.readingKm}:{}),reviewNote:input.note,revision:{increment:1}}});
  const row=await tx.mileage.update({where:{id:item.id},data:{status:input.decision,note:input.note,reviewedBy:actorId}});await audit(tx,actorId,'REVIEW_MONTHLY_READING','usage-periods',p.id,{mileageId:item.id,decision:input.decision,boundaryConfirmed:input.boundaryConfirmed===true});return row;
}

