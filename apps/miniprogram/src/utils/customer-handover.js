const STAGES = {
  FACTS_PENDING: '待确认交接事实', PREPARING: '等待后台准备', REVIEWING: '等待双人复核',
  READY_TO_SIGN: '可以签署', VERIFYING: '签署结果待核实', WAITING_PLATFORM: '等待平台签署',
  ARCHIVING: '等待文件归档', SIGNED: '已签署归档', REJECTED: '签署已拒绝',
  EXPIRED: '签署已过期', BLOCKED: '状态待核对',
};
function handoverSigning(handover) {
  const fallback = { available: false, stage: 'BLOCKED', title: STAGES.BLOCKED, canSign: false, canOpenSigned: false, message: '签署状态暂不可用，请刷新交接状态或联系后台核对。' };
  const ready = handover?.signingReadiness;
  if(handover?.confirmationMode==='ONLINE_RECORD'){
    const blocked={...fallback,onlineRecord:true,confirmationBlocked:true,message:'线上交接记录或约定暂不可用，请刷新或联系平台核对。'};
    const record=handover.onlineRecord,titles={FACTS_PENDING:'待本人确认',WAITING_COMPLETION:'待平台核对实际完成',RECORDED:'已完成并留存',OBJECTION_SUBMITTED:'异议处理中',SUPERSEDED:'本版本已被替代',BLOCKED:'状态待核对'};
    const text=value=>typeof value==='string'&&!!value.trim();
    const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
    const evidence=record?.evidence;
    if(ready?.version!==3||ready.confirmationMode!=='ONLINE_RECORD'||ready.handoverId!==handover.id||ready.revision!==handover.revision||!Number.isSafeInteger(handover.revision)||handover.revision<1||!hash(handover.manifestHash)||ready.manifestHash!==handover.manifestHash||!Object.prototype.hasOwnProperty.call(titles,ready.stage)||ready.canSign!==false||!text(ready.message)||!text(record?.documentId)||!text(record?.termsVersion)||!text(record?.termsTitle)||!text(record?.termsContent)||!hash(record?.termsHash)||!Array.isArray(evidence)||!evidence.length||!Array.isArray(handover.fileIds)||new Set(handover.fileIds).size!==handover.fileIds.length||evidence.length!==handover.fileIds.length||new Set(evidence.map(e=>e?.fileId)).size!==evidence.length||!evidence.every(e=>handover.fileIds.includes(e?.fileId)&&hash(e?.sha256)&&Number.isSafeInteger(e?.size)&&e.size>0))return blocked;
    const canRespond=ready.stage==='FACTS_PENDING'&&handover.status==='PUBLISHED'&&!handover.customerResponse;
    return{available:true,onlineRecord:true,confirmationBlocked:!canRespond,stage:ready.stage,title:titles[ready.stage],canSign:false,canOpenSigned:false,message:ready.message};
  }
  if(handover?.confirmationMode!=null&&handover.confirmationMode!=='SEPARATE_DOCUMENT')return{...fallback,confirmationBlocked:true,message:'交接确认方式暂不可用，请联系平台核对。'};
  if(handover?.executionMode==='OFFLINE'||ready?.executionMode==='OFFLINE'){
    const titles={FACTS_PENDING:'待确认查验事实',PAPER_PENDING:'等待纸质交接单',PAPER_REVIEWING:'纸质单审核中',PAPER_ARCHIVED:'纸质单已归档',BLOCKED:'状态待核对'};
    if(ready?.version!==2||ready.handoverId!==handover.id||!handover.manifestHash||ready.manifestHash!==handover.manifestHash||!Number.isSafeInteger(handover.revision)||handover.revision<1||ready.revision!==handover.revision||!titles[ready.stage]||typeof ready.message!=='string')return{...fallback,offline:true,message:'纸质交接单状态暂不可用，请刷新或联系平台核对。'};
    return{available:true,offline:true,stage:ready.stage,title:titles[ready.stage],canSign:false,canOpenSigned:false,message:ready.message,archiveId:ready.archive?.archiveId||'',canReadArchive:!!ready.archive?.versions?.some(v=>['ARCHIVED','INVALIDATED'].includes(v.status))};
  }
  if (!handover || !handover.id || !handover.manifestHash || !Number.isSafeInteger(handover.revision) || handover.revision < 1 ||
    ready?.version !== 1 || ready.handoverId !== handover.id || ready.manifestHash !== handover.manifestHash || ready.revision !== handover.revision ||
    !Object.prototype.hasOwnProperty.call(STAGES, ready.stage) || typeof ready.canSign !== 'boolean' || typeof ready.message !== 'string' || !ready.message.trim()) return fallback;
  const canSign = ready.stage === 'READY_TO_SIGN' && ready.canSign && handover.actualAtValid === true && handover.status === 'CUSTOMER_CONFIRMED' && handover.customerResponse === 'CONFIRM' && ['DRAFT', 'PENDING'].includes(handover.signatureStatus);
  // A raw signature status alone does not prove that a signed file is archived.
  const canOpenSigned = ready.stage === 'SIGNED' && handover.signatureStatus === 'SIGNED' && typeof handover.signedFileId === 'string' && Boolean(handover.signedFileId);
  if (ready.historyOnly === true) return { available: true, historyOnly: true, stage: ready.stage, title: '历史交接资料', canSign: false, canOpenSigned, message: ready.message };
  if (ready.stage === 'READY_TO_SIGN' && !canSign) return fallback;
  return { available: true, stage: ready.stage, title: STAGES[ready.stage], canSign, canOpenSigned, message: ready.message };
}
module.exports = { handoverSigning };
