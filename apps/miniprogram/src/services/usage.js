const { money, date } = require('../utils/format');
const PERIOD_STATUS = { OPEN: '本期进行中', AWAITING_READING: '待月界读数或补证', REVIEW_PENDING: '仪表证据待人工审核', READY: '已审核，待结算', SETTLED: '已结算', CANCELLED: '已取消' };
const PACK_STATUS = { PENDING_PAYMENT: '待支付，尚未发放', ACTIVE: '已到账', EXPIRED: '已失效', VOID: '已关闭', REFUND_PENDING:'退款核对中（已冻结，不可消费）',REFUNDED:'已退款（不可用）' };
const SETTLEMENT_STATUS = { READINGS_REQUIRED: '待月界证据，尚未结清', PENDING_PAYMENT: '待结算账单支付', DISPUTED: '异议处理中，尚未结清', COMPLETED: '服务端已确认结清' };
const PRICES = { 1000: 80000, 2000: 150000, 3000: 200000 };
const BILL_TYPES = { SUBSCRIPTION: '订阅费', DEPOSIT: '押金', MILEAGE_PACK: '加购里程包', MILEAGE_EXCESS: '月超里程费用' };
const BILL_STATUS = { DRAFT: '待发布', REVIEWED: '审核通过', PENDING: '待支付', PUBLISHED: '待支付', PAID: '已支付', PARTIALLY_PAID: '部分支付', VOID: '已作废' };

function createUsageApi({ call, identifier, error, idempotencyKey, getContext }) {
  const keys = new Map();
  const nonnegative = value => Number.isSafeInteger(value) && value >= 0;
  const known = (values, value) => typeof value === 'string' && Object.prototype.hasOwnProperty.call(values, value);
  function response(message = '月度里程数据暂不可用，请刷新或联系人工。') { throw error(message, 'RESPONSE'); }
  function day(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : ''; }
  function nullable(value) { if (value == null) return null; if (!nonnegative(value)) response(); return value; }
  function purchaseTerms(value) {
    return value?.version === 'MILEAGE_PACK_V1' && typeof value.documentId === 'string' && value.documentId && Number.isInteger(value.documentVersion) && value.documentVersion > 0 && typeof value.hash === 'string' && /^[a-f0-9]{64}$/i.test(value.hash) && typeof value.content === 'string' && value.content.trim()
      ? { version: value.version, documentId:value.documentId,documentVersion:value.documentVersion,hash: value.hash, content: value.content } : null;
  }
  function billView(value) {
    if (!value || typeof value.id !== 'string' || !nonnegative(value.amount) || typeof value.status !== 'string') response('账单数据不完整，请查询普通账单。');
    return { id: value.id, type: value.type || '', typeText: BILL_TYPES[value.type] || '结算账单', amount: value.amount, amountText: money(value.amount), paidAmount: nullable(value.paidAmount), status: value.status, statusText:BILL_STATUS[value.status]||'请查看账单核对状态',dueDate: day(value.dueDate), dueDateText: date(value.dueDate), description: typeof value.description === 'string' ? value.description : '' };
  }
  function periodView(value, returnCutoff = false) {
    if (!value || typeof value.id !== 'string' || !known(PERIOD_STATUS, value.status) || !Number.isInteger(value.sequence) || value.sequence < 1 || !Number.isInteger(value.revision) || !day(value.startDate) || !day(value.endDate) || !day(value.effectiveEndDate)) response();
    const fields = Object.fromEntries(['startReadingKm', 'endReadingKm', 'usedKm', 'baseUsedKm', 'packUsedKm', 'excessKm', 'excessAmount'].map(key => [key, nullable(value[key])]));
    return { id: value.id, sequence: value.sequence, revision: value.revision, startDate: day(value.startDate), endDate: day(value.endDate), effectiveEndDate: day(value.effectiveEndDate), status: value.status, statusText: PERIOD_STATUS[value.status], ...fields,
      periodText: date(value.startDate) + '—' + date(value.effectiveEndDate) + (!returnCutoff && day(value.effectiveEndDate) === day(value.endDate) ? '（末日不含）' : '（归还日，以实际还车时刻截止）'), boundaryDateText: date(value.effectiveEndDate), excessAmountText: fields.excessAmount == null ? '尚未结算' : money(fields.excessAmount),
      billId: typeof value.billId === 'string' ? value.billId : null, canSubmit: value.canSubmit === true && ['OPEN', 'AWAITING_READING'].includes(value.status), reviewNote: typeof value.reviewNote === 'string' ? value.reviewNote : '' };
  }
  function usageView(value, orderId) {
    if (!value || value.orderId !== orderId || value.policyVersion !== 'USAGE_V1' || value.baseAllowanceKm !== 1500 || !nonnegative(value.excessPriceAmount) || !nonnegative(value.packBalanceKm) || !['ACTIVE', 'FROZEN', 'EXPIRED'].includes(value.packStatus) || ['periods', 'packs', 'ledger', 'products'].some(key => !Array.isArray(value[key]))) response();
    const products = value.products.map(product => {
      if (typeof product?.id !== 'string' || !Object.prototype.hasOwnProperty.call(PRICES, product.km) || PRICES[product.km] !== product.amount) response('里程包规格或金额不符合已确认规则，不能购买。');
      return { id: product.id, version: product.version, km: product.km, amount: product.amount, amountText: money(product.amount) };
    });
    const packs = value.packs.map(pack => {
      if (typeof pack?.id !== 'string' || !known(PACK_STATUS, pack.status) || !nonnegative(pack.km) || !nonnegative(pack.amount) || !nonnegative(pack.remainingKm)) response();
      return { id: pack.id, km: pack.km, amount: pack.amount, amountText: money(pack.amount), status: pack.status, statusText: PACK_STATUS[pack.status], availabilityText:pack.status==='REFUND_PENDING'?'已冻结，不可消费；结果以服务端退款核对为准。':pack.status==='REFUNDED'?'已退款，该包不可用。':'',billId: typeof pack.billId === 'string' ? pack.billId : null, remainingKm: pack.remainingKm };
    });
    const terms = purchaseTerms(value.purchaseTerms);
    const lastPeriod = value.periods.filter(period => period.status !== 'CANCELLED').reduce((last, period) => !last || period.sequence > last.sequence ? period : last, null);
    const returnPeriodId = value.returnedOn && lastPeriod && day(lastPeriod.effectiveEndDate) === day(value.returnedOn) ? lastPeriod.id : null;
    return { orderId, orderStatus: value.orderStatus, policyVersion: value.policyVersion, startedOn: day(value.startedOn), startedOnText: date(value.startedOn), returnedOn: day(value.returnedOn) || null, returnedOnText: value.returnedOn ? date(value.returnedOn) : '', baseAllowanceKm: 1500, excessPriceAmount: value.excessPriceAmount, excessPriceText: money(value.excessPriceAmount), packBalanceKm: value.packBalanceKm, packStatus: value.packStatus,
      packStatusText: { ACTIVE: '当前订阅期可用', FROZEN: '已冻结，仅用于归还前未结算月份', EXPIRED: '订阅已结束，剩余包额度失效' }[value.packStatus], periods: value.periods.map(period => periodView(period, period.id === returnPeriodId)), packs,
      ledger: value.ledger.map(row => { if (typeof row?.id !== 'string' || !Number.isSafeInteger(row.deltaKm)) response(); return { id: row.id, type: row.type, typeText:{GRANT:'支付到账发放',CONSUME:'月结算抵扣',EXPIRE:'订阅结束失效',REFUND:'退款收回'}[row.type]||'额度变动',periodId: row.periodId || null, packId: row.packId || null, deltaKm: row.deltaKm, createdAt: row.createdAt }; }), products, purchaseTerms: terms,
      canPurchase: value.canPurchase === true && value.orderStatus === 'ACTIVE' && value.packStatus === 'ACTIVE' && Boolean(terms) && products.length > 0,
      returnSettlement: value.returnSettlement && typeof value.returnSettlement.id === 'string' && known(SETTLEMENT_STATUS, value.returnSettlement.status) ? { id: value.returnSettlement.id, status: value.returnSettlement.status, revision: value.returnSettlement.revision } : null };
  }
  async function getUsageAccount(orderId) { return usageView(await call('GET', '/customer/orders/' + identifier(orderId) + '/usage-account'), orderId); }
  function stableKey(kind, parts) { const key = JSON.stringify([getContext().customer?.id, kind, ...parts]); if (!keys.has(key)) keys.set(key, idempotencyKey(kind)); return { key, id: keys.get(key) }; }
  async function createMileagePack(orderId, payload) {
    if (payload?.accepted !== true) throw error('请先阅读并单独同意本次里程包购买规则。', 'CONSENT_REQUIRED');
    const account = await getUsageAccount(orderId), terms = account.purchaseTerms, product = account.products.find(row => row.id === payload.productId);
    if (!account.canPurchase || !product || !terms || terms.version !== payload.termsVersion || terms.hash !== payload.termsHash || terms.documentId!==payload.termsDocumentId || terms.documentVersion!==payload.termsDocumentVersion) throw error('里程包规格、购买规则或订阅状态已改变，请刷新后重新阅读。', 'USAGE_PURCHASE_UNAVAILABLE');
    const key = stableKey('mileage-pack', [orderId, product.id, terms.version, terms.documentId,terms.documentVersion,terms.hash]);
    const value = await call('POST', '/customer/orders/' + identifier(orderId) + '/mileage-packs', { productId: product.id, termsVersion: terms.version, termsDocumentId:terms.documentId,termsDocumentVersion:terms.documentVersion,termsHash: terms.hash, accepted: true, idempotencyKey: key.id });
    const bill = billView(value?.bill), purchase = value?.purchase;
    if (!purchase || typeof purchase.id !== 'string' || !known(PACK_STATUS, purchase.status) || purchase.billId !== bill.id || purchase.km !== product.km || purchase.amount !== product.amount || bill.amount !== product.amount) response('里程包账单结果未核实，请刷新查询，不要重复创建。');
    keys.delete(key.key);
    return { purchase: { id: purchase.id, status: purchase.status, statusText: PACK_STATUS[purchase.status], billId: bill.id, km: purchase.km, amount: purchase.amount }, bill };
  }
  async function submitUsageReading(payload) {
    const ids = payload?.fileIds;
    if (!payload?.orderId || !payload.periodId || !nonnegative(payload.readingKm) || payload.readingKm > 9999999 || !Array.isArray(ids) || !ids.length || ids.length > 4 || ids.some(id => typeof id !== 'string' || !id) || typeof payload.recordedAt !== 'string' || !Number.isFinite(Date.parse(payload.recordedAt))) throw error('请选择订阅月，填写实际拍摄时间、整数读数并上传仪表证据。', 'VALIDATION');
    const account = await getUsageAccount(payload.orderId), period = account.periods.find(row => row.id === payload.periodId);
    const chinaDate = new Date(Date.parse(payload.recordedAt) + 8 * 3600000).toISOString().slice(0, 10);
    if (!period?.canSubmit || (period.startReadingKm !== null && payload.readingKm < period.startReadingKm) || chinaDate !== period.effectiveEndDate) throw error('该月份不可申报，或照片时间、读数不符合本月界证据，请联系人工补证。', 'USAGE_READING_UNAVAILABLE');
    const key = stableKey('usage-reading', [payload.orderId, period.id, payload.readingKm, payload.recordedAt, ids]);
    const result = await call('POST', '/customer/usage-periods/' + identifier(period.id) + '/readings', { readingKm: payload.readingKm, recordedAt: payload.recordedAt, fileIds: ids, idempotencyKey: key.id });
    if (typeof result?.id !== 'string' || (result.periodId && result.periodId !== period.id)) response('月界申报结果未核实，请刷新本月状态。');
    keys.delete(key.key); return { id: result.id, periodId: period.id, status: result.status };
  }
  function settlementView(value, id, orderId) {
    if (!value || value.id !== id || value.orderId !== orderId || !known(SETTLEMENT_STATUS, value.status) || !Number.isInteger(value.revision) || !Array.isArray(value.unsettledPeriodIds) || !Array.isArray(value.bills)) response('退订结算状态暂不可用，请联系人工。');
    const depositRefundRequiredAmount=nullable(value.depositRefundRequiredAmount);
    return { id, orderId, status: value.status, statusText: SETTLEMENT_STATUS[value.status], revision: value.revision, returnedOn: day(value.returnedOn), returnedOnText: date(value.returnedOn), unsettledPeriodIds: value.unsettledPeriodIds.filter(id => typeof id === 'string'), bills: value.bills.map(billView),depositRefundRequiredAmount,depositRefundRequiredText:depositRefundRequiredAmount==null?'待人工核对':money(depositRefundRequiredAmount),disputeReason: typeof value.disputeReason === 'string' ? value.disputeReason : '', resolutionNote: typeof value.resolutionNote === 'string' ? value.resolutionNote : '', canDispute: value.canDispute === true && value.status !== 'COMPLETED' };
  }
  async function getReturnSettlement(id, orderId) { return settlementView(await call('GET', '/customer/return-settlements/' + identifier(id)), id, orderId); }
  async function disputeReturnSettlement(id, payload) {
    const reason = String(payload?.reason || '').trim();
    if (!reason || reason.length > 500) throw error('请填写不超过500字的结算异议。', 'VALIDATION');
    const current = await getReturnSettlement(id, payload.orderId);
    if (!current.canDispute) throw error('当前结算不能重复提交异议，请联系人工。', 'USAGE_SETTLEMENT_STATE');
    const key = stableKey('usage-dispute', [id, reason]);
    const result = settlementView(await call('POST', '/customer/return-settlements/' + identifier(id) + '/dispute', { reason, idempotencyKey: key.id }), id, payload.orderId);
    keys.delete(key.key); return result;
  }
  return { getUsageAccount, createMileagePack, submitUsageReading, getReturnSettlement, disputeReturnSettlement, clearUsageKeys: () => keys.clear() };
}
module.exports = { createUsageApi };
