import { Prisma } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';
import { Db } from '../common/db';
import { audit, hash, money } from '../common/data';
import { ensure } from '../common/errors';
import { day, shanghaiDay, lockAccount, PACK_TERMS, USAGE_CLOCK } from './rules';
import { expireRemainingPacks, voidUnpaidQuotes } from './ledger';
export async function packTerms(tx:any){const doc=await tx.legalDocument.findFirst({where:{type:'mileage-pack',status:'PUBLISHED',confirmedAt:{not:null},confirmedBy:{not:null}},orderBy:{version:'desc'}});return doc?{version:PACK_TERMS,documentId:doc.id,documentVersion:doc.version,hash:hash(doc.content),content:doc.content}:null;}
export function periodView(period:any,now:Date,orderStatus:string,financial=false,operational=false){
 const due=day(period.effectiveEndDate)<=shanghaiDay(now),active=['ACTIVE','SETTLING'].includes(orderStatus);
 const fields=['id','orderId','sequence','revision','startReadingKm','endReadingKm','usedKm','baseUsedKm','packUsedKm','excessKm','excessAmount','billId','readingId','reviewNote','settledAt','createdAt'];
 return {...Object.fromEntries(fields.map(k=>[k,period[k]])),startDate:day(period.startDate),endDate:day(period.endDate),effectiveEndDate:day(period.effectiveEndDate),status:period.status==='OPEN'&&due?'AWAITING_READING':period.status,canSubmit:['OPEN','AWAITING_READING'].includes(period.status)&&due&&active,canSettle:financial&&period.status==='READY'&&due&&active,canRequestEvidence:operational&&active&&['READY','REVIEW_PENDING'].includes(period.status)};
}

@Injectable()
export class UsageService {
  constructor(@Inject(Db)private db:Db,@Inject(USAGE_CLOCK)private clock:()=>Date){}
  async account(orderId:string,customerId?:string,financial=false,operational=false){
    return this.db.serial(async tx=>{const a=await tx.usageAccount.findFirst({where:{orderId,...(customerId?{customerId}:{})},include:{order:true,periods:{orderBy:{sequence:'asc'}},purchases:{orderBy:{createdAt:'asc'}},ledger:{orderBy:{createdAt:'asc'}},settlement:true}});ensure(a,404,'NOT_FOUND','月度用量账户不存在');
      const terms=await packTerms(tx),today=shanghaiDay(this.clock()),current=a.periods.find(p=>day(p.startDate)<=today&&today<day(p.endDate));
      return {orderId,orderStatus:a.order.status,policyVersion:a.policyVersion,startedOn:day(a.startedOn),returnedOn:a.returnedOn?day(a.returnedOn):null,baseAllowanceKm:1500,excessPriceAmount:150,packBalanceKm:a.purchases.filter(p=>p.status==='ACTIVE').reduce((n,p)=>n+p.remainingKm,0),packStatus:a.packStatus,
        periods:a.periods.map(p=>periodView(p,this.clock(),a.order.status,financial,operational)),packs:a.purchases.map(p=>({id:p.id,km:p.km,amount:p.amount,status:p.status,billId:p.billId,remainingKm:p.remainingKm})),ledger:a.ledger.map(l=>({id:l.id,type:l.type,periodId:l.periodId,packId:l.packId,deltaKm:l.deltaKm,createdAt:l.createdAt})),products:await tx.mileagePackProduct.findMany({where:{active:true},orderBy:{km:'asc'},select:{id:true,version:true,km:true,amount:true}}),purchaseTerms:terms,canPurchase:!!terms&&a.order.status==='ACTIVE'&&a.packStatus==='ACTIVE'&&!!current&&!['SETTLED','CANCELLED'].includes(current.status),returnSettlement:a.settlement?{id:a.settlement.id,status:a.settlement.status,revision:a.settlement.revision}:null};});
  }
  async purchase(orderId:string,customerId:string,input:any){return this.db.serial(async tx=>{
    const order=await tx.order.findFirst({where:{id:orderId,customerId}});ensure(order,404,'NOT_FOUND','订单不存在');const account=await lockAccount(tx,orderId),requestHash=hash(input);
    const existing=await tx.mileagePurchase.findUnique({where:{orderId_idempotencyKey:{orderId,idempotencyKey:input.idempotencyKey}}});if(existing){ensure(existing.requestHash===requestHash,409,'IDEMPOTENCY_CONFLICT','购买请求编号与内容冲突');return this.purchaseResult(tx,existing);}
    ensure(order.status==='ACTIVE'&&account.packStatus==='ACTIVE',409,'PACK_UNAVAILABLE','仅当前用车中的订阅可加购');
    const terms=await packTerms(tx);ensure(terms&&input.termsVersion===terms.version&&input.termsDocumentId===terms.documentId&&input.termsDocumentVersion===terms.documentVersion&&input.termsHash===terms.hash,409,'PACK_CONSENT','请先阅读并主动同意当前已发布的里程包说明');
    const product=await tx.mileagePackProduct.findFirst({where:{id:input.productId,active:true}});ensure(product,404,'NOT_FOUND','里程包产品不存在');
    const today=new Date(shanghaiDay(this.clock()));const period=await tx.usagePeriod.findFirst({where:{accountId:account.id,startDate:{lte:today},endDate:{gt:today},status:{notIn:['SETTLED','CANCELLED']}}});ensure(period,409,'PERIOD_CLOSED','当前订阅月已结束，不可追溯购买');
    const max=await tx.bill.aggregate({where:{orderId,type:'MILEAGE_PACK'},_max:{sequence:true}});
    const bill=await tx.bill.create({data:{orderId,customerId,type:'MILEAGE_PACK',sequence:(max._max.sequence||0)+1,amount:product.amount,dueDate:today,status:'PENDING',description:`加购${product.km}公里；本订阅期有效，退订失效且不退未使用费用`}});
    const p=await tx.mileagePurchase.create({data:{accountId:account.id,orderId,customerId,productId:product.id,productVersion:product.version,applicableFromSequence:period.sequence,km:product.km,amount:product.amount,billId:bill.id,termsSnapshot:{...terms,accepted:true},acceptedAt:this.clock(),idempotencyKey:input.idempotencyKey,requestHash}});
    await audit(tx,customerId,'PURCHASE_MILEAGE_PACK','orders',orderId,{purchaseId:p.id,billId:bill.id,documentId:terms.documentId,documentVersion:terms.documentVersion,termsHash:terms.hash},'CUSTOMER');return this.purchaseResult(tx,p);
  });}
  private async purchaseResult(tx:any,p:any){const bill=await tx.bill.findUniqueOrThrow({where:{id:p.billId}});return{purchase:{id:p.id,status:p.status,billId:p.billId,km:p.km,amount:p.amount},bill:{id:bill.id,amount:bill.amount,status:bill.status}};}
  async submit(periodId:string,customerId:string,input:any){return this.db.serial(async tx=>{
    const p=await tx.usagePeriod.findUnique({where:{id:periodId},include:{account:{include:{order:true}}}});ensure(p&&p.account.customerId===customerId,404,'NOT_FOUND','本人的订阅月不存在');
    await lockAccount(tx,p.orderId);const prior=await tx.mileage.findUnique({where:{customerId_idempotencyKey:{customerId,idempotencyKey:input.idempotencyKey}}});
    if(prior){ensure(prior.periodId===periodId&&prior.readingKm===input.readingKm&&prior.recordedAt.toISOString()===new Date(input.recordedAt).toISOString()&&hash(prior.fileIds)===hash(input.fileIds),409,'IDEMPOTENCY_CONFLICT','月读数编号与内容冲突');return prior;}
    ensure(periodView(p,this.clock(),p.account.order.status).canSubmit,409,'PERIOD_NOT_REPORTABLE','该订阅月尚未到期或已有待核验记录');
    const recordedAt=new Date(input.recordedAt);ensure(shanghaiDay(recordedAt)===day(p.effectiveEndDate)&&recordedAt.getTime()<=this.clock().getTime()+300000,409,'BOUNDARY_EVIDENCE','照片时间必须对应本订阅月界或归还日，不能推算跨月读数');
    ensure(input.readingKm>=(p.startReadingKm||0),409,'MILEAGE_REGRESSION','仪表读数不可低于月初读数');
    if(p.account.returnedOn&&day(p.effectiveEndDate)===day(p.account.returnedOn))ensure(input.readingKm===p.account.returnReadingKm,409,'RETURN_READING_MISMATCH','末期读数必须与已确认归还交接一致');
    ensure(await tx.storedFile.count({where:{id:{in:input.fileIds},customerId,purpose:'mileage',mimeType:{in:['image/jpeg','image/png','image/webp']}}})===new Set(input.fileIds).size,403,'FILE_OWNERSHIP','请上传本人仪表照片');
    const row=await tx.mileage.create({data:{...input,recordedAt,periodId,customerId,orderId:p.orderId}});await tx.usagePeriod.update({where:{id:periodId},data:{status:'REVIEW_PENDING',readingId:row.id,revision:{increment:1}}});await audit(tx,customerId,'SUBMIT_MONTHLY_READING','usage-periods',periodId,{mileageId:row.id},'CUSTOMER');return row;
  });}
  async requestEvidence(id:string,input:any,actorId:string){return this.db.serial(async tx=>{
    const p=await tx.usagePeriod.findUnique({where:{id},include:{account:{include:{order:true}}}});ensure(p,404,'NOT_FOUND','订阅月不存在');await lockAccount(tx,p.orderId);
    const previous=await tx.auditLog.findFirst({where:{resourceType:'usage-periods',resourceId:id,action:'REQUEST_EVIDENCE',data:{path:['idempotencyKey'],equals:input.idempotencyKey}}});
    if(previous){ensure((previous.data as any).requestHash===hash(input),409,'IDEMPOTENCY_CONFLICT','补证编号与内容冲突');return periodView(p,this.clock(),p.account.order.status,false,true);}
    ensure(p.revision===input.revision&&periodView(p,this.clock(),p.account.order.status,false,true).canRequestEvidence,409,'PERIOD_NOT_CORRECTABLE','仅尚未结算的当前读数可以请求补证，请刷新');
    const updated=await tx.usagePeriod.update({where:{id},data:{status:'AWAITING_READING',readingId:null,endReadingKm:null,reviewNote:input.reason,revision:{increment:1}}});
    await audit(tx,actorId,'REQUEST_EVIDENCE','usage-periods',id,{...input,requestHash:hash(input),previousReadingId:p.readingId,previousEndReadingKm:p.endReadingKm});return periodView(updated,this.clock(),p.account.order.status,false,true);
  });}
  async settle(id:string,input:any,actorId:string){return this.db.serial(async tx=>{
    const p=await tx.usagePeriod.findUnique({where:{id},include:{account:{include:{order:true}}}});ensure(p,404,'NOT_FOUND','订阅月不存在');const account=await lockAccount(tx,p.orderId);
    if(p.status==='SETTLED'){ensure(p.settlementKey===input.idempotencyKey&&p.revision===input.revision+1,409,'IDEMPOTENCY_CONFLICT','该月已结算，不可再次计费');return periodView(p,this.clock(),p.account.order.status,true);}
    ensure(['ACTIVE','SETTLING'].includes(p.account.order.status)&&p.status==='READY'&&p.revision===input.revision&&p.endReadingKm!==null&&day(p.effectiveEndDate)<=shanghaiDay(this.clock()),409,'PERIOD_NOT_READY','须有当前月界确认读数及最新版本');
    ensure(!await tx.usagePeriod.count({where:{orderId:p.orderId,sequence:{lt:p.sequence},status:{not:'SETTLED'}}}),409,'MISSING_PRIOR_READING','之前月份尚未结算，不可跨月估算');
    const previous=p.sequence>1?await tx.usagePeriod.findUniqueOrThrow({where:{orderId_sequence:{orderId:p.orderId,sequence:p.sequence-1}}}):null;
    const start=previous?.endReadingKm??p.startReadingKm;ensure(start!==null&&p.endReadingKm>=start,409,'MILEAGE_REGRESSION','月界读数不完整或倒退');
    ensure(!await tx.mileagePurchase.count({where:{accountId:account.id,status:'REFUND_PENDING'}}),409,'PACK_REFUND_PENDING','里程包退款待核实，额度已冻结，请先核对渠道退款结果');
    await voidUnpaidQuotes(tx,account.id,account.returnedOn?120:p.sequence);
    const used=p.endReadingKm-start,base=Math.min(1500,used);let rest=used-base,packUsed=0;
    const packs=await tx.mileagePurchase.findMany({where:{accountId:account.id,status:'ACTIVE',remainingKm:{gt:0},applicableFromSequence:{lte:p.sequence}},orderBy:[{paidAt:'asc'},{id:'asc'}]});
    for(const pack of packs){const take=Math.min(rest,pack.remainingKm);if(!take)continue;await tx.mileagePurchase.update({where:{id:pack.id},data:{remainingKm:{decrement:take}}});await tx.mileageLedger.create({data:{accountId:account.id,packId:pack.id,periodId:id,type:'CONSUME',deltaKm:-take,sourceKey:`period:${id}:pack:${pack.id}`}});rest-=take;packUsed+=take;}
    const amount=money.parse(rest*150);let billId:string|null=null;
    if(amount){const bill=await tx.bill.create({data:{orderId:p.orderId,customerId:account.customerId,type:'MILEAGE_EXCESS',sequence:p.sequence,amount,dueDate:new Date(shanghaiDay(this.clock())),description:`第${p.sequence}订阅月：已核验${used}公里，基础${base}公里，加购${packUsed}公里，超额${rest}公里×150分`,createdBy:actorId,evidenceFileIds:(await tx.mileage.findUniqueOrThrow({where:{id:p.readingId!}})).fileIds}});billId=bill.id;}
    const settled=await tx.usagePeriod.update({where:{id},data:{status:'SETTLED',revision:{increment:1},startReadingKm:start,usedKm:used,baseUsedKm:base,packUsedKm:packUsed,excessKm:rest,excessAmount:amount,billId,settlementKey:input.idempotencyKey,settledAt:this.clock()}});
    if(p.account.order.status==='ACTIVE'){const vehicle=await tx.vehicle.findUniqueOrThrow({where:{id:p.account.order.vehicleId}});ensure(vehicle.reservedOrderId===p.orderId&&vehicle.status==='IN_USE',409,'VEHICLE_OWNERSHIP','车辆已不属于当前订单');if(p.endReadingKm>vehicle.mileageKm)await tx.vehicle.update({where:{id:vehicle.id},data:{mileageKm:p.endReadingKm}});if(p.endReadingKm>p.account.order.confirmedMileageKm)await tx.order.update({where:{id:p.orderId},data:{confirmedMileageKm:p.endReadingKm}});}
    await expireRemainingPacks(tx,account);await audit(tx,actorId,'SETTLE_USAGE_PERIOD','usage-periods',id,{usedKm:used,baseUsedKm:base,packUsedKm:packUsed,excessKm:rest,amount,billId});return periodView(settled,this.clock(),p.account.order.status,true);
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
