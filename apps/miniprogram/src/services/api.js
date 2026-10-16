const { money, date } = require('../utils/format');
const { createUsageApi } = require('./usage');
const { createOrderChangesApi } = require('./order-changes');
const { createNativeSigningApi } = require('./native-signing');
const TYPES = ['applications', 'orders', 'contracts', 'bills', 'payments', 'deposits', 'entitlements', 'notifications', 'services', 'mileages'];
const VERIFICATION_STATUS = { AUTHORIZED: '已授权，尚未付款', CREATING: '支付准备结果待确认', PENDING: '支付结果待确认', SUCCEEDED: '支付成功', CLOSED: '验收已关闭', FAILED: '支付失败，不能继续付款', EXPIRED: '验收授权已过期' };
const CREDIT_BANDS = { GE750: '750分及以上', B700_749: '700—749分', B650_699: '650—699分', LT650: '低于650分', UNVERIFIABLE: '无法核验' };
const CREDIT_MULTIPLIERS = { GE750: 0, B700_749: 1, B650_699: 2, LT650: null, UNVERIFIABLE: null };
const COMMERCIAL_FIELDS = { vehicleIdentification: '车辆及 VIN/车牌', permittedUse: '城市、使用性质、驾驶人及限制', conditionDisclosure: '车辆状况及已披露问题', customerAddress: '合同联系地址', mileageCarryRule: '里程累计与结转方式', excessMileageCalculation: '超里程计算及上限', usageCosts: '充电、停车、通行及违章承担', insuranceDetails: '保险机构、保单、险种、保额、免赔及免责', maintenanceRule: '保养、维修及正常磨损责任', serviceCoverage: '救援等权益覆盖、时间、次数及电话', handoverArrangement: '交还车地点、时间及延迟处理', earlyTerminationRule: '提前解约计算、上限及退费', depositRefundRule: '押金结算与退款期限', otherFees: '其他已明确收费项目' };
function commercialDetails(plan) {
  const commercialRows = Object.keys(COMMERCIAL_FIELDS).map(key => ({ key, label: COMMERCIAL_FIELDS[key], value: plan.commercialTerms?.[key] || '' }));
  const termsComplete = commercialRows.every(row => typeof row.value === 'string' && row.value.trim() && !/\{\{|\}\}|待确认|待补齐|待填写|另行通知/.test(row.value));
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
function createApi(options, request, platform = typeof wx !== 'undefined' ? wx : {}) {
  const storageKey = options.storageKey || 'ev-subscription:customer-session:v1';
  const pendingKey = storageKey + ':pending';
  const paymentKeys = new Map();
  const verificationPayments = new Set();
  const creditKeys = new Map();
  const usageApi = createUsageApi({ call, identifier, error, idempotencyKey, getContext });
  const changesApi = createOrderChangesApi({ call, identifier, error, idempotencyKey, getContext, enterSigning: (kind, id, body) => nativeSigning.startSigning(kind, id, body) });
  const nativeSigning = createNativeSigningApi({ call, native, error, identifier, getContext, sessionKey: () => session()?.token, getSignStatus, platform, pendingKey });
  function clearSession() { platform.removeStorageSync(storageKey); platform.removeStorageSync(pendingKey); platform.removeStorageSync(pendingKey + ':payment'); paymentKeys.clear(); creditKeys.clear(); usageApi.clearUsageKeys(); changesApi.clearChangeKeys(); nativeSigning.clearSigningState(); }
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
  function failure(response, token) {
    const body = response.data || {};
    if (response.statusCode === 401 && (!token || session()?.token === token)) clearSession();
    const messages = { 401: '登录已过期，请重新登录。', 403: '无权查看或操作此记录。', 404: '记录不存在或暂不可用。', 409: '内容或状态已更新，请刷新后重试。', 429: '操作频繁，请稍后重试。' };
    return error(body.error?.message || messages[response.statusCode] || '后台暂时无法处理请求，请稍后重试。', body.error?.code || `HTTP_${response.statusCode}`, { statusCode: response.statusCode, details: body.error?.details, requestId: body.requestId });
  }
  async function call(method, path, data, authenticated = true) {
    const base = validateBase(options.apiBase);
    const current = authenticated ? session() : null;
    if (authenticated && !current) throw error('请先登录后继续。', 'AUTH_REQUIRED');
    return new Promise((resolve, reject) => request({
      url: base + '/api' + path, method, data, timeout: options.requestTimeout || 15000,
      header: { Accept: 'application/json', 'Content-Type': 'application/json', ...(current ? { Authorization: 'Bearer ' + current.token } : {}) },
      success(response) {
        if (current && (session()?.token !== current.token || session()?.customer.id !== current.customer.id)) return reject(error('登录会话已变化，已忽略原账号请求结果。', 'SESSION_CHANGED'));
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.data);
        else reject(failure(response, current?.token));
      },
      fail() { reject(error('无法连接后台，请检查网络后重试。', 'NETWORK')); },
    }));
  }
  function validateSession(value) {
    if (!value || typeof value.token !== 'string' || !value.token || !value.customer?.id || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now()) throw error('后台登录响应无效，请重新登录。', 'RESPONSE');
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
    return { ...row, name: row.name || row.title || [row.brand, row.model].filter(Boolean).join(' ') || '车型待确认', brand: row.brand || '其他品牌', city: row.city || '城市待确认',
      registrationText: row.registrationText || (row.registrationDate ? date(row.registrationDate) + ' 上牌' : row.year ? row.year + ' 年款' : '上牌时间待确认'),
      mileageText: row.mileageText || (Number.isFinite(mileage) ? mileage.toLocaleString('en-US') + ' km' : '里程待确认'),
      rangeText: row.rangeText || '续航待披露', bodyType: row.bodyType || row.model || '配置见车辆资料',
      available: row.available === true, statusText: row.statusText || (row.available === true ? '可申请' : '暂不可申请'),
      imageUrl: media(row.imageUrl || row.coverImageUrl) || '/assets/car-placeholder.png', minFeeAmount: Number.isSafeInteger(amount) ? amount : null, minFeeText: money(amount), tagline: row.tagline || row.description || '以车辆披露及最终方案为准。' };
  }
  function plan(row) {
    if (!row || typeof row.id !== 'string') throw error('后台套餐数据不符合约定。', 'RESPONSE');
    return { ...row, title: row.title || row.name || '订阅套餐', termMonths: row.termMonths ?? row.months ?? null, monthlyFeeText: money(row.monthlyFeeAmount), mileageText: row.mileageText || (Number.isFinite(row.mileagePerMonthKm) ? '每月 ' + row.mileagePerMonthKm + ' 公里' : '里程条件待确认'), energyText: row.energyText || row.energyDescription || '能源条件待确认', benefits: row.benefits || [], depositText: row.depositText || '审核后确认', notes: row.notes || row.conditions || '', available: row.available === true || row.active === true };
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
    if (originalVerification && (typeof originalVerification.id !== 'string' || !Object.prototype.hasOwnProperty.call(CREDIT_BANDS, originalVerification.band))) throw error('人工核验档位无效，请联系运营核对。', 'RESPONSE');
    const verification = originalVerification ? { id: originalVerification.id, band: originalVerification.band, verifiedAt: originalVerification.verifiedAt, consentId: originalVerification.consentId } : null;
    const multiplier = [0, 1, 2].includes(value.depositMultiplier) ? value.depositMultiplier : null;
    if ((value.depositMultiplier != null && multiplier === null) || (multiplier !== null && (!verification || CREDIT_MULTIPLIERS[verification.band] !== multiplier))) throw error('核验档位与押金规则不匹配，请联系运营核对。', 'RESPONSE');
    const currentConsent = Boolean(document && consent?.status === 'ACCEPTED' && consent.documentId === document.id && consent.version === document.version);
    const verificationCurrent = Boolean(value.verificationCurrent === true && currentConsent && verification?.consentId === consent.id);
    const verifiedDate = verification && new Date(verification.verifiedAt);
    return {
      applicationId, creditRevision: value.creditRevision, ruleVersion: value.ruleVersion, document, consent, verification, consentCurrent: currentConsent,
      status: value.status, statusText: statuses[value.status], consentRequirementsMet: value.consentRequirementsMet === true,
      canConsent: Boolean(value.status !== 'HISTORICAL' && document && value.canConsent === true && value.consentRequirementsMet === true),
      canDecline: Boolean(value.status !== 'HISTORICAL' && document && value.canDecline === true), canWithdraw: Boolean(consent?.status === 'ACCEPTED' && value.canWithdraw === true),
      verificationCurrent,
      canConfirmFinalPlan: Boolean(value.canConfirmFinalPlan === true && value.consentRequirementsMet === true && value.status === 'VERIFIED' && verificationCurrent && multiplier !== null && CREDIT_MULTIPLIERS[verification.band] === multiplier),
      depositMultiplier: multiplier, bandText: verification ? CREDIT_BANDS[verification.band] : '尚未人工核验',
      verifiedAtText: verifiedDate && Number.isFinite(verifiedDate.getTime()) ? new Date(verifiedDate.getTime() + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ') + '（北京时间）' : '尚未核验',
      depositRuleText: multiplier === 0 ? '押金0元' : multiplier !== null ? '押金为最终方案中' + multiplier + '个月订阅费' : '转人工处理，暂不生成正式方案',
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
      mapped.usagePolicyComplete = Boolean(policy?.version === 'USAGE_V1' && typeof policy.documentId === 'string' && policy.documentId && Number.isInteger(policy.documentVersion) && policy.documentVersion > 0 && typeof policy.hash === 'string' && /^[a-f0-9]{64}$/i.test(policy.hash) && typeof policy.content === 'string' && policy.content.trim() && policy.baseAllowanceKm === 1500 && final.mileagePerMonthKm === policy.baseAllowanceKm && Number.isSafeInteger(policy.excessPriceAmount) && policy.excessPriceAmount >= 0 && final.excessMileagePriceAmount === policy.excessPriceAmount);
      mapped.complete = mapped.termsComplete && mapped.usagePolicyComplete && Number.isSafeInteger(final.monthlyFeeAmount) && final.monthlyFeeAmount >= 0 && Number.isSafeInteger(final.depositAmount) && final.depositAmount >= 0 && Number.isSafeInteger(final.excessMileagePriceAmount) && final.excessMileagePriceAmount >= 0 && Number.isInteger(mapped.termMonths) && mapped.termMonths > 0 && Number.isSafeInteger(final.mileagePerMonthKm) && final.mileagePerMonthKm >= 0 && mapped.startDateText !== '待确认' && mapped.firstDueDateText !== '待确认' && Boolean(mapped.notes && mapped.energyText && final.commercialHash) && Array.isArray(final.benefits);
    }
    return { ...row, planTitle: row.planTitle || row.planName || row.plan?.name || '', monthlyFeeText: row.monthlyFeeText || money(row.plan?.monthlyFeeAmount), finalPlan: mapped };
  }
  async function getHome() {
    if (session()) { const result = await call('GET', '/customer/home'); return { ...result, vehicles: (result.vehicles || []).map(vehicle) }; }
    return { vehicles: (await getVehicles({ pageSize: 2 })).items, context: getContext(), nextAction: null };
  }
  function consentSnapshot(consents) {
    if (!Array.isArray(consents) || consents.length < 2 || new Set(consents.map(row => row.documentId)).size !== consents.length || consents.some(row => !row.documentId || !Number.isInteger(row.version) || row.version < 1)) throw error('请阅读并同意当前已发布的用户协议和隐私政策。', 'CONSENT_REQUIRED');
    return consents.map(row => ({ documentId: row.documentId, version: row.version }));
  }
  async function loginWechat(phoneCode, consents) {
    consents = consentSnapshot(consents);
    if (!phoneCode) throw error('请授权微信手机号后继续。', 'VALIDATION');
    const login = await native('login');
    if (!login.code) throw error('微信登录凭证未取得，请重试。', 'WECHAT_LOGIN');
    return validateSession(await call('POST', '/customer/auth/wechat', { loginCode: login.code, phoneCode, consents }, false));
  }
  async function requestSms(mobile) {
    if (!/^1[3-9]\d{9}$/.test(mobile)) throw error('请输入有效手机号。', 'VALIDATION');
    return call('POST', '/customer/auth/sms/request', { mobile }, false);
  }
  async function loginSms(mobile, code, consents) {
    consents = consentSnapshot(consents);
    if (!/^1[3-9]\d{9}$/.test(mobile) || !/^\d{4,8}$/.test(code)) throw error('请输入有效手机号与验证码。', 'VALIDATION');
    const login = await native('login');
    if (!login.code) throw error('微信登录凭证未取得，请重试。', 'WECHAT_LOGIN');
    return validateSession(await call('POST', '/customer/auth/sms/login', { mobile, code, loginCode: login.code, consents }, false));
  }
  async function logout() { await call('POST', '/customer/auth/logout', {}); clearSession(); }
  async function saveProfile(payload) {
    const profile = getContext().profile;
    if (payload.mobile && payload.mobile !== profile?.mobile) throw error('修改手机号需要重新验证，请在账户页重新登录。', 'PHONE_REVERIFY');
    const { mobile, ...body } = payload;
    const result = await call('PUT', '/customer/profile', body);
    await refreshContext();
    return result;
  }
  async function submitApplication(payload) {
    if (!payload.accepted || !Array.isArray(payload.consents) || !payload.consents.length || payload.consents.some(c => !c.documentId || c.version == null)) throw error('请阅读并同意当前已发布的申请协议。', 'CONSENT_REQUIRED');
    return call('POST', '/customer/applications', { vehicleId: payload.vehicleId, subscriptionPlanId: payload.subscriptionPlanId || payload.planId, profile: payload.profile || { name: payload.name, mobile: payload.mobile }, consents: payload.consents, idempotencyKey: payload.idempotencyKey || idempotencyKey('application') });
  }
  async function getRecords(type, params = {}) {
    if (type === 'orderchanges') return (await changesApi.getOrderChanges(params)).items;
    if (!TYPES.includes(type)) throw error('无法识别记录类型。', 'VALIDATION');
    return list(await call('GET', '/customer/records/' + type, { page: params.page || 1, pageSize: params.pageSize || 50 })).items;
  }
  async function getRecord(type, id) {
    if (type === 'orderchanges') return changesApi.getOrderChange(id);
    if (!TYPES.includes(type)) throw error('无法识别记录类型。', 'VALIDATION');
    return call('GET', '/customer/records/' + type + '/' + identifier(id));
  }
  async function uploadFile(file, purpose) {
    const current = session();
    if (!current) throw error('请先登录再上传资料。', 'AUTH_REQUIRED');
    if (!file?.tempFilePath || !['profile', 'service', 'mileage', 'handover'].includes(purpose) || !Number.isFinite(file.size) || file.size <= 0 || file.size > 10 * 1024 * 1024) throw error('请选择不超过 10 MB 的有效图片。', 'VALIDATION');
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
    return call('POST', '/customer/services', { type: payload.type, location: payload.location, description: payload.description, mobile: payload.mobile, fileIds: fileIds(payload), idempotencyKey: payload.idempotencyKey || idempotencyKey('service') });
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
    if (!objection) {
      const current = await getHandover(payload.handoverId);
      if (!current.actualAtValid || current.manifestHash !== payload.manifestHash || current.actualAt !== payload.actualAt) throw error('实际交接时间缺失、无效或已变更，请重新核对当前交接证据。', 'HANDOVER_ACTUAL_TIME');
    }
    const body = { manifestHash: payload.manifestHash, ...(objection ? { reason: payload.reason || payload.note, fileIds: fileIds(payload) } : { readFileIds: payload.readFileIds || [] }), idempotencyKey: payload.idempotencyKey || idempotencyKey('handover') };
    return call('POST', '/customer/handovers/' + identifier(payload.handoverId) + (objection ? '/object' : '/confirm'), body);
  }
  async function getHandover(id) {
    const value = await call('GET', '/customer/handovers/' + identifier(id));
    if (!value || value.id !== id) throw error('交接记录不匹配，请刷新。', 'RESPONSE');
    const time = typeof value.actualAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.actualAt) ? Date.parse(value.actualAt) : NaN;
    const actualAtValid = Number.isFinite(time) && time <= Date.now() + 300000 && ['DELIVERY','RETURN'].includes(value.type);
    const actualAtDisplay = actualAtValid ? new Date(time + 8 * 3600000).toISOString().slice(0,19).replace('T',' ') : '缺少有效实际时间';
    return { ...value, actualAtValid, actualAtDisplay, actualAtLabel: value.type === 'DELIVERY' ? '实际交车时间' : value.type === 'RETURN' ? '实际还车时间' : '实际交接时间（类型待核对）', actualAtText: actualAtValid ? actualAtDisplay + '（北京时间）' : '缺少有效实际时间，待后台核对' };
  }
  async function getSignStatus(id, kind = 'contract') {
    if (!['contract', 'handover', 'order-change', 'identity'].includes(kind)) throw error('签署业务类型无效。', 'SIGN_CONTEXT');
    if (kind === 'order-change') return changesApi.queryOrderChangeSignature(id);
    if (kind === 'identity') { if (id !== session()?.customer.id) throw error('实名记录不属于当前账户。', 'SIGN_CONTEXT'); const readiness = await call('GET', '/customer/esign/readiness'); return { ...readiness, status: readiness.readyForSigning === true ? 'VERIFIED' : 'PENDING' }; }
    const result = await call('GET', (kind === 'handover' ? '/customer/handovers/' : '/customer/contracts/') + identifier(id) + '/sign-status');
    if (!['DRAFT', 'PENDING', 'SIGNED', 'REJECTED', 'EXPIRED'].includes(result?.status) || (result.status === 'SIGNED' && !result.signedFileId)) throw error('签署结果或归档尚未核实，请稍后查询。', 'SIGN_STATUS');
    return { status: result.status, signedFileId: result.signedFileId || null };
  }
  async function pay(id, payload) {
    const bill = identifier(id);
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
  function verificationView(value) {
    if (!value || typeof value.id !== 'string' || !Object.prototype.hasOwnProperty.call(VERIFICATION_STATUS,value.status)) throw error('支付验收记录格式无效，请重新查询。','RESPONSE');
    const amountValid=value.amount===1&&value.currency==='CNY';
    const active=Number.isFinite(Date.parse(value.expiresAt))&&Date.parse(value.expiresAt)>Date.now();
    const manualReviewRequired=value.manualReviewRequired===true;
    const statusMessage=typeof value.statusMessage==='string'?value.statusMessage.trim().slice(0,1000):'';
    return {id:value.id,amount:value.amount,currency:value.currency,status:value.status,expiresAt:value.expiresAt,createdAt:value.createdAt,paidAt:value.paidAt||null,title:'微信支付验收',amountText:amountValid?'¥0.01':'金额或币种异常',statusText:manualReviewRequired?'需人工核对支付结果':VERIFICATION_STATUS[value.status],manualReviewRequired,statusMessage:statusMessage||(manualReviewRequired?'渠道结果尚未核实，需人工核对；不能认定未扣款。':''),canPay:!manualReviewRequired&&value.canPay===true&&amountValid&&active&&['AUTHORIZED','CREATING','PENDING'].includes(value.status),unavailableReason:!amountValid?'验收仅支持人民币0.01元，当前记录不可付款。':!active&&value.status!=='SUCCEEDED'?'验收授权已过期或有效期异常。':''};
  }
  async function getPaymentVerifications() {
    const result=await call('GET','/customer/payment-verifications');
    if(!Array.isArray(result?.items))throw error('支付验收列表格式无效。','RESPONSE');
    return result.items.map(verificationView);
  }
  async function queryPaymentVerification(id) { const result=verificationView(await call('POST','/customer/payment-verifications/'+identifier(id)+'/query',{}));if(result.id!==id)throw error('支付验收查询记录不匹配。','RESPONSE');return result; }
  async function payPaymentVerification(id,options={}) {
    identifier(id);
    if(verificationPayments.has(id))throw error('本次支付验收正在处理中，请等待结果。','PAYMENT_VERIFICATION_BUSY');
    verificationPayments.add(id);
    try{
      const record=(await getPaymentVerifications()).find(item=>item.id===id);
      if(!record)throw error('当前账户没有这份支付验收授权。','PAYMENT_VERIFICATION_NOT_AUTHORIZED');
      if(!record.canPay)throw error(record.unavailableReason||'当前支付验收状态不可付款，请查询最新结果。','PAYMENT_VERIFICATION_STATE');
      if(record.status!=='AUTHORIZED'&&options.resume!==true)throw error('请先手动查询本次验收状态，再决定是否继续同一次付款。','PAYMENT_VERIFICATION_QUERY_REQUIRED');
      const [context,documents]=await Promise.all([refreshContext(),Promise.all(['terms','privacy'].map(type=>call('GET','/public/legal/'+type,undefined,false)))]);
      if(documents.some((doc,index)=>!doc?.id||doc.type!==['terms','privacy'][index]||!Number.isInteger(doc.version)||!doc.content||!context.consents.some(consent=>consent.documentId===doc.id&&consent.version===doc.version)))throw error('请先阅读并同意当前正式用户协议与隐私政策。','CONSENT_REQUIRED');
      let result;
      try{result=await call('POST','/customer/payment-verifications/'+identifier(id)+'/pay',{});}
      catch(failure){if(failure.statusCode!==409)throw failure;const verification=await queryPaymentVerification(id);return{verification,nativeOutcome:'NOT_STARTED',message:verification.manualReviewRequired?verification.statusMessage:verification.status==='SUCCEEDED'?'微信支付验收支付成功。':verification.statusText+'，请以当前服务端状态为准。'};}
      const response=verificationView(result?.verification),payment=result?.paymentParams;
      if(response.id!==id||response.amount!==1||response.currency!=='CNY'||!['AUTHORIZED','CREATING','PENDING'].includes(response.status)||!Number.isFinite(Date.parse(response.expiresAt))||Date.parse(response.expiresAt)<=Date.now()||!payment||typeof payment.timeStamp!=='string'||!/^\d{1,16}$/.test(payment.timeStamp)||['nonceStr','package','signType','paySign'].some(key=>typeof payment[key]!=='string'||!payment[key].trim()||payment[key].length>4096)||payment.signType!=='RSA'||!/^prepay_id=[^\s]+$/.test(payment.package))throw error('支付验收参数无效，请查询本次验收，不要重复付款。','RESPONSE');
      let nativeOutcome='COMPLETED';
      try{await native('requestPayment',{timeStamp:payment.timeStamp,nonceStr:payment.nonceStr,package:payment.package,signType:payment.signType,paySign:payment.paySign});}
      catch(failure){nativeOutcome=/cancel/i.test(failure?.errMsg||failure?.message||'')?'CANCELLED':'FAILED';}
      let verification;
      try{verification=await queryPaymentVerification(id);}catch(failure){throw error('支付验收结果尚未核实，请手动查询状态，不要重复付款。','PAYMENT_VERIFICATION_QUERY_REQUIRED',{statusCode:failure.statusCode});}
      return{verification,nativeOutcome,message:verification.manualReviewRequired?verification.statusMessage:verification.status==='SUCCEEDED'?'微信支付验收支付成功。':['CLOSED','FAILED','EXPIRED'].includes(verification.status)?verification.statusText+'，本次验收不可继续付款。':nativeOutcome==='CANCELLED'?'已取消微信付款，请查询本次验收；不会自动关闭或再次付款。':nativeOutcome==='FAILED'?'微信付款结果未完成，请查询本次验收。':'服务端结果待确认，请查询本次验收，不要重复付款。'};
    }finally{verificationPayments.delete(id);}
  }
  async function performAction(type, id, action, payload = {}) {
    const value = identifier(id);
    if (type === 'application' && ['cancel', 'confirm', 'reject'].includes(action)) {
      if (action === 'reject' && !String(payload.reason || '').trim()) throw error('请填写拒绝当前方案的原因。', 'VALIDATION');
      if (action !== 'cancel' && (!Number.isInteger(payload.revision) || payload.revision < 1 || (action === 'confirm' && !payload.commercialHash))) throw error('当前方案版本不完整，请刷新后重新阅读。', 'VALIDATION');
      return call('POST', '/customer/applications/' + value + '/' + action, action === 'confirm' ? { revision: payload.revision, commercialHash: payload.commercialHash } : action === 'reject' ? { revision: payload.revision, reason: payload.reason.trim() } : { reason: payload.reason });
    }
    if (type === 'bills' && action === 'pay') return pay(id, payload);
    if (type === 'contracts' && action === 'sign') return nativeSigning.startSigning('contract', id);
    if (type === 'handovers' && action === 'sign') return nativeSigning.startSigning('handover', id);
    if (type === 'notifications' && action === 'read') return call('POST', '/customer/notifications/' + value + '/read', {});
    if (type === 'services' && action === 'cancel') return call('POST', '/customer/services/' + value + '/cancel', { reason: payload.reason });
    throw error('当前记录不支持此操作，请刷新状态。', 'VALIDATION');
  }
  async function resumePayment() {
    const pending = platform.getStorageSync(pendingKey + ':payment');
    if (!pending || !session()) return null;
    const result = await call('GET', '/customer/payments/' + identifier(pending.id));
    if (['SUCCESS', 'SUCCEEDED', 'PAID', 'CLOSED', 'FAILED'].includes(result.status)) { platform.removeStorageSync(pendingKey + ':payment'); paymentKeys.delete(pending.billId); }
    return result;
  }
  async function openPrivateFile(id) {
    const current = session();
    if (!current) throw error('请先登录再查看文件。', 'AUTH_REQUIRED');
    const downloaded = await native('downloadFile', { url: validateBase(options.apiBase) + '/api/customer/files/' + identifier(id), header: { Authorization: 'Bearer ' + current.token }, timeout: 60000 });
    if (downloaded.statusCode !== 200) throw failure({ statusCode: downloaded.statusCode }, current.token);
    if (!downloaded.tempFilePath) throw error('文件下载未完成，请重试。', 'FILE_DOWNLOAD');
    const contentType = downloaded.header?.['Content-Type'] || downloaded.header?.['content-type'] || '';
    if (/^image\//i.test(contentType)) await native('previewImage', { current: downloaded.tempFilePath, urls: [downloaded.tempFilePath] });
    else await native('openDocument', { filePath: downloaded.tempFilePath, showMenu: false });
  }
  return { ...usageApi, ...changesApi, ...nativeSigning, getContext, refreshContext, loginWechat, requestSms, loginSms, logout, getHome, getVehicles, getVehicle,
    getModelDefinitions: async () => list(await call('GET', '/public/model-definitions', undefined, false)).items,
    getDashboard: async () => { const result = await call('GET', '/customer/dashboard'); return { ...result, ...(result.application ? { application: application(result.application) } : {}), ...(result.subscription ? { subscription: { ...result.subscription, imageUrl: media(result.subscription.imageUrl) } } : {}) }; },
    getApplication: async id => application(await call('GET', '/customer/applications/' + identifier(id))),
    amendApplication: (id, payload) => call('POST', '/customer/applications/' + identifier(id) + '/amend', { profile: { name: payload.profile.name, drivingYears: payload.profile.drivingYears, fileIds: fileIds({ fileIds: payload.profile.fileIds || [] }) }, note: payload.note || '', idempotencyKey: payload.idempotencyKey || idempotencyKey('amend') }),
    getLoginDocuments: () => Promise.all(['terms','privacy'].map(type => call('GET', '/public/legal/' + type, undefined, false))),
    acceptConsents: consents => call('POST', '/customer/consents', { consents: consentSnapshot(consents) }),
    getESignReadiness: () => call('GET', '/customer/esign/readiness'),
    getLegal: type => call('GET', '/public/legal/' + identifier(type), undefined, false),
    getRecords, getRecord, performAction, saveProfile, submitApplication, uploadFile, submitService, submitMileage, submitHandover,getPaymentVerifications,payPaymentVerification,queryPaymentVerification,getCreditReview,submitCreditConsent,withdrawCreditConsent,
    getHandover, getSignStatus, resumePayment, idempotencyKey, openPrivateFile,
    clearSigningCache: () => platform.removeStorageSync(pendingKey),
    readFile: id => call('GET', '/customer/files/' + identifier(id)),
  };
}
module.exports = { createApi, validateBase };
