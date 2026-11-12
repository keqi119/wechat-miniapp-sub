import {isOnlineHandover} from '../operations/online-handover';
import {allowed} from '../auth/role-policy';
import {billFundsReady,receiptState} from '../billing/receipt-state';
import {fen} from '../common/data';
import {shanghaiDay} from '../usage/rules';
import {currentHandoverArchive,archiveReviewAvailable} from './order-process-facts';

export type OrderProcessStepKey='APPLICATION'|'CONTRACT'|'PAYMENT'|'DELIVERY'|'IN_USE'|'RETURN'|'SETTLEMENT';
export type OrderProcessState='DONE'|'CURRENT'|'BLOCKED'|'WAITING'|'NOT_APPLICABLE'|'UNKNOWN';
export type OrderProcessAction={key:string;label:string;kind:'OPEN_DETAIL'|'OPEN_FORM'|'WAIT'|'REFRESH';target:{resource:string;id?:string;section?:string;orderId:string};enabled:boolean;disabledReason?:string;expectedRevision?:number};
export type OrderProcessCheck={code:string;label:string;state:OrderProcessState;description:string;ownerLabel:string;action?:OrderProcessAction};
const titles:[OrderProcessStepKey,string][]=[['APPLICATION','申请审核'],['CONTRACT','合同归档'],['PAYMENT','首期资金'],['DELIVERY','交付'],['IN_USE','用车'],['RETURN','还车'],['SETTLEMENT','结算']];
const closed=(s:string)=>['COMPLETED','CANCELLED'].includes(s);
const date=(v:any)=>v?new Date(v).toISOString().slice(0,10):'';

/** Pure allowlisted projection. No resource command is executed by rendering a step. */
export function orderProcess(f:any){
 const {order,actor}=f,id=order.id,terminal=closed(order.status)?order.status:null;
 const action=(key:string,label:string,resource:string,targetId?:string,kind:OrderProcessAction['kind']='OPEN_DETAIL',section?:string,condition=true,reason='当前办理条件未满足'):OrderProcessAction=>{
  const write=kind==='OPEN_FORM',readable=allowed(actor.role,resource,false)&&(resource!=='offline-archives'||f.archivesVisible),permission=readable&&allowed(actor.role,resource,write),enabled=permission&&condition&&!(terminal&&write);
  const revision=resource==='orders'?order.revision:resource==='handovers'?f.handovers.find((h:any)=>h.id===targetId)?.revision:resource==='return-settlements'?f.settlements.find((s:any)=>s.id===targetId)?.revision:resource==='offline-archives'?f.archives.find((a:any)=>a.id===targetId)?.revision:undefined;
  return{key,label,kind,target:{resource,orderId:id,...(targetId&&readable?{id:targetId}:{}),...(section?{section}:{})},enabled,...(!enabled?{disabledReason:!permission?'当前岗位无此操作权限':terminal&&write?'订单已结束':reason}:{}),...(write&&Number.isInteger(revision)?{expectedRevision:revision}:{})};
 };
 const check=(code:string,label:string,ready:boolean|undefined,description:string,ownerLabel:string,link?:OrderProcessAction):OrderProcessCheck=>({code,label,state:ready===undefined?'UNKNOWN':ready?'DONE':'BLOCKED',description,ownerLabel,...(link?{action:link}:{})});
 const viewOrder=(label='查看本单记录',section='records')=>action('OPEN_ORDER',label,'orders',id,'OPEN_DETAIL',section);
 const wait=(key:string,label:string,owner:string):OrderProcessAction=>({...viewOrder(label),key,kind:'WAIT',enabled:false,disabledReason:owner});
 const archiveAction=(a:any,kind:string,h?:any)=>a?action('OPEN_ARCHIVE','办理'+({RENTAL:'租赁合同',DELIVERY_RECEIPT:'纸质交车单',RETURN_RECEIPT:'纸质还车单',TERMINATION:'终止协议'} as any)[kind],'offline-archives',a.id):action('CREATE_ARCHIVE','建立'+({RENTAL:'租赁合同',DELIVERY_RECEIPT:'纸质交车单',RETURN_RECEIPT:'纸质还车单',TERMINATION:'终止协议'} as any)[kind],'offline-archives',h?.id,'OPEN_FORM',kind);
 const electronic=order.contractMode==='ELECTRONIC';
 const rental=f.archives.find((a:any)=>a.kind==='RENTAL'),contractAction=electronic?action('OPEN_ELECTRONIC','办理三方电子订阅合同','orders',id,'OPEN_DETAIL','electronic-documents'):archiveAction(rental,'RENTAL');
 const first=f.funding.bills.find((b:any)=>b.type==='SUBSCRIPTION'),deposits=f.funding.bills.filter((b:any)=>b.type==='DEPOSIT');
 const delivery=f.handovers.find((h:any)=>h.type==='DELIVERY'&&h.status!=='SUPERSEDED'),returned=f.handovers.find((h:any)=>h.type==='RETURN'&&h.status!=='SUPERSEDED');
 const delivered=delivery?.status==='COMPLETED',returnDone=returned?.status==='COMPLETED';
 const deliveryTask=f.tasks.find((t:any)=>t.type==='DELIVERY'&&!['CANCELLED','COMPLETED'].includes(t.status)),returnTask=f.tasks.find((t:any)=>t.type==='RETURN'&&!['CANCELLED','COMPLETED'].includes(t.status));
 let currentStep:OrderProcessStepKey=({AWAITING_CONTRACT_REVIEW:'CONTRACT',AWAITING_SIGNATURE:'CONTRACT',AWAITING_PAYMENT:'PAYMENT',AWAITING_HANDOVER:'DELIVERY',ACTIVE:f.receipts.length||returned||returnTask?'RETURN':'IN_USE',SETTLING:'SETTLEMENT',COMPLETED:'SETTLEMENT',CANCELLED:'CONTRACT'} as any)[order.status]||'CONTRACT';
 // This is the next work area, not a write to the transactional order status.
 if(order.status==='AWAITING_PAYMENT'&&f.funding.ready)currentStep='DELIVERY';
 const contractChecks=[check('RENTAL_ARCHIVE_REQUIRED',f.contract.ready?'租赁合同已归档':'租赁合同资料待完成',f.contract.ready,f.contract.ready?'当前有效版本与本单条款一致':electronic?(f.contract.legalSigningStatus==='SIGNED'?'三方签署已完成，签后归档尚未核验，请重试归档，不要重复签署':'请完成当前三方签署及签后文件核验；签署生效与文件归档状态分别可查'):'请完成当前版本签署、上传和资料审核；资料反馈须先处理','运营',contractAction)];
 const pendingRental=rental?.versions.find((v:any)=>v.status==='SUBMITTED');
 if(!electronic&&pendingRental&&!f.contract.ready)contractChecks.push(check('ARCHIVE_REVIEW_REQUIRED',archiveReviewAvailable(rental,actor)?actor.role==='ADMIN'?'待管理员审核':'待独立审核':'等待有权限的审核人员',false,archiveReviewAvailable(rental,actor)?'请逐页核对当前版本原件':'管理员可按普通资料规则自审并留痕；其他岗位须由未参与提交或上传的审核人办理',actor.role==='ADMIN'?'管理员':'其他运营审核人员',contractAction));
 const fundingChecks:OrderProcessCheck[]=[];
 const firstAction=first?action('OPEN_BILL','查看首期账单','bills',first.id):viewOrder('核对本单资金','funds');
 if(f.fundsVisible){
  fundingChecks.push(check('FIRST_RENT_UNPAID',f.funding.firstReady?'首期租金已核清':'首期租金尚未核清',f.funding.firstReady,f.funding.firstReady?'首期应收已有有效到账':`首期应收 ${fen(f.funding.first?.amount??first?.amount)}，以净有效到账及异常核对结果为准`,'客户付款／财务核对',firstAction));
  for(const b of deposits)fundingChecks.push(check('DEPOSIT_UNPAID',billFundsReady(b)?'约定押金已核清':'约定押金尚未核清',billFundsReady(b),`押金应收 ${fen(b.amount)}`,'客户付款／财务核对',action('OPEN_BILL','查看押金账单','bills',b.id)));
  if(!deposits.length)fundingChecks.push(check('NO_DEPOSIT_BILL','无待收押金账单',true,'按当前已确认方案和实际账单核对','财务'));
  const requiredPayments=[...f.funding.bills.flatMap((b:any)=>b.payments),...(f.funding.first?.allocations||[]).map((a:any)=>a.payment)];
  for(const p of requiredPayments){
   const cash=receiptState(p),link=action('OPEN_PAYMENT','查看原支付及退款','payments',p.id);
   if(!['CREATING','PENDING','SUCCEEDED','FAILED','CLOSED'].includes(p.status)||!cash.valid||(p.refunds||[]).some((r:any)=>!['PENDING_APPROVAL','PROCESSING','SUCCEEDED','FAILED','REJECTED'].includes(r.status)))fundingChecks.push(check('PAYMENT_STATE_UNKNOWN','收退款状态待核实',undefined,'当前收退款状态或金额无法确认，请财务核对原始记录','财务',link));
   if(p.reconciliationRequired)fundingChecks.push(check('PAYMENT_RECONCILIATION_REQUIRED','到账异常待核对',false,'渠道成功记录仍有异常，不能据此交车','财务',link));
   if(['CREATING','PENDING'].includes(p.status))fundingChecks.push(check('PAYMENT_PROCESSING','支付结果尚未确认',false,'请查询原支付结果，避免重复收款','财务',link));
   if(cash.pending)fundingChecks.push(check('REFUND_PROCESSING','退款尚未核清',false,'待审批或处理中的退款不能按已到账资金计入','财务',link));
  }
 }else fundingChecks.push(check('FUNDS_CHECK_REQUIRED','等待客户付款及财务核对',undefined,'当前岗位不展示资金明细','客户／财务'));
 const deliveryGates:OrderProcessCheck[]=[];
 if(!f.contract.ready)deliveryGates.push(...contractChecks.filter(x=>x.state!=='DONE'));
 if(!f.funding.ready)deliveryGates.push(...fundingChecks.filter(x=>x.state!=='DONE'));
 if(f.changes.length)deliveryGates.push(check('ORDER_CHANGE_PENDING','当前订单变更尚未完成',false,'先核对正在办理的变更，再安排交接','运营',viewOrder()));
 for(const b of f.business.blockers){
  const resource=['customers','partners','vehicles','insurance-policies','products','orders'].includes(b.resourceType)?b.resourceType:'orders';
  deliveryGates.push(check(b.code,b.label,false,'本项是现有交付校验条件，完成后重新核对','运营',b.code.startsWith('DELIVERY_INSURANCE_')?action('OPEN_BUSINESS_RECORD','补齐车辆保险','vehicles',b.resourceId,'OPEN_DETAIL','insurance'):resource==='customers'&&b.code==='CUSTOMER_QUALIFICATION_REQUIRED'?viewOrder('核对本单客户资格','customer-profile'):action('OPEN_BUSINESS_RECORD','查看对应资料',resource,b.resourceId||(resource==='orders'?id:undefined))));
 }
 if(order.status==='AWAITING_PAYMENT'&&f.contract.ready&&f.funding.ready&&!f.changes.length&&f.business.ready)deliveryGates.push(check('DELIVERY_RECHECK_REQUIRED','条件已具备，待重新核对流转',false,'资金已核清；重新核对全部交付条件后才实际流转为待交付','运营',action('RECHECK_DELIVERY','重新核对交付条件','orders',id,'OPEN_FORM')));
 const taskAction=(type:'DELIVERY'|'RETURN',task:any)=>task?action('OPEN_TASK','查看本单现场任务','handover-tasks',task.id):action(type==='DELIVERY'?'CREATE_DELIVERY_TASK':'CREATE_RETURN_TASK',type==='DELIVERY'?'创建交车任务':'创建还车任务','handover-tasks',undefined,'OPEN_FORM',type,order.status===(type==='DELIVERY'?'AWAITING_HANDOVER':'ACTIVE'),'交车任务须待交付，还车任务须用车中');
 function handoverChecks(type:'DELIVERY'|'RETURN',h:any,task:any){
  const taskLink=taskAction(type,task),name=type==='DELIVERY'?'交车':'还车',checks:OrderProcessCheck[]=[];
  if(h?.status==='COMPLETED')return[check(type+'_COMPLETE',name+'已正式完成',true,'已完成事实以历史交接记录为准，不重新要求过程确认','运营',action('OPEN_HANDOVER','查看已完成'+name+'记录','handovers',h.id))];
  checks.push(check(type+'_TASK',h?name+'查验已建立':task?'现场任务已派发':'待安排'+name+'任务',!!h||!!task,task?`现场经办人：${['ADMIN','OPERATIONS'].includes(actor.role)?task.assignee?.name||'已派发':'已派发'}`:'由运营安排实际现场人员采集','运营／现场员工',taskLink));
  if(!h){checks.push(check(type+'_FACTS',name+'现场资料待采集',false,'现场员工填写实际时间、地点、里程、车况及附件；后台不代替现场事实','现场员工',task?wait('WAIT_FIELD','等待现场采集','由当前任务经办人办理'):taskLink));return checks;}
  const open=action('OPEN_HANDOVER','查看本次'+name+'记录','handovers',h.id),paper=currentHandoverArchive(f,h);
  checks.push(check(type+'_CUSTOMER',h.status==='OBJECTION_SUBMITTED'?'客户对查验提出异议':'客户确认查验事实',h.customerResponse==='CONFIRM'&&!!h.confirmedAt,h.status==='OBJECTION_SUBMITTED'?'请核对异议，修订后重新发布':'客户须在本人小程序阅读当前版本证据并确认','客户／现场员工',open));
  if(!isOnlineHandover(h))checks.push(check(type+'_ARCHIVE',paper.ready?'纸质'+name+'单已归档':'纸质'+name+'单待归档',paper.ready,'线上查验确认与纸质签收归档分别办理','运营／资料审核人员',archiveAction(paper.archive,type==='DELIVERY'?'DELIVERY_RECEIPT':'RETURN_RECEIPT',h)));
  if(!isOnlineHandover(h)&&paper.archive?.versions.some((v:any)=>v.status==='SUBMITTED')&&!paper.ready&&!archiveReviewAvailable(paper.archive,actor))checks.push(check(type+'_OTHER_REVIEWER','需其他人员独立审核',false,'本人提交或参与上传的交接资料不能本人审核','其他运营审核人员',open));
  if(!electronic&&type==='DELIVERY'&&h.actualAt&&date(f.snapshot.startDate)!==shanghaiDay(new Date(h.actualAt)))checks.push(check('DELIVERY_DATE_AMENDMENT_REQUIRED','实际交车日与已确认起租日不一致',false,'须先核对已确认条款及线下变更依据，不能直接改日期完成交付','运营',viewOrder('核对本单日期','plan')));
  for(const b of f.handoverReadiness?.[h.id]?.blockers||[])if(!checks.some(c=>c.code===b.code))checks.push(check(b.code,b.label,false,'请核对当前记录及对应资料；完成时仍会重新检查全部条件','运营',open));
  checks.push(check(type+'_COMPLETE',h.status==='COMPLETED'?name+'已正式完成':'待后台确认完成'+name,h.status==='COMPLETED',type==='DELIVERY'?'完成后才进入用车中并建立实际用量账户':'实际收车不等于正式还车或结算完成','运营',open));
  return checks;
 }
 const deliveryChecks=handoverChecks('DELIVERY',delivery,deliveryTask),returnChecks=handoverChecks('RETURN',returned,returnTask);
 if(f.receipts.length)returnChecks.unshift(check('PHYSICAL_RETURN_RECORDED','车辆已实际收回',true,'仍需完成本版客户查验确认、交接核验和结算','运营'));
 const settlement=f.settlements[0],settlementAction=settlement?action('OPEN_SETTLEMENT','办理本单还车结算','return-settlements',settlement.id):viewOrder('查看还车进度','handover');
 const settlementChecks:OrderProcessCheck[]=[];
 if(!settlement)settlementChecks.push(check('RETURN_SETTLEMENT_REQUIRED','正式还车完成后生成结算',false,'先完成当前还车手续','运营',settlementAction));
 else{
  settlementChecks.push(check('RETURN_READINGS_REQUIRED','核清应结月份里程',!settlement.unsettledPeriodIds.length,settlement.unsettledPeriodIds.length?`尚有 ${settlement.unsettledPeriodIds.length} 个未结月份`:'应结月份已完成核对','财务',action('OPEN_USAGE','查看本单里程账户','usage-periods',undefined,'OPEN_DETAIL','usage')));
  if(settlement.status==='DISPUTED')settlementChecks.push(check('SETTLEMENT_DISPUTED','结算存在争议',false,'请先核实并记录处理结论','财务',settlementAction));
  if(f.fundsVisible){
   if(settlement.depositRefundRequiredAmount>0)settlementChecks.push(check('DEPOSIT_REFUND_REQUIRED','押金待退还',false,`尚有 ${fen(settlement.depositRefundRequiredAmount)} 押金须核清原路退款`,'财务',settlementAction));
   if(settlement.exceptionalCash)settlementChecks.push(check('PAYMENT_RECONCILIATION_REQUIRED','异常到账待核对',false,'原收款异常仍需独立核对','财务',settlementAction));
  }
  for(const code of settlement.documentBlockers){if(electronic){settlementChecks.push(check(code,'终止依据或原始事实待核验',false,'核对真实终止依据、实际收车和当前来源','运营',viewOrder('办理终止依据','termination')));continue;}const end=f.archives.find((a:any)=>a.kind==='TERMINATION');settlementChecks.push(check(code,code==='TERMINATION_REQUIRED'?'提前终止协议待归档':'结算所需归档资料未就绪',false,'按本单当前有效版本完成签署、归档及反馈处理','运营',code==='TERMINATION_REQUIRED'?archiveAction(end,'TERMINATION'):contractAction));}
  for(const code of settlement.financialBlockers||[])settlementChecks.push(check(code,code==='EXIT_AMOUNT_CONFIRMATION_REQUIRED'?'无争议金额待确认':'结算资金来源待核验',false,'按原付款、已确认金额及差额处置核对本单结算','财务',settlementAction));
  if(!settlement.canComplete&&settlement.status!=='COMPLETED')settlementChecks.push(check('RETURN_NOT_SETTLED','尚未满足全部结单条件',false,'在本单结算中核对未结账单、渠道处理中收退款及加购权益；不能强行关单','财务',settlementAction));
  if(settlement.canComplete)settlementChecks.push(check('SETTLEMENT_CAN_COMPLETE','可核清并完成结算',true,'提交时系统仍会重新核验本单全部条件','财务',action('COMPLETE_SETTLEMENT','核清并完成结算','return-settlements',settlement.id,'OPEN_FORM')));
 }
 const summaries:Record<OrderProcessStepKey,string>={APPLICATION:f.application?.status==='FINAL_PLAN_CONFIRMED'?'客户已确认方案，正式订单已建立':'关联申请资料待核对',CONTRACT:f.contract.ready?'本单租赁合同已归档，当前版本有效':electronic?'完成三方电子签署及签后归档':'完成线下签署及当前版本归档',PAYMENT:f.fundsVisible?f.funding.ready?'首期租金及约定押金已核清':delivered?'交付前资金环节已完成；当前资金有待核对事项':f.funding.firstReady?'首期租金已核清；约定押金或收退款仍待核对':`首期租金 ${fen(f.funding.first?.amount??first?.amount)} 尚未核清`:'等待客户付款及财务核对',DELIVERY:delivered?'车辆交付已正式完成':order.status==='AWAITING_PAYMENT'&&f.funding.ready?'首期资金已核清；待核对交付条件，实际订单流转尚未完成':deliveryTask?'已派发现场任务，继续查验并按本版确认方式完成手续':'准备交车资料和现场任务',IN_USE:f.usage?`实际起租 ${date(f.usage.startedOn)}`:'正式交车后建立用量账户并激活权益',RETURN:returnDone?'正式还车已完成':f.receipts.length?'已实际收车，正式还车与结算仍待办理':'安排真实还车、查验及签收归档',SETTLEMENT:settlement?.status==='COMPLETED'?'本单结算已完成':'核清里程、账单、退款及终止资料'};
 const checksBy:Record<OrderProcessStepKey,OrderProcessCheck[]>={APPLICATION:[check('APPLICATION_CONFIRMED','客户确认最终方案',f.application?.status==='FINAL_PLAN_CONFIRMED','正式订单保留原申请与已确认方案','运营',action('OPEN_APPLICATION','查看原申请','applications',order.applicationId))],CONTRACT:contractChecks,PAYMENT:delivered?[check('FUNDING_STAGE_COMPLETED','交付前资金环节已完成',true,'后续收退款另行核对，不重开已完成的交付前流程','财务',viewOrder('查看当前收退款','funds'))]:fundingChecks,DELIVERY:[...(!delivered?deliveryGates:[]),...deliveryChecks],IN_USE:[check('DELIVERY_ACTIVATED','实际交车及用量账户',!!delivered&&!!f.usage,'未完成真实交付不会激活用车；计划日期不会自动改写已确认条款','运营',viewOrder('查看用车资料','services'))],RETURN:returnChecks,SETTLEMENT:settlementChecks};
 const actionsBy:Record<OrderProcessStepKey,OrderProcessAction[]>={APPLICATION:[action('OPEN_APPLICATION','查看原申请','applications',order.applicationId)],CONTRACT:[contractAction],PAYMENT:[firstAction],DELIVERY:[...(order.status==='AWAITING_PAYMENT'?[action('RECHECK_DELIVERY','重新核对交付条件','orders',id,'OPEN_FORM')]:[]),delivery?action('OPEN_HANDOVER','办理本次交车','handovers',delivery.id):taskAction('DELIVERY',deliveryTask)],IN_USE:[viewOrder('查看用车服务','services'),taskAction('RETURN',returnTask)],RETURN:[returned?action('OPEN_HANDOVER','办理本次还车','handovers',returned.id):taskAction('RETURN',returnTask)],SETTLEMENT:[settlementAction]};
 for(const [type,h,key] of [['DELIVERY',delivery,'DELIVERY'],['RETURN',returned,'RETURN']] as const){if(!h||h.status==='COMPLETED')continue;const paper=currentHandoverArchive(f,h);if(!isOnlineHandover(h))actionsBy[key].push(archiveAction(paper.archive,type==='DELIVERY'?'DELIVERY_RECEIPT':'RETURN_RECEIPT',h));const unresolved=checksBy[key].filter(c=>c.state!=='DONE'&&!c.code.endsWith('_COMPLETE'));
  actionsBy[key].push(action('COMPLETE_HANDOVER','确认完成'+(type==='DELIVERY'?'交车':'还车'),'handovers',h.id,'OPEN_FORM',undefined,h.status==='CUSTOMER_CONFIRMED'&&!unresolved.length,'须核清本阶段全部条件后再完成交接'));
 }
 if(settlement?.canComplete)actionsBy.SETTLEMENT.push(action('COMPLETE_SETTLEMENT','核清并完成结算','return-settlements',settlement.id,'OPEN_FORM'));
 if(!terminal&&!delivered&&['AWAITING_CONTRACT_REVIEW','AWAITING_SIGNATURE','AWAITING_PAYMENT','AWAITING_HANDOVER'].includes(order.status))actionsBy[currentStep].push(action('OPEN_CANCELLATION','查看交付前取消','orders',id,'OPEN_DETAIL','cancellation'));
 const done:Record<OrderProcessStepKey,boolean>={APPLICATION:f.application?.status==='FINAL_PLAN_CONFIRMED',CONTRACT:f.contract.ready,PAYMENT:f.funding.ready||!!delivered,DELIVERY:!!delivered,IN_USE:!!returnDone||order.status==='COMPLETED',RETURN:!!returnDone,SETTLEMENT:settlement?.status==='COMPLETED'&&order.status==='COMPLETED'};
 const currentIndex=titles.findIndex(([key])=>key===currentStep);
 const steps=titles.map(([key,label],index)=>{
  const checks=checksBy[key],state:OrderProcessState=terminal==='CANCELLED'?(done[key]?'DONE':'NOT_APPLICABLE'):done[key]?'DONE':index>currentIndex?'WAITING':key===currentStep?(checks.some(c=>c.state==='BLOCKED')?'BLOCKED':checks.some(c=>c.state==='UNKNOWN')?'UNKNOWN':'CURRENT'):'UNKNOWN';
  return{key,label,state,summary:summaries[key],checks,actions:actionsBy[key]};
 });
 const current=steps.find(s=>s.key===currentStep)!;
 const blockers=terminal?[]:current.checks.filter(c=>c.state==='BLOCKED');
 let primaryAction=terminal?viewOrder('查看已结束订单'):current.actions.find(a=>a.enabled)||current.actions[0];
 if(currentStep==='PAYMENT'&&!f.funding.ready)primaryAction=firstAction;
 if(currentStep==='DELIVERY'||currentStep==='RETURN'){
  primaryAction=current.checks.find(c=>c.state!=='DONE'&&c.action?.enabled)?.action||primaryAction;
  const h=currentStep==='DELIVERY'?delivery:returned;
  if(h?.status==='PUBLISHED')primaryAction=wait('WAIT_CUSTOMER','等待客户确认查验','客户须在本人小程序操作');
  else if(h?.status==='CUSTOMER_CONFIRMED'){const paper=currentHandoverArchive(f,h);primaryAction=isOnlineHandover(h)||paper.ready?current.actions.find(a=>a.key==='COMPLETE_HANDOVER')||primaryAction:archiveAction(paper.archive,currentStep==='DELIVERY'?'DELIVERY_RECEIPT':'RETURN_RECEIPT',h);}
 }
 const attention:OrderProcessCheck[]=delivered&&f.fundsVisible?fundingChecks.filter(c=>c.state!=='DONE'):[];
 const start=date(f.snapshot.startDate),due=date(f.snapshot.firstDueDate);
 if(start&&due&&Math.abs(new Date(due).getTime()-new Date(start).getTime())>31*86400000)attention.push(check('BILL_DATE_CHECK','计划起租与首期付款日期需核对',undefined,`计划起租 ${start}；首期付款 ${due}。当前不会按实际交车自动重排账单。`,'运营',viewOrder('核对日期及条款','plan')));
 if(f.fundsVisible&&f.related.bills.some((b:any)=>b.type==='PAYMENT_TEST'))attention.push(check('PAYMENT_TEST_SEPARATE','测试账单不抵首期租金或押金',true,'测试款收退款独立列示，不作为交车资金依据','财务',viewOrder('查看本单收退款','funds')));
 return{version:1,observedAt:f.now.toISOString(),orderId:id,orderRevision:order.revision,currentStep,terminal,steps,blockers,attention,primaryAction,related:f.related};
}
