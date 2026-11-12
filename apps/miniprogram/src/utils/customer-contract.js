const PHASES = ['PREPARING', 'REVIEWING', 'READY_TO_SIGN', 'VERIFYING', 'WAITING_OWNER', 'ARCHIVING', 'ARCHIVED', 'REJECTED', 'EXPIRED', 'CANCELLED'];
const PARTY_STATUS = ['PENDING', 'SIGNED', 'VERIFYING', 'REJECTED', 'EXPIRED', 'UNAVAILABLE'];
function contractOverview(record, id) {
  const fallback = { available: false, id, primaryAction: null, canSign: false, canQuery: false, documents: [] };
  const detail = record?.contractDetail;
  const strings = (value, keys) => value && keys.every(key => typeof value[key] === 'string');
  const rows = (value, keys) => Array.isArray(value) && value.every(row => strings(row, keys));
  if(record?.id===id&&detail?.version===2&&detail.executionMode==='OFFLINE'&&detail.contractId===id&&typeof detail.orderId==='string'&&/^[-\w]+$/.test(detail.orderId)&&['OFFLINE_PREPARING','OFFLINE_REVIEWING','OFFLINE_NEEDS_UPDATE','OFFLINE_ARCHIVED'].includes(detail.phase)&&strings(detail.guidance,['title','description'])&&strings(detail.vehicle,['title'])&&strings(detail.lessor,['name'])&&rows(detail.summaryRows,['label','value'])&&rows(detail.parties,['role','label','name','statusText'])&&rows(detail.progress,['id','title','state'])&&Array.isArray(detail.documents)){
    const documents=detail.documents.flatMap(file=>{const match=typeof file.url==='string'&&file.url.match(/^\/api\/customer\/offline-archives\/([A-Za-z0-9_-]+)\/versions\/([A-Za-z0-9_-]+)\/files\/([A-Za-z0-9_-]+)$/);return match&&match[3]===file.id&&match[1]===detail.archive?.archiveId?[{id:file.id,title:file.title,label:'纸质合同归档文件',kind:'SIGNED',archiveId:match[1],versionId:match[2]}]:[];});
    return{available:true,id,offline:true,executionMode:'OFFLINE',orderId:detail.orderId,kind:detail.kind,phase:detail.phase,phaseText:detail.phaseText,guidance:detail.guidance,vehicle:detail.vehicle,lessor:detail.lessor,summaryRows:detail.summaryRows,parties:detail.parties,progress:detail.progress,documents,sourceFileId:documents[0]?.id||'',archiveId:detail.archive?.archiveId||'',canSign:false,canQuery:false,primaryAction:null,createdAtText:detail.createdAtText,updatedAtText:detail.updatedAtText,templateVersion:''};
  }
  if (record?.id !== id || detail?.version !== 1 || detail.contractId !== id || !detail.orderId || detail.status !== record.status ||
    !strings(detail, ['orderId', 'kind', 'status', 'phaseText', 'createdAtText', 'updatedAtText']) || !PHASES.includes(detail.phase) ||
    !['SUBSCRIPTION', 'AMENDMENT'].includes(detail.kind) || !['DRAFT', 'PENDING', 'SIGNED', 'REJECTED', 'EXPIRED', 'CANCELLED'].includes(detail.status) ||
    !(detail.templateVersion === null || typeof detail.templateVersion === 'string' || Number.isSafeInteger(detail.templateVersion) && detail.templateVersion > 0) ||
    !strings(detail.guidance, ['title', 'description']) || !strings(detail.vehicle, ['title']) || !strings(detail.lessor, ['name']) ||
    !rows(detail.summaryRows, ['label', 'value']) || !rows(detail.parties, ['role', 'label', 'name', 'status', 'statusText']) ||
    !detail.parties.every(party => ['CUSTOMER', 'OWNER', 'PLATFORM'].includes(party.role) && PARTY_STATUS.includes(party.status)) ||
    !rows(detail.progress, ['id', 'title', 'state']) || !detail.progress.every(step => ['DONE', 'CURRENT', 'PENDING', 'STOPPED'].includes(step.state)) ||
    !rows(detail.documents, ['id', 'kind', 'title']) || !detail.documents.every(file => file.id && ['SOURCE', 'SIGNED'].includes(file.kind)) ||
    new Set(detail.documents.map(file => file.id)).size !== detail.documents.length ||
    typeof detail.canSign !== 'boolean' || typeof detail.canQuery !== 'boolean' ||
    (detail.primaryAction !== null && (!strings(detail.primaryAction, ['id', 'label']) || !['sign', 'query'].includes(detail.primaryAction.id)))) return fallback;
  const customer = detail.parties.filter(party => party.role === 'CUSTOMER');
  const source = detail.documents.find(file => file.kind === 'SOURCE');
  const canSign = detail.canSign && detail.kind !== 'AMENDMENT' && detail.phase === 'READY_TO_SIGN' && customer.length === 1 && customer[0].status === 'PENDING' && Boolean(source);
  // The legacy platform status endpoint can execute signing. Only the owner
  // task query is a read-only verification path for this page.
  const canQuery = detail.canQuery && detail.kind !== 'AMENDMENT' && !detail.parties.some(party => party.role === 'PLATFORM') && ['READY_TO_SIGN', 'VERIFYING', 'WAITING_OWNER', 'ARCHIVING'].includes(detail.phase);
  const action = detail.primaryAction;
  const primaryAction = action?.id === 'sign' && canSign || action?.id === 'query' && canQuery ? { id: action.id, label: action.label } : null;
  return {
    available: true, id, orderId: detail.orderId, kind: detail.kind, phase: detail.phase, phaseText: detail.phaseText,
    guidance: detail.guidance, vehicle: detail.vehicle, lessor: detail.lessor, summaryRows: detail.summaryRows,
    parties: detail.parties, progress: detail.progress, documents: detail.documents.map(file => ({ id: file.id, kind: file.kind, title: file.title, label: file.kind === 'SIGNED' ? '双方签署归档文件' : '合同原文（未签署）' })),
    sourceFileId: source?.id || '', canSign, canQuery, primaryAction,
    createdAtText: detail.createdAtText, updatedAtText: detail.updatedAtText, templateVersion: detail.templateVersion === null ? '' : String(detail.templateVersion),
  };
}
module.exports = { contractOverview };
