const {money}=require('../utils/format');
const PACK_STATES={PENDING_PAYMENT:'待支付，尚未发放',ACTIVE:'已到账',EXPIRED:'已失效',VOID:'已关闭',PAYMENT_REVIEW:'已付款，待人工核账（未发放）',REFUND_PENDING:'退款核对中（不可用）',REFUNDED:'已退款（不可用）'};
const BILL_STATES={DRAFT:'待发布',REVIEWED:'审核通过',PENDING:'待支付',PUBLISHED:'待支付',PAID:'已支付',PARTIALLY_PAID:'部分支付',VOID:'已作废'};
const REASONS={MILEAGE_PURCHASE_NOT_PENDING:'额外到账款项待核账，原合法里程额度保持原规则',MILEAGE_RETURNED:'服务已结束，已付款待核账',MILEAGE_MONTH_CLOSED:'原计费月已结束，已付款待核账',MILEAGE_PERIOD_SETTLED:'原计费月已结算，已付款待核账',MILEAGE_PACK_SOURCE_INVALID:'购买来源已变化，已付款待核账',MILEAGE_SOURCE_INVALID:'购买来源已变化，已付款待核账',MILEAGE_EXTRA_RECEIPT:'额外到账款项待核账，原合法里程额度保持原规则',MILEAGE_DUPLICATE_PAYMENT:'额外到账款项待核账，原合法里程额度保持原规则',MILEAGE_GRANT_REVIEW:'已付款，里程发放待核账',MILEAGE_REFUND_REVIEW:'退款金额待人工核对'};
const nonnegative=value=>Number.isSafeInteger(value)&&value>=0;
function mileagePackPayment(value,invalid,required=false){
  const present=['effectiveStatus','bill','paymentReview','paymentFacts'].some(key=>value[key]!==undefined);
  if(!present){if(required)invalid();return{effectiveStatus:value.status,statusText:PACK_STATES[value.status],bill:null,paymentReview:null,paymentFacts:null,paymentReviewText:'',canPay:false};}
  const status=value.effectiveStatus,b=value.bill,r=value.paymentReview,f=value.paymentFacts;
  if(!PACK_STATES[status]||!b||b.id!==value.billId||b.type!=='MILEAGE_PACK'||b.amount!==value.amount||!nonnegative(b.paidAmount)||!BILL_STATES[b.status]||!r||typeof r.required!=='boolean'||!Array.isArray(r.reasons)||r.reasons.some(reason=>typeof reason!=='string'||!reason.trim())||!(r.reason===null||typeof r.reason==='string'&&r.reason.trim())||!nonnegative(r.unresolvedReceiptCount)||!f||['receiptCount','receivedAmount','refundedAmount','netReceivedAmount','pendingRefundCount'].some(key=>!nonnegative(f[key]))||f.netReceivedAmount!==Math.max(f.receivedAmount-f.refundedAmount,0)||typeof value.canPay!=='boolean')invalid();
  if(value.canPay&&(value.status!=='PENDING_PAYMENT'||status!=='PENDING_PAYMENT'||f.receiptCount!==0||b.paidAmount!==0||b.status!=='PENDING')||value.canUseNow===true&&value.status!=='ACTIVE')invalid();
  const paymentReviewText=r.required?(r.reasons.length?r.reasons:[r.reason]).map(reason=>REASONS[reason]||'有已到账款项待平台核对，请勿再次付款').filter((text,index,all)=>all.indexOf(text)===index).join('；'):'';
  return{effectiveStatus:status,statusText:PACK_STATES[status],bill:{...b,amountText:money(b.amount),paidAmountText:money(b.paidAmount),statusText:BILL_STATES[b.status]},paymentReview:{...r,reasons:[...r.reasons]},paymentFacts:{...f,receivedAmountText:money(f.receivedAmount),refundedAmountText:money(f.refundedAmount),netReceivedAmountText:money(f.netReceivedAmount)},paymentReviewText,canPay:value.canPay};
}
module.exports={mileagePackPayment};
