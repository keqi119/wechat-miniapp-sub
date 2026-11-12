import {z} from 'zod';
import {ensure} from '../common/errors';
import {canonicalHash} from '../customers/types';
import {readChangedTerminationContext} from './termination-chain';
const text=z.string().trim().min(1).max(3000),money=z.number().int().min(0).max(2147483647);
const deadline=(value:string)=>/\d{4}[-年/]\d{1,2}[-月/]\d{1,2}|(?:\d+|[一二三四五六七八九十]+)\s*(?:个)?(?:工作日|天|日|周|个月)(?:内|前|后)/.test(value);
export const terminationDetailsSchema=z.object({
 reasonType:z.enum(['CUSTOMER_REQUEST','PROVIDER_BREACH','MUTUAL_AGREEMENT','OTHER']),reason:text,effectiveAt:z.iso.datetime({offset:true}),
 plannedReturnAt:z.iso.datetime({offset:true}).optional(),returnPlace:z.string().trim().min(1).max(500).optional(),conditionSummary:text,
 violationStatus:z.enum(['NOT_APPLICABLE','NONE','SETTLED','PENDING']),violationSummary:text,
 additionalPaymentAmount:money,additionalPaymentDueOn:z.iso.date().optional(),refundAmount:money,refundDueOn:z.iso.date().optional(),
 retainedDepositAmount:money,retainedDepositHandling:text,settlementBasis:text,unresolvedMatters:text,
}).strict().superRefine((v,ctx)=>{
 if(v.additionalPaymentAmount>0&&!v.additionalPaymentDueOn)ctx.addIssue({code:'custom',path:['additionalPaymentDueOn'],message:'应补款不为零时须填写付款期限'});
 if(v.refundAmount>0&&!v.refundDueOn)ctx.addIssue({code:'custom',path:['refundDueOn'],message:'应退款不为零时须填写退款期限'});
 if(v.retainedDepositAmount>0&&!deadline(v.retainedDepositHandling))ctx.addIssue({code:'custom',path:['retainedDepositHandling'],message:'保留款须说明处理安排和具体期限（日期或几日内）'});
 if(v.violationStatus==='PENDING'&&!deadline(v.violationSummary))ctx.addIssue({code:'custom',path:['violationSummary'],message:'未处理违章须写明处理安排和具体期限（日期或几日内）'});
});
export type TerminationDetails=z.infer<typeof terminationDetailsSchema>;
type Original={archiveId:string;versionId:string;version:number;name:string;number:string;signedOn:string;businessSnapshotHash:string};
export type TerminationContext={
 originalContract:Original|null;
 amendments?:Array<Original&{termsVersionId:string;quoteId:string}>;
 effectiveTermsVersionId?:string;
 vehicle:{id:string;vin:string;identification:string}|null;
 relevantTerms:{earlyTerminationRule:string;depositRefundRule:string};
 delivery:{state:'UNKNOWN'|'NOT_DELIVERED'|'RETURNED'|'AWAITING_RETURN';deliveryId?:string;deliveredAt?:string;returnId?:string;returnedAt?:string;returnPlace?:string;readingKm?:number;source?:'PHYSICAL_RECEIPT'|'RETURN_HANDOVER'};
 funds:{receivedAmount:number;refundedAmount:number;netReceivedAmount:number;depositReceivedAmount:number;depositRefundedAmount:number};
 blockers:{code:string;message:string}[];
};
const iso=(v:unknown)=>v?new Date(v as string).toISOString():undefined;
const string=(v:unknown)=>typeof v==='string'?v:'';
async function completedReturnAssignment(tx:any,order:any,handovers:any[]){
 if(order.currentAssignmentId||!order.customerId||!['SETTLING','COMPLETED'].includes(order.status))return null;
 const scoped=(h:any)=>h.orderId===order.id&&h.customerId===order.customerId&&h.vehicleId===order.vehicleId&&h.status==='COMPLETED'&&h.actualAt&&h.completedAt;
 const returns=handovers.filter(h=>h.type==='RETURN'&&h.assignmentId&&scoped(h));if(returns.length!==1)return null;
 const returned=returns[0],where={id:returned.assignmentId,orderId:order.id,customerId:order.customerId,vehicleId:order.vehicleId,status:'CLOSED',returnHandoverId:returned.id};
 const assignment=await tx.vehicleAssignment.findFirst({where});
 if(!assignment||!Object.entries(where).every(([key,value])=>assignment[key]===value)||!assignment.endAt||new Date(assignment.endAt).getTime()!==new Date(returned.actualAt).getTime())return null;
 const delivered=handovers.find(h=>h.id===assignment.deliveryHandoverId&&h.type==='DELIVERY'&&h.assignmentId===assignment.id&&scoped(h));
 if(!delivered||new Date(assignment.startAt).getTime()!==new Date(delivered.actualAt).getTime())return null;
 return assignment;
}
/** Only same-order signed facts and frozen contract terms are eligible as the reference. */
export async function readTerminationContext(tx:any,order:any):Promise<TerminationContext>{
 const [rental,handovers,receipt,payments]=await Promise.all([
  tx.documentArchive.findFirst({where:{orderId:order.id,kind:'RENTAL'},include:{versions:{orderBy:{version:'desc'},include:{files:{select:{fileId:true}}}}}}),
  tx.handover.findMany({where:{orderId:order.id},orderBy:{createdAt:'desc'},select:{id:true,orderId:true,customerId:true,type:true,status:true,actualAt:true,completedAt:true,vehicleId:true,assignmentId:true,changeId:true,readingKm:true}}),
  tx.vehicleReceiptEvent.findFirst({where:{orderId:order.id,isCurrent:true},orderBy:{createdAt:'desc'}}),
  tx.payment.findMany({where:{bill:{orderId:order.id},status:'SUCCEEDED'},select:{amount:true,status:true,bill:{select:{type:true}},refunds:{select:{amount:true,status:true}}}}),
 ]);
 if(order.effectiveTermsVersionId)return readChangedTerminationContext(tx,order,{rental,handovers,receipt,payments});
 const signed=rental?.versions?.filter((v:any)=>['REVIEWED','ARCHIVED','INVALIDATED'].includes(v.status)&&v.files?.length&&(v.status!=='INVALIDATED'||v.reviewedBy&&v.reviewedAt)).sort((a:any,b:any)=>b.version-a.version)[0];
 const blockers:TerminationContext['blockers']=[];let originalContract:Original|null=null,originalSnapshot:any;
 if(signed){
  const template=await tx.legalDocument.findUnique({where:{id:signed.templateId},select:{title:true,type:true}});
  if(template?.type==='OFFLINE_RENTAL'&&template.title&&signed.contractNumber&&signed.signedOn)originalContract={archiveId:rental.id,versionId:signed.id,version:signed.version,name:template.title,number:signed.contractNumber,signedOn:signed.signedOn,businessSnapshotHash:signed.businessSnapshotHash};
  if(order.finalPlanSnapshot?.commercialHash===signed.businessSnapshotHash)originalSnapshot=order.finalPlanSnapshot;
  else originalSnapshot=(await tx.orderTermsVersion.findFirst({where:{orderId:order.id,hash:signed.businessSnapshotHash},select:{snapshot:true}}))?.snapshot;
 }
 if(!originalContract)blockers.push({code:'TERMINATION_ORIGINAL_REQUIRED',message:'请先补齐本单已签租赁合同的名称、编号、签署日期及签字版审核记录'});
 if(order.effectiveTermsVersionId){const effective=await tx.orderTermsVersion.findUnique({where:{id:order.effectiveTermsVersionId},select:{orderId:true,hash:true,snapshot:true}});if(effective?.orderId===order.id&&effective.hash!==signed?.businessSnapshotHash&&effective.snapshot?.amendmentContractId)blockers.push({code:'TERMINATION_AMENDMENT_REVIEW_REQUIRED',message:'本单存在已生效补充协议，请先核对原有效补充协议及其适用条款；不能仅套用原租赁合同生成终止协议'});}
 const relevantTerms={earlyTerminationRule:string(originalSnapshot?.commercialTerms?.earlyTerminationRule),depositRefundRule:string(originalSnapshot?.commercialTerms?.depositRefundRule)};
 if(!relevantTerms.earlyTerminationRule||!relevantTerms.depositRefundRule)blockers.push({code:'TERMINATION_ORIGINAL_TERMS_REQUIRED',message:'原已签合同冻结版本的提前终止或押金条款缺失，请核对原合同记录'});
 const identification=string(originalSnapshot?.commercialTerms?.vehicleIdentification),vin=identification.toUpperCase().match(/(?:VIN\s*[:：]\s*|\b)([A-HJ-NPR-Z0-9]{17})(?![A-Z0-9])/)?.[1]||'',originalVehicleId=string(signed?.scopeSnapshot?.vehicleId);
 const vehicle=originalVehicleId&&vin?{id:originalVehicleId,vin,identification}:null;
 if(!vehicle||vehicle.id!==order.vehicleId)blockers.push({code:'TERMINATION_VEHICLE_UNCONFIRMED',message:'请核对原已签合同冻结的车辆与VIN；当前车辆与原合同不一致或原记录不完整，不能套用当前车辆资料'});
 // Formal return clears currentAssignmentId; use only its fully bound closed history.
 const closedAssignment=await completedReturnAssignment(tx,order,handovers),assignmentId=order.currentAssignmentId||closedAssignment?.id||null;
 const matching=(h:any)=>closedAssignment?h.orderId===order.id&&h.vehicleId===order.vehicleId&&h.assignmentId===assignmentId&&(!h.customerId||h.customerId===order.customerId):(!h.vehicleId||h.vehicleId===order.vehicleId)&&(!h.assignmentId||h.assignmentId===assignmentId);
 const delivered=handovers.find((h:any)=>h.type==='DELIVERY'&&h.status==='COMPLETED'&&h.actualAt&&matching(h)),returned=handovers.find((h:any)=>h.type==='RETURN'&&h.status==='COMPLETED'&&h.actualAt&&matching(h));
 const receiptMatches=receipt&&matching(receipt)&&(!closedAssignment||receipt.handoverId===closedAssignment.returnHandoverId),hasActualFacts=!!receipt||handovers.some((h:any)=>h.actualAt||h.status==='COMPLETED');
 const beforeDelivery=['AWAITING_SIGNATURE','AWAITING_CONTRACT_REVIEW','AWAITING_PAYMENT','AWAITING_HANDOVER'].includes(order.status);
 const conflictingFacts=!!receipt&&!receiptMatches||handovers.some((h:any)=>(h.actualAt||h.status==='COMPLETED')&&!matching(h));
 const delivery:TerminationContext['delivery']=delivered&&!conflictingFacts?{state:'AWAITING_RETURN',deliveryId:delivered.id,deliveredAt:iso(delivered.actualAt)}:{state:beforeDelivery&&!hasActualFacts?'NOT_DELIVERED':'UNKNOWN'};
 if(delivery.state==='AWAITING_RETURN'&&(receiptMatches||returned))Object.assign(delivery,{state:'RETURNED',returnId:receipt?.id||returned.id,returnedAt:iso(receipt?.receivedAt||returned.actualAt),returnPlace:receipt?.storageLocation||undefined,readingKm:receipt?.readingKm??returned.readingKm,source:receipt?'PHYSICAL_RECEIPT':'RETURN_HANDOVER'});
 if(delivery.state==='UNKNOWN')blockers.push({code:'TERMINATION_DELIVERY_UNCONFIRMED',message:'车辆交付或收车记录尚未核实，不能认定未交付；请先核对实际交接事实'});
 const funds={receivedAmount:0,refundedAmount:0,netReceivedAmount:0,depositReceivedAmount:0,depositRefundedAmount:0};
 for(const p of payments){if(p.status!=='SUCCEEDED')continue;const refunded=p.refunds.filter((r:any)=>r.status==='SUCCEEDED').reduce((sum:number,r:any)=>sum+r.amount,0);funds.receivedAmount+=p.amount;funds.refundedAmount+=refunded;if(p.bill.type==='DEPOSIT'){funds.depositReceivedAmount+=p.amount;funds.depositRefundedAmount+=refunded;}}
 funds.netReceivedAmount=funds.receivedAmount-funds.refundedAmount;
 return{originalContract,vehicle,relevantTerms,delivery,funds,blockers};
}
/** Money is a dated reference; later payments/refunds must not invalidate a signed agreement. */
export const terminationSourceFactHash=(context:TerminationContext)=>canonicalHash({originalContract:context.originalContract,vehicle:context.vehicle,relevantTerms:context.relevantTerms,delivery:context.delivery,...(context.amendments?{amendments:context.amendments,effectiveTermsVersionId:context.effectiveTermsVersionId}: {})});
export function freezeTerminationPrintContext(context:TerminationContext){return{context:JSON.parse(JSON.stringify(context)) as TerminationContext,sourceFactHash:terminationSourceFactHash(context),capturedAt:new Date().toISOString()};}
export function assertTerminationPrintCurrent(archive:any,version:any,current:TerminationContext|undefined){
 if(archive.kind!=='TERMINATION')return;
 const printed=version.scopeSnapshot?.terminationPrintSnapshot;
 ensure(printed?.context&&printed.sourceFactHash&&current,409,'TERMINATION_SOURCE_REQUIRED',version.status==='SUBMITTED'?'该签字版缺少生成时资料，请先退回材料，再建立补正版本':version.status==='REVIEWED'?'该签字版缺少生成时资料，请建立补正版本':'请重新生成终止协议并确认打印内容');
 ensure(!current!.blockers.length&&printed.sourceFactHash===terminationSourceFactHash(printed.context)&&printed.sourceFactHash===terminationSourceFactHash(current!),409,'TERMINATION_SOURCE_CHANGED',version.status==='SUBMITTED'?'原合同、车辆或交接事实已变化，请先退回材料，再建立补正版本':version.status==='REVIEWED'?'原合同、车辆或交接事实已变化，请建立补正版本':'原合同、车辆或交接事实已变化，请重新生成并确认打印内容');
}
export function validateTerminationForPrint(raw:unknown,context:TerminationContext){
 const parsed=terminationDetailsSchema.safeParse(raw);ensure(parsed.success,400,'TERMINATION_DETAILS_REQUIRED',parsed.success?'':parsed.error.issues.map(i=>i.message).join('；'));
 ensure(context&&!context.blockers.length&&context.originalContract&&context.delivery.state!=='UNKNOWN',409,context?.blockers?.[0]?.code||'TERMINATION_ORIGINAL_REQUIRED',context?.blockers?.[0]?.message||'原已签合同资料尚未就绪');
 const details=parsed.data!;ensure(context.delivery.state!=='AWAITING_RETURN'||details.plannedReturnAt&&details.returnPlace,400,'TERMINATION_RETURN_PLAN_REQUIRED','车辆已交付但尚无收车事实，请填写计划交回时间和地点');
 return details;
}
export function terminationPrintSections(details:TerminationDetails,context:TerminationContext){
 const original=context.originalContract!,d=context.delivery,cash=(n:number)=>`${(n/100).toFixed(2)} 元`,time=(v?:string)=>v?new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'';
 const returnText=d.state==='NOT_DELIVERED'?'本单尚无正式车辆交付记录，未交付，无需办理还车或还车查验。':d.state==='RETURNED'?`${d.returnedAt?'实际收车时间：'+time(d.returnedAt):'实际收车时间未登记'}；${d.returnPlace?'地点：'+d.returnPlace+'；':''}${typeof d.readingKm==='number'?'实际收车里程：'+d.readingKm+' 公里；':''}依据：${d.source==='PHYSICAL_RECEIPT'?'实际收车记录':'已完成还车查验单'} ${d.returnId}。`:`计划交回时间：${time(details.plannedReturnAt)}；计划交回地点：${details.returnPlace}。此为交回安排，尚无实际收车记录。`;
 return[
  {title:'原合同与终止依据',rows:[{label:'原合同名称',value:original.name},{label:'原合同编号',value:original.number},{label:'原合同签署日期',value:original.signedOn},...(context.vehicle?[{label:context.amendments?.length?'当前适用车辆':'原合同车辆',value:context.vehicle.identification},{label:'VIN',value:context.vehicle.vin}]:[]),{label:'原合同提前终止条款',value:context.relevantTerms.earlyTerminationRule},{label:'原合同押金条款',value:context.relevantTerms.depositRefundRule}]},
  ...(context.amendments?.length?[{title:'已生效补充协议与当前车辆',rows:[...context.amendments.map(a=>({label:a.name,value:`编号：${a.number}；签署日期：${a.signedOn}；纸质归档第 ${a.version} 版`})),{label:'当前车辆',value:context.vehicle?.identification||''}]}]:[]),
  {title:'终止安排',rows:[{label:'终止原因类别',value:({CUSTOMER_REQUEST:'客户申请',PROVIDER_BREACH:'出租方或平台违约',MUTUAL_AGREEMENT:'各方协商一致',OTHER:'其他'} as const)[details.reasonType]},{label:'具体原因',value:details.reason},{label:'终止生效时间（北京时间）',value:time(details.effectiveAt)},{label:'车辆交回',value:returnText},{label:'车况与查验',value:d.state==='NOT_DELIVERED'?'未交付，无需还车查验。':details.conditionSummary},{label:'违章处理',value:({NOT_APPLICABLE:'不适用',NONE:'无待处理违章',SETTLED:'已处理',PENDING:'待处理'} as const)[details.violationStatus]+'；'+details.violationSummary}]},
  {title:'结算确认',rows:[{label:'客户应补款',value:cash(details.additionalPaymentAmount)+(details.additionalPaymentAmount?`；付款期限：${details.additionalPaymentDueOn}`:'')},{label:'应退客户款项',value:cash(details.refundAmount)+(details.refundAmount?`；退款期限：${details.refundDueOn}`:'')},{label:'暂保留押金',value:cash(details.retainedDepositAmount)+'；'+details.retainedDepositHandling},{label:'结算依据',value:details.settlementBasis},{label:'尚未解决事项',value:details.unresolvedMatters}]},
 ];
}
