const policy = require('./native-signing-policy');
const KINDS = { identity: '实名与证书准备', contract: '主合同签署', handover: '交接单签署', 'order-change': '订阅变更补充协议签署', 'technical-acceptance': '电子签署流程验证确认书' };
const TTL = 10 * 60 * 1000;
Object.assign(KINDS,{'owner-identity':'企业车主实名认证','owner-authority':'企业自动签署授权','owner-revoke':'撤销企业自动签署授权','owner-contract':'企业车主订阅合同签署'});
function createNativeSigningApi({ call, native, identifier, error, getContext, sessionKey = () => null, getSignStatus, platform, pendingKey }) {
  const tasks = new Map(), running = new Map(), flowVersions = new Map(); let generation = 0;
  const keyOf = (kind, id) => kind + ':' + id;
  function context(kind, id) {
    const current = getContext();
    if (!current.authenticated) throw error('请先登录后办理实名或签署。', 'AUTH_REQUIRED');
    if (!Object.prototype.hasOwnProperty.call(KINDS, kind) || typeof id !== 'string' || !id.trim() || (kind === 'identity' && id !== current.customer?.id)) throw error('实名或签署业务类型、记录编号无效，请从原记录重新进入。', 'SIGN_CONTEXT');
    return current;
  }
  function snapshot(kind, id) { const current = context(kind, id); return { generation, customerId: current.customer.id, sessionKey: sessionKey(), flowKey: keyOf(kind, id), flowVersion: flowVersions.get(keyOf(kind, id)) || 0 }; }
  function matches(stamp) { const current = getContext(); return current.authenticated && stamp.generation === generation && stamp.customerId === current.customer?.id && stamp.sessionKey === sessionKey() && stamp.flowVersion === (flowVersions.get(stamp.flowKey) || 0); }
  function assertCurrent(stamp) { if (!matches(stamp)) throw error('登录会话或当前流程已变化，请从本人记录重新进入。', 'SIGN_SESSION_CHANGED'); return getContext(); }
  async function getSigningConfig() { return policy.signingConfig(await call('GET', '/public/signing-config', undefined, false)); }
  async function enabled() { const config = await getSigningConfig(); if (!config.enabled || !config.signProviderConfigured || !config.providerHosts.length) throw error('小程序内实名与签署暂未启用，请联系运营。', 'MINIAPP_SIGNING_UNAVAILABLE'); return config; }
  function purgeLegacySigningCache() {
    const value = platform.getStorageSync?.(pendingKey);
    if (value && (Object.keys(value).some(key => !['kind', 'id'].includes(key)) || !Object.prototype.hasOwnProperty.call(KINDS, value.kind) || typeof value.id !== 'string' || !value.id.trim())) platform.removeStorageSync?.(pendingKey);
  }
  function getSigningTask(kind, id) {
    const current = context(kind, id), key = keyOf(kind, id), task = tasks.get(key);
    if (!task || task.customerId !== current.customer.id || !matches(task.stamp) || task.expiresAt <= Date.now()) { tasks.delete(key); return { kind, id, title: KINDS[kind], url: '', status: 'UNKNOWN', contextOnly: true }; }
    return { kind, id, title: KINDS[kind], taskId: task.taskId, url: task.url, status: task.status, expiresAt: task.expiresAt, faceBridgeConfigured: false };
  }
  async function enter(kind, id, result, config, stamp) {
    const current = assertCurrent(stamp);
    if (!result || !['PENDING', 'SIGNED'].includes(result.status) || (kind !== 'identity' && (typeof result.taskId !== 'string' || !result.taskId))) throw error('实名或签署任务响应未核实，请刷新原记录。', 'SIGN_RESPONSE');
    const url = result.url ? policy.providerUrl(result.url, config) : '';
    if (!url && result.status !== 'SIGNED') throw error('尚未取得有效的实名或签署页面，请查询当前状态后重试。', 'SIGN_RESPONSE');
    if (['identity','owner-identity'].includes(kind) && url && !/^https:\/\/realnameverify16\.fadada\.com\//.test(url)) throw error('实名页面域名与已核验配置不符。', 'SIGN_URL');
    if (!['identity','owner-identity'].includes(kind) && url && !/^https:\/\/textapi17\.fadada\.com\//.test(url)) throw error('签署页面域名与已核验配置不符。', 'SIGN_URL');
    if (result.status === 'SIGNED' && (await getSignStatus(id, kind)).status !== 'SIGNED') throw error('服务端尚未确认双方签署归档，请查询当前状态。', 'SIGN_STATUS');
    assertCurrent(stamp);
    // Short URLs and any identity input never enter storage or logs.
    tasks.set(keyOf(kind, id), { stamp, customerId: current.customer.id, taskId: result.taskId || 'identity', url, status: result.status, expiresAt: Date.now() + TTL, config });
    purgeLegacySigningCache(); platform.setStorageSync(pendingKey, { kind, id });
    await native('navigateTo', { url: '/pages/sign/index?kind=' + kind + '&id=' + identifier(id) });
    return { taskId: result.taskId, status: result.status, message: '实名或签署页面已打开，完成后请查询服务端结果。' };
  }
  async function startSigning(kind, id, body = {}) {
    const stamp = snapshot(kind, id);
    if (kind === 'identity' || kind.startsWith('owner-')) throw error('请从对应本人业务入口阅读并确认。', 'SIGN_CONTEXT');
    const key = keyOf(kind, id), lease = {}; if (running.has(key)) throw error('签署页面正在准备，请勿重复点击。', 'SIGN_BUSY'); running.set(key, lease);
    try { const config = await enabled(); assertCurrent(stamp); const route = kind === 'handover' ? 'handovers' : kind === 'order-change' ? 'order-changes' : kind === 'technical-acceptance' ? 'technical-acceptances' : 'contracts'; const result = await call('POST', '/customer/' + route + '/' + identifier(id) + '/sign', body); assertCurrent(stamp); return await enter(kind, id, result, config, stamp); }
    finally { if (running.get(key) === lease) running.delete(key); }
  }
  async function startOwnerSigning(kind,ownerId,recordId,body={}){
    if(!['owner-identity','owner-authority','owner-revoke','owner-contract'].includes(kind)||!/^[A-Za-z0-9-]{1,100}$/.test(ownerId)||recordId&&!/^[A-Za-z0-9-]{1,100}$/.test(recordId))throw error('企业签署记录无效。','SIGN_CONTEXT');
    if(['owner-contract','owner-revoke'].includes(kind)&&!recordId)throw error('缺少企业业务记录。','SIGN_CONTEXT');
    const id=ownerId+':'+(recordId||'new'),stamp=snapshot(kind,id),key=keyOf(kind,id),lease={};if(running.has(key))throw error('企业页面正在准备。','SIGN_BUSY');running.set(key,lease);
    try{const config=await enabled();assertCurrent(stamp);const suffix=kind==='owner-identity'?'/verification':kind==='owner-authority'?'/authorities':kind==='owner-revoke'?'/authorities/'+identifier(recordId)+'/revoke':'/contracts/'+identifier(recordId)+'/sign';const result=await call('POST','/customer/owners/'+identifier(ownerId)+suffix,body);assertCurrent(stamp);if(!result?.url)throw error('企业页面尚未就绪，请查询当前状态。','SIGN_RESPONSE');let resolvedId=id,resolvedStamp=stamp;if(kind==='owner-authority'){if(typeof result.id!=='string'||!/^[A-Za-z0-9-]{1,100}$/.test(result.id))throw error('授权记录编号尚未核实。','SIGN_RESPONSE');resolvedId=ownerId+':'+result.id;resolvedStamp=snapshot(kind,resolvedId);}return await enter(kind,resolvedId,{taskId:result.taskId||result.id||resolvedId,status:'PENDING',url:result.url},config,resolvedStamp);}
    finally{if(running.get(key)===lease)running.delete(key);}
  }
  async function startESignVerification(input) {
    const id = getContext().customer?.id, stamp = snapshot('identity', id);
    const consent = input?.consent, name = typeof input?.name === 'string' ? input.name.trim() : '';
    if (name.length < 2 || name.length > 50 || !/^\d{17}[\dXx]$/.test(input?.idCardNo || '') || consent?.accepted !== true || !consent.documentId || !Number.isInteger(consent.version)) throw error('请填写本人实名资料，并单独阅读同意当前实名信息处理说明。', 'IDENTITY_CONSENT');
    const key = keyOf('identity', id), lease = {}; if (running.has(key)) throw error('实名页面正在准备，请勿重复点击。', 'SIGN_BUSY'); running.set(key, lease);
    try { const config = await enabled(); assertCurrent(stamp); const privacy = await call('GET', '/public/legal/privacy', undefined, false); assertCurrent(stamp); if (privacy?.type !== 'privacy' || privacy.id !== consent.documentId || privacy.version !== consent.version || !privacy.content) throw error('隐私政策版本已更新，请重新阅读后选择。', 'CONSENT_VERSION'); await call('POST', '/customer/esign/register', {}); assertCurrent(stamp); const result = await call('POST', '/customer/esign/verify', { name, idCardNo: input.idCardNo, consent: { accepted: true, documentId: consent.documentId, version: consent.version } }); assertCurrent(stamp); return await enter('identity', id, result, config, stamp); }
    finally { if (running.get(key) === lease) running.delete(key); }
  }
  async function refreshESignReadiness() { const id = getContext().customer?.id, stamp = snapshot('identity', id); await enabled(); assertCurrent(stamp); const result = await call('POST', '/customer/esign/refresh', {}); assertCurrent(stamp); return result; }
  function reloadSigningPage(kind, id, url) {
    const task = getSigningTask(kind, id), stored = tasks.get(keyOf(kind, id));
    if (!stored || task.contextOnly || (url !== stored.url && url !== stored.config.returnUrl)) throw error('返回地址与当前实名或签署流程不匹配。', 'SIGN_RETURN');
    return policy.providerUrl(url, stored.config, true);
  }
  function prepareFaceBridge() { throw error('刷脸中间页尚缺本流程已核验的AppID、路径及回跳绑定，暂不能跳转；请联系运营。', 'FACE_BRIDGE_UNAVAILABLE'); }
  async function resumeSigning() {
    purgeLegacySigningCache(); const value = platform.getStorageSync?.(pendingKey); if (!value || !getContext().authenticated) return null;
    const stamp = snapshot(value.kind, value.id); const result = await getSignStatus(value.id, value.kind); assertCurrent(stamp);
    if (['SIGNED', 'VERIFIED', 'REJECTED', 'EXPIRED', 'CLOSED'].includes(result.status) || value.kind === 'technical-acceptance' && !result.enabled) forgetSigningTask(value.kind, value.id);
    return result;
  }
  function forgetSigningTask(kind, id) { context(kind, id); const key = keyOf(kind, id); flowVersions.set(key, (flowVersions.get(key) || 0) + 1); tasks.delete(key); const pending = platform.getStorageSync?.(pendingKey); if (pending?.kind === kind && pending.id === id) platform.removeStorageSync(pendingKey); }
  return { startOwnerSigning, getSigningConfig, getSigningTask, startSigning, startESignVerification, refreshESignReadiness, purgeLegacySigningCache, resumeSigning, reloadSigningPage, prepareFaceBridge, forgetSigningTask, clearSigningState: () => { generation++; tasks.clear(); running.clear(); flowVersions.clear(); } };
}
module.exports = { createNativeSigningApi };
