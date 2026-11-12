import type {Prisma} from '@prisma/client';
import {allowed} from '../auth/role-policy';

export type WorkbenchQueue={
 key:string;module:'vehicles'|'customers'|'partners'|'insurance'|'products'|'orders'|'contracts';
 title:string;count:number;ownerRole:'OPERATIONS'|'FINANCE'|'SUPPORT';ownerLabel:string;
 resource:string;href:string;instruction:string;
};
export type WorkbenchSummary={checkedAt:string;queues:WorkbenchQueue[]};
type QueueDefinition=Omit<WorkbenchQueue,'count'|'ownerLabel'>&{count:()=>Promise<number>};
type SummaryDb=Pick<Prisma.TransactionClient,'vehicle'|'customerQualificationVersion'|'application'|'partnerIdentityBinding'|'partnerVerification'|'partnerVehicleBindingProposal'|'ownerVehicle'|'archiveVersion'|'archiveFeedback'|'insurancePolicyVersion'|'insuranceRenewalReminder'|'productVersion'|'payment'|'partnerRevenueRuleVersion'|'partnerAccountVersion'|'partnerSettlement'|'refund'|'handover'|'serviceRequest'>;
const pending=(rows:{status:string}[])=>rows.filter(row=>row.status==='SUBMITTED').length;
const ownerLabels={OPERATIONS:'运营',FINANCE:'财务',SUPPORT:'客服／运营'} as const;

/** Counts and static guidance only. Role filtering precedes every query; GET never creates a task. */
export async function buildWorkbenchSummary(db:SummaryDb,role:string,at:Date=new Date()):Promise<WorkbenchSummary>{
 if(!Number.isFinite(at.getTime()))throw new Error('WORKBENCH_TIME_INVALID');
 if(!allowed(role,'dashboard',false))return{checkedAt:at.toISOString(),queues:[]};
 const queues:QueueDefinition[]=[
  {key:'vehicle-drafts',module:'vehicles',title:'车辆资料待完善',ownerRole:'OPERATIONS',resource:'vehicles',href:'#vehicles?status=DRAFT',instruction:'补齐 VIN、车况和照片，并核对权属、产品及保障后再上架。',count:()=>db.vehicle.count({where:{status:'DRAFT'}})},
  {key:'customer-qualification',module:'customers',title:'客户资格待复核',ownerRole:'OPERATIONS',resource:'customers',href:'#customers',instruction:'进入客户档案核验当前身份和驾驶资格；管理员可核验普通资料并留痕，其他经办人员须交由另一有权限人员复核。',count:async()=>pending(await db.customerQualificationVersion.findMany({distinct:['customerId'],orderBy:[{customerId:'asc'},{revision:'desc'}],select:{customerId:true,status:true}}))},
  {key:'risk-applications',module:'customers',title:'申请与风控待处理',ownerRole:'OPERATIONS',resource:'applications',href:'#customer-risk',instruction:'先核对资格与本次申请，再生成候选并审核；未审核方案不能交客户确认。',count:()=>db.application.count({where:{status:{in:['SUBMITTED','IN_REVIEW']}}})},
  {key:'partner-identity',module:'partners',title:'本人／经办关系待复核',ownerRole:'OPERATIONS',resource:'partners',href:'#partners',instruction:'核对本人或企业经办关系及原件；登录成功或收到邀请码不等于准入通过。',count:()=>db.partnerIdentityBinding.count({where:{status:'SUBMITTED',revokedAt:null}})},
  {key:'partner-admission',module:'partners',title:'合作商准入待复核',ownerRole:'OPERATIONS',resource:'partners',href:'#partners',instruction:'选择合作商的最新准入申请，核对主体与权属材料，按岗位权限审核；管理员可审核普通资料。',count:async()=>pending(await db.partnerVerification.findMany({distinct:['ownerId'],orderBy:[{ownerId:'asc'},{revision:'desc'}],select:{ownerId:true,status:true}}))},
  {key:'vehicle-binding',module:'vehicles',title:'车辆权属待复核',ownerRole:'OPERATIONS',resource:'partners',href:'#partners',instruction:'核验当前车辆权属申请；被占用或未结束订单的车辆不能直接转绑。',count:async()=>{
   const [proposals,bindings]=await Promise.all([db.partnerVehicleBindingProposal.findMany({where:{status:'SUBMITTED'},select:{vehicleId:true,bindingRevision:true}}),db.ownerVehicle.findMany({select:{vehicleId:true,revision:true}})]);
   const current=new Map(bindings.map(binding=>[binding.vehicleId,binding.revision]));return proposals.filter(p=>p.bindingRevision===(current.get(p.vehicleId)??0)).length;
  }},
  {key:'contract-review',module:'contracts',title:role==='ADMIN'?'线下资料待审核':'线下资料待独立复核',ownerRole:'OPERATIONS',resource:'offline-archives',href:'#offline-archives?status=SUBMITTED',instruction:'核对当前版本、全部必签方、页序及签章；上传成功不等于已签或已归档。',count:()=>db.archiveVersion.count({where:{status:'SUBMITTED'}})},
  {key:'contract-feedback',module:'contracts',title:'合同资料反馈待处理',ownerRole:'OPERATIONS',resource:'offline-archives',href:'#offline-archives',instruction:'进入对应档案核实反馈、补齐资料并留痕关闭；未处理反馈可能阻断付款或履约。',count:()=>db.archiveFeedback.count({where:{status:'OPEN'}})},
  {key:'insurance-review',module:'insurance',title:role==='ADMIN'?'保单待审核':'保单待独立复核',ownerRole:'OPERATIONS',resource:'insurance-policies',href:'#insurance',instruction:'逐车核对险种、有效期和保单原件；退保及批改按当前版本办理。',count:()=>db.insurancePolicyVersion.count({where:{status:'SUBMITTED'}})},
  ...([30,7,0] as const).map(thresholdDays=>({key:`insurance-renewal-${thresholdDays}`,module:'insurance' as const,title:thresholdDays===0?'保单到期待处理':`保单 ${thresholdDays} 天续保提醒`,ownerRole:'OPERATIONS' as const,resource:'insurance-policies',href:'#insurance-renewals',instruction:'查看已到提醒时间的未处理事项，核对续保与车辆范围；不因旧保单存在而跳过交车保障校验。',count:()=>db.insuranceRenewalReminder.count({where:{status:'OPEN',thresholdDays,dueAt:{lte:at}}})})),
  {key:'product-drafts',module:'products',title:'产品草稿待核对发布',ownerRole:'OPERATIONS',resource:'products',href:'#products',instruction:'核对范围、价格、期限和权益版本；历史说明型权益不自动换算为服务次数。',count:()=>db.productVersion.count({where:{status:'DRAFT'}})},
  {key:'handover-review',module:'orders',title:'交还车待办理',ownerRole:'OPERATIONS',resource:'handovers',href:'#handovers',instruction:'逐项核对现场查验、客户确认、纸质单和款项；实际收车记录不等于正式还车完成。',count:()=>db.handover.count({where:{status:{in:['DRAFT','PUBLISHED','CUSTOMER_CONFIRMED','OBJECTION_SUBMITTED']}}})},
  {key:'payment-exceptions',module:'orders',title:'到账异常待核对',ownerRole:'FINANCE',resource:'payments',href:'#payments?reconciliationRequired=true',instruction:'先核对原账单、金额、交易与退款，再交另一财务人员复核；未核对到账不能用于交车。',count:()=>db.payment.count({where:{reconciliationRequired:true}})},
  {key:'revenue-rule-review',module:'partners',title:'分润约定待复核',ownerRole:'FINANCE',resource:'partner-revenue-rules',href:'#partner-rules',instruction:'核对当前合作协议、适用期间、来源口径和退款约定；系统不自动计算实付。',count:async()=>pending(await db.partnerRevenueRuleVersion.findMany({distinct:['ruleId'],orderBy:[{ruleId:'asc'},{version:'desc'}],select:{ruleId:true,status:true}}))},
  {key:'partner-account-review',module:'partners',title:'收款账户待复核',ownerRole:'FINANCE',resource:'partner-settlements',href:'#partner-settlements',instruction:'核对最新账户版本与主体证明；新账户不能替换已冻结结算中的收款对象。',count:async()=>pending(await db.partnerAccountVersion.findMany({distinct:['ownerId'],orderBy:[{ownerId:'asc'},{version:'desc'}],select:{ownerId:true,status:true}}))},
  {key:'settlement-review',module:'partners',title:'人工结算待复核',ownerRole:'FINANCE',resource:'partner-settlements',href:'#partner-settlements',instruction:'逐行核对实收来源、已使用份额及人工应付；编制人与提交人不能复核本人结算。',count:()=>db.partnerSettlement.count({where:{status:'SUBMITTED'}})},
  {key:'settlement-payment-review',module:'partners',title:'实付登记待核对',ownerRole:'FINANCE',resource:'partner-settlements',href:'#partner-settlements',instruction:'另一财务人员核对真实付款依据；登记凭证不等于已经核对完成或系统向银行付款。',count:()=>db.partnerSettlement.count({where:{status:'PAYMENT_RECORDED'}})},
  {key:'refund-review',module:'orders',title:'退款待独立审批',ownerRole:'FINANCE',resource:'refunds',href:'#refunds?status=PENDING_APPROVAL',instruction:'核对退款范围和资金事实，由不同于申请人的员工审批；未知结果先查证原交易。',count:()=>db.refund.count({where:{status:'PENDING_APPROVAL'}})},
  {key:'service-intake',module:'orders',title:'客户服务待受理',ownerRole:'SUPPORT',resource:'services',href:'#services?status=SUBMITTED',instruction:'核对本单服务需求并联络派单；次数权益的最终完成或取消由运营办理。',count:()=>db.serviceRequest.count({where:{status:'SUBMITTED'}})}
 ];
 const visible=queues.filter(q=>(role==='ADMIN'||role===q.ownerRole||(role==='OPERATIONS'&&q.ownerRole==='SUPPORT'))&&allowed(role,q.resource,false)&&allowed(role,q.resource,true));
 return{checkedAt:at.toISOString(),queues:await Promise.all(visible.map(async({count,...queue})=>({...queue,ownerLabel:ownerLabels[queue.ownerRole],count:await count()})))};
}
