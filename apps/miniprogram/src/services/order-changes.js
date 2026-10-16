const { money, date } = require('../utils/format');
const { assignmentView, beijingTime } = require('./vehicle-assignments');
const STATES = { DRAFT: '方案准备中', REVIEW_PENDING: '资金安排待复核', REVIEWED: '资金安排已复核，待发布', AWAITING_CONFIRMATION: '待客户确认延期方案', AWAITING_SIGNATURE: '补充协议待签署', AWAITING_FINANCE: '资金安排待核实', READY: '待后台核对生效', SWAP_RETURNED: '已还旧车，待交新车', APPLIED: '延期方案已生效', CANCELLED: '延期流程已取消', REJECTED: '客户已拒绝此方案' };
const TERMINAL = ['APPLIED', 'CANCELLED', 'REJECTED'];
const PUBLIC = ['AWAITING_CONFIRMATION', 'AWAITING_SIGNATURE', 'AWAITING_FINANCE', 'READY', 'SWAP_RETURNED', ...TERMINAL];
const FINANCE = { PENDING: '待处理', PROCESSING: '处理中，待核实', SUCCESS: '已完成', SUCCEEDED: '已完成', REFUNDED: '已退款', FAILED: '失败，待人工处理', CLOSED: '已关闭', PUBLISHED: '待支付', PAID: '已支付', PARTIALLY_PAID: '部分支付', VOID: '已作废', REQUESTED: '待复核', APPROVED: '已复核' };
function createOrderChangesApi({ call, identifier, error, idempotencyKey, getContext, enterSigning }) {
  const keys = new Map(), running = new Set();
  const invalid = () => { throw error('变更方案数据不完整或状态未知，请刷新或联系客服核对。', 'RESPONSE'); };
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
  function documentView(row, swap) {
    return row && typeof row.id === 'string' && row.id && row.type === (swap ? 'vehicle-change-amendment' : 'delivery-delay-amendment') && Number.isInteger(row.version) && row.version > 0 && /^[a-f0-9]{64}$/i.test(row.hash) && typeof row.content === 'string' && row.content.trim() && !/\{\{|\}\}|待确认|待填写|待补齐/.test(row.content)
      ? { id: row.id, type: row.type, version: row.version, hash: row.hash, content: row.content } : null;
  }
  function view(value, id) {
    if (!value || typeof value.id !== 'string' || !value.id || (id && value.id !== id) || typeof value.orderId !== 'string' || !['DELIVERY_DELAY', 'VEHICLE_CHANGE'].includes(value.kind) || !Object.prototype.hasOwnProperty.call(STATES, value.status) || !Number.isInteger(value.revision) || value.revision < 0) invalid();
    const swap = value.kind === 'VEHICLE_CHANGE';
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
      quote = { id: q.id, revision: q.revision, commercialHash: q.commercialHash, newStartDate, newEndDate, newStartDateText: date(newStartDate), newEndDateText: date(newEndDate) + '（含当日）', months: q.months, periods, reason: text(q.reason), settlementExplanation: text(q.settlementExplanation), handoverArrangement: text(q.handoverArrangement), cancellationTerms: text(q.cancellationTerms), confirmedAt: q.confirmedAt || null, document: documentView(q.document, swap), ...deadline(q.expiresAt, value.status === 'AWAITING_CONFIRMATION') };
      if (swap) {
        const isRecovery = q.financeSourceQuoteId != null || q.recoveryFromQuoteId != null;
        if (isRecovery && (![q.financeSourceQuoteId, q.recoveryFromQuoteId].every(v => typeof v === 'string' && v.trim() && v !== q.id) || (q.previousQuoteId != null && (typeof q.previousQuoteId !== 'string' || !q.previousQuoteId.trim())))) invalid();
        Object.assign(quote, { isRecovery, financeSourceQuoteId: isRecovery ? q.financeSourceQuoteId : null, recoveryFromQuoteId: isRecovery ? q.recoveryFromQuoteId : null, previousQuoteId: text(q.previousQuoteId) });
        for (const key of ['newMonthlyFeeAmount', 'depositAmount', 'depositChargeAmount', 'depositRefundAmount', 'handoverFeeAmount']) { quote[key] = amount(q[key]); quote[key + 'Text'] = money(q[key]); }
        Object.assign(quote, { plannedReturnAt: q.plannedReturnAt, plannedDeliveryAt: q.plannedDeliveryAt, plannedReturnAtText: beijingTime(q.plannedReturnAt), plannedDeliveryAtText: beijingTime(q.plannedDeliveryAt), oldVehicleIdentification: text(q.oldVehicleIdentification), targetVehicleIdentification: text(q.targetVehicleIdentification), financialGate: q.financialGate, financialGateText: q.financialGate === 'BEFORE_RETURN' ? '旧车交还前核清本次应退、押金调整、交接费用及交付所在期应收；后续月份按到期日主动付款。' : '资金门槛待核对，暂不可确认', handoverFeeBasis: text(q.handoverFeeBasis), depositBasis: text(q.depositBasis), insuranceResponsibility: text(q.insuranceResponsibility), downtimeArrangement: text(q.downtimeArrangement) });
      }
    }
    const finance = value.finance;
    if (!finance || !Array.isArray(finance.obligations) || !Array.isArray(finance.refunds) || !Array.isArray(finance.blockers) || !Array.isArray(value.blockers)) invalid();
    const obligations = finance.obligations.map(row => {
      const item = { ...periodView(row), chargeBillId: typeof row.chargeBillId === 'string' ? row.chargeBillId : null, chargeStatusText: FINANCE[row.chargeStatus] || '待人工核对' };
      for (const key of ['amount', 'allocatedAmount', 'chargeAmount']) { item[key] = amount(row[key]); item[key + 'Text'] = money(item[key]); }
      return item;
    });
    const refunds = finance.refunds.map(row => { if (typeof row.id !== 'string') invalid(); return { id: row.id, amount: amount(row.amount), amountText: money(row.amount), status: text(row.status), statusText: FINANCE[row.status] || '待人工核对' }; });
    const adjustments = (finance.adjustments || []).map(row => { if (typeof row.id !== 'string' || !['DEPOSIT_ADJUSTMENT', 'SWAP_HANDOVER_FEE'].includes(row.type)) invalid(); return { id: row.id, type: row.type, title: row.type === 'DEPOSIT_ADJUSTMENT' ? '押金调整账单' : '换车交接费用', amount: amount(row.amount), amountText: money(row.amount), paidAmount: amount(row.paidAmount), paidAmountText: money(row.paidAmount), statusText: FINANCE[row.status] || '待人工核对', dueDateText: date(day(row.dueDate)) }; });
    const c = value.contract;
    const contract = c ? { id: text(c.id), status: text(c.status), sourceFileId: text(c.sourceFileId), signedFileId: text(c.signedFileId), statusText: c.status === 'SIGNED' && c.signedFileId ? '双方签署完成，已归档' : c.status === 'SIGNED' ? '归档待核实' : c.status === 'PENDING' ? '签署结果确认中' : '补充协议待完成' } : null;
    const currentAssignment = swap ? assignmentView(value.currentAssignment, invalid) : null;
    const originalAssignment = swap ? assignmentView(value.originalAssignment, invalid) : null;
    let targetVehicle = null;
    if (swap && value.targetVehicle) { if (typeof value.targetVehicle.id !== 'string' || typeof value.targetVehicle.title !== 'string') invalid(); targetVehicle = { id: value.targetVehicle.id, title: value.targetVehicle.title, plateNumber: text(value.targetVehicle.plateNumber), vin: text(value.targetVehicle.vin) }; }
    const handover = row => { if (!row) return null; if (typeof row.id !== 'string' || !['SWAP_RETURN', 'SWAP_DELIVERY'].includes(row.type) || typeof row.vehicleId !== 'string') invalid(); const completed = row.status === 'COMPLETED'; return { id: row.id, type: row.type, label: row.type === 'SWAP_RETURN' ? '旧车交还' : '新车交付', completed, actionText: completed ? '查看已完成交接及归档记录' : row.type === 'SWAP_RETURN' ? '核对旧车交还事实与签署' : '核对新车交付事实与签署', vehicleId: row.vehicleId, assignmentId: row.assignmentId || null, status: row.status, statusText: { PUBLISHED: '待事实确认', CUSTOMER_CONFIRMED: '事实已确认', OBJECTION_SUBMITTED: '异议待处理', COMPLETED: '物理交接已完成', SUPERSEDED: '已有修订版本', DRAFT: '运营准备中' }[row.status] || '状态待核实', signatureStatus: row.signatureStatus, actualAtText: beijingTime(row.actualAt), readingKm: amount(row.readingKm) }; };
    const complete = Boolean(quote?.document && [quote.reason, quote.settlementExplanation, quote.handoverArrangement, quote.cancellationTerms].every(v => v.trim()) && quote.periods.every(p => p.calculationBasis.trim()) && (!swap || (targetVehicle && quote.financialGate === 'BEFORE_RETURN' && quote.plannedReturnAtText !== '待核对' && quote.plannedDeliveryAtText !== '待核对' && [quote.oldVehicleIdentification, quote.targetVehicleIdentification, quote.handoverFeeBasis, quote.depositBasis, quote.insuranceResponsibility, quote.downtimeArrangement].every(v => v.trim()))));
    const statusText = swap ? { AWAITING_CONFIRMATION: '待客户确认换车方案', READY: '待两侧交接及后台核对', APPLIED: '换车已实际完成并生效', CANCELLED: '换车流程已取消' }[value.status] || STATES[value.status] : STATES[value.status];
    return { id: value.id, orderId: value.orderId, kind: value.kind, isSwap: swap, status: value.status, revision: value.revision, title: swap ? '换车补充方案' : '延期交车补充方案', statusText, reason: text(value.reason), subtitle: quote ? quote.newStartDateText + '起 · 保持' + quote.months + '个月' : '正式方案尚待发布', quote, contract, currentAssignment, originalAssignment, targetVehicle, returnHandover: handover(value.returnHandover), deliveryHandover: handover(value.deliveryHandover), actualCompletedAtText: value.actualCompletedAt ? beijingTime(value.actualCompletedAt) : '', recordedAtText: value.recordedAt ? beijingTime(value.recordedAt) : '', finance: { obligations, refunds, adjustments, depositRefundAmountText: finance.depositRefundAmount == null ? '' : money(amount(finance.depositRefundAmount)), blockers: finance.blockers.filter(v => typeof v === 'string') }, blockers: value.blockers.filter(v => typeof v === 'string'), capabilityNote: text(value.capabilityNote), canConfirm: complete && quote.confirmationDeadlineValid && !quote.confirmationExpired && value.status === 'AWAITING_CONFIRMATION' && value.canConfirm === true, canReject: value.status === 'AWAITING_CONFIRMATION' && value.canReject === true, canSign: complete && value.status === 'AWAITING_SIGNATURE' && value.canSign === true, canSync: value.canSync === true && !['CANCELLED', 'REJECTED'].includes(value.status) };
  }
  function summary(value) {
    if (!value || typeof value.id !== 'string' || !value.id || typeof value.orderId !== 'string' || !['DELIVERY_DELAY', 'VEHICLE_CHANGE'].includes(value.kind) || !Object.prototype.hasOwnProperty.call(STATES, value.status) || !Number.isInteger(value.revision) || value.revision < 0) invalid();
    const raw = value.quoteSummary;
    let quoteSummary = null;
    if (raw && PUBLIC.includes(value.status)) {
      if (typeof raw.id !== 'string' || !Number.isInteger(raw.revision) || raw.revision < 1 || !/^[a-f0-9]{64}$/i.test(raw.commercialHash) || !Number.isInteger(raw.months) || raw.months < 1 || raw.months > 120) invalid();
      quoteSummary = { id: raw.id, revision: raw.revision, commercialHash: raw.commercialHash, newStartDate: day(raw.newStartDate), newEndDate: day(raw.newEndDate), months: raw.months, targetVehicleTitle: text(raw.targetVehicleTitle), plannedReturnAtText: raw.plannedReturnAt ? beijingTime(raw.plannedReturnAt) : '', plannedDeliveryAtText: raw.plannedDeliveryAt ? beijingTime(raw.plannedDeliveryAt) : '', ...deadline(raw.expiresAt, value.status === 'AWAITING_CONFIRMATION') };
    }
    return { id: value.id, orderId: value.orderId, kind: value.kind, status: value.status, revision: value.revision, reason: text(value.reason), createdAt: text(value.createdAt), title: value.kind === 'VEHICLE_CHANGE' ? '换车补充方案' : '延期交车补充方案', statusText: quoteSummary?.confirmationExpired ? '客户确认期限已过，待新报价' : value.kind === 'VEHICLE_CHANGE' ? ({ AWAITING_CONFIRMATION: '待客户确认换车方案', READY: '待两侧交接及后台核对', APPLIED: '换车已实际完成并生效', CANCELLED: '换车流程已取消' }[value.status] || STATES[value.status]) : STATES[value.status], subtitle: quoteSummary ? (value.kind === 'VEHICLE_CHANGE' ? quoteSummary.targetVehicleTitle + ' · 原期限至' + date(quoteSummary.newEndDate) + '（含当日）' : date(quoteSummary.newStartDate) + '起 · 保持' + quoteSummary.months + '个月') : '正式方案尚待发布', quoteSummary };
  }
  async function getOrderChange(id) { return view(await call('GET', '/customer/order-changes/' + identifier(id)), id); }
  async function getOrderChanges(params = {}) { if (params.kind && !['DELIVERY_DELAY', 'VEHICLE_CHANGE'].includes(params.kind)) throw error('变更类型无效。', 'VALIDATION'); const result = await call('GET', '/customer/order-changes', { page: params.page || 1, pageSize: params.pageSize || 50, ...(params.kind ? { kind: params.kind } : {}) }); if (!Array.isArray(result?.items) || !Number.isInteger(result.total) || result.total < 0) invalid(); return { total: result.total, page: result.page, pageSize: result.pageSize, items: result.items.map(summary) }; }
  async function act(id, action, payload = {}) {
    if (!Number.isInteger(payload.revision) || payload.revision < 1 || (action === 'confirm' && (payload.read !== true || !payload.commercialHash)) || (action === 'reject' && (!text(payload.reason).trim() || payload.reason.trim().length > 500))) throw error('请完整阅读当前方案，确认版本并填写必要意见。', 'VALIDATION');
    const busyKey = id + ':' + action;
    if (running.has(busyKey)) throw error('当前操作正在提交，请等待结果。', 'CHANGE_BUSY');
    running.add(busyKey);
    try {
      const current = await getOrderChange(id);
      if (current.revision !== payload.revision || (action === 'confirm' && current.quote?.commercialHash !== payload.commercialHash)) throw error('方案版本已改变，请刷新后重新阅读。', 'CHANGE_STALE');
      const capability = { confirm: 'canConfirm', reject: 'canReject', sign: 'canSign', sync: 'canSync' }[action];
      if (!capability || !current[capability]) throw error('当前变更流程不可执行此操作，请刷新或联系人工。', 'CHANGE_UNAVAILABLE');
      const body = { revision: current.revision, ...(action === 'confirm' ? { commercialHash: current.quote.commercialHash } : {}), ...(action === 'reject' ? { reason: payload.reason.trim() } : {}) };
      const key = JSON.stringify([getContext().customer?.id, id, action, body]); if (!keys.has(key)) keys.set(key, idempotencyKey('order-change'));
      if (action === 'sign') return enterSigning('order-change', id, { ...body, idempotencyKey: keys.get(key) });
      const result = await call('POST', '/customer/order-changes/' + identifier(id) + '/' + action, { ...body, idempotencyKey: keys.get(key) });
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
