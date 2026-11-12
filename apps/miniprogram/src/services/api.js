const { createAddonApi } = require('./addons');
const { createAdvertisingCopyReader } = require('./advertising-copy');
const { handoverSigning } = require('../utils/customer-handover');
const {archiveFilePath}=require('../utils/offline-order');
const { locationPayload } = require('../utils/handover-location');
const { money, date } = require('../utils/format');
const { createUsageApi } = require('./usage');
const { createOrderChangesApi } = require('./order-changes');
const { createOrderRenewalsApi } = require('./order-renewals');
const { createNativeSigningApi } = require('./native-signing');
const { createSwapApi } = require('./swap');
const { assignmentView } = require('./vehicle-assignments');
const TYPES = ['applications', 'orders', 'contracts', 'bills', 'payments', 'deposits', 'entitlements', 'notifications', 'services', 'mileages'];
const LOGIN_ERROR_MESSAGES = {
  WECHAT_UNAVAILABLE: '登录服务暂不可用，请稍后重试。',
  WECHAT_INVALID_RESPONSE: '登录服务响应异常，请稍后重试。',
  WECHAT_AUTH_FAILED: '登录验证未成功，请重新尝试。',
  WECHAT_CODE_INVALID: '登录验证已失效，请重新尝试。',
  WECHAT_TOKEN_INVALID: '登录服务响应异常，请稍后重试。',
  WECHAT_PHONE_INVALID: '手机号授权信息无效，请重新授权。',
  IDENTITY_CONFLICT: '手机号与登录身份不匹配，请核对后重试。',
};
const CREDIT_BANDS = { GE750: '750分及以上', B700_749: '700—749分', B650_699: '650—699分', LT650: '低于650分', UNVERIFIABLE: '无法核验' };
const CREDIT_MULTIPLIERS = { GE750: 0, B700_749: 1, B650_699: 2, LT650: null, UNVERIFIABLE: null };
const COMMERCIAL_FIELDS = { vehicleIdentification: '车辆及 VIN/车牌', permittedUse: '城市、使用性质、驾驶人及限制', conditionDisclosure: '车辆状况及已披露问题', customerAddress: '合同联系地址', mileageCarryRule: '里程累计与结转方式', excessMileageCalculation: '超里程计算及上限', usageCosts: '充电、停车、通行及违章承担', insuranceDetails: '保险机构、保单、险种、保额、免赔及免责', maintenanceRule: '保养、维修及正常磨损责任', serviceCoverage: '救援等权益覆盖、时间、次数及电话', handoverArrangement: '交还车地点、时间及延迟处理', earlyTerminationRule: '提前解约计算、上限及退费', depositRefundRule: '押金结算与退款期限', otherFees: '其他已明确收费项目' };
function commercialDetails(plan) {
  const electronic = plan.contractMode === 'ELECTRONIC';
  const commercialRows = (electronic ? ['vehicleIdentification','customerAddress','handoverArrangement'] : Object.keys(COMMERCIAL_FIELDS)).map(key => ({ key, label: COMMERCIAL_FIELDS[key], value: plan.commercialTerms?.[key] || '' }));
  const termsComplete = commercialRows.every(row => typeof row.value === 'string' && row.value.trim() && !/\{\{|\}\}|待确认|待补齐|待填写|另行通知/.test(row.value));
  if (electronic) return { commercialRows, termsComplete, billingRows: [], endDateText: '实际交付后按约定期限确定' };
  const origin = new Date(String(plan.startDate).slice(0, 10) + 'T00:00:00Z'), due = new Date(String(plan.firstDueDate).slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(origin.getTime()) || !Number.isFinite(due.getTime()) || !Number.isInteger(plan.months) || plan.months < 1 || plan.months > 120) return { commercialRows, termsComplete: false, billingRows: [], endDateText: '待确认' };
  const anchored = (start, index) => { const last = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index + 1, 0)); return new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), Math.min(start.getUTCDate(), last.getUTCDate()))); };
  const endBefore = value => new Date(value.getTime() - 86400000).toISOString().slice(0, 10);
  const billingRows = Array.from({ length: plan.months }, (_, index) => ({ sequence: index + 1, amountText: money(plan.monthlyFeeAmount), dueDateText: date(anchored(due, index).toISOString()), periodText: date(anchored(origin, index).toISOString()) + '—' + date(endBefore(anchored(origin, index + 1))) }));
  return { commercialRows, termsComplete, billingRows, endDateText: date(endBefore(anchored(origin, plan.months))) };
}
function error(message, code, extra = {}) { return Object.assign(new Error(message), { code }, extra); }
function validateBase(value) {
  const base = String(value || '').replace(/\/api\/?$/, '').replace(/\/$/, '');
  if (!/^https:\/\/[a-zA-Z0-9.-]+(?::\d{1,5})?$/.test(base) && base !== 'http://127.0.0.1:3101' && base !== 'http://localhost:3101')
    throw error('请配置新平台的 HTTPS API 地址。', 'CONFIG');
  return base;
}
function identifier(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw error('缺少有效的业务编号，请返回列表重新进入。', 'VALIDATION');
  return encodeURIComponent(value);
}
const {createSwapFactApi}=require('./swap-fact-settlement');
const {createContractPlanApi}=require('./contract-plan');
function createApi(options, request, platform = typeof wx !== 'undefined' ? wx : {}) {
  const getAdvertisingCopy = createAdvertisingCopyReader({ request, url: () => validateBase(options.apiBase) + '/api/public/advertising-copy' });
  let sessionVersion = 0;
  const storageKey = options.storageKey || 'ev-subscription:customer-session:v1';
  const pendingKey = storageKey + ':pending';
  const paymentKeys = new Map();
  const creditKeys = new Map();
  const legalPreviews = new Map();
  const addonApi = createAddonApi({ call, identifier, error, idempotencyKey, getContext, sessionKey: () => session()?.token, platform, pendingKey: pendingKey + ':addons' });
  const usageApi = createUsageApi({ call, identifier, error, idempotencyKey, getContext });
  const swapApi = createSwapApi({ call, identifier, error, idempotencyKey, getContext, sessionKey: () => session()?.token });
  const changesApi = createOrderChangesApi({ call, identifier, error, idempotencyKey, getContext, sessionKey: () => session()?.token, canUseSigning: () => nativeSigning.canUseLegacyWorkflow(), enterSigning: (kind, id, body) => nativeSigning.startSigning(kind, id, body) });
  const contractPlanApi=createContractPlanApi({call,identifier,sessionKey:()=>session()?.token,idempotencyKey});
  const renewalsApi = createOrderRenewalsApi({ call, identifier, error, idempotencyKey, getContext, sessionKey: () => session()?.token });
  const nativeSigning = createNativeSigningApi({ call, native, error, identifier, getContext, sessionKey: () => session()?.token, getSignStatus, platform, pendingKey });
  function clearSession() { sessionVersion++; legalPreviews.clear(); addonApi.clearAddonState(); platform.removeStorageSync(storageKey); platform.removeStorageSync(pendingKey); platform.removeStorageSync(pendingKey + ':payment'); paymentKeys.clear(); creditKeys.clear(); usageApi.clearUsageKeys(); swapApi.clearSwapKeys(); changesApi.clearChangeKeys(); renewalsApi.clearRenewalState(); nativeSigning.clearSigningState(); }
  function session() {
    const value = platform.getStorageSync(storageKey);
    if (!value) return null;
    if (!value.token || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now()) { clearSession(); return null; }
    return value;
  }
  function getContext() {
    const value = session();
    const customer = value?.customer;
    const profile = customer ? { name: customer.name || '', mobile: customer.mobile || '', drivingYears: customer.drivingYears ?? 0, ...customer.profile, ...value.profile } : null;
    return { mode: 'api', authenticated: Boolean(value), customer: customer || null, profile, expiresAt: value?.expiresAt || null, consents: value?.consents || [] };
  }
  function native(method, args = {}) {
    return new Promise((resolve, reject) => {
      if (typeof platform[method] !== 'function') return reject(error('当前微信版本暂不支持此功能。', 'NATIVE_UNAVAILABLE'));
      platform[method]({ ...args, success: resolve, fail: reject });
    });
  }
  function failure(response, token, path, addonLease) {
    const body = response.data || {};
    if ([403,404].includes(response.statusCode) && token && session()?.token === token) addonApi.revokeAddonAccessForPath(path, addonLease);
    if (response.statusCode === 401 && token && session()?.token === token) clearSession();
    const messages = { 401: '登录已过期，请重新登录。', 403: '无权查看或操作此记录。', 404: '记录不存在或暂不可用。', 409: '内容或状态已更新，请刷新后重试。', 429: '操作频繁，请稍后重试。' };
    const loginMessage = ['/customer/auth/wechat', '/customer/auth/sms/login'].includes(path) && Object.prototype.hasOwnProperty.call(LOGIN_ERROR_MESSAGES, body.error?.code) ? LOGIN_ERROR_MESSAGES[body.error.code] : null;
    return error(loginMessage || body.error?.message || messages[response.statusCode] || '后台暂时无法处理请求，请稍后重试。', body.error?.code || `HTTP_${response.statusCode}`, { statusCode: response.statusCode, details: body.error?.details, requestId: body.requestId });
  }
  async function call(method, path, data, authenticated = true) {
    const base = validateBase(options.apiBase);
    const current = authenticated ? session() : null;
    if (authenticated && !current) throw error('请先登录后继续。', 'AUTH_REQUIRED');
    const addonLease = current ? addonApi.getAddonAccessLease() : null;
    return new Promise((resolve, reject) => request({
      url: base + '/api' + path, method, data, timeout: options.requestTimeout || 15000,
      header: { Accept: 'application/json', 'Content-Type': 'application/json', ...(current ? { Authorization: 'Bearer ' + current.token } : {}) },
      success(response) {
        if (current && (session()?.token !== current.token || session()?.customer.id !== current.customer.id)) return reject(error('登录会话已变化，已忽略原账号请求结果。', 'SESSION_CHANGED'));
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.data);
        else reject(failure(response, current?.token, path, addonLease));
      },
      fail() { reject(error('无法连接后台，请检查网络后重试。', 'NETWORK')); },
    }));
  }
  function validateSession(value) {
    if (!value || typeof value.token !== 'string' || !value.token || !value.customer?.id || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now()) throw error('后台登录响应无效，请重新登录。', 'RESPONSE');
    sessionVersion++;
    addonApi.clearAddonState();
    platform.setStorageSync(storageKey, { token: value.token, expiresAt: value.expiresAt, customer: value.customer, consents: value.consents || [] });
    return getContext();
  }
  function list(value) {
    if (!value || !Array.isArray(value.items) || !Number.isInteger(value.total)) throw error('后台列表数据不符合约定。', 'RESPONSE');
    return value;
  }
  function media(value) {
    if (typeof value !== 'string' || value.includes('..')) return '';
    if (/^\/api\/public\/media\//.test(value)) return validateBase(options.apiBase) + value;
    if (/^\/api\/(public|customer)\/files\//.test(value)) return validateBase(options.apiBase) + value;
    if (/^https:\/\/[^\s@]+$/.test(value)) return value;
    if (/^\/assets\/[\w-]+\.png$/.test(value)) return value;
    return '';
  }
  function vehicle(row) {
    if (!row || typeof row.id !== 'string') throw error('后台车辆数据不符合约定。', 'RESPONSE');
    const mileage = row.mileageKm;
    const amount = row.minFeeAmount ?? row.monthlyFeeFromAmount;
    // Only the public vehicle photo IDs form its album; document links never join it.
    const photoIds = [row.coverFileId, ...(Array.isArray(row.mediaFileIds) ? row.mediaFileIds : [])];
    const galleryUrls = [...new Set(photoIds.filter(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(id)))].map(id => validateBase(options.apiBase) + '/api/public/media/' + encodeURIComponent(id));
    return { ...row, name: row.name || row.title || [row.brand, row.model].filter(Boolean).join(' ') || '车型待确认', brand: row.brand || '其他品牌', city: row.city || '城市待确认',
      registrationText: row.registrationText || (row.registrationDate ? date(row.registrationDate) + ' 上牌' : row.year ? row.year + ' 年款' : '上牌时间待确认'),
      mileageText: row.mileageText || (Number.isFinite(mileage) ? mileage.toLocaleString('en-US') + ' km' : '里程待确认'),
      rangeText: row.rangeText || '续航待披露', bodyType: row.bodyType || row.model || '配置见车辆资料',
      available: row.available === true, statusText: row.statusText || (row.available === true ? '可申请' : '暂不可申请'),
      galleryUrls, imageUrl: galleryUrls[0] || media(row.imageUrl || row.coverImageUrl) || '/assets/car-placeholder.png', minFeeAmount: Number.isSafeInteger(amount) ? amount : null, minFeeText: money(amount), tagline: row.tagline || row.description || '以车辆披露及最终方案为准。' };
  }
  function plan(row) {
    if (!row || typeof row.id !== 'string') throw error('后台套餐数据不符合约定。', 'RESPONSE');
    const amount = value => Number.isSafeInteger(value) && value >= 0;
    const validParts = row.configurationVersion === 2 && amount(row.baseFeeAmount) && amount(row.mileageMonthlyFeeAmount) && amount(row.monthlyFeeAmount) && row.baseFeeAmount + row.mileageMonthlyFeeAmount === row.monthlyFeeAmount;
    const validSwap = row.configurationVersion === 2 && amount(row.swapPolicy?.includedCount) && amount(row.swapPolicy?.extraFeeAmount);
    return { ...row, title: row.title || row.name || '订阅套餐', termMonths: row.termMonths ?? row.months ?? null, monthlyFeeText: money(row.monthlyFeeAmount), monthlyFeeParts: validParts ? [{ label: '基础使用费', amountText: money(row.baseFeeAmount) }, { label: '里程包月费', amountText: money(row.mileageMonthlyFeeAmount) }] : [], excessMileagePriceText: amount(row.excessMileagePriceAmount) ? money(row.excessMileagePriceAmount) : '', swapIncludedText: validSwap ? '合同期内赠送 ' + row.swapPolicy.includedCount + ' 次' : '', swapExtraFeeText: validSwap ? money(row.swapPolicy.extraFeeAmount) + ' / 次' : '', mileageText: row.mileageText || (Number.isFinite(row.mileagePerMonthKm) ? '每月 ' + row.mileagePerMonthKm + ' 公里' : '里程条件待确认'), energyText: row.energyText || row.energyDescription || '能源条件待确认', benefits: row.benefits || [], depositText: row.depositText || '审核后确认', notes: row.notes || row.conditions || '', available: row.available === true };
  }
  function idempotencyKey(prefix = 'request') { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`; }
  function fileIds(payload) {
    const files = payload.fileIds || payload.attachments || [];
    if (!Array.isArray(files)) throw error('附件格式无效。', 'VALIDATION');
    const ids = files.map(value => typeof value === 'string' ? value : value?.id);
    if (ids.some(value => typeof value !== 'string' || !value)) throw error('请等待附件上传成功再提交。', 'UPLOAD_REQUIRED');
    return ids;
  }
  async function getVehicles(filters = {}) {
    const result = list(await call('GET', '/public/vehicles', { brand: filters.brand === '全部' ? '' : filters.brand || '', keyword: filters.query || filters.keyword || '', page: filters.page || 1, pageSize: filters.pageSize || 20 }, false));
    const items = result.items.map(vehicle);
    return { ...result, items, brands: result.brands || [...new Set(items.map(row => row.brand))] };
  }
  async function getVehicle(id) {
    const result = await call('GET', '/public/vehicles/' + identifier(id), undefined, false);
    if (!result?.vehicle || !Array.isArray(result.plans)) throw error('后台车辆详情数据不符合约定。', 'RESPONSE');
    return { vehicle: vehicle(result.vehicle), plans: result.plans.map(plan), report: result.report || { summary: '车况资料待披露', items: [], images: [], notice: '未披露资料不代表车况正常。' } };
  }
  async function refreshContext() {
    const result = await call('GET', '/customer/context');
    const current = session();
    if (current) platform.setStorageSync(storageKey, { ...current, customer: result.customer || current.customer, profile: result.profile || result.customer?.profile || current.customer.profile, consents: result.consents || [] });
    addonApi.syncAddonSession();
    return getContext();
  }
  function creditView(value, applicationId) {
    const statuses = { CONSENT_REQUIRED: '等待本申请单独授权', AWAITING_VERIFICATION: '已授权，等待人工核验', MANUAL_REVIEW: '转人工联系处理', VERIFIED: '人工核验已记录', HISTORICAL: '申请结束后的历史核验' };
    if (!value || value.applicationId !== applicationId || !Number.isInteger(value.creditRevision) || value.creditRevision < 0 || value.ruleVersion !== 'ZHIMA_MANUAL_V1' || !Object.prototype.hasOwnProperty.call(statuses, value.status)) throw error('本申请信用核验状态无效，请刷新或联系人工。', 'RESPONSE');
    const raw = value.document;
    const document = raw && typeof raw.id === 'string' && raw.id && raw.type === 'credit-verification' && Number.isInteger(raw.version) && raw.version >= 1 && typeof raw.content === 'string' && raw.content.trim() && typeof raw.title === 'string' && raw.title.trim()
      ? { id: raw.id, type: raw.type, version: raw.version, title: raw.title, content: raw.content } : null;
    const originalConsent = value.consent;
    if (originalConsent && (typeof originalConsent.id !== 'string' || !['ACCEPTED', 'DECLINED', 'WITHDRAWN'].includes(originalConsent.status))) throw error('本申请授权记录无效，请刷新。', 'RESPONSE');
    const consent = originalConsent ? { id: originalConsent.id, status: originalConsent.status, documentId: originalConsent.documentId, version: originalConsent.version, acceptedAt: originalConsent.acceptedAt || null, withdrawnAt: originalConsent.withdrawnAt || null } : null;
    const originalVerification = value.verification;
    const safeVerification = Boolean(originalVerification && !Object.prototype.hasOwnProperty.call(originalVerification,'band'));
    if (originalVerification && !safeVerification && (typeof originalVerification.id !== 'string' || !Object.prototype.hasOwnProperty.call(CREDIT_BANDS, originalVerification.band))) throw error('人工核验结果无效，请联系运营核对。', 'RESPONSE');
    const verification = originalVerification ? safeVerification ? {verifiedAt:originalVerification.verifiedAt,current:originalVerification.current===true} : { id: originalVerification.id, band: originalVerification.band, verifiedAt: originalVerification.verifiedAt, consentId: originalVerification.consentId } : null;
    const multiplier = [0, 1, 2].includes(value.depositMultiplier) ? value.depositMultiplier : null;
    if (!safeVerification && ((value.depositMultiplier != null && multiplier === null) || (multiplier !== null && (!verification || CREDIT_MULTIPLIERS[verification.band] !== multiplier)))) throw error('核验结果与押金规则不匹配，请联系运营核对。', 'RESPONSE');
    const currentConsent = Boolean(document && consent?.status === 'ACCEPTED' && consent.documentId === document.id && consent.version === document.version);
    const verificationCurrent = Boolean(value.verificationCurrent === true && currentConsent && (safeVerification ? verification?.current : verification?.consentId === consent.id));
    const verifiedDate = verification && new Date(verification.verifiedAt);
    return {
      applicationId, creditRevision: value.creditRevision, ruleVersion: value.ruleVersion, document, consent, verification, consentCurrent: currentConsent,
      status: value.status, statusText: statuses[value.status], consentRequirementsMet: value.consentRequirementsMet === true,
      canConsent: Boolean(value.status !== 'HISTORICAL' && document && value.canConsent === true && value.consentRequirementsMet === true),
      canDecline: Boolean(value.status !== 'HISTORICAL' && document && value.canDecline === true), canWithdraw: Boolean(consent?.status === 'ACCEPTED' && value.canWithdraw === true),
      verificationCurrent,
      canConfirmFinalPlan: Boolean(value.canConfirmFinalPlan === true && value.consentRequirementsMet === true && value.status === 'VERIFIED' && verificationCurrent && (safeVerification || multiplier !== null && CREDIT_MULTIPLIERS[verification.band] === multiplier)),
      depositMultiplier: multiplier, bandText: safeVerification ? '本次核验已记录' : verification ? CREDIT_BANDS[verification.band] : '尚未人工核验',
      verifiedAtText: verifiedDate && Number.isFinite(verifiedDate.getTime()) ? new Date(verifiedDate.getTime() + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ') + '（北京时间）' : '尚未核验',
      depositRuleText: safeVerification ? '押金以审核后的最终方案列明金额为准' : multiplier === 0 ? '押金0元' : multiplier !== null ? '押金为最终方案中' + multiplier + '个月订阅费' : '转人工处理，暂不生成正式方案',
      consentStatusText: { ACCEPTED: '已单独授权本申请', DECLINED: '已选择暂不授权', WITHDRAWN: '已撤回后续核验授权' }[consent?.status] || '尚未单独授权',
    };
  }
  async function getCreditReview(id) { return creditView(await call('GET', '/customer/applications/' + identifier(id) + '/credit-review'), id); }
  async function submitCreditConsent(id, payload) {
    if (!payload || !['ACCEPT', 'DECLINE'].includes(payload.decision) || typeof payload.documentId !== 'string' || !Number.isInteger(payload.version)) throw error('请明确选择本申请当前说明的授权决定。', 'VALIDATION');
    const current = await getCreditReview(id);
    if (!current.document || current.document.id !== payload.documentId || current.document.version !== payload.version) throw error('信用核验说明已更新或尚未发布，请重新阅读。', 'CREDIT_DOCUMENT_CHANGED');
    if (!(payload.decision === 'ACCEPT' ? current.canConsent : current.canDecline)) throw error(payload.decision === 'ACCEPT' && !current.consentRequirementsMet ? '请先到账户设置同意当前用户协议和隐私政策。' : '本申请当前不可修改核验授权，请刷新或联系人工。', 'CREDIT_CONSENT_UNAVAILABLE');
    const key = [session()?.customer.id, id, payload.decision, payload.documentId, payload.version].join(':');
    if (!creditKeys.has(key)) creditKeys.set(key, idempotencyKey('credit-consent'));
    const result = creditView(await call('POST', '/customer/applications/' + identifier(id) + '/credit-consent', { documentId: payload.documentId, version: payload.version, decision: payload.decision, idempotencyKey: creditKeys.get(key) }), id);
    creditKeys.delete(key); return result;
  }
  async function withdrawCreditConsent(id, payload) {
    const current = await getCreditReview(id);
    if (!current.canWithdraw || !payload?.consentId || current.consent?.id !== payload.consentId) throw error('授权已变更或不可撤回，请刷新本申请状态。', 'CREDIT_CONSENT_CHANGED');
    const key = [session()?.customer.id, id, 'withdraw', payload.consentId].join(':');
    if (!creditKeys.has(key)) creditKeys.set(key, idempotencyKey('credit-withdraw'));
    const result = creditView(await call('POST', '/customer/applications/' + identifier(id) + '/credit-consent/withdraw', { consentId: payload.consentId, idempotencyKey: creditKeys.get(key) }), id);
    creditKeys.delete(key); return result;
  }
  function application(row) {
    if (!row) return row;
    const final = row.finalPlan;
    const mapped = final ? { ...final, planTitle: final.planTitle || final.title || row.planName || row.planTitle || '', notes: final.notes || final.conditions || '', termMonths: final.termMonths ?? final.months, monthlyFeeText: money(final.monthlyFeeAmount), depositText: money(final.depositAmount), mileageText: final.mileageText || (Number.isFinite(final.mileagePerMonthKm) ? '每月 ' + final.mileagePerMonthKm + ' 公里' : '待确认'), energyText: final.energyText || final.energyDescription || '', excessMileagePriceText: money(final.excessMileagePriceAmount), startDateText: date(final.startDate), firstDueDateText: date(final.firstDueDate) } : null;
    if (mapped) {
      Object.assign(mapped, commercialDetails(final));
      const policy = final.usagePolicy;
      const policyRuleValid = policy?.policyVersion === 'USAGE_V1'
        ? policy.baseAllowanceKm === 1500 && policy.excessPriceAmount === 150
        : policy?.policyVersion === 'USAGE_V2' && Number.isSafeInteger(policy.baseAllowanceKm) && policy.baseAllowanceKm >= 0 && typeof policy.templateHash === 'string' && /^[a-f0-9]{64}$/i.test(policy.templateHash) && typeof policy.templateContent === 'string' && policy.templateContent.includes('{{baseAllowanceKm}}') && policy.templateContent.includes('{{excessPriceYuan}}');
      mapped.usagePolicyComplete = Boolean(policyRuleValid && policy?.policyVersion === final.usagePolicyVersion && typeof policy.documentId === 'string' && policy.documentId && Number.isInteger(policy.documentVersion) && policy.documentVersion > 0 && typeof policy.hash === 'string' && /^[a-f0-9]{64}$/i.test(policy.hash) && typeof policy.content === 'string' && policy.content.trim() && final.mileagePerMonthKm === policy.baseAllowanceKm && Number.isSafeInteger(policy.excessPriceAmount) && policy.excessPriceAmount >= 0 && final.excessMileagePriceAmount === policy.excessPriceAmount);
      mapped.complete = mapped.termsComplete && mapped.usagePolicyComplete && Number.isSafeInteger(final.monthlyFeeAmount) && final.monthlyFeeAmount >= 0 && Number.isSafeInteger(final.depositAmount) && final.depositAmount >= 0 && Number.isSafeInteger(final.excessMileagePriceAmount) && final.excessMileagePriceAmount >= 0 && Number.isInteger(mapped.termMonths) && mapped.termMonths > 0 && Number.isSafeInteger(final.mileagePerMonthKm) && final.mileagePerMonthKm >= 0 && mapped.startDateText !== '待确认' && mapped.firstDueDateText !== '待确认' && Boolean(mapped.notes && mapped.energyText && final.commercialHash) && Array.isArray(final.benefits);
      if (final.contractMode === 'ELECTRONIC') {
        const fees = final.agreedFeeComponents;
        mapped.baseFeeText = money(fees?.baseFeeAmount);mapped.mileageFeeText = money(fees?.mileageMonthlyFeeAmount);
        mapped.minimumTermMonths = final.product?.minimumTermMonths;
        mapped.firstDueDateText = '交付前支付首期预付款';
        mapped.complete = mapped.termsComplete && mapped.usagePolicyComplete && /^[a-f0-9]{64}$/.test(final.commercialHash || '') &&
          Number.isSafeInteger(final.monthlyFeeAmount) && final.monthlyFeeAmount > 0 && Number.isSafeInteger(final.depositAmount) && final.depositAmount >= 0 &&
          Number.isInteger(final.months) && final.months === final.product?.months && Number.isInteger(mapped.minimumTermMonths) && mapped.minimumTermMonths >= 3 && final.months >= mapped.minimumTermMonths &&
          Number.isSafeInteger(fees?.baseFeeAmount) && fees.baseFeeAmount >= 0 && Number.isSafeInteger(fees?.mileageMonthlyFeeAmount) && fees.mileageMonthlyFeeAmount >= 0 && fees.baseFeeAmount + fees.mileageMonthlyFeeAmount === final.monthlyFeeAmount &&
          mapped.startDateText !== '待确认' && Boolean(mapped.notes && mapped.energyText) && Array.isArray(final.benefits);
      }
    }
    return { ...row, planTitle: row.planTitle || row.planName || row.plan?.name || '', monthlyFeeText: row.monthlyFeeText || money(row.plan?.monthlyFeeAmount), finalPlan: mapped };
  }
  function subscriptionView(value) {
    const tracked = Object.prototype.hasOwnProperty.call(value, 'currentAssignment');
    const assignment = tracked ? assignmentView(value.currentAssignment, () => { throw error('当前车辆分配尚未核实。', 'RESPONSE'); }) : null;
    if (!tracked) return { ...value, imageUrl: media(value.imageUrl) };
    if (assignment && assignment.status !== 'ACTIVE') throw error('当前车辆分配尚未核实，请重新加载或联系运营。', 'RESPONSE');
    if (value.status === 'CANCELLED') return { ...value, currentAssignment: null, vehicleStageText: '订单已取消，可查看历史订单记录。', imageUrl: media(value.imageUrl) };
    if (assignment) return { ...value, currentAssignment: assignment, vehicleName: assignment.vehicle.title, vehicleStageText: '已记录当前车辆交付，请以订单与交接记录为准。', imageUrl: media(value.imageUrl) };
    const initial = ['AWAITING_SIGNATURE', 'AWAITING_PAYMENT', 'AWAITING_HANDOVER'].includes(value.status);
    if (initial) return { ...value, currentAssignment: null, vehicleStageText: value.status === 'AWAITING_SIGNATURE' ? '车辆尚未交付，当前需完成合同签署。' : value.status === 'AWAITING_PAYMENT' ? '车辆尚未交付，请按本单实际账单完成支付。' : '车辆尚未交付，请按双方确认的安排办理交接。', imageUrl: media(value.imageUrl) };
    const returned = ['SETTLING', 'COMPLETED'].includes(value.status);
    if (returned) return { ...value, currentAssignment: null, vehicleName: '车辆已交还', vehicleStageText: value.status === 'SETTLING' ? '已还车，费用与押金结算以订单记录为准。' : '本次订阅已完成，可查看历史订单与交接记录。', imageUrl: '' };
    // The API preserves vehicle only for an initial/legacy order without assignment history.
    // An explicit null vehicle is the server's no-current-car result; never restore the old car.
    if (value.vehicle) return { ...value, currentAssignment: null, vehicleStageText: '订阅车辆以订单为准，当前交付记录待核对。', imageUrl: media(value.imageUrl) };
    const swapGap = Boolean(value.status === 'ACTIVE' && value.activeChangeId && !value.deliveryDelayChangeId);
    return { ...value, currentAssignment: null, vehicleName: '当前暂无分配车辆', vehicleStageText: swapGap ? '换车办理中，请查看换车进度与新车交付安排。' : '当前车辆分配尚待核实，请联系运营核对。', imageUrl: '' };
  }
  async function getHome() {
    if (session()) { const result = await call('GET', '/customer/home'); return { ...result, vehicles: (result.vehicles || []).map(vehicle) }; }
    return { vehicles: (await getVehicles({ pageSize: 2 })).items, context: getContext(), nextAction: null };
  }
  function consentSnapshot(consents) {
    if (!Array.isArray(consents) || consents.length < 2 || new Set(consents.map(row => row.documentId)).size !== consents.length || consents.some(row => !row.documentId || !Number.isInteger(row.version) || row.version < 1)) throw error('请阅读并同意当前已发布的用户协议和隐私政策。', 'CONSENT_REQUIRED');
    return consents.map(row => ({ documentId: row.documentId, version: row.version }));
  }
  async function wechatLoginCode() {
    let login;
    try { login = await native('login'); }
    catch { throw error('登录暂未成功，请稍后重试。', 'WECHAT_LOGIN'); }
    if (!login?.code) throw error('登录验证未完成，请重试。', 'WECHAT_LOGIN');
    return login.code;
  }
  async function loginWechat(phoneCode, consents) {
    consents = consentSnapshot(consents);
    if (!phoneCode) throw error('请完成手机号授权后继续。', 'VALIDATION');
    const loginCode = await wechatLoginCode();
    return validateSession(await call('POST', '/customer/auth/wechat', { loginCode, phoneCode, consents }, false));
  }
  async function requestSms(mobile) {
    if (!/^1[3-9]\d{9}$/.test(mobile)) throw error('请输入有效手机号。', 'VALIDATION');
    return call('POST', '/customer/auth/sms/request', { mobile }, false);
  }
  async function loginSms(mobile, code, consents) {
    consents = consentSnapshot(consents);
    if (!/^1[3-9]\d{9}$/.test(mobile) || !/^\d{4,8}$/.test(code)) throw error('请输入有效手机号与验证码。', 'VALIDATION');
    const loginCode = await wechatLoginCode();
    return validateSession(await call('POST', '/customer/auth/sms/login', { mobile, code, loginCode, consents }, false));
  }
  async function logout() { await call('POST', '/customer/auth/logout', {}); clearSession(); }
  function verifiedProfileResponse(value){
    const policy=value?.readiness?.identityPolicy;
    if(policy!==undefined&&!['MANUAL_REVIEW','PROVIDER_REQUIRED','SIGNING_REQUIRED'].includes(policy))throw error('资料审核方式尚未核实，请刷新后重试。','IDENTITY_POLICY_UNKNOWN');
    return value;
  }
  async function saveProfile(payload) {
    const profile = getContext().profile;
    if (payload.mobile && payload.mobile !== profile?.mobile) throw error('修改手机号需要重新验证，请在账户页重新登录。', 'PHONE_REVERIFY');
    const body = { revision: payload.revision, idempotencyKey: payload.idempotencyKey || idempotencyKey('profile'), name: payload.name, drivingYears: payload.drivingYears };
    for (const key of ['identityFrontFileId','identityBackFileId','drivingLicenseFileId']) if (Object.prototype.hasOwnProperty.call(payload,key)) body[key]=payload[key];
    const result = await verifiedProfileResponse(await call('PUT', '/customer/profile', body));
    await refreshContext();
    return result;
  }
  async function submitApplication(payload) {
    if (!payload.accepted || !Array.isArray(payload.consents) || !payload.consents.length || payload.consents.some(c => !c.documentId || c.version == null)) throw error('请阅读并同意当前已发布的申请协议。', 'CONSENT_REQUIRED');
    return call('POST', '/customer/applications', { vehicleId: payload.vehicleId, subscriptionPlanId: payload.subscriptionPlanId || payload.planId, profile: { ...(payload.profile || { name: payload.name, mobile: payload.mobile }), ...(payload.profile?.handoverLocation !== undefined ? { handoverLocation: locationPayload(payload.profile.handoverLocation) } : {}) }, consents: payload.consents, idempotencyKey: payload.idempotencyKey || idempotencyKey('application') });
  }
  async function getRecords(type, params = {}) {
    if (type === 'orderchanges') return params.kind === 'SUBSCRIPTION_EXTENSION' ? (await renewalsApi.getOrderRenewals({ page: params.page, pageSize: params.pageSize, ...(params.orderId ? { orderId: params.orderId } : {}) })).items : (await changesApi.getOrderChanges(params)).items;
    if (!TYPES.includes(type)) throw error('无法识别记录类型。', 'VALIDATION');
    return list(await call('GET', '/customer/records/' + type, { page: params.page || 1, pageSize: params.pageSize || 50 })).items;
  }
  async function getRecord(type, id, params = {}) {
    if (type === 'orderchanges') return params.kind === 'SUBSCRIPTION_EXTENSION' ? renewalsApi.getOrderRenewal(id) : changesApi.getOrderChange(id);
    if (!TYPES.includes(type)) throw error('无法识别记录类型。', 'VALIDATION');
    const token = session()?.token, result = await call('GET', '/customer/records/' + type + '/' + identifier(id));
    if (type !== 'contracts' || result.executionMode === 'OFFLINE' || result.contractDetail?.executionMode === 'OFFLINE') return result;
    const allowed = await nativeSigning.canUseSigning(); if (session()?.token !== token) throw error('登录会话已变化，请重新进入本人记录。', 'SESSION_CHANGED');
    if (allowed) return result;
    return { ...result, historyOnly: true, actions: (result.actions || []).filter(action => !['sign','query','sync'].includes(action.id)), ...(result.contractDetail ? { contractDetail: { ...result.contractDetail, canSign: false, canQuery: false, primaryAction: null, guidance: { title: '历史合同资料', description: '仅查看已记录的进度与文件，当前不办理新的电子签署或渠道核验。' } } } : {}) };
  }
  async function uploadFile(file, purpose) {
    const current = session();
    if (!current) throw error('请先登录再上传资料。', 'AUTH_REQUIRED');
    if (!file?.tempFilePath || !['identity', 'profile', 'service', 'mileage', 'handover'].includes(purpose) || !Number.isFinite(file.size) || file.size <= 0 || file.size > 10 * 1024 * 1024) throw error('请选择不超过 10 MB 的有效图片。', 'VALIDATION');
    return new Promise((resolve, reject) => platform.uploadFile({
      url: validateBase(options.apiBase) + '/api/customer/files', filePath: file.tempFilePath, name: 'file', formData: { purpose }, timeout: 60000,
      header: { Authorization: 'Bearer ' + current.token },
      success(response) {
        let data;
        try { data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data; } catch (_) { return reject(error('上传响应无效，请重新上传。', 'RESPONSE')); }
        if (response.statusCode < 200 || response.statusCode >= 300) return reject(failure({ ...response, data }, current.token));
        if (!data?.id || !data.url) return reject(error('上传未取得文件编号，请重新上传。', 'RESPONSE'));
        resolve({ id: data.id, name: data.name, url: media(data.url), mimeType: data.mimeType, size: data.size });
      }, fail() { reject(error('附件上传失败，请检查网络后重试。', 'UPLOAD_FAILED')); },
    }));
  }
  async function submitService(payload) {
    if(payload.type==='benefit'&&!payload.entitlementId)throw error('请从本单权益重新进入。','VALIDATION');
    return call('POST', '/customer/services', { type: payload.type, location: payload.location, description: payload.description, mobile: payload.mobile, ...(payload.orderId||payload.entitlementId?{orderId:identifier(payload.orderId)}:{}),...(payload.entitlementId?{entitlementId:identifier(payload.entitlementId)}:{}),fileIds: fileIds(payload), idempotencyKey: payload.idempotencyKey || idempotencyKey('service') });
  }
  async function submitMileage(payload) {
    const readingKm = payload.readingKm ?? payload.reading;
    if (!payload.orderId || !Number.isSafeInteger(readingKm) || readingKm < 0 || !fileIds(payload).length) throw error('请提供订阅编号、整数公里读数与已上传凭证。', 'VALIDATION');
    return call('POST', '/customer/mileages', { orderId: payload.orderId, readingKm, recordedAt: payload.recordedAt || new Date().toISOString(), fileIds: fileIds(payload), idempotencyKey: payload.idempotencyKey || idempotencyKey('mileage') });
  }
  async function submitHandover(payload) {
    if (!payload.handoverId || !payload.manifestHash || !payload.evidenceRead || !payload.accepted) throw error('请重新阅读当前版本交接证据并确认意见。', 'VALIDATION');
    const objection = ['object', 'objection', 'dispute'].includes(payload.decision);
    if (!objection && payload.decision !== 'confirm') throw error('请选择交接意见。', 'VALIDATION');
    if (objection && !String(payload.reason || payload.note || '').trim()) throw error('请填写异议说明。', 'VALIDATION');
    const identity=JSON.stringify([session()?.token,session()?.customer?.id]);
    const current = await getHandover(payload.handoverId);
    if(identity!==JSON.stringify([session()?.token,session()?.customer?.id]))throw error('登录会话已变化，请重新读取本人交接记录。','SESSION_CHANGED');
    if(current.confirmationMode!=null&&!['ONLINE_RECORD','SEPARATE_DOCUMENT'].includes(current.confirmationMode))throw error('交接确认方式未核实，请刷新。','HANDOVER_MODE');
    let onlineBinding={};
    if(current.confirmationMode==='ONLINE_RECORD'){
      const signing=handoverSigning(current),record=current.onlineRecord;
      if(signing.confirmationBlocked||payload.revision!==current.revision||payload.manifestHash!==current.manifestHash)throw error('线上交接版本已变化，请重新阅读。','HANDOVER_VERSION');
      if(!objection&&(payload.termsAccepted!==true||payload.documentId!==record.documentId||payload.termsVersion!==record.termsVersion||payload.termsHash!==record.termsHash||!Array.isArray(payload.readFileIds)||new Set(payload.readFileIds).size!==current.fileIds.length||payload.readFileIds.length!==current.fileIds.length||!current.fileIds.every(id=>payload.readFileIds.includes(id))))throw error('请明确同意当前线上交接约定，并逐份阅读本版本证据。','HANDOVER_TERMS');
      onlineBinding={revision:current.revision,...(!objection?{documentId:record.documentId,termsVersion:record.termsVersion,termsHash:record.termsHash,termsAccepted:true}:{})};
    }
    if (!objection) {
      if (!current.actualAtValid || current.manifestHash !== payload.manifestHash || current.actualAt !== payload.actualAt) throw error('实际交接时间缺失、无效或已变更，请重新核对当前交接证据。', 'HANDOVER_ACTUAL_TIME');
    }
    const body = { manifestHash: payload.manifestHash, ...onlineBinding, ...(objection ? { reason: payload.reason || payload.note, fileIds: fileIds(payload) } : { readFileIds: payload.readFileIds || [] }), idempotencyKey: payload.idempotencyKey || idempotencyKey('handover') };
    return call('POST', '/customer/handovers/' + identifier(payload.handoverId) + (objection ? '/object' : '/confirm'), body);
  }
  async function getHandover(id) {
    const token = session()?.token; let value = await call('GET', '/customer/handovers/' + identifier(id));
    if (!value || value.id !== id) throw error('交接记录不匹配，请刷新。', 'RESPONSE');
    if (value.confirmationMode !== 'ONLINE_RECORD' && value.executionMode !== 'OFFLINE' && value.signingReadiness && value.signingReadiness.executionMode !== 'OFFLINE') {
      const allowed = await nativeSigning.canUseSigning(); if (session()?.token !== token) throw error('登录会话已变化，请重新进入本人记录。', 'SESSION_CHANGED');
      if (!allowed) value = { ...value, historyOnly: true, signingReadiness: { ...value.signingReadiness, historyOnly: true, canSign: false, canQuery: false, message: '仅查看已记录的交接事实与文件，当前不办理新的电子签署或渠道核验。' } };
    }
    const time = typeof value.actualAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.actualAt) ? Date.parse(value.actualAt) : NaN;
    const swap = ['SWAP_RETURN', 'SWAP_DELIVERY'].includes(value.type);
    const actualAtValid = Number.isFinite(time) && time <= Date.now() + 300000 && ['DELIVERY','RETURN', 'SWAP_RETURN', 'SWAP_DELIVERY'].includes(value.type) && (!swap || (typeof value.vehicleId === 'string' && value.vehicleId && typeof value.vehicleTitle === 'string' && value.vehicleTitle && typeof value.changeId === 'string' && value.changeId));
    const actualAtDisplay = actualAtValid ? new Date(time + 8 * 3600000).toISOString().slice(0,19).replace('T',' ') : '缺少有效实际时间';
    return { ...value, isSwap: swap, actualAtValid: Boolean(actualAtValid), actualAtDisplay, actualAtLabel: { DELIVERY: '实际交车时间', RETURN: '实际还车时间', SWAP_RETURN: '旧车实际交还时间', SWAP_DELIVERY: '新车实际交付时间' }[value.type] || '实际交接时间（类型待核对）', actualAtText: actualAtValid ? actualAtDisplay + '（北京时间）' : '缺少有效实际时间，待后台核对' };
  }
  async function getSignStatus(id, kind = 'contract') {
    if (typeof kind === 'string' && kind.startsWith('owner-')) throw error('企业车主业务请从宁达汽车订阅服务号办理。', 'OWNER_H5_REQUIRED');
    if (kind === 'electronic') return electronicSigningStatus(await getElectronicDocument(id));
    if (!['contract', 'handover', 'order-change', 'identity'].includes(kind)) throw error('签署业务类型无效。', 'SIGN_CONTEXT');
    if (kind === 'order-change') { const token = session()?.token, capability = await nativeSigning.getSigningConfig(); if (session()?.token !== token) throw error('登录会话已变化，请重新进入本人记录。', 'SESSION_CHANGED'); if (capability.newOrderContractMode !== 'ESIGN' || !capability.newEsignRequestsEnabled) throw error('当前仅可查阅已有资料，签署渠道核验未开放。', 'SIGNING_READ_ONLY'); return changesApi.queryOrderChangeSignature(id); }
    if (kind === 'identity') { if (id !== session()?.customer.id) throw error('实名记录不属于当前账户。', 'SIGN_CONTEXT'); const readiness = await call('GET', '/customer/identity/readiness'); return { ...readiness, status: readiness?.verified === true && readiness?.realNameStatus === 'VERIFIED' ? 'VERIFIED' : 'PENDING' }; }
    const token = session()?.token, capability = await nativeSigning.getSigningConfig(); if (session()?.token !== token) throw error('登录会话已变化，请重新进入本人记录。', 'SESSION_CHANGED');
    if (!capability.enabled || !capability.signProviderConfigured) throw error('当前仅可查阅已有资料，签署渠道核验未开放。', 'SIGNING_READ_ONLY');
    const result = await call('GET', (kind === 'handover' ? '/customer/handovers/' : '/customer/contracts/') + identifier(id) + '/sign-status');
    if (!['DRAFT', 'PENDING', 'SIGNED', 'REJECTED', 'EXPIRED'].includes(result?.status) || (result.status === 'SIGNED' && !result.signedFileId)) throw error('签署结果或归档尚未核实，请稍后查询。', 'SIGN_STATUS');
    return { status: result.status, signedFileId: result.signedFileId || null };
  }
  async function pay(id, payload) {
    const bill = identifier(id),identity=JSON.stringify([session()?.token,session()?.customer?.id]);
    const current=await call('GET','/customer/records/bills/'+bill);
    if(identity!==JSON.stringify([session()?.token,session()?.customer?.id]))throw error('登录会话已变化，请重新进入本人账单。','SESSION_CHANGED');
    if(current?.id!==id||current.status!=='PENDING'||current.cancellation!=null||!Array.isArray(current.actions)||!current.actions.some(a=>a?.id==='pay'))throw error('当前账单已变化或续期取消处理中，请刷新核对；原支付结果仍可查询。','PAYMENT_UNAVAILABLE');
    if (!paymentKeys.has(id)) paymentKeys.set(id, idempotencyKey('payment'));
    const result = await call('POST', '/customer/bills/' + bill + '/pay', { idempotencyKey: payload.idempotencyKey || paymentKeys.get(id) });
    if (!result?.paymentId || ['timeStamp', 'nonceStr', 'package', 'signType', 'paySign'].some(key => typeof result[key] !== 'string' || !result[key]) || result.signType !== 'RSA') throw error('支付参数不完整，请稍后重新发起。', 'RESPONSE');
    platform.setStorageSync(pendingKey + ':payment', { id: result.paymentId, billId: id });
    let cancelled = false;
    let nativeFailure;
    try { await native('requestPayment', { timeStamp: result.timeStamp, nonceStr: result.nonceStr, package: result.package, signType: result.signType, paySign: result.paySign }); }
    catch (failure) { cancelled = /cancel/i.test(failure.errMsg || failure.message || ''); nativeFailure = failure; }
    const payment = await call('GET', '/customer/payments/' + identifier(result.paymentId));
    if (['SUCCESS', 'SUCCEEDED', 'PAID'].includes(payment.status)) { paymentKeys.delete(id); platform.removeStorageSync(pendingKey + ':payment'); return { status: payment.status, payment, message: '服务端已确认支付结果。' }; }
    if (nativeFailure && !cancelled) throw error('支付未完成，请刷新账单查询结果后重试。', 'PAYMENT_FAILED');
    return { status: cancelled ? 'CANCELLED' : payment.status || 'PENDING', payment, message: cancelled ? '已取消支付，可返回账单重新发起。' : '支付结果确认中，请稍后刷新账单。' };
  }
  async function performAction(type, id, action, payload = {}) {
    const value = identifier(id);
    if (type === 'application' && ['cancel', 'confirm', 'reject'].includes(action)) {
      if (action === 'reject' && !String(payload.reason || '').trim()) throw error('请填写拒绝当前方案的原因。', 'VALIDATION');
      if (action !== 'cancel' && (!Number.isInteger(payload.revision) || payload.revision < 1 || (action === 'confirm' && !payload.commercialHash))) throw error('当前方案版本不完整，请刷新后重新阅读。', 'VALIDATION');
      return call('POST', '/customer/applications/' + value + '/' + action, action === 'confirm' ? { revision: payload.revision, commercialHash: payload.commercialHash, ...(payload.ownerSharing ? {ownerSharing:payload.ownerSharing}: {}) } : action === 'reject' ? { revision: payload.revision, reason: payload.reason.trim() } : { reason: payload.reason });
    }
    if (type === 'bills' && action === 'pay') return pay(id, payload);
    if (['contracts','handovers'].includes(type) && action === 'sign') {
      const context=await getSigningBusinessContext(type==='contracts'?'contract':'handover',id);
      if(context.onlineRecord)throw error('本单采用线上交接记录，请返回交接页核对并确认。','HANDOVER_ONLINE_RECORD');
      if(context.offline)throw error('本单采用线下签署，请查看纸质资料归档进度。','OFFLINE_CONTRACT');
      return nativeSigning.startSigning(type==='contracts'?'contract':'handover',id);
    }
    if (type === 'notifications' && action === 'read') return call('POST', '/customer/notifications/' + value + '/read', {});
    if (type === 'services' && action === 'cancel') return call('POST', '/customer/services/' + value + '/cancel', { reason: payload.reason });
    throw error('当前记录不支持此操作，请刷新状态。', 'VALIDATION');
  }
  async function getSigningBusinessContext(kind,id){
    if(!['contract','handover'].includes(kind))return{offline:false};
    const record=kind==='handover'?await getHandover(id):await getRecord('contracts',id);
    if(!record||record.id!==id)throw error('业务记录不匹配，请返回原记录重新读取。','RESPONSE');
    return{onlineRecord:kind==='handover'&&record.confirmationMode==='ONLINE_RECORD',offline:record.executionMode==='OFFLINE'||record.contractMode==='OFFLINE'||record.contractDetail?.executionMode==='OFFLINE'||record.signingReadiness?.executionMode==='OFFLINE',orderId:record.orderId||record.contractDetail?.orderId||''};
  }
  async function resumePayment() {
    const pending = platform.getStorageSync(pendingKey + ':payment');
    if (!pending || !session()) return null;
    const result = await call('GET', '/customer/payments/' + identifier(pending.id));
    if (['SUCCESS', 'SUCCEEDED', 'PAID', 'CLOSED', 'FAILED'].includes(result.status)) { platform.removeStorageSync(pendingKey + ':payment'); paymentKeys.delete(pending.billId); }
    return result;
  }
  async function getElectronicDocument(id) {
    const row = await call('GET', '/customer/electronic-documents/' + identifier(id));
    if (row?.id !== id || !Number.isInteger(row.revision) || !/^[a-f0-9]{64}$/.test(row.sourceSha256)) throw error('电子合同任务或版本不匹配，请重新读取。', 'SIGN_RESPONSE');
    return row;
  }
  function electronicSigningStatus(row) {
    const archived = row.status === 'ARCHIVED' && row.finalFileAvailable === true && !!row.archivedAt;
    return { status: archived ? 'SIGNED' : ['WITHDRAWN','RETIRED'].includes(row.status) ? 'CLOSED' : row.status === 'DECLINED' ? 'REJECTED' : row.status === 'EXPIRED' ? 'EXPIRED' : 'PENDING', document: row };
  }
  async function syncElectronicSigningStatus(id) {
    const token = session()?.token, row = await getElectronicDocument(id);
    if (session()?.token !== token) throw error('登录会话已变化，请重新进入本人记录。', 'SESSION_CHANGED');
    const result = await call('POST', '/customer/electronic-documents/' + identifier(id) + '/sync', { revision: row.revision, idempotencyKey: idempotencyKey('electronic-sync') });
    if (result?.id !== id) throw error('电子合同返回任务不匹配。', 'SIGN_RESPONSE');
    return electronicSigningStatus(result);
  }
  async function openPrivateFile(id,mimeHint) { return openCustomerFile('/files/'+identifier(id),['image/png','image/jpeg','application/pdf'].includes(mimeHint)?mimeHint:''); }
  async function openCustomerFile(path,mimeHint='') {
    const current = session(), version = sessionVersion;
    if (!current) throw error('请先登录再查看文件。', 'AUTH_REQUIRED');
    const downloaded = await native('downloadFile', { url: validateBase(options.apiBase) + '/api/customer' + path, header: { Authorization: 'Bearer ' + current.token }, timeout: 60000 });
    if (sessionVersion !== version || session()?.token !== current.token || session()?.customer.id !== current.customer.id) throw error('登录会话已变化，不能打开上一账户的文件。', 'SESSION_CHANGED');
    if (downloaded.statusCode !== 200) throw failure({ statusCode: downloaded.statusCode }, current.token);
    if (!downloaded.tempFilePath) throw error('文件下载未完成，请重试。', 'FILE_DOWNLOAD');
    const contentType = downloaded.header?.['Content-Type'] || downloaded.header?.['content-type'] || '';
    if (/^image\//i.test(contentType)||['image/png','image/jpeg'].includes(mimeHint)) await native('previewImage', { current: downloaded.tempFilePath, urls: [downloaded.tempFilePath] });
    else await native('openDocument', { filePath: downloaded.tempFilePath, showMenu: false });
  }
  return { ...createSwapFactApi({call,identifier,sessionKey:()=>session()?.token||null,idempotencyKey}),...contractPlanApi, ...addonApi, ...usageApi, ...swapApi, ...changesApi, ...renewalsApi, ...nativeSigning, getAdvertisingCopy, getContext, refreshContext, loginWechat, requestSms, loginSms, logout, getHome, getVehicles, getVehicle,
    getModelDefinitions: async () => list(await call('GET', '/public/model-definitions', undefined, false)).items,
    getDashboard: async () => { const result = await call('GET', '/customer/dashboard'); return { ...result, ...(result.application ? { application: application(result.application) } : {}), ...(result.subscription ? { subscription: subscriptionView(result.subscription) } : {}) }; },
    getApplication: async id => application(await call('GET', '/customer/applications/' + identifier(id))),
    amendApplication: (id, payload) => call('POST', '/customer/applications/' + identifier(id) + '/amend', { profile: { name: payload.profile.name, drivingYears: payload.profile.drivingYears, fileIds: fileIds({ fileIds: payload.profile.fileIds || [] }), ...(Object.prototype.hasOwnProperty.call(payload.profile, 'handoverLocation') ? { handoverLocation: locationPayload(payload.profile.handoverLocation) } : {}) }, note: payload.note || '', idempotencyKey: payload.idempotencyKey || idempotencyKey('amend') }),
    getHandoverLocationCapability: () => call('GET', '/public/handover-location', undefined, false),
    getLoginDocuments: () => Promise.all(['terms','privacy'].map(type => call('GET', '/public/legal/' + type, undefined, false))),
    acceptConsents: consents => call('POST', '/customer/consents', { consents: consentSnapshot(consents) }),
    getProfile: async () => verifiedProfileResponse(await call('GET','/customer/profile')),
    getESignReadiness: () => call('GET', '/customer/identity/readiness'),
    getIdentityReadiness: () => call('GET', '/customer/identity/readiness'),
    previewLegalDocument: document => {
      const id=document?.id||document?.documentId,version=document?.documentVersion??document?.version;
      if(typeof id!=='string'||!id||!Number.isInteger(version)||version<1||typeof document.content!=='string'||!document.content.trim())throw error('当前版本文档暂不可用，请刷新原业务记录。','DOCUMENT_UNAVAILABLE');
      const token=idempotencyKey('document');legalPreviews.set(token,{token:session()?.token||null,customerId:session()?.customer.id||null,document:{id,version,title:document.title||'协议说明',content:document.content}});
      while(legalPreviews.size>12)legalPreviews.delete(legalPreviews.keys().next().value);
      return '/pages/legal/index?preview='+encodeURIComponent(token);
    },
    getLegalPreview: token => {
      const row=legalPreviews.get(token);
      if(!row||row.token!==(session()?.token||null)||row.customerId!==(session()?.customer.id||null))throw error('阅读入口已失效，请返回原业务记录重新打开。','DOCUMENT_EXPIRED');
      return {...row.document};
    },
    getLegal: type => call('GET', '/public/legal/' + identifier(type), undefined, false),
    getRecords, getRecord, performAction, saveProfile, submitApplication, uploadFile, submitService, submitMileage, submitHandover,getCreditReview,submitCreditConsent,withdrawCreditConsent,
    getElectronicDocument, syncElectronicSigningStatus,
    getElectronicDocuments: ({orderId='',page=1}={}) => call('GET','/customer/electronic-documents?' + (orderId ? 'orderId='+identifier(orderId)+'&' : '') + 'page='+page+'&pageSize=20'),
    getElectronicWorkspace: id => call('GET','/customer/electronic-documents/workspace/'+identifier(id)),
    openElectronicFile: async (id,variant) => { if(!['source','signed'].includes(variant))throw error('文件类型无效。','VALIDATION'); return openCustomerFile('/electronic-documents/'+identifier(id)+'/files/'+variant,'application/pdf'); },
    getHandover, getSignStatus, getSigningBusinessContext, resumePayment, idempotencyKey, openPrivateFile,
    getOrderWorkspace: id => call('GET','/customer/orders/'+identifier(id)+'/workspace'),
    getWorkbench: () => call('GET','/customer/workbench'),
    getOfflineArchive: id => call('GET','/customer/offline-archives/'+identifier(id)),
    openOfflineArchiveFile: (archiveId,versionId,fileId,mimeType) => openCustomerFile(archiveFilePath(archiveId,versionId,fileId),mimeType),
    feedbackOfflineArchive: (archiveId,payload) => call('POST','/customer/offline-archives/'+identifier(archiveId)+'/feedback',{versionId:payload.versionId,message:String(payload.message||'').trim(),idempotencyKey:payload.idempotencyKey}),
    getOrderEntitlements: id => call('GET','/customer/orders/'+identifier(id)+'/entitlements'),
    getOrderInsurance: id => call('GET','/customer/orders/'+identifier(id)+'/insurance-summary'),
    getQualifications: () => call('GET','/customer/qualifications'),
    getApplicationRisk: id => call('GET','/customer/applications/'+identifier(id)+'/risk-review'),
    clearSigningCache: () => platform.removeStorageSync(pendingKey),
    readFile: id => call('GET', '/customer/files/' + identifier(id)),
  };
}
module.exports = { createApi, validateBase };
