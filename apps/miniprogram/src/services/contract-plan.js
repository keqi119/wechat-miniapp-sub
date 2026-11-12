const {beijingTime}=require('./vehicle-assignments');
const TYPES=['cancellation04','termination'];
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const money=v=>Number.isSafeInteger(v)&&v>=0?'¥'+(v/100).toFixed(2):'待核对';
const states={PROPOSED:'待运营复核',VERIFIED:'待您确认方案',CONFIRMED:'待电子签署',EFFECTIVE:'协议已生效',ARCHIVED:'已归档',REJECTED:'已退回',DEPENDENCIES_RELEASED:'后续安排已处理',AMOUNT_CONFIRMED:'金额已确认'};
function createContractPlanApi({call,identifier,sessionKey,idempotencyKey}){
 const tickets=new WeakMap(),pending=new Map(),busy=new Set();
 async function getContractPlan(orderId,kind){
  if(!TYPES.includes(kind))throw Error('协议类型不正确');const session=sessionKey();if(!session)throw Error('请先登录本人账户');
  const raw=await call('GET','/customer/orders/'+identifier(orderId)+'/'+kind);if(session!==sessionKey())throw Error('登录会话已变化');
  if(raw?.orderId!==orderId||!Array.isArray(raw.blockers))throw Error('返回协议不属于本订单');
  const c=raw.case;
  if(c&&(!c.id||!Number.isInteger(c.revision)||!sha(c.proposalHash)||typeof c.reason!=='string'))throw Error('本版方案尚未完整读取');
  const canConfirm=!!c&&['VERIFIED','EFFECTIVE'].includes(c.state)&&!raw.blockers.length&&(kind==='cancellation04'||c.kind==='AGREED06');
  const value={orderId,kind,title:kind==='cancellation04'?'交付前取消方案':'协商终止方案',case:c?JSON.parse(JSON.stringify(c)):null,canConfirm,statusText:c?states[c.state]||'办理中':'暂无协商方案',blockers:raw.blockers.map(b=>b.message||'本单办理条件待核对'),plannedReturnAtText:c?.plannedReturnAt?beijingTime(c.plannedReturnAt):'—',netRefundText:money(c?.netRefundAmount),costs:(c?.costs||[]).map(v=>({description:v.description,agreement:v.agreement,amountText:money(v.amount)}))};
  const s=kind==='termination'?raw.settlementSource:null;
  if(s){
   if(s.orderId!==orderId||!sha(s.hash)||!Number.isInteger(s.responses?.version)||s.responses.version<0||!(s.responses.headId===null||typeof s.responses.headId==='string')||!Array.isArray(s.periods)||!Array.isArray(s.paymentReferences))throw Error('实际结算来源尚未完整读取');
   const amounts=s.amounts||{};for(const v of [s.depositBalanceAmount,amounts.compensationAmount,...s.periods.map(p=>p.amount),...s.paymentReferences.map(p=>p.amount)])if(!Number.isSafeInteger(v)||v<0)throw Error('实际结算金额待核对');
   value.settlement={canConfirm:s.responses.current?.decision!=='CONFIRM',statusText:s.responses.current?.decision==='CONFIRM'?'金额已确认':s.responses.current?.decision==='OBJECT'?'异议待核对':'待您核对金额',reason:s.responses.current?.reason||'',actualReceiptAtText:beijingTime(s.actualReceiptAt),stopAtText:beijingTime(amounts.stopAt),remainingRentText:money(amounts.remainingRentAmount??amounts.fullOriginalRefundAmount),compensationText:money(amounts.compensationAmount),depositText:money(s.depositBalanceAmount),occupancy:s.occupancyClaim?{amountText:money(s.occupancyClaim.amount),disputedText:money(s.occupancyClaim.disputedAmount),basis:s.occupancyClaim.basis}:null,periods:s.periods.map(p=>({sequence:p.sequence,dates:p.startDate+' 至 '+p.endDate+'（末日不含）',amountText:money(p.amount)})),payments:s.paymentReferences.map(p=>({id:p.paymentId,amountText:money(p.amount)})),history:(s.responses.history||[]).map(r=>({id:r.id,decision:r.decision,reason:r.reason,at:beijingTime(r.respondedAt)}))};
  }
  tickets.set(value,{session,caseId:c?.id,revision:c?.revision,hash:c?.proposalHash,settlement:s?{sourceHash:s.hash,responseVersion:s.responses.version,predecessorId:s.responses.headId}:null});return value;
 }
 async function confirmContractPlan(view){
  const ticket=tickets.get(view);if(!ticket||ticket.session!==sessionKey())throw Error('登录会话已变化，请重新读取方案');
  if(!view.canConfirm)throw Error('当前方案不能确认');
  const current=await getContractPlan(view.orderId,view.kind);
  if(ticket.session!==sessionKey())throw Error('登录会话已变化');
  if(!current.canConfirm||current.case.id!==ticket.caseId||current.case.revision!==ticket.revision||current.case.proposalHash!==ticket.hash)throw Error('方案已变化，请重新阅读确认');
  return call('POST','/customer/'+(view.kind==='cancellation04'?'cancellations04':'terminations')+'/'+identifier(ticket.caseId)+'/confirm',{revision:ticket.revision,proposalHash:ticket.hash,accepted:true,idempotencyKey:'contract-plan-'+ticket.caseId+'-'+ticket.revision+'-'+ticket.hash.slice(0,32)});
 }
 async function respondExitAmounts(view,decision,reason){
  const t=tickets.get(view);reason=String(reason||'').trim();if(!t||t.session!==sessionKey())throw Error('请重新读取本人会话和结算');if(!t.settlement||!['CONFIRM','OBJECT'].includes(decision)||!reason||reason.length>2000||decision==='CONFIRM'&&!view.settlement.canConfirm)throw Error('请核对实际结算并填写说明');
  const key=view.orderId;if(busy.has(key))throw Error('正在提交，请稍候');busy.add(key);
  try{const fresh=await getContractPlan(view.orderId,'termination'),ft=tickets.get(fresh);if(t.session!==sessionKey()||JSON.stringify(t.settlement)!==JSON.stringify(ft?.settlement))throw Error('结算来源或响应已变化，请重新核对');const body={...t.settlement,decision,reason},serialized=JSON.stringify(body),old=pending.get(key);if(old&&old.session===t.session&&old.serialized!==serialized)throw Error('上次提交结果未知，请先按原意见核对');const cmd=old?.session===t.session?old:{session:t.session,serialized,body:{...body,idempotencyKey:idempotencyKey('exit-amount')}};pending.set(key,cmd);try{const result=await call('POST','/customer/orders/'+identifier(view.orderId)+'/exit-amounts/respond',cmd.body);if(t.session!==sessionKey())throw Error('登录会话已变化');pending.delete(key);return result;}catch(e){if(e.statusCode>=400&&e.statusCode<500)pending.delete(key);throw e;}}finally{busy.delete(key);}
 }
 return{getContractPlan,confirmContractPlan,respondExitAmounts};
}
module.exports={createContractPlanApi};
