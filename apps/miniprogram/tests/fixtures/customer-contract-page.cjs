const phases = {
  PREPARING: '合同准备中', REVIEWING: '合同复核中', READY_TO_SIGN: '待您签署',
  VERIFYING: '签署结果核验中', WAITING_OWNER: '等待车主签署', ARCHIVING: '双方已签待归档',
  ARCHIVED: '已签署归档', REJECTED: '签署已拒绝', EXPIRED: '签署已过期', CANCELLED: '合同已取消',
};
function contractRecord(phase = 'READY_TO_SIGN', overrides = {}) {
  const signed = ['WAITING_OWNER', 'ARCHIVING', 'ARCHIVED'].includes(phase);
  const canSign = phase === 'READY_TO_SIGN';
  const canQuery = ['READY_TO_SIGN', 'VERIFYING', 'WAITING_OWNER', 'ARCHIVING'].includes(phase);
  const descriptions = {
    PREPARING: '运营正在准备本单正式合同文件，完成后将进入文件复核。', REVIEWING: '运营正在复核合同全文与冻结条件，复核通过后您可签署。',
    READY_TO_SIGN: '请核对合同原文与冻结的订阅条件，阅读后自行签署。', VERIFYING: '您的签署交易已有尝试，结果尚待核实，请查询原交易进度。',
    WAITING_OWNER: '您的签署结果已核实，请等待车主完成签署。', ARCHIVING: '双方签署结果已核实，正在核对并归档签署文件。',
    ARCHIVED: '双方签署与文件归档已核实，可查看签署归档文件。', REJECTED: '本次签署已拒绝，请联系运营核对后续安排。',
    EXPIRED: '本次签署已过期，请联系运营核对，不要重复发起原签署。', CANCELLED: '本合同已取消，可保留查看历史记录。',
  };
  const current = { PREPARING: 0, REVIEWING: 1, READY_TO_SIGN: 2, VERIFYING: 2, WAITING_OWNER: 3, ARCHIVING: 4, ARCHIVED: 5 }[phase];
  const ownerSigned = ['ARCHIVING', 'ARCHIVED'].includes(phase);
  const detail = {
    version: 1, contractId: 'offline-contract', orderId: 'offline-order', kind: 'SUBSCRIPTION', status: phase === 'ARCHIVED' ? 'SIGNED' : 'PENDING',
    phase, phaseText: phases[phase], guidance: { title: phases[phase], description: descriptions[phase] },
    vehicle: { title: 'ET5T · 合成订阅车辆' }, lessor: { name: '离线合成车辆出租企业有限公司' },
    summaryRows: [{ label: '月订阅费', value: '¥0.01' }, { label: '押金', value: '¥0.00' }, { label: '订阅期限', value: '12 个月' }, { label: '起止日期', value: '2026.10.26 — 2027.10.25' }],
    parties: [{ role: 'CUSTOMER', label: '您（承租方）', name: '合成客户', status: signed ? 'SIGNED' : phase === 'VERIFYING' ? 'VERIFYING' : 'PENDING', statusText: signed ? '已核实签署' : phase === 'VERIFYING' ? '结果核验中' : '待签署' }, { role: 'OWNER', label: '车主（出租方）', name: '离线合成车辆出租企业有限公司', status: ownerSigned ? 'SIGNED' : 'PENDING', statusText: ownerSigned ? '已核实签署' : '待签署' }],
    progress: [['prepare', '合同准备'], ['review', '文件复核'], ['customer', '您签署'], ['owner', '车主签署'], ['archive', '文件归档']].map(([id, title], index) => ({ id, title, state: current === undefined ? index < 2 ? 'DONE' : 'STOPPED' : index < current ? 'DONE' : index === current ? 'CURRENT' : 'PENDING' })),
    documents: ['PREPARING', 'REVIEWING'].includes(phase) ? [] : [{ id: 'offline-source', kind: 'SOURCE', title: '合同原文（未签署）' }, ...(phase === 'ARCHIVED' ? [{ id: 'offline-signed', kind: 'SIGNED', title: '双方签署归档文件' }] : [])],
    canSign, canQuery, primaryAction: canSign ? { id: 'sign', label: '签署合同' } : canQuery ? { id: 'query', label: '查询签署进度' } : null,
    createdAtText: '2026-10-26 09:10（北京时间）', updatedAtText: '2026-10-26 09:30（北京时间）', templateVersion: 3,
    ...overrides,
  };
  return { id: 'offline-contract', type: 'contracts', title: '车辆订阅合同', status: detail.status, statusText: '旧通用待处理', actions: [{ id: 'sign', label: '旧通用签署' }], documents: [{ id: 'forged-file', title: '不可沿用旧文件' }], details: [], timeline: [], contractDetail: detail };
}
module.exports = { contractRecord, phases };
