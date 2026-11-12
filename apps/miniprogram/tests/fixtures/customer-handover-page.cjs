const stages = {
  FACTS_PENDING: '请先阅读交接证据并提交交接意见。',
  PREPARING: '交接事实已确认，等待后台准备当前交接单并发起文档和印章复核。',
  REVIEWING: '交接单已准备，等待另一位工作人员完成文档和印章复核。',
  READY_TO_SIGN: '交接单已完成复核，请核对正文后自行签署。',
  VERIFYING: '正在核对您的签署结果，请勿重复签署。',
  WAITING_PLATFORM: '您的签署已核实，等待平台签署交接单。',
  ARCHIVING: '双方已签署，等待签署文件归档。',
  SIGNED: '交接单已签署归档，实际交付以后台确认结果为准。',
  REJECTED: '本次签署已拒绝，请联系后台处理。',
  EXPIRED: '本次签署已过期，请联系后台核对。',
  BLOCKED: '交接状态待核对，请刷新或联系后台。',
};
function handoverRecord(stage = 'PREPARING', overrides = {}) {
  const item = { id: 'offline-handover', orderId: 'offline-order', type: 'DELIVERY', revision: 2, manifestHash: 'a'.repeat(64), actualAt: '2026-10-26T10:30:00Z', actualAtDisplay: '2026-10-26 18:30:00', actualAtText: '2026-10-26 18:30:00（北京时间）', actualAtLabel: '实际交车时间', actualAtValid: true, vehicleTitle: '离线合成验收车辆', status: stage === 'FACTS_PENDING' ? 'PUBLISHED' : 'CUSTOMER_CONFIRMED', customerResponse: stage === 'FACTS_PENDING' ? null : 'CONFIRM', signatureStatus: stage === 'SIGNED' ? 'SIGNED' : stage === 'PREPARING' ? 'DRAFT' : 'PENDING', signedFileId: stage === 'SIGNED' ? 'offline-signed-file' : null, fileIds: ['offline-photo'], evidence: [{ id: 'offline-photo', name: '车辆外观与附件照片' }], checklist: [{ label: '外观、钥匙与随车附件', value: '离线合成证据：外观已逐项记录，钥匙 2 把。' }], ...overrides };
  return { ...item, signingReadiness: { version: 1, handoverId: item.id, manifestHash: item.manifestHash, revision: item.revision, stage, canSign: stage === 'READY_TO_SIGN', message: stages[stage] } };
}
module.exports = { handoverRecord, stages };
