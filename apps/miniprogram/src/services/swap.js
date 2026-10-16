const { date } = require('../utils/format');
const { assignmentView, assignmentHistory, beijingTime } = require('./vehicle-assignments');
const { createPaidSwapApi } = require('./paid-swap');
function createSwapApi({ call, identifier, error, idempotencyKey, getContext, sessionKey = () => null }) {
  const keys = new Map(), running = new Set();
  const { productView, termsView, purchaseView, clearPaidSwapState, ...paidMethods } = createPaidSwapApi({ call, identifier, error, idempotencyKey, getContext, sessionKey, getSwapAccount });
  const invalid = () => { throw error('换车次数或车辆数据尚未核实，请刷新或联系人工。', 'RESPONSE'); };
  const count = value => { if (!Number.isSafeInteger(value) || value < 0) invalid(); return value; };
  const day = value => { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) invalid(); return value; };
  function view(value, orderId) {
    if (!value || value.orderId !== orderId || !value.cycle || !Array.isArray(value.reservations) || !Array.isArray(value.ledger) || !Array.isArray(value.blockers)) invalid();
    const c = value.cycle, sequence = count(c.sequence); if (!sequence) invalid();
    const currentAssignment = assignmentView(value.currentAssignment, invalid);
    const startDate = day(c.startDate), endDate = day(c.endDate); if (startDate >= endDate) invalid();
    const cycle = row => row.source === 'PAID' && row.cycleSequence == null ? null : count(row.cycleSequence);
    const reservations = value.reservations.map(r => { if (typeof r.id !== 'string' || typeof r.changeId !== 'string' || !['FREE', 'PAID'].includes(r.source) || !['RESERVED', 'RELEASED', 'CONSUMED'].includes(r.status)) invalid(); return { id: r.id, changeId: r.changeId, source: r.source, sourceText: r.source === 'FREE' ? '免费次数' : '已有付费次数', cycleSequence: cycle(r), status: r.status, statusText: { RESERVED: '已预占，尚未消费', RELEASED: '已释放', CONSUMED: '已完成消费' }[r.status] }; });
    const ledger = value.ledger.map(r => { if (typeof r.id !== 'string' || !['RESERVE','RELEASE','CONSUME','GRANT','FREEZE','EXPIRE','REFUND','RESTORE'].includes(r.type) || !['FREE', 'PAID'].includes(r.source) || (r.changeId != null && typeof r.changeId !== 'string')) invalid(); return { id: r.id, type: r.type, typeText: { RESERVE: '预占', RELEASE: '释放预占', CONSUME: '实际完成消费', GRANT: '可信支付到账发放', FREEZE: '冻结，尚不可消费', EXPIRE: '订阅结束失效', REFUND: '可信退款收回', RESTORE: '已核查恢复原次数' }[r.type], sourceText: r.source === 'FREE' ? '免费次数' : '已有付费次数', cycleSequence: cycle(r), changeId: r.changeId || null, purchaseId: typeof r.purchaseId === 'string' ? r.purchaseId : null, actualAt: r.actualAt || null, actualAtText: r.actualAt ? beijingTime(r.actualAt) : '', recordedAtText: beijingTime(r.recordedAt) }; });
    if ((value.purchases != null && !Array.isArray(value.purchases)) || (value.purchaseBlockers != null && !Array.isArray(value.purchaseBlockers))) invalid();
    const product = productView(value.product), purchaseTerms = termsView(value.purchaseTerms), purchases = (value.purchases || []).map(r => purchaseView(r, orderId));
    const paid = Object.fromEntries(['paidAvailable','paidReserved','paidConsumed','paidFrozen','paidExpired'].map(k => [k, count(value[k] === undefined && !value.product ? 0 : value[k])]));
    return { orderId, startedOn: day(value.startedOn), startedOnText: date(value.startedOn), endDate: day(value.endDate), endDateText: date(value.endDate) + '（含当日）', currentAssignment, assignments: assignmentHistory(value.assignments, invalid), currentVehicleText: currentAssignment?.vehicle.title || '当前暂无车辆，换车待交付', cycle: { sequence, startDate, endDate, periodText: date(startDate) + '—' + date(endDate) + '（末日不含）', freeAvailable: count(c.freeAvailable), freeReserved: count(c.freeReserved), freeConsumed: count(c.freeConsumed) }, ...paid, product, purchaseTerms, purchases, purchaseBlockers: (value.purchaseBlockers || []).filter(v => typeof v === 'string'), canPurchase: value.canPurchase === true && !!product && !!purchaseTerms, canRequest: value.canRequest === true && currentAssignment?.status === 'ACTIVE', reservations, ledger, blockers: value.blockers.filter(v => typeof v === 'string') };
  }
  async function getSwapAccount(orderId) { return view(await call('GET', '/customer/orders/' + identifier(orderId) + '/swap-account'), orderId); }
  async function requestVehicleChange(orderId, payload) {
    const reason = typeof payload?.reason === 'string' ? payload.reason.trim() : '';
    if (!reason || reason.length > 500) throw error('请填写不超过500字的真实换车原因。', 'VALIDATION');
    if (running.has(orderId)) throw error('换车申请正在提交，请勿重复操作。', 'SWAP_BUSY');
    running.add(orderId);
    try {
      const current = await getSwapAccount(orderId); if (!current.canRequest) throw error('当前不能发起换车，请查看次数预占与进行中的变更或联系人工。', 'SWAP_UNAVAILABLE');
      const key = JSON.stringify([getContext().customer?.id, orderId, reason]); if (!keys.has(key)) keys.set(key, idempotencyKey('vehicle-change'));
      const value = await call('POST', '/customer/orders/' + identifier(orderId) + '/vehicle-changes', { reason, idempotencyKey: keys.get(key) });
      if (typeof value?.id !== 'string' || !value.id || value.kind !== 'VEHICLE_CHANGE') invalid();
      keys.delete(key); return { id: value.id, kind: value.kind, message: '换车申请已保存，等待运营报价；申请不代表车辆已更换或次数已消费。' };
    } finally { running.delete(orderId); }
  }
  return { ...paidMethods, getSwapAccount, requestVehicleChange, clearSwapKeys: () => { keys.clear(); clearPaidSwapState(); } };
}
module.exports = { createSwapApi };
