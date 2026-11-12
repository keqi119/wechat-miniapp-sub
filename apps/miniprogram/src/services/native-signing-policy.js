const HOSTS = ['textapi17.fadada.com', 'realnameverify16.fadada.com'];
const RETURN_URL = 'https://api.evsub.ndacar.com/api/public/esign-return';
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function signingConfig(value, electronic = false) {
  if (!['OFFLINE','ESIGN','ELECTRONIC'].includes(value?.newOrderContractMode) || typeof value.newEsignRequestsEnabled !== 'boolean') fail('SIGN_CONFIG', '当前签署办理能力尚未核实，历史资料仍可查看。');
  if (value?.mode !== 'MINIAPP_WEBVIEW' || typeof value.enabled !== 'boolean' || typeof value.signProviderConfigured !== 'boolean' || !Array.isArray(value.providerHosts) || value.providerHosts.some(host => !HOSTS.includes(host)) || new Set(value.providerHosts).size !== value.providerHosts.length || value.returnUrl !== RETURN_URL) fail('SIGN_CONFIG', '小程序签约配置尚未核验，请联系运营。');
  const newEsignRequestsEnabled = value.newOrderContractMode === 'ESIGN' && value.newEsignRequestsEnabled;
  const enabled = electronic ? value.newOrderContractMode === 'ELECTRONIC' && value.newElectronicRequestsEnabled === true && value.electronicEnabled === true : newEsignRequestsEnabled && value.enabled;
  const faceBridgeConfigured = enabled && value.faceBridgeConfigured === true && value.faceBridgeProtocol === 'FADADA_H5_CURRENT_FLOW_V1';
  return { mode: value.mode, newOrderContractMode: value.newOrderContractMode, newEsignRequestsEnabled, enabled, signProviderConfigured: value.signProviderConfigured, providerHosts: [...value.providerHosts], returnUrl: RETURN_URL, faceBridgeConfigured, faceBridgeProtocol: faceBridgeConfigured ? value.faceBridgeProtocol : null };
}
function identityConfig(value) {
  const identityPolicy=value?.identityPolicy===undefined?'PROVIDER_REQUIRED':value.identityPolicy;
  if(!['MANUAL_REVIEW','PROVIDER_REQUIRED','SIGNING_REQUIRED'].includes(identityPolicy))fail('IDENTITY_CONFIG','实名认证办理方式尚未核实，请稍后重试。');
  if(value?.mode!=='MINIAPP_WEBVIEW'||typeof value.enabled!=='boolean'||typeof value.signProviderConfigured!=='boolean'||!Array.isArray(value.providerHosts)||value.providerHosts.some(host=>!HOSTS.includes(host))||new Set(value.providerHosts).size!==value.providerHosts.length||value.returnUrl!==RETURN_URL)fail('IDENTITY_CONFIG','实名认证能力暂未核实，请稍后重试。');
  if(identityPolicy==='MANUAL_REVIEW')return{identityPolicy,mode:value.mode,enabled:false,signProviderConfigured:false,providerHosts:[],returnUrl:RETURN_URL,faceBridgeConfigured:false,faceBridgeProtocol:null};
  const enabled=value.enabled,faceBridgeConfigured=enabled&&value.faceBridgeConfigured===true&&value.faceBridgeProtocol==='FADADA_H5_CURRENT_FLOW_V1'&&Array.isArray(value.faceBridgeKinds)&&value.faceBridgeKinds.includes('identity');
  return{identityPolicy,mode:value.mode,enabled,canQueryIdentity:identityPolicy==='SIGNING_REQUIRED'&&value.canQueryIdentity===true,signProviderConfigured:value.signProviderConfigured,providerHosts:[...value.providerHosts],returnUrl:RETURN_URL,faceBridgeConfigured,faceBridgeProtocol:faceBridgeConfigured?value.faceBridgeProtocol:null};
}
function providerUrl(value, config, allowReturn = false) {
  // Mini Program JavaScript does not universally expose the browser URL class.
  // Reject raw authority ports including :443; preserve opaque path/query bytes.
  const match = typeof value === 'string' && value.length <= 16384 && /^https:\/\/([a-zA-Z0-9.-]+)(\/[^\s\\#]*)$/.exec(value);
  const allowed = config?.providerHosts;
  if (allowReturn && value === RETURN_URL && config?.returnUrl === RETURN_URL) return value;
  if (!match || !Array.isArray(allowed) || !HOSTS.includes(match[1].toLowerCase()) || !allowed.includes(match[1].toLowerCase())) fail('SIGN_URL', '签约地址未通过业务域名核验，请联系运营。');
  return value;
}
function trustedBridge(value, config) {
  if (!value || typeof value.flowId !== 'string' || !value.flowId || !/^wx[a-f0-9]{16}$/.test(value.appId) || typeof value.path !== 'string' || !/^\/?[A-Za-z0-9_/-]{1,200}$/.test(value.path) || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now()) fail('FACE_BRIDGE_UNAVAILABLE', '刷脸跳转尚未取得当前流程的可信配置，请联系运营。');
  if (value.protocol === 'FADADA_H5_CURRENT_FLOW_V1') identityCallback(value.callbackUrl, config);
  else providerUrl(value.callbackUrl, config);
  return value;
}
function decodeBridgeOption(options, key) {
  try { const value = options?.[key]; if (typeof value !== 'string' || !value || value.length > 24576) throw Error(); return decodeURIComponent(value); }
  catch { fail('FACE_BRIDGE_ARGUMENTS', '刷脸跳转参数无效，请重新进入当前实名认证流程。'); }
}
function identityCallback(value, config) {
  // The official integration guide requires mapping the generic realname origin
  // to the tenant's WeChat business domain. Preserve opaque query/hash bytes.
  if (!config?.providerHosts?.includes('realnameverify16.fadada.com') || typeof value !== 'string' || value.length > 16384 || !/^https:\/\/realnameverify(?:16)?\.fadada\.com\/fddAuthenticationService\/[^\s\\]*$/.test(value)) fail('FACE_BRIDGE_ARGUMENTS', '刷脸回跳地址未通过当前实名域名核验。');
  return value.replace(/^https:\/\/realnameverify\.fadada\.com\//, 'https://realnameverify16.fadada.com/');
}
function providerIdentityBridge(options, flowId, expiresAt, config) {
  if (!config?.enabled || !config.signProviderConfigured || !config.faceBridgeConfigured || config.faceBridgeProtocol !== 'FADADA_H5_CURRENT_FLOW_V1') fail('FACE_BRIDGE_UNAVAILABLE', '刷脸跳转暂未启用，请返回原认证流程。');
  return trustedBridge({ protocol: config.faceBridgeProtocol, flowId, expiresAt, appId: decodeBridgeOption(options, 'miniProgramAppId'), path: decodeBridgeOption(options, 'miniProgramPath'), callbackUrl: identityCallback(decodeBridgeOption(options, 'miniProgramCallBackUrl'), config) }, config);
}
function bridgeArguments(options, bridge, config) {
  const b = trustedBridge(bridge, config);
  const decode = key => decodeBridgeOption(options, key);
  const appId = decode('miniProgramAppId'), path = decode('miniProgramPath'), rawCallback = decode('miniProgramCallBackUrl'), callbackUrl = b.protocol === 'FADADA_H5_CURRENT_FLOW_V1' ? identityCallback(rawCallback, config) : rawCallback, bizToken = decode('bizToken');
  if (appId !== b.appId || path !== b.path || callbackUrl !== b.callbackUrl || !bizToken || bizToken.length > 4096 || /[\s\x00-\x1f]/.test(bizToken)) fail('FACE_BRIDGE_ARGUMENTS', '刷脸参数与当前流程不匹配，不能跳转。');
  if (b.protocol !== 'FADADA_H5_CURRENT_FLOW_V1') providerUrl(callbackUrl, config);
  return { flowId: b.flowId, appId, path: path + '?bizToken=' + encodeURIComponent(bizToken), callbackUrl };
}
function faceReturn(entry, bridge, initiated, config) {
  const b = trustedBridge(bridge, config);
  if (!initiated || entry?.scene !== 1038 || entry.referrerInfo?.appId !== b.appId) fail('FACE_RETURN_UNTRUSTED', '未收到当前刷脸流程的可信返回，请返回原流程查询。');
  // extraData/faceResult are navigation signals, never an authentication result.
  return { reloadUrl: b.callbackUrl, flowId: b.flowId };
}
module.exports = { signingConfig, identityConfig, providerUrl, providerIdentityBridge, bridgeArguments, faceReturn };
