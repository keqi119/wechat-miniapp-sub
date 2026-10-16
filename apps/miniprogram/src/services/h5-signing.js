const ENTRY = 'https://app.subauto.keybox.cloud/miniapp-sign/';
const KINDS = { identity: '实名与证书准备', contract: '主合同签署', handover: '交接单签署', 'order-change': '订阅变更补充协议签署' };
function createH5SigningApi({ call, native, error, identifier, getContext, getSignStatus, platform, pendingKey }) {
  function context(kind, id) {
    const current = getContext();
    if (!current.authenticated) throw error('请先登录后查看签约指引。', 'AUTH_REQUIRED');
    if (!Object.prototype.hasOwnProperty.call(KINDS, kind) || typeof id !== 'string' || !id.trim() || (kind === 'identity' && id !== current.customer?.id)) throw error('签署业务类型或记录编号无效，请从原业务记录重新进入。', 'SIGN_CONTEXT');
    return current;
  }
  async function getSigningConfig() {
    const value = await call('GET', '/public/signing-config', undefined, false);
    if (value?.mode !== 'SERVICE_ACCOUNT_H5' || value.entryUrl !== ENTRY || typeof value.enabled !== 'boolean') throw error('签约中心配置尚未核验，请联系运营。', 'SIGN_CONFIG');
    return { mode: value.mode, enabled: value.enabled, entryUrl: value.enabled ? ENTRY : '' };
  }
  async function getSigningGuidance(kind, id) { context(kind, id); return { ...await getSigningConfig(), kind, title: KINDS[kind] }; }
  function purgeLegacySigningCache() {
    const value = platform.getStorageSync?.(pendingKey);
    if (value && (Object.keys(value).some(key => !['kind', 'id'].includes(key)) || !Object.prototype.hasOwnProperty.call(KINDS, value.kind) || typeof value.id !== 'string')) platform.removeStorageSync?.(pendingKey);
  }
  async function enterH5SigningGuide(kind, id) {
    await getSigningGuidance(kind, id);
    purgeLegacySigningCache(); platform.setStorageSync(pendingKey, { kind, id });
    await native('navigateTo', { url: '/pages/sign/index?kind=' + kind + '&id=' + identifier(id) });
    return { status: 'H5_GUIDANCE', message: '请按签约指引操作，返回小程序后查询最新结果。' };
  }
  async function copySigningEntry(kind, id) {
    const signing = await getSigningGuidance(kind, id);
    if (!signing.enabled) throw error('签约入口尚未启用，请联系运营。', 'H5_SIGNING_DISABLED');
    await native('setClipboardData', { data: signing.entryUrl });
    return { message: '已复制签约入口。请在微信中打开，用与小程序相同手机号登录；完成后手动返回查询。' };
  }
  async function resumeSigning() {
    purgeLegacySigningCache(); const value = platform.getStorageSync?.(pendingKey);
    if (!value || !getContext().authenticated) return null;
    context(value.kind, value.id); const result = await getSignStatus(value.id, value.kind);
    if (['SIGNED', 'VERIFIED', 'REJECTED', 'EXPIRED'].includes(result.status)) platform.removeStorageSync(pendingKey);
    return result;
  }
  return { getSigningConfig, getSigningGuidance, copySigningEntry, enterH5SigningGuide, purgeLegacySigningCache, resumeSigning };
}
module.exports = { createH5SigningApi };
