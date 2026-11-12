import {hash} from '../common/data';
import {canonicalHash} from '../customers/types';
import {z} from 'zod';
import {listedProductSnapshot} from '../products/snapshot';
import {productVersionInclude} from '../products/types';
import {ensure} from '../common/errors';
import {requireCurrentStaff} from '../auth/staff-session';
import {financialContext} from '../order-changes/context';
import {buildOfflineLessorSnapshot} from '../owner-signing/lessor';
import {snapshotRevenueRule} from '../partners/revenue-rules';
import {requireVehicleUnrestricted} from '../vehicles/operational-restrictions';
import {day,shanghaiDay} from '../usage/rules';
import {readSwapCreditAvailability,readSwapServiceFeeSource} from './credits';
import {buildElectronicLessorSnapshot} from '../electronic-documents/initial-terms';
import {freezeSwapTerms} from '../contract-terms/swap';
import {electronicSwapQuoteInput,offlineSwapQuoteInput} from './offline-pricing-input';
import {composeOfflineSwapPricing,loadOfflineSwapTarget} from './offline-pricing';
import {requireOfflineSwapFacts} from './offline-facts';
import {readOfflineSwapFunds} from './offline-money';
import {assertOfflineSwapQuote} from './offline-target';
import {readSwapStageScope} from './stage-source';


function quotePricing(input:Parameters<typeof composeOfflineSwapPricing>[0]){
 try{return composeOfflineSwapPricing(input);}catch(error){
  if(error instanceof RangeError){
   ensure(error.message!=='UPGRADE_PRICING_DOWNGRADE_NOT_SUPPORTED',409,'DOWNGRADE_NOT_SUPPORTED','首版仅支持同价换车或升级');
   ensure(error.message!=='UPGRADE_PRICING_OUTSIDE_TERM',409,'SWAP_OUTSIDE_TERM','新车交付须在原服务期限内');
   ensure(!['OFFLINE_SWAP_PRICING_AMOUNT_OVERFLOW','UPGRADE_PRICING_AMOUNT_OVERFLOW'].includes(error.message),409,'OFFLINE_SWAP_PRICING_AMOUNT_OVERFLOW','升级后单期或合计金额超出系统可存储范围，请核对方案');
  }
  throw error;
 }
}

/** Shared source construction: only reads and row locks; no quote/hold/money/rights writes.
 * The same guards run again inside the existing quote command transaction. */
export async function buildOfflineSwapQuoteSource(tx:any,change:any,raw:unknown,actor:any,at=new Date()){
 const reference=await tx.order.findUniqueOrThrow({where:{id:change.orderId}}),electronic=reference.contractMode==='ELECTRONIC';
 const sourceInput=electronic?electronicSwapQuoteInput.parse(raw):null;
 const input=offlineSwapQuoteInput.parse(sourceInput?{...sourceInput,pricingVersion:2,depositAmount:change.priorTerms.depositAmount,depositBasis:'原押金完全沿用',insuranceResponsibility:'按已签协议及实际有效保单核验',downtimeArrangement:'无可用车辆间隔按原服务月自然日单列减租',settlementExplanation:'按实际交接事实及原有效实收核对补退',cancellationTerms:'已发生交接事实及原约定保留，未履行权益按有效依据释放',externalCompensationRequired:false}:raw);await requireCurrentStaff(tx,actor,'order-changes',true);ensure(['ADMIN','OPERATIONS'].includes(actor.role),403,'FORBIDDEN','仅当前运营可创建换车报价');
 await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${change.orderId} FOR UPDATE`;
 const order=await tx.order.findUniqueOrThrow({where:{id:change.orderId}}),active=change.activeQuoteId?await tx.delayQuote.findUnique({where:{id:change.activeQuoteId}}):null;
 ensure(!electronic||!active?.financePreparedAt&&!change.returnHandoverId,409,'PHYSICAL_FACT_IMMUTABLE','电子换车确认资金或形成交接后不得覆盖原报价');
 const previousPreparedQuoteId=active?.financePreparedAt?active.id:active?.snapshot?.previousPreparedQuoteId??null,repricing=!!previousPreparedQuoteId&&active?.snapshot?.pricingVersion===2&&!active.snapshot.financeSourceQuoteId;
 ensure(repricing||!active?.financePreparedAt&&!active?.snapshot?.financeSourceQuoteId&&!['AWAITING_FINANCE','SWAP_RETURNED'].includes(change.status),409,'OFFLINE_SWAP_REPRICE_REQUIRED','实际安排涉及已确认资金，须另行核定净差并重新确认；当前不能复用旧资金安排');
 ensure(['DRAFT','REVIEW_PENDING','REVIEWED'].includes(change.status)||repricing&&['AWAITING_FINANCE','SWAP_RETURNED'].includes(change.status)||change.status==='AWAITING_CONFIRMATION'&&active?.status==='PUBLISHED'&&new Date(active.snapshot.expiresAt)<=at,409,'CHANGE_STATE','当前换车报价不可重出');
 ensure(change.revision===input.revision,409,'VERSION_CONFLICT','变更已更新，请刷新');
 ensure(!/待确认|待补齐|待填写|另行通知|\{\{|\}\}/.test(JSON.stringify(input)),400,'COMMERCIAL_INCOMPLETE','请逐单明确真实条款');
 const facts=await requireOfflineSwapFacts(tx,order,change,at,repricing),baseFunds=await financialContext(tx,order),money=repricing?await readOfflineSwapFunds(tx,order,change,previousPreparedQuoteId,active.revision+1):null,funds=money?{...baseFunds,rows:money.rows}:baseFunds;
 ensure(!funds.blockers.length,409,'FUNDS_UNCONFIRMED',funds.blockers.join('；'));
 if(repricing){assertOfflineSwapQuote(change,active);const original=active.snapshot.targetSource.product;ensure(input.targetListingId===original.listingId&&input.targetListingRevision===original.listingRevision&&input.targetSourceHash===original.sourceHash&&input.depositAmount===active.snapshot.depositAmount,409,'SWAP_REPRICE_SCOPE','本次实际日期重报须保持原目标商品及押金，只重新计算真实差额');}
 const listing=repricing?{vehicleId:active.snapshot.targetSource.vehicleId}:await tx.vehicleListing.findUnique({where:{id:input.targetListingId},select:{vehicleId:true}});ensure(listing,409,'GOODS_UNAVAILABLE','目标商品不存在');
 const previousHolds=await tx.vehicleHold.findMany({where:{changeId:change.id,status:'HELD'}});
 for(const vehicleId of [...new Set<string>([listing.vehicleId,...previousHolds.map((h:any)=>h.vehicleId)])].sort())await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${vehicleId} FOR UPDATE`;
 const source=repricing?structuredClone(active.snapshot.targetSource):await loadOfflineSwapTarget(tx,{targetListingId:input.targetListingId,targetListingRevision:input.targetListingRevision,targetSourceHash:input.targetSourceHash});
 ensure(source.vehicleId===listing.vehicleId,409,'GOODS_SOURCE_CHANGED','目标商品车辆来源已变化');
 await requireVehicleUnrestricted(tx,source.vehicleId,'ALLOCATION');
 const target=await tx.vehicle.findUnique({where:{id:source.vehicleId}}),held=target?.holdId?await tx.vehicleHold.findUnique({where:{id:target.holdId}}):null;
 ensure(target&&target.id!==facts.assignment.vehicleId&&target.status==='PUBLISHED'&&!target.reservedOrderId&&(!held||held.changeId===change.id&&held.status==='HELD'),409,'VEHICLE_UNAVAILABLE','目标车辆不可用或已被其它订单预留');
 const returned=new Date(input.plannedReturnAt),delivered=new Date(input.plannedDeliveryAt),expires=new Date(input.expiresAt);
 const completedReturn=repricing&&change.returnHandoverId?await tx.handover.findUnique({where:{id:change.returnHandoverId}}):null;
 if(completedReturn?.status==='COMPLETED')ensure(completedReturn.type==='SWAP_RETURN'&&completedReturn.changeId===change.id&&completedReturn.orderId===order.id&&completedReturn.customerId===order.customerId&&new Date(completedReturn.actualAt).getTime()===returned.getTime(),409,'PHYSICAL_FACT_IMMUTABLE','已经实际归还的原车时间不得被重报覆盖');
 ensure(returned>=facts.assignment.startAt&&delivered>=returned&&expires>at,400,'SWAP_DATES','计划日期顺序或有效期不正确');
 ensure(await tx.usagePeriod.count({where:{orderId:order.id,status:'SETTLED',effectiveEndDate:{gt:new Date(shanghaiDay(completedReturn?.status==='COMPLETED'?delivered:returned))}}})===0,409,'SETTLED_USAGE_IMMUTABLE','换车不可回溯已结算月份');
 const serviceStageScope=await readSwapStageScope(tx,order,funds.terms);
 if(serviceStageScope)ensure(shanghaiDay(returned)>=serviceStageScope.startDate,409,'SWAP_OUTSIDE_TERM','本次换车归还不得回填至已结束的原服务段');
 const calculated=quotePricing({...(serviceStageScope?{serviceStageScope}:{}),priorTermsVersionId:facts.chain.termsVersionId,priorTermsHash:change.priorTermsHash,originalStartDate:serviceStageScope?.startDate??(electronic?order.serviceAnchor?.firstStartDay:String(funds.terms.startDate).slice(0,10)),months:funds.terms.months,currentMonthlyFeeAmount:funds.terms.monthlyFeeAmount,target:source,deliveryAt:input.plannedDeliveryAt,currentPeriods:money?.baseRows??funds.rows});
 const range={startDate:calculated.pricing.deliveryDate,endDate:day(new Date(new Date(calculated.pricing.endDate).getTime()-86400000))};
 const targetLessorSnapshot=await (electronic?buildElectronicLessorSnapshot:buildOfflineLessorSnapshot)(tx,target.id,range),lessor=funds.terms.lessorSnapshot;
 ensure(lessor?.ownerId===targetLessorSnapshot.ownerId&&lessor.name===targetLessorSnapshot.name&&lessor.subjectType===targetLessorSnapshot.subjectType&&lessor.creditCode===targetLessorSnapshot.creditCode,409,'OWNER_SWAP_BINDING','换车仅限原合同同一实际出租方；更换主体须另行安排');
 const targetRevenueRuleSnapshot=await snapshotRevenueRule(tx,targetLessorSnapshot.ownerId,target.id,range.startDate,range.endDate);
 await readSwapCreditAvailability(tx,order,facts.account,change.id,delivered,target.id);
 const rows=calculated.periods.map(p=>{const current=funds.rows.find((r:any)=>r.sequence===p.sequence)!;return{...p,calculationBasis:`原服务月 ${p.startDate} 至 ${p.endDate}（结束日不含），本次升级差额 ${p.differenceAmount} 分`,netPaidAmount:current.netPaidAmount,carryAmount:Math.min(p.amount,current.netPaidAmount),chargeAmount:Math.max(0,p.amount-current.netPaidAmount),refundAmount:Math.max(0,current.netPaidAmount-p.amount)};});
 const deposits=await tx.payment.findMany({where:{customerId:order.customerId,status:'SUCCEEDED',bill:{orderId:order.id,type:{in:['DEPOSIT','DEPOSIT_ADJUSTMENT']}}},include:{refunds:true},orderBy:{id:'asc'}});
 const depositFunds=deposits.map((p:any)=>({id:p.id,amount:p.amount,net:p.amount-p.refunds.filter((r:any)=>r.status==='SUCCEEDED').reduce((n:number,r:any)=>n+r.amount,0)})),net=depositFunds.reduce((n:number,p:any)=>n+p.net,0);
 ensure(depositFunds.every((p:any)=>Number.isSafeInteger(p.net)&&p.net>=0)&&Number.isSafeInteger(net),409,'FUNDS_INCONSISTENT','押金收退须重新核账');
 const {revision:_,idempotencyKey:__,previewHash:___,...fields}=input,{pricingHash,...pricing}=calculated;
 const identity=(v:any)=>`${v.title}；VIN：${v.vin||'未登记'}；车牌：${v.plateNumber||'未登记'}；车况：${v.conditionDisclosure||'未披露'}`;
 const serviceFeeSource=electronic?await readSwapServiceFeeSource(tx,order,facts.account,change.id,delivered,target.id):null;
 const electronicTerms=electronic?freezeSwapTerms({orderId:order.id,customerId:order.customerId,changeId:change.id,priorTermsHash:change.priorTermsHash,originalAssignmentId:facts.assignment.id,ownerId:lessor.ownerId,targetOwnerId:targetLessorSnapshot.ownerId,originalVehicleId:facts.assignment.vehicleId,targetVehicleId:target.id,targetProduct:source.product,depositAmount:funds.terms.depositAmount,originalDepositAmount:funds.terms.depositAmount,currentMonthlyFeeAmount:funds.terms.monthlyFeeAmount,targetMonthlyFeeAmount:calculated.targetMonthlyFeeAmount,serviceFeeAmount:serviceFeeSource!.amount,serviceAnchor:order.serviceAnchor,startDate:calculated.pricing.startDate,months:funds.terms.months,periods:funds.rows.map((r:any)=>({sequence:r.sequence,startDate:r.startDate,endDate:r.endDate,dueDate:r.dueDate,amount:r.amount}))}):null;
 const snapshot={...fields,...(electronic?{executionMode:'ELECTRONIC',electronicTerms,serviceFeeSource}:{}),...(serviceStageScope?{serviceStageScope:structuredClone(serviceStageScope)}:{}),...(money?{previousPreparedQuoteId,previousQuoteId:active.id,preparedSources:money.sources,preparedSourceHash:money.sourceHash}:{}),targetVehicleId:target.id,newMonthlyFeeAmount:calculated.targetMonthlyFeeAmount,handoverFeeAmount:0,handoverFeeBasis:'本报价未另收交接费',financialGate:electronic?'BEFORE_DELIVERY':'BEFORE_RETURN',newStartDate:calculated.pricing.startDate,newEndDate:range.endDate,months:funds.terms.months,periods:rows,targetSource:source,pricing,pricingHash,targetLessorSnapshot,targetRevenueRuleSnapshot,originalArchiveVersionId:facts.chain.original.archiveVersionId,priorTermsVersionId:facts.chain.termsVersionId,originalAssignmentId:facts.assignment.id,oldVehicleIdentification:identity(facts.assignment.vehicle),targetVehicleIdentification:identity(target),targetVehicleTitle:target.title,affectedSequence:calculated.pricing.periods.find(p=>p.chargeDays>0)!.sequence,depositNetPaidAmount:net,depositChargeAmount:Math.max(0,input.depositAmount-net),depositRefundAmount:Math.max(0,net-input.depositAmount),depositFunds,document:null};

 const normalized=Object.fromEntries(Object.entries(input).filter(([key])=>!['idempotencyKey','previewHash'].includes(key)));
 const inputHash=canonicalHash(normalized);
 const sourceSnapshot={orderId:order.id,customerId:order.customerId,status:order.status,currentAssignmentId:order.currentAssignmentId,
  changeId:change.id,revision:change.revision,priorTermsHash:change.priorTermsHash,chain:facts.chain,
  assignment:{id:facts.assignment.id,revision:facts.assignment.revision??null,vehicleId:facts.assignment.vehicleId,startAt:facts.assignment.startAt,endAt:facts.assignment.endAt??null,startReadingKm:facts.assignment.startReadingKm,endReadingKm:facts.assignment.endReadingKm??null},
  qualification:{id:facts.qualification.id,revision:facts.qualification.revision,profileHash:facts.qualification.profileHash},
  target:{id:target.id,revision:target.revision,status:target.status,holdId:target.holdId??null,reservedOrderId:target.reservedOrderId??null},funds:funds.rows,snapshot};
 const sourceHash=canonicalHash(sourceSnapshot);
 // Order.revision is intentionally absent: the existing act command increments it itself.
 const previewHash=canonicalHash({version:1,changeId:change.id,revision:change.revision,inputHash,sourceHash});
 return{input,order,active,repricing,previousHolds,completedReturn,target,funds,snapshot,inputHash,sourceSnapshot,sourceHash,previewHash};
}

const {idempotencyKey:_key,previewHash:_preview,...previewFields}=offlineSwapQuoteInput.shape;
const {idempotencyKey:_electronicKey,previewHash:_electronicHash,...electronicPreviewFields}=electronicSwapQuoteInput.shape;
export const electronicSwapPreviewInput=z.object(electronicPreviewFields).strict();
export const strictElectronicSwapQuoteInput=z.object({...electronicSwapQuoteInput.shape,previewHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const offlineSwapPreviewInput=z.object(previewFields).strict();
export const strictOfflineSwapQuoteInput=z.object({...offlineSwapQuoteInput.shape,previewHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const offlineSwapPreviewId=z.string().trim().min(1).max(128).refine(v=>!v.includes('\0'));
const targetQuery=z.object({keyword:z.string().trim().max(100).refine(v=>!v.includes('\0')).default(''),page:z.coerce.number().int().min(1).max(2147483647).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20)}).strict().refine(v=>(v.page-1)*v.pageSize<=2147483647,'分页超出范围');
async function operatorChange(tx:any,id:string,actor:any){
 await requireCurrentStaff(tx,actor,'order-changes',false);ensure(['ADMIN','OPERATIONS'].includes(actor.role),403,'FORBIDDEN','仅当前运营可选车和编制报价');
 const change=await tx.orderChange.findUnique({where:{id:offlineSwapPreviewId.parse(id)}});ensure(change,404,'NOT_FOUND','换车草案不存在');ensure(change.kind==='VEHICLE_CHANGE',409,'CHANGE_KIND','仅换车草案支持目标商品与自动预览');return change;
}
function targetDto(product:any,vehicle:any){return{targetListingId:product.listingId,targetListingRevision:product.listingRevision,targetSourceHash:product.sourceHash,vehicle:{id:vehicle.id,title:vehicle.title,vin:vehicle.vin??null,plateNumber:vehicle.plateNumber??null},product:{id:product.productId,productVersionId:product.productVersionId,version:product.version,name:product.name,months:product.months,monthlyFeeAmount:product.monthlyFeeAmount}};}
export async function listOfflineSwapTargets(tx:any,id:string,raw:unknown,actor:any,at=new Date()){
 const change=await operatorChange(tx,id,actor),input=targetQuery.parse(raw),order=await tx.order.findUniqueOrThrow({where:{id:change.orderId}});
 await requireOfflineSwapFacts(tx,order,change,at,true);
 const ownedHolds=await tx.vehicleHold.findMany({where:{changeId:id,status:'HELD'}});
 const where={status:'PUBLISHED',visible:true,productVersion:{status:'PUBLISHED'},subscriptionPlan:{active:true},vehicle:{id:{not:order.vehicleId},status:'PUBLISHED',reservedOrderId:null,OR:[{holdId:null},...(ownedHolds.length?[{holdId:{in:ownedHolds.map((h:any)=>h.id)}}]:[])]},...(input.keyword?{OR:[{id:{contains:input.keyword,mode:'insensitive'}},{vehicle:{title:{contains:input.keyword,mode:'insensitive'}}},{vehicle:{vin:{contains:input.keyword,mode:'insensitive'}}},{vehicle:{plateNumber:{contains:input.keyword,mode:'insensitive'}}},{productVersion:{name:{contains:input.keyword,mode:'insensitive'}}}]}:{})};
 const [rows,total]=await Promise.all([tx.vehicleListing.findMany({where,include:{vehicle:true,subscriptionPlan:true,productVersion:{include:productVersionInclude}},skip:(input.page-1)*input.pageSize,take:input.pageSize,orderBy:[{sortOrder:'asc'},{id:'asc'}]}),tx.vehicleListing.count({where})]);
 return{items:rows.map((listing:any)=>targetDto(listedProductSnapshot({...listing.subscriptionPlan,listing,vehicle:listing.vehicle,productVersion:listing.productVersion}),listing.vehicle)),total,page:input.page,pageSize:input.pageSize};
}
export async function readOfflineSwapQuotePreview(tx:any,id:string,raw:unknown,actor:any,at=new Date()){
 const change=await operatorChange(tx,id,actor),order=await tx.order.findUniqueOrThrow({where:{id:change.orderId}}),input=order.contractMode==='ELECTRONIC'?electronicSwapPreviewInput.parse(raw):offlineSwapPreviewInput.parse(raw);
 const built=await buildOfflineSwapQuoteSource(tx,change,{...input,idempotencyKey:'read-only-preview'},actor,at),s=built.snapshot;
 return{changeId:change.id,revision:change.revision,orderId:change.orderId,inputHash:built.inputHash,sourceHash:built.sourceHash,previewHash:built.previewHash,pricingVersion:s.executionMode==='ELECTRONIC'?3:2,pricingHash:s.pricingHash,financialGate:s.financialGate,
 target:targetDto(s.targetSource.product,built.target),currentMonthlyFeeAmount:s.pricing.currentMonthlyFeeAmount,targetMonthlyFeeAmount:s.newMonthlyFeeAmount,...(s.serviceStageScope?{serviceStageScope:s.serviceStageScope}:{}),
 periods:s.periods,depositAmount:s.depositAmount,depositNetPaidAmount:s.depositNetPaidAmount,depositChargeAmount:s.depositChargeAmount,depositRefundAmount:s.depositRefundAmount,handoverFeeAmount:0};
}
