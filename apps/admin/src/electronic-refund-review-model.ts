import{businessInstant}from './electronic-exit-model.ts';
const sha=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function refundReviewRead(v:any,orderId:string){if(v?.orderId!==orderId||!sha(v.sourceHash)||!['candidates','amountStatements','dependencies','items'].every(k=>Array.isArray(v[k])))throw Error('本单退款依据尚未完整读取');return v;}
export function refundReviewCommand(v:any,action:string,target:any,raw:Record<string,unknown>){
 if(action==='materialize')return{sourceHash:v.sourceHash};
 if(action==='claim'){if(!v.amountStatements.some((s:any)=>s.amountStatementHash===target?.amountStatementHash)||!sha(target.amountStatementHash)||!target.customerId)throw Error('应退金额来源已变化');const at=businessInstant(raw.confirmedAt);return{sourceHash:target.amountStatementHash,customerId:target.customerId,confirmedAt:at,intention:raw.intention,evidenceFileIds:raw.evidenceFileIds};}
 if(action==='review'){if(!v.amountEvidence?.some((r:any)=>r.id===target?.id&&r.kind==='CLAIM')||v.amountEvidence.some((r:any)=>r.predecessorId===target.id))throw Error('原始依据已复核或来源变化');return{decision:raw.decision,reason:raw.reason};}
 if(action==='bind'){const {obligation:o,refund:r}=target||{};if(!o||!r||!v.items.some((i:any)=>i.id===o.id&&i.sourceHash===o.sourceHash)||r.obligationId||r.status!=='PENDING_APPROVAL'||!Number.isInteger(r.revision)||r.revision<0||r.paymentId!==o.paymentId||r.amount!==o.amount||!o.refunds.some((f:any)=>f.id===r.id&&f.sameDebt))throw Error('退款与本项已核实依据不匹配，请刷新核对');return{revision:r.revision,obligationId:o.id};}
 throw Error('不支持的人工办理动作');
}
