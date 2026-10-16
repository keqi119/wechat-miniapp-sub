const { money, date } = require('../utils/format');
const STATES = { DRAFT: '方案准备中', REVIEW_PENDING: '资金安排待复核', REVIEWED: '资金安排已复核，待发布', AWAITING_CONFIRMATION: '待客户确认延期方案', AWAITING_SIGNATURE: '补充协议待签署', AWAITING_FINANCE: '资金安排待核实', READY: '待后台核对生效', APPLIED: '延期方案已生效', CANCELLED: '延期流程已取消', REJECTED: '客户已拒绝此方案' };
const TERMINAL = ['APPLIED', 'CANCELLED', 'REJECTED'];
const PUBLIC = ['AWAITING_CONFIRMATION', 'AWAITING_SIGNATURE', 'AWAITING_FINANCE', 'READY', ...TERMINAL];
const FINANCE = { PENDING: '待处理', PROCESSING: '处理中，待核实', SUCCESS: '已完成', SUCCEEDED: '已完成', REFUNDED: '已退款', FAILED: '失败，待人工处理', CLOSED: '已关闭', PUBLISHED: '待支付', PAID: '已支付', PARTIALLY_PAID: '部分支付', VOID: '已作废', REQUESTED: '待复核', APPROVED: '已复核' };
function createOrderChangesApi({ call, identifier, error, idempotencyKey, getContext, enterSigning }) {
  const keys = new Map(), running = new Set();
  const invalid = () => { throw error('延期方案数据不完整或状态未知，请刷新或联系客服核对。', 'RESPONSE'); };
  const text = value => typeof value === 'string' ? value : '';
  const amount = value => { if (!Number.isSafeInteger(value) || value < 0) invalid(); return value; };
  const day = value => { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) invalid(); return value; };
  function deadline(value, awaitingConfirmation) {
    const time = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
    const confirmationDeadlineValid = Number.isFinite(time);
    return { expiresAt: confirmationDeadlineValid ? value : null, expiresAtText: confirmationDeadlineValid ? new Date(time + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ') + '（北京时间）' : '期限待核对', confirmationDeadlineValid, confirmationExpired: Boolean(awaitingConfirmation && confirmationDeadlineValid && time <= Date.now()) };
  }
  const periodView = row => {
    if (!row || !Number.isInteger(row.sequence) || row.sequence < 1) invalid();
    const startDate = day(row.startDate), endDate = day(row.endDate), dueDate = day(row.dueDate);
    if (startDate >= endDate) invalid();
    return { sequence: row.sequence, startDate, endDate, dueDate, periodText: date(startDate) + '—' + date(endDate) + '（末日不含）', dueDateText: date(dueDate) };
  };
  function documentView(row) {
    return row && typeof row.id === 'string' && row.id && row.type === 'delivery-delay-amendment' && Number.isInteger(row.version) && row.version > 0 && /^[a-f0-9]{64}$/i.test(row.hash) && typeof row.content === 'string' && row.content.trim() && !/\{\{|\}\}/.test(row.content)
      ? { id: row.id, type: row.type, version: row.version, hash: row.hash, content: row.content } : null;
  }
  function view(value, id) {
    if (!value || typeof value.id !== 'string' || !value.id || (id && value.id !== id) || typeof value.orderId !== 'string' || value.kind !== 'DELIVERY_DELAY' || !Object.prototype.hasOwnProperty.call(STATES, value.status) || !Number.isInteger(value.revision) || value.revision < 0) invalid();
    let quote = null;
    if (value.quote && PUBLIC.includes(value.status)) {
      const q = value.quote;
      if (typeof q.id !== 'string' || !Number.isInteger(q.revision) || q.revision < 1 || !/^[a-f0-9]{64}$/i.test(q.commercialHash) || !Number.isInteger(q.months) || q.months < 1 || q.months > 120 || !Array.isArray(q.periods) || q.periods.length !== q.months) invalid();
      const newStartDate = day(q.newStartDate), newEndDate = day(q.newEndDate);
      const periods = q.periods.map(row => {
        const p = { ...periodView(row), calculationBasis: text(row.calculationBasis) };
        for (const key of ['amount', 'originalAmount', 'netPaidAmount', 'carryAmount', 'chargeAmount', 'refundAmount']) { p[key] = amount(row[key]); p[key + 'Text'] = money(p[key]); }
        return p;
      });
      if (periods.some((row, index) => row.sequence !== index + 1 || (index && row.startDate !== periods[index - 1].endDate)) || periods[0].startDate !== newStartDate || new Date(periods[periods.length - 1].endDate + 'T00:00:00Z').getTime() - Date.parse(newEndDate + 'T00:00:00Z') !== 86400000) invalid();
      quote = { id: q.id, revision: q.revision, commercialHash: q.commercialHash, newStartDate, newEndDate, newStartDateText: date(newStartDate), newEndDateText: date(newEndDate) + '（含当日）', months: q.months, periods, reason: text(q.reason), settlementExplanation: text(q.settlementExplanation), handoverArrangement: text(q.handoverArrangement), cancellationTerms: text(q.cancellationTerms), confirmedAt: q.confirmedAt || null, document: documentView(q.document), ...deadline(q.expiresAt, value.status === 'AWAITING_CONFIRMATION') };
    }
    const finance = value.finance;
    if (!finance || !Array.isArray(finance.obligations) || !Array.isArray(finance.refunds) || !Array.isArray(finance.blockers) || !Array.isArray(value.blockers)) invalid();
    const obligations = finance.obligations.map(row => {
      const item = { ...periodView(row), chargeBillId: typeof row.chargeBillId === 'string' ? row.chargeBillId : null, chargeStatusText: FINANCE[row.chargeStatus] || '待人工核对' };
      for (const key of ['amount', 'allocatedAmount', 'chargeAmount']) { item[key] = amount(row[key]); item[key + 'Text'] = money(item[key]); }
      return item;
    });
    const refunds = finance.refunds.map(row => { if (typeof row.id !== 'string') invalid(); return { id: row.id, amount: amount(row.amount), amountText: money(row.amount), status: text(row.status), statusText: FINANCE[row.status] || '待人工核对' }; });
    const c = value.contract;
    const contract = c ? { id: text(c.id), status: text(c.status), sourceFileId: text(c.sourceFileId), signedFileId: text(c.signedFileId), statusText: c.status === 'SIGNED' && c.signedFileId ? '双方签署完成，已归档' : c.status === 'SIGNED' ? '归档待核实' : c.status === 'PENDING' ? '签署结果确认中' : '补充协议待完成' } : null;
    const complete = Boolean(quote?.document && [quote.reason, quote.settlementExplanation, quote.handoverArrangement, quote.cancellationTerms].every(v => v.trim()) && quote.periods.every(p => p.calculationBasis.trim()));
    return { id: value.id, orderId: value.orderId, kind: value.kind, status: value.status, revision: value.revision, title: '延期交车补充方案', statusText: STATES[value.status], reason: text(value.reason), subtitle: quote ? quote.newStartDateText + '起 · 保持' + quote.months + '个月' : '正式方案尚待发布', quote, contract, finance: { obligations, refunds, blockers: finance.blockers.filter(v => typeof v === 'string') }, blockers: value.blockers.filter(v => typeof v === 'string'), capabilityNote: text(value.capabilityNote), canConfirm: complete && quote.confirmationDeadlineValid && !quote.confirmationExpired && value.status === 'AWAITING_CONFIRMATION' && value.canConfirm === true, canReject: value.status === 'AWAITING_CONFIRMATION' && value.canReject === true, canSign: complete && value.status === 'AWAITING_SIGNATURE' && value.canSign === true, canSync: value.canSync === true && !['CANCELLED', 'REJECTED'].includes(value.status) };
  }
  function summary(value) {
    if (!value || typeof value.id !== 'string' || !value.id || typeof value.orderId !== 'string' || value.kind !== 'DELIVERY_DELAY' || !Object.prototype.hasOwnProperty.call(STATES, value.status) || !Number.isInteger(value.revision) || value.revision < 0) invalid();
    const raw = value.quoteSummary;
    let quoteSummary = null;
    if (raw && PUBLIC.includes(value.status)) {
      if (typeof raw.id !== 'string' || !Number.isInteger(raw.revision) || raw.revision < 1 || !/^[a-f0-9]{64}$/i.test(raw.commercialHash) || !Number.isInteger(raw.months) || raw.months < 1 || raw.months > 120) invalid();
      quoteSummary = { id: raw.id, revision: raw.revision, commercialHash: raw.commercialHash, newStartDate: day(raw.newStartDate), newEndDate: day(raw.newEndDate), months: raw.months, ...deadline(raw.expiresAt, value.status === 'AWAITING_CONFIRMATION') };
    }
    return { id: value.id, orderId: value.orderId, kind: value.kind, status: value.status, revision: value.revision, reason: text(value.reason), createdAt: text(value.createdAt), title: '延期交车补充方案', statusText: quoteSummary?.confirmationExpired ? '客户确认期限已过，待新报价' : STATES[value.status], subtitle: quoteSummary ? date(quoteSummary.newStartDate) + '起 · 保持' + quoteSummary.months + '个月' : '正式方案尚待发布', quoteSummary };
  }
  async function getOrderChange(id) { return view(await call('GET', '/customer/order-changes/' + identifier(id)), id); }
  async function getOrderChanges(params = {}) { const result = await call('GET', '/customer/order-changes', { page: params.page || 1, pageSize: params.pageSize || 50 }); if (!Array.isArray(result?.items) || !Number.isInteger(result.total) || result.total < 0) invalid(); return { total: result.total, page: result.page, pageSize: result.pageSize, items: result.items.map(summary) }; }
  async function act(id, action, payload = {}) {
    if (!Number.isInteger(payload.revision) || payload.revision < 1 || (action === 'confirm' && (payload.read !== true || !payload.commercialHash)) || (action === 'reject' && (!text(payload.reason).trim() || payload.reason.trim().length > 500))) throw error('请完整阅读当前方案，确认版本并填写必要意见。', 'VALIDATION');
    const busyKey = id + ':' + action;
    if (running.has(busyKey)) throw error('当前操作正在提交，请等待结果。', 'CHANGE_BUSY');
    running.add(busyKey);
    try {
      const current = await getOrderChange(id);
      if (current.revision !== payload.revision || (action === 'confirm' && current.quote?.commercialHash !== payload.commercialHash)) throw error('延期方案版本已改变，请刷新后重新阅读。', 'CHANGE_STALE');
      const capability = { confirm: 'canConfirm', reject: 'canReject', sign: 'canSign', sync: 'canSync' }[action];
      if (!capability || !current[capability]) throw error('当前延期流程不可执行此操作，请刷新或联系人工。', 'CHANGE_UNAVAILABLE');
      const body = { revision: current.revision, ...(action === 'confirm' ? { commercialHash: current.quote.commercialHash } : {}), ...(action === 'reject' ? { reason: payload.reason.trim() } : {}) };
      const key = JSON.stringify([getContext().customer?.id, id, action, body]); if (!keys.has(key)) keys.set(key, idempotencyKey('order-change'));
      const result = await call('POST', '/customer/order-changes/' + identifier(id) + '/' + action, { ...body, idempotencyKey: keys.get(key) });
      if (action === 'sign') { const entry = await enterSigning('order-change', id, result); keys.delete(key); return entry; }
      const mapped = view(result, id); keys.delete(key); return mapped;
    } finally { running.delete(busyKey); }
  }
  async function queryOrderChangeSignature(id) {
    const current = await getOrderChange(id);
    const result = current.canSync ? await act(id, 'sync', { revision: current.revision }) : current;
    return { status: result.contract?.status === 'SIGNED' && result.contract.signedFileId ? 'SIGNED' : result.contract?.status === 'REJECTED' ? 'REJECTED' : 'PENDING', changeStatus: result.status };
  }
  return { getOrderChange, getOrderChanges, confirmOrderChange: (id, payload) => act(id, 'confirm', payload), rejectOrderChange: (id, payload) => act(id, 'reject', payload), signOrderChange: (id, payload) => act(id, 'sign', payload), syncOrderChange: (id, payload) => act(id, 'sync', payload), queryOrderChangeSignature, clearChangeKeys: () => keys.clear() };
}
module.exports = { createOrderChangesApi };
