import {allowed} from '../auth/role-policy';
import {archiveSummary} from '../offline-documents/projection';
import {withBillPublication} from '../billing/publication-view';
import {receiptState} from '../billing/receipt-state';
import {cancellationBlockers,cancellableOrderStates,type CancellationFacts,type CancellationBlocker} from './cancellation-facts';

export type CancellationStepKey='EVIDENCE'|'TERMINATION'|'FUNDS'|'CONFIRM'|'RESULT';
export type CancellationActionKey='SUBMIT_CANCELLATION_REVIEW'|'REVIEW_CANCELLATION_EVIDENCE'|'CREATE_ARCHIVE'|'OPEN_ARCHIVE'|'OPEN_PAYMENT'|'OPEN_BILL'|'REQUEST_REFUND'|'REVIEW_REFUND'|'SYNC_REFUND'|'OPEN_CHANGE'|'OPEN_VEHICLE'|'OPEN_CONTRACT'|'OPEN_HANDOVER'|'OPEN_TASK'|'CANCEL_ORDER'|'OPEN_RETURN'|'OPEN_SETTLEMENT';
export type CancellationAction={key:CancellationActionKey;label:string;kind:'OPEN_DETAIL'|'OPEN_FORM'|'WAIT'|'REFRESH';target:{resource:string;id?:string;section?:string;orderId:string};enabled:boolean;disabledReason?:string;expectedRevision?:number};
type State='DONE'|'CURRENT'|'BLOCKED'|'WAITING'|'NOT_APPLICABLE'|'UNKNOWN';
export type CancellationCheck={code:string;label:string;state:State;description:string;ownerLabel:string;action?:CancellationAction};
export type CancellationStep={key:CancellationStepKey;label:string;state:State;summary:string;checks:CancellationCheck[];actions:CancellationAction[]};
export type CancellationReadiness={version:1;orderId:string;orderRevision:number;orderStatus:string;observedAt:string;mode:'PRE_DELIVERY_CANCEL'|'POST_DELIVERY_RETURN'|'TERMINAL';canCancel:boolean;currentStep:CancellationStepKey;steps:CancellationStep[];blockers:CancellationCheck[];attention:CancellationCheck[];actions:CancellationAction[];signing:{paperStatus:'SIGNED'|'UNSIGNED'|'UNKNOWN';source:'ARCHIVE'|'CONFIRMATION'|'UNCONFIRMED'};related:{review:Record<string,any>|null;terminationArchive:Record<string,any>|null;bills:Record<string,any>[];payments:Record<string,any>[];refunds:Record<string,any>[];tasks:Record<string,any>[];changes:Record<string,any>[]};effects:string[]};
const labels:Record<string,string>={CANCELLATION_REVIEW_REQUIRED:'实际签署情况待确认',PAPER_STATUS_UNKNOWN:'纸质签署情况尚未明确',PAPER_STATUS_CONFLICT:'未签声明与历史已签原件矛盾',TERMINATION_REQUIRED:'三方终止协议待归档',CANCELLATION_REVIEW_STALE:'取消依据对应的条款已变化',ARCHIVE_FEEDBACK_OPEN:'本单资料反馈待处理',ORDER_STATE:'当前状态不能办理交付前取消',CHANGE_ACTIVE:'本单订单变更尚未完成',VEHICLE_OWNERSHIP:'车辆预留归属待核对',SIGNATURE_PENDING:'历史签署或交接状态待核对',PAYMENT_PENDING:'渠道支付结果尚未结束',REFUND_PENDING:'退款尚未成功核清',REFUND_REQUIRED:'实际已收款尚未全额退回'};
const evidenceCodes=new Set(['CANCELLATION_REVIEW_REQUIRED','PAPER_STATUS_UNKNOWN','PAPER_STATUS_CONFLICT','CANCELLATION_REVIEW_STALE']);
const fundCodes=new Set(['PAYMENT_PENDING','REFUND_PENDING','REFUND_REQUIRED']);

/** Adds presentation only; all truth checks are shared with the final cancellation command. */
export async function cancellationReadiness(tx:any,f:CancellationFacts,actor:any,now=new Date()):Promise<CancellationReadiness>{
 const {order,paper}=f,id=order.id,operator=['ADMIN','OPERATIONS'].includes(actor.role),financial=allowed(actor.role,'refunds',true);
 const terminal=['CANCELLED','COMPLETED'].includes(order.status),delivered=order.handovers.some((h:any)=>h.type==='DELIVERY'&&h.status==='COMPLETED')||['ACTIVE','SETTLING'].includes(order.status);
 const mode=terminal?'TERMINAL':delivered?'POST_DELIVERY_RETURN':'PRE_DELIVERY_CANCEL',pre=mode==='PRE_DELIVERY_CANCEL',review=paper?.review;
 const evidence=operator&&review?await tx.storedFile.findMany({where:{id:{in:review.evidenceFileIds}},select:{id:true,adminId:true,name:true,mimeType:true,size:true}}):[];
 const unchanged=!!paper&&review?.businessSnapshotHash===paper.currentHash;
 const formAllowed=pre&&cancellableOrderStates.includes(order.status);
 const raw=terminal?[]:cancellationBlockers(f),evidenceReady=!raw.some(b=>evidenceCodes.has(b.code)),terminationReady=evidenceReady&&!raw.some(b=>['TERMINATION_REQUIRED','ARCHIVE_FEEDBACK_OPEN'].includes(b.code));
 const action=(key:CancellationActionKey,label:string,resource:string,targetId?:string,kind:CancellationAction['kind']='OPEN_DETAIL',section?:string,condition=true,reason='当前办理条件未满足',expectedRevision?:number,privateTarget=false):CancellationAction=>{
  const readable=allowed(actor.role,resource,false)&&(!privateTarget||operator),writable=kind!=='OPEN_FORM'||allowed(actor.role,resource,true),enabled=readable&&writable&&condition&&!(terminal&&kind==='OPEN_FORM');
  return{key,label,kind,target:{resource,orderId:id,...(targetId&&readable?{id:targetId}:{}),...(section?{section}:{})},enabled,...(!enabled?{disabledReason:!readable||!writable?'当前岗位无此操作权限，请由负责岗位办理':terminal&&kind==='OPEN_FORM'?'订单已结束':reason}:{}),...(Number.isInteger(expectedRevision)&&readable?{expectedRevision}:{})};
 };
 const submit=action('SUBMIT_CANCELLATION_REVIEW',review?'重新确认签署情况':'确认签署情况','orders',id,'OPEN_FORM','evidence',operator&&formAllowed&&!evidenceReady,'当前签署情况已确认，或订单不允许继续办理',review?.revision||0,true);
 const reviewAction=action('REVIEW_CANCELLATION_EVIDENCE','确认已有签署记录','orders',id,'OPEN_FORM','evidence',operator&&formAllowed&&!evidenceReady&&review?.status==='SUBMITTED'&&unchanged,review?.status!=='SUBMITTED'?'当前没有待确认记录':!unchanged?'商业条款已变化，请重新确认签署情况':'当前签署情况已确认，或订单不允许继续办理',review?.revision||0,true);
 const archive=paper?.termination,requiredTermination=paper?.historical||review?.paperStatus==='SIGNED';
 const termAction=archive?action('OPEN_ARCHIVE','继续办理终止协议','offline-archives',archive.id,'OPEN_DETAIL','TERMINATION',evidenceReady,'请先确认签署情况',archive.revision,true):action('CREATE_ARCHIVE','生成本单终止协议','offline-archives',undefined,'OPEN_FORM','TERMINATION',formAllowed&&!!requiredTermination&&evidenceReady,'请先确认签署情况，再生成终止协议',0,true);
 const publications=await withBillPublication(tx,order.bills,now),pubById=new Map(publications.map((b:any)=>[b.id,b.publication]));
 const bills=order.bills.map((b:any)=>{
  const payments=b.payments.map((p:any)=>{const cash=receiptState(p);return{id:p.id,orderId:id,billId:b.id,status:p.status,amount:p.amount,refundedAmount:cash.returned,netReceivedAmount:p.status==='SUCCEEDED'&&cash.valid?cash.retained:0,reconciliationRequired:p.reconciliationRequired,succeededAt:p.succeededAt,refunds:p.refunds.map((r:any)=>({id:r.id,orderId:id,paymentId:p.id,status:r.status,amount:r.amount,requestedBy:r.requestedBy,approvedBy:r.approvedBy,succeededAt:r.succeededAt}))};});
  return{id:b.id,orderId:id,type:b.type,sequence:b.sequence,status:b.status,amount:b.amount,paidAmount:b.paidAmount,receivedAmount:payments.filter((p:any)=>p.status==='SUCCEEDED').reduce((n:number,p:any)=>n+p.amount,0),dueDate:b.dueDate,description:b.description,publication:pubById.get(b.id),refundedAmount:payments.reduce((n:number,p:any)=>n+p.refundedAmount,0),netReceivedAmount:payments.reduce((n:number,p:any)=>n+p.netReceivedAmount,0),payments};
 });
 const payments=bills.flatMap((b:any)=>b.payments),refunds=payments.flatMap((p:any)=>p.refunds),actions:CancellationAction[]=[submit,reviewAction];
 if(requiredTermination||archive)actions.push(termAction);
 const moneyAction=(resource:string,resourceId?:string):CancellationAction=>{
  if(resource==='refunds'){
   const refund=refunds.find((r:any)=>r.id===resourceId),pending=refund?.status==='PENDING_APPROVAL';
   return pending?action('REVIEW_REFUND','独立复核退款','refunds',resourceId,'OPEN_FORM','funds',financial&&terminationReady&&refund.requestedBy!==actor.id,!terminationReady?'请先完成签署确认及必要终止协议':refund?.requestedBy===actor.id?'退款须由另一名有权限人员独立复核':'请由管理员或财务核对退款'):action('SYNC_REFUND','查询退款渠道结果','refunds',resourceId,'OPEN_FORM','funds',financial&&terminationReady,!terminationReady?'请先完成签署确认及必要终止协议':'请由管理员或财务查询原退款结果');
  }
  if(resource==='bills')return action('OPEN_BILL','核对本单账单实收','bills',resourceId,'OPEN_DETAIL','funds');
  return action('OPEN_PAYMENT','核对原支付与退款','payments',resourceId,'OPEN_DETAIL','funds');
 };
 const link=(b:CancellationBlocker):CancellationAction|undefined=>{
  if(evidenceCodes.has(b.code))return b.code==='CANCELLATION_REVIEW_REQUIRED'&&review?.status==='SUBMITTED'&&unchanged?reviewAction:submit;
  if(b.code==='TERMINATION_REQUIRED')return termAction;
  if(b.code==='ARCHIVE_FEEDBACK_OPEN'){const record=paper?.openFeedbackArchives.find(a=>a.id===b.resourceId);return action('OPEN_ARCHIVE','处理本单资料反馈','offline-archives',record?.id,'OPEN_DETAIL',record?.kind,!!record,'请刷新后核对反馈原件',record?.revision,true);}
  if(fundCodes.has(b.code))return moneyAction(b.resource!,b.resourceId);
  if(b.code==='CHANGE_ACTIVE')return action('OPEN_CHANGE','查看本单未完成变更','order-changes',operator?b.resourceId:undefined,'OPEN_DETAIL',undefined,operator,'请由管理员或运营处理本单未完成的订单变更');
  if(b.code==='VEHICLE_OWNERSHIP')return action('OPEN_VEHICLE','核对本单车辆预留','vehicles',order.vehicleId);
  if(b.code==='SIGNATURE_PENDING')return action(b.resource==='contracts'?'OPEN_CONTRACT':'OPEN_HANDOVER','核对原签署与交接记录',b.resource!,b.resourceId,'OPEN_DETAIL',undefined,true,'',undefined,b.resource==='contracts');
  return undefined;
 };
 const blockers:CancellationCheck[]=raw.map(b=>({code:b.code,label:labels[b.code]||'取消条件待核对',state:'BLOCKED',description:b.message,ownerLabel:fundCodes.has(b.code)?'管理员／财务':'管理员／运营',...(link(b)?{action:link(b)}:{})}));
 for(const payment of payments){
  if(['CREATING','PENDING'].includes(payment.status)||payment.status==='SUCCEEDED')actions.push(action('OPEN_PAYMENT','核对原支付与退款','payments',payment.id,'OPEN_DETAIL','funds'));
  const reserved=payment.refunds.filter((r:any)=>['PENDING_APPROVAL','PROCESSING','SUCCEEDED'].includes(r.status)).reduce((n:number,r:any)=>n+r.amount,0);
  if(pre&&payment.status==='SUCCEEDED'&&payment.amount>reserved)actions.push(action('REQUEST_REFUND','申请原路退款','payments',payment.id,'OPEN_FORM','funds',financial&&terminationReady&&!f.changes.length,!terminationReady?'请先完成签署确认及必要终止协议':f.changes.length?'订单变更期间退款须使用已签补充协议的安排':'请由管理员或财务申请退款'));
 }
 for(const refund of refunds.filter((r:any)=>['PENDING_APPROVAL','PROCESSING'].includes(r.status)))actions.push(moneyAction('refunds',refund.id));
 for(const check of blockers)if(check.action)actions.push(check.action);
 const eligible=!terminal&&pre&&!raw.length,canCancel=eligible&&operator&&allowed(actor.role,'orders',true);
 const confirm=action('CANCEL_ORDER','确认取消本单','orders',id,'OPEN_FORM','confirm',canCancel,!operator?'请由管理员或运营确认取消':raw.length?'请先完成全部取消前置条件':!pre?'已交车订单请办理还车与结算':'当前无法取消',order.revision,true);
 if(pre)actions.push(confirm);
 const attention:CancellationCheck[]=[{code:'CANCELLATION_PREPARATION_NOT_HOLD',label:'取消准备不改变原订单状态',state:'NOT_APPLICABLE',description:'提交核实不会冻结支付、交付或账单自动发布。最终确认时系统仍会重新核验全部条件。',ownerLabel:'管理员／运营'}];
 const pendingTasks=f.tasks.filter((t:any)=>!['CANCELLED','COMPLETED'].includes(t.status));
 if(operator)for(const task of pendingTasks){const open=action('OPEN_TASK','核对本单现场安排','handover-tasks',task.id,'OPEN_DETAIL',undefined,true,'',task.version);actions.push(open);attention.push({code:'FIELD_TASK_REMAINS',label:'尚有现场安排需核对',state:'WAITING',description:task.currentHandoverId?'任务已发布材料，不能直接撤销；取消订单不会自动取消现场任务，请保留原事实核对。':'未发布任务可按实际情况撤销；这不是最终取消的新增门槛，取消订单不会自动取消现场任务。',ownerLabel:'运营／现场员工',action:open});}
 if(!terminal&&delivered){const settlement=f.settlements[0],open=settlement?action('OPEN_SETTLEMENT','办理本单还车结算','return-settlements',settlement.id):action('OPEN_RETURN','办理本单还车','orders',id,'OPEN_DETAIL','handover');actions.push(open);attention.unshift({code:'DELIVERY_ALREADY_COMPLETED',label:'请办理还车与结算',state:'NOT_APPLICABLE',description:'正式交车后的订单不能按交付前取消；须完成真实还车、查验、归档与结算。',ownerLabel:'运营／财务',action:open});}
 if(terminal)actions.push(action('OPEN_VEHICLE','查看车辆当前状态','vehicles',order.vehicleId));
 const evidenceChecks=blockers.filter(b=>evidenceCodes.has(b.code)),terminationChecks=blockers.filter(b=>['TERMINATION_REQUIRED','ARCHIVE_FEEDBACK_OPEN'].includes(b.code)),fundChecks=blockers.filter(b=>fundCodes.has(b.code)),finalChecks=blockers.filter(b=>!evidenceCodes.has(b.code)&&!['TERMINATION_REQUIRED','ARCHIVE_FEEDBACK_OPEN'].includes(b.code)&&!fundCodes.has(b.code));
 const successfulCash=payments.some((p:any)=>p.status==='SUCCEEDED')||order.bills.some((b:any)=>b.paidAmount>0);
 const step=(key:CancellationStepKey,label:string,checks:CancellationCheck[],summary:string,stepActions:CancellationAction[],state?:State):CancellationStep=>({key,label,state:state||(checks.length?'BLOCKED':'DONE'),summary,checks,actions:stepActions});
 const steps:CancellationStep[]=[
  step('EVIDENCE','确认签署情况',evidenceChecks,evidenceReady?paper?.historical?'已有经审核的租赁签字合同，系统确认已签署，无需重复提交依据。':'运营已确认实际签署情况。':review?.status==='SUBMITTED'?'已有签署记录待确认，可由本账号直接办理。':'由运营确认实际签署情况，附件选填；尚不能确定时不可继续。',[submit,reviewAction]),
  step('TERMINATION','终止协议',terminationChecks,requiredTermination?paper?.terminationReady?'当前条款对应的三方终止协议已归档。':'按模板生成、预览打印、上传并审核签字版，最后归档。':evidenceReady?'已确认未签署，无需终止协议。':'确认签署情况后确定是否需要终止协议。',requiredTermination||archive?[termAction]:[],!evidenceReady?'WAITING':!requiredTermination&&!terminationChecks.length?'NOT_APPLICABLE':undefined),
  step('FUNDS','资金核查',fundChecks,fundChecks.length?'核清在途支付及退款，实际收到的每笔款项须退清。':successfulCash?'实收款已逐笔成功退清，无需重复退款。':'没有实际已收款，无需退款。',actions.filter(a=>['OPEN_PAYMENT','OPEN_BILL','REQUEST_REFUND','REVIEW_REFUND','SYNC_REFUND'].includes(a.key)),!terminationReady?'WAITING':undefined),
  step('CONFIRM','确认取消',finalChecks,eligible?'当前条件已具备，提交时系统会再次核验。':'完成前序步骤后确认取消。',[confirm],!terminationReady||fundChecks.length?'WAITING':eligible?'CURRENT':'BLOCKED')
 ];
 if(!pre)for(const s of steps){s.state='NOT_APPLICABLE';s.actions=s.actions.filter(a=>a.kind==='OPEN_DETAIL');}
 if(terminal)steps.push(step('RESULT','处理结果',[],order.status==='CANCELLED'?'订单已取消，历史合同与收退款记录保留；车辆释放预留不等于重新上架。':'订单已完成，请查看既有还车结算与归档记录。',actions.filter(a=>a.key==='OPEN_VEHICLE'),'DONE'));
 const currentStep:CancellationStepKey=terminal?'RESULT':evidenceChecks.length?'EVIDENCE':terminationChecks.length?'TERMINATION':fundChecks.length?'FUNDS':'CONFIRM';
 const uniqueActions=[...new Map(actions.filter(a=>pre||a.kind!=='OPEN_FORM').map(a=>[`${a.key}:${a.target.resource}:${a.target.id||''}:${a.target.section||''}`,a])).values()];
 return{version:1,orderId:id,orderRevision:order.revision,orderStatus:order.status,observedAt:now.toISOString(),mode,canCancel,currentStep,steps,blockers,attention,actions:uniqueActions,
  signing:{paperStatus:paper?.historical?'SIGNED':review?.paperStatus==='SIGNED'?'SIGNED':review?.paperStatus==='UNSIGNED'?'UNSIGNED':'UNKNOWN',source:paper?.historical?'ARCHIVE':review?'CONFIRMATION':'UNCONFIRMED'},
  related:{review:operator&&review?{id:review.id,orderId:id,status:review.status,paperStatus:review.paperStatus,revision:review.revision,reason:review.reason,reviewReason:review.reviewReason,submittedBy:review.submittedBy,reviewedBy:review.reviewedBy,businessSnapshotMatches:unchanged,evidence:evidence.map(({adminId,...file}:any)=>file)}:null,
   terminationArchive:operator&&archive?{...archiveSummary({...archive,customerId:order.customerId},paper!.currentHash,actor),orderId:id}:null,bills,payments,refunds,tasks:operator?f.tasks.map((t:any)=>({...t,handoverId:t.currentHandoverId})):[],changes:operator?f.changes:[]},
  effects:['未结束账单（草稿、已审核、待支付）作废。','订单权益失效，未完成交接保留为历史版本。','车辆解除本单预留，转为未上架；需运营另行确认上架。','历史合同、收退款、归档原件及审核记录保留。']};
}
