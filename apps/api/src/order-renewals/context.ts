import {validTermMonths} from '../service-calendar/rules';
import {HttpException} from '@nestjs/common';
import {ensure} from '../common/errors';
import {hash} from '../common/data';
import {canonicalHash} from '../customers/types';
import {listedProductSnapshot,snapshotProduct} from '../products/snapshot';
import {productVersionInclude} from '../products/types';
import {requireOfflineSwapFacts} from '../vehicle-changes/offline-facts';
import {readServiceStageAt} from '../order-service-stages/readiness';
import {prepareInitialServiceStageSnapshot} from '../order-service-stages/initial';
import {stageDay,stagePeriods} from '../order-service-stages/source';
import {buildOfflineLessorSnapshot,lessorIdentityHash} from '../owner-signing/lessor';
import {buildElectronicLessorSnapshot,assertAgreedFeeComponents} from '../electronic-documents/initial-terms';
import {readRevenueRuleSnapshot} from '../partners/revenue-rules';
import {snapshotUsagePolicy} from '../usage/policy';
import {freezeUsagePricing} from '../usage/pricing';
import {freezeSwapPolicy} from '../swap-purchases/policy';
import {coverageAt} from '../insurance/coverage';
import {shanghaiDay} from '../usage/rules';
import {renewalGoodsQuery,renewalId,renewalPreviewInput,type RenewalPreviewInput} from './types';
import {RENEWAL_CANCELLATION_TERMS,renewalCancellationTerms} from './cancellation-policy';
const terminal=['APPLIED','CANCELLED','REJECTED'];
const cents=(v:any)=>Number.isSafeInteger(v)&&v>=0&&v<=2147483647;
const clean=(v:any)=>JSON.parse(JSON.stringify(v));

/** Shared domain reads only; caller is responsible for current actor authorization. */
export async function renewalFacts(tx:any,orderId:string,now:Date,changeId?:string){
 renewalId.parse(orderId);const order=await tx.order.findUnique({where:{id:orderId}});ensure(order,404,'NOT_FOUND','订单不存在');
 const facts=await requireOfflineSwapFacts(tx,order,undefined,now),{assignment,account,terms,chain}=facts,vehicle=await tx.vehicle.findUnique({where:{id:order.vehicleId}});
 ensure(vehicle?.id===assignment.vehicleId&&vehicle.status==='IN_USE'&&vehicle.reservedOrderId===order.id&&!vehicle.holdId&&assignment.status==='ACTIVE'&&!assignment.returnHandoverId&&!assignment.endAt,409,'RENEWAL_VEHICLE_SOURCE','续期须为本单仍在用的同一辆实际车辆');
 ensure(!await tx.handover.count({where:{orderId,type:'RETURN',status:{not:'SUPERSEDED'}}}),409,'RENEWAL_RETURN_PENDING','已有最终归还事实或办理，请先核对');
 ensure(cents(terms.monthlyFeeAmount)&&terms.monthlyFeeAmount>0&&cents(terms.depositAmount)&&terms.depositAmount===order.finalPlanSnapshot?.depositAmount&&terms.lessorSnapshot?.vehicleId===vehicle.id&&(!terms.vehicleId||terms.vehicleId===vehicle.id),409,'RENEWAL_TERMS_SOURCE','有效月费、押金或车辆来源不完整');
 const rows=await tx.orderServiceStage.findMany({where:{orderId},orderBy:{sequence:'asc'}});
 ensure(!rows.some((s:any)=>['PREPARED','SCHEDULED'].includes(s.status)),409,'RENEWAL_FUTURE_EXISTS','已有已准备的未来租期');
 const candidate=rows.length?null:await prepareInitialServiceStageSnapshot(tx,order);
 const current=rows.length?await readServiceStageAt(tx,order,shanghaiDay(now)):{stage:null,snapshot:candidate};
 const snapshot=current.snapshot;ensure(snapshot&&snapshot.period.startDate<=shanghaiDay(now)&&shanghaiDay(now)<snapshot.period.endDate,409,'RENEWAL_WINDOW_CLOSED','原服务期已结束，不能补签新的续期报价');
 const pending=await tx.orderChange.findMany({where:{orderId,status:{notIn:terminal},...(changeId?{id:{not:changeId}}:{})}});
 ensure(pending.length===0,409,'RENEWAL_CHANGE_EXISTS','已有未完成变更或未来续期');
 return{...facts,order,vehicle,current:{...current,snapshot},initialCandidate:candidate,stageRows:rows};
}

async function resumedDraft(tx:any,orderId:string,changeId:string|undefined,now:Date){
 if(changeId===undefined)return;
 const change=await tx.orderChange.findUnique({where:{id:renewalId.parse(changeId)}});ensure(change?.kind==='SUBSCRIPTION_EXTENSION'&&change.orderId===orderId,404,'NOT_FOUND','本订单续期草案不存在');
 const quote=change.activeQuoteId?await tx.delayQuote.findUnique({where:{id:change.activeQuoteId}}):null;
 ensure(['DRAFT','REVIEW_PENDING','REVIEWED'].includes(change.status)||change.status==='AWAITING_CONFIRMATION'&&quote?.changeId===change.id&&quote.status==='PUBLISHED'&&new Date(quote.snapshot?.expiresAt).getTime()<=now.getTime(),409,'RENEWAL_REQUOTE_BLOCKED','仅未确认草案或已过期报价可重新选择商品');
}
export async function renewalContext(tx:any,orderId:string,now:Date,changeId?:string){
 await resumedDraft(tx,orderId,changeId,now);
 try{const f=await renewalFacts(tx,orderId,now,changeId);return{orderId,...(changeId?{changeId}:{}),orderRevision:f.order.revision,accountRevision:f.account.revision,priorTermsHash:hash(f.terms),vehicle:{id:f.vehicle.id,title:f.vehicle.title,vin:f.vehicle.vin??null,plateNumber:f.vehicle.plateNumber??null},assignmentId:f.assignment.id,currentStage:{id:f.current.stage?.id??null,candidateId:f.initialCandidate?.identity.serviceStageId??null,kind:f.current.snapshot.kind,startDate:f.current.snapshot.period.startDate,endDate:f.current.snapshot.period.endDate,months:f.current.snapshot.period.months,monthlyFeeAmount:f.terms.monthlyFeeAmount,usagePricing:f.current.snapshot.usagePricing},depositAmount:f.terms.depositAmount,cancellationTerms:renewalCancellationTerms(f.order.contractMode),eligible:true,canCreate:!changeId,blockers:[]};}
 catch(error){if(error instanceof HttpException&&error.getStatus()===409)return{orderId,eligible:false,blockers:[(error.getResponse() as any).error?.code||'RENEWAL_SOURCE_REQUIRED']};throw error;}
}

export async function renewalGoods(tx:any,orderId:string,raw:unknown,now:Date,changeId?:string){
 await resumedDraft(tx,orderId,changeId,now);
 const query=renewalGoodsQuery.parse(raw),f=await renewalFacts(tx,orderId,now,changeId),where={vehicleId:f.vehicle.id,status:'PUBLISHED',visible:true,subscriptionPlan:{active:true},productVersion:{status:'PUBLISHED',configurationVersion:2,...(query.keyword?{name:{contains:query.keyword}}:{})}};
 const [rows,total]=await Promise.all([tx.vehicleListing.findMany({where,skip:(query.page-1)*query.pageSize,take:query.pageSize,orderBy:[{createdAt:'desc'},{id:'asc'}],include:{subscriptionPlan:{include:{vehicle:true,productVersion:{include:productVersionInclude}}}}}),tx.vehicleListing.count({where})]);
 const items=rows.map((listing:any)=>{ensure(listing.vehicleId===f.vehicle.id,409,'GOODS_SOURCE_MISMATCH','商品车辆来源不一致');const p=listedProductSnapshot({...listing.subscriptionPlan,listing});return{listingId:p.listingId,listingRevision:p.listingRevision,sourceHash:p.sourceHash,productVersionId:p.productVersionId,name:p.name,months:p.months,monthlyFeeAmount:p.monthlyFeeAmount,mileagePerMonthKm:p.mileagePerMonthKm,excessMileagePriceAmount:p.excessMileagePriceAmount,swapPolicy:(p as any).swapPolicy,unsupportedBenefits:p.benefits.filter(b=>b.kind==='COUNT').map(b=>b.name)};});
 return{items,total,page:query.page,pageSize:query.pageSize};
}

/** Short read-only transaction. Order precedes the existing lessor builder's Vehicle/Owner locks. */
export async function buildRenewalPreview(tx:any,orderId:string,raw:unknown,now:Date,changeId?:string){
 const input={...renewalPreviewInput.parse(raw),cancellationTerms:RENEWAL_CANCELLATION_TERMS};await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${orderId} FOR UPDATE`;
 const f=await renewalFacts(tx,orderId,now,changeId);input.cancellationTerms=renewalCancellationTerms(f.order.contractMode);
 ensure(input.orderRevision===f.order.revision&&input.accountRevision===f.account.revision,409,'VERSION_CONFLICT','订单或用量账户已变化，请重新预览');
 ensure(new Date(input.expiresAt)>now,400,'QUOTE_EXPIRED','报价有效期须晚于当前时间');
 const listing=await tx.vehicleListing.findUnique({where:{id:input.listingId}});ensure(listing?.vehicleId===f.vehicle.id,409,'GOODS_SOURCE_MISMATCH','只能选择本单实际在用车辆的商品');
 const product=await snapshotProduct(tx,listing.subscriptionPlanId);
 ensure(product.listingId===input.listingId&&product.listingRevision===input.listingRevision&&product.productVersionId===input.productVersionId&&product.sourceHash===input.listingSourceHash,409,'GOODS_SOURCE_CHANGED','商品来源版本已变化，请重新选择');
 ensure(product.configurationVersion===2&&validTermMonths(product.months,product.minimumTermMonths)&&cents(product.monthlyFeeAmount)&&product.monthlyFeeAmount>0,409,'RENEWAL_PRODUCT_REQUIRED','续期须选择明确月费、里程及合同期权益的已发布产品');
 ensure(!product.benefits.some(b=>b.kind==='COUNT'),409,'RENEWAL_COUNT_BENEFIT_UNSUPPORTED','此商品含尚未定义跨租期规则的计次权益，请先核对');
 const max=await Promise.all([tx.usagePeriod.aggregate({where:{orderId},_max:{sequence:true}}),tx.bill.aggregate({where:{orderId,type:'SUBSCRIPTION'},_max:{sequence:true}}),tx.serviceObligation.aggregate({where:{orderId},_max:{sequence:true}})]);
 const first=Math.max(f.current.snapshot.period.lastPeriodSequence,...f.stageRows.map((s:any)=>s.lastPeriodSequence),...max.map(r=>r._max.sequence??0))+1;
 const startDate=f.current.snapshot.period.endDate,periods=stagePeriods(startDate,product.months,first,product.monthlyFeeAmount,f.order.serviceAnchor??undefined),endDate=periods.at(-1)!.endDate,inclusiveEnd=stageDay(new Date(new Date(endDate+'T00:00:00Z').getTime()-86400000));
 const electronic=f.order.contractMode==='ELECTRONIC';
 const lessor=await (electronic?buildElectronicLessorSnapshot:buildOfflineLessorSnapshot)(tx,f.vehicle.id,{startDate,endDate:inclusiveEnd}),prior=f.terms.lessorSnapshot;
 ensure(lessor.ownerId===prior.ownerId&&lessor.name===prior.name&&lessor.subjectType===prior.subjectType&&lessor.creditCode===prior.creditCode,409,'OWNER_LESSOR_CHANGED','续期须保持原已确认实际出租方');
 const revenue=await readRevenueRuleSnapshot(tx,lessor.ownerId,f.vehicle.id,startDate,inclusiveEnd),policy=await snapshotUsagePolicy(tx,product);
 const nextStageSequence=Math.max(...f.stageRows.map((s:any)=>s.sequence),f.current.snapshot.identity.sequence)+1,serviceStageId=renewalId.parse(`renewal:${orderId}:${nextStageSequence}`);
 ensure(Number.isInteger(nextStageSequence)&&nextStageSequence<=2147483647,409,'RENEWAL_SEQUENCE_RANGE','续期序号超出有效范围');
 const renewalTerms=clean({...f.terms,...(f.order.serviceAnchor?{serviceAnchor:structuredClone(f.order.serviceAnchor)}:{}),serviceStageId,startDate,months:product.months,monthlyFeeAmount:product.monthlyFeeAmount,depositAmount:f.terms.depositAmount,mileagePerMonthKm:product.mileagePerMonthKm,excessMileagePriceAmount:product.excessMileagePriceAmount,energyDescription:product.energyDescription,conditions:product.conditions,productSnapshot:product,currentVehicleProductSnapshot:product,usagePolicyVersion:policy.policyVersion,usagePolicy:policy,lessorSnapshot:lessor,revenueRuleSnapshot:revenue,vehicleId:f.vehicle.id,billingSchedule:periods,monthlyAmounts:periods.map(p=>p.amount)});
 delete renewalTerms.quoteId; // Real renewal quote identity belongs to the stage/terms FK, never an inherited swap quote.
 if(electronic){renewalTerms.agreedFeeComponents=assertAgreedFeeComponents(product,{monthlyFeeAmount:product.monthlyFeeAmount});delete renewalTerms.priceAdjustmentReason;}
 const usagePricing=freezeUsagePricing(renewalTerms),swapPolicy=freezeSwapPolicy({finalPlanSnapshot:renewalTerms});ensure(swapPolicy,409,'RENEWAL_PRODUCT_REQUIRED','续期合同期换车政策缺失');
 const currentCoverage=await coverageAt(tx,f.vehicle.id,product.productVersionId,now);ensure(currentCoverage.ready,409,currentCoverage.blockers[0]?.code||'INSURANCE_COVERAGE_REQUIRED','当前车辆保障未就绪');
 const futureCoverage=await coverageAt(tx,f.vehicle.id,product.productVersionId,new Date(startDate+'T00:00:00+08:00'));
 const rental=await tx.documentArchive.findUnique({where:{id:f.chain.original.archiveId},include:{versions:true}}),original=rental?.versions.find((v:any)=>v.id===f.chain.original.archiveVersionId);ensure(original&&/^[a-f0-9]{64}$/.test(original.fileManifestHash)&&original.contractNumber,409,'AGREEMENT_ORIGINAL_ARCHIVE_MISMATCH','原签字件来源不完整');
 const total=BigInt(product.monthlyFeeAmount)*BigInt(product.months);ensure(total<=BigInt(Number.MAX_SAFE_INTEGER),409,'AMOUNT_OVERFLOW','总金额超出安全整数范围');
 const source=clean({version:1,orderId,customerId:f.order.customerId,orderRevision:f.order.revision,accountId:f.account.id,accountRevision:f.account.revision,currentStageId:f.current.snapshot.identity.serviceStageId,currentStageHash:canonicalHash(f.current.snapshot),initialCandidate:!!f.initialCandidate,nextStageSequence:Math.max(...f.stageRows.map((s:any)=>s.sequence),f.current.snapshot.identity.sequence)+1,assignmentId:f.assignment.id,vehicleId:f.vehicle.id,vehicleRevision:f.vehicle.revision,ownerId:lessor.ownerId,originalContractId:f.chain.original.contractId,originalArchiveVersionId:f.chain.original.archiveVersionId,originalArchiveHash:original.fileManifestHash,originalContractNumber:original.contractNumber,priorTermsVersionId:f.chain.termsVersionId,priorTermsHash:hash(f.terms),qualificationId:f.qualification.id,qualificationRevision:f.qualification.revision,listingId:product.listingId,listingRevision:product.listingRevision,listingSourceHash:product.sourceHash,productVersionId:product.productVersionId,subscriptionPlanId:listing.subscriptionPlanId,lessorHash:lessorIdentityHash(lessor),revenueHash:canonicalHash(revenue),currentCoverage,futureCoverage});
 const value={kind:'SUBSCRIPTION_EXTENSION' as const,...(electronic?{executionMode:'ELECTRONIC' as const}:{}),startDate,endDate,newStartDate:startDate,newEndDate:inclusiveEnd,expiresAt:input.expiresAt,originalAssignmentId:f.assignment.id,originalArchiveVersionId:source.originalArchiveVersionId,priorTermsVersionId:source.priorTermsVersionId,months:product.months,monthlyFeeAmount:product.monthlyFeeAmount,depositAmount:f.terms.depositAmount,totalAmount:Number(total),periods,usagePricing,swapPolicy,product,renewalTerms,source,input};
 return{facts:f,value,previewHash:canonicalHash(value)};
}
export async function previewRenewal(tx:any,orderId:string,input:RenewalPreviewInput,now:Date,changeId?:string){const p=await buildRenewalPreview(tx,orderId,input,now,changeId);return publicRenewalPreview(p.value,p.previewHash);}
export function publicRenewalPreview(value:any,previewHash:string){return{cancellationTerms:value.input.cancellationTerms,kind:value.kind,startDate:value.startDate,endDate:value.endDate,months:value.months,monthlyFeeAmount:value.monthlyFeeAmount,depositAmount:value.depositAmount,totalAmount:value.totalAmount,periods:value.periods,usagePricing:{policyVersion:value.usagePricing.policyVersion,baseAllowanceKm:value.usagePricing.baseAllowanceKm,excessPriceAmount:value.usagePricing.excessPriceAmount},swapPolicy:{policyVersion:value.swapPolicy.policyVersion,includedCount:value.swapPolicy.includedCount,extraFeeAmount:value.swapPolicy.extraFeeAmount},listingId:value.product.listingId,listingRevision:value.product.listingRevision,productVersionId:value.product.productVersionId,listingSourceHash:value.product.sourceHash,lessor:{ownerId:value.renewalTerms.lessorSnapshot.ownerId,name:value.renewalTerms.lessorSnapshot.name,subjectType:value.renewalTerms.lessorSnapshot.subjectType,creditCode:value.renewalTerms.lessorSnapshot.creditCode},lessorHash:value.source.lessorHash,noticeHash:value.renewalTerms.lessorSnapshot.sharingNotice.contentHash,sharingNotice:value.renewalTerms.lessorSnapshot.sharingNotice,coverage:{currentReady:value.source.currentCoverage.ready,futureReady:value.source.futureCoverage.ready,futureBlockers:value.source.futureCoverage.blockers.map((b:any)=>b.code)},previewHash};}

