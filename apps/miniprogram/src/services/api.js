const { money, date } = require('../utils/format');
const TYPES = ['applications', 'orders', 'contracts', 'bills', 'payments', 'deposits', 'entitlements', 'notifications', 'services', 'mileages'];
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
  function clearSession() { platform.removeStorageSync(storageKey); platform.removeStorageSync(pendingKey); platform.removeStorageSync(pendingKey + ':payment'); paymentKeys.clear(); }
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
  function application(row) {
    if (!row) return row;
    const final = row.finalPlan;
    const mapped = final ? { ...final, planTitle: final.planTitle || final.title || row.planName || row.planTitle || '', notes: final.notes || final.conditions || '', termMonths: final.termMonths ?? final.months, monthlyFeeText: money(final.monthlyFeeAmount), depositText: money(final.depositAmount), mileageText: final.mileageText || (Number.isFinite(final.mileagePerMonthKm) ? '每月 ' + final.mileagePerMonthKm + ' 公里' : '待确认'), energyText: final.energyText || final.energyDescription || '', excessMileagePriceText: money(final.excessMileagePriceAmount), startDateText: date(final.startDate), firstDueDateText: date(final.firstDueDate) } : null;
    if (mapped) { Object.assign(mapped, commercialDetails(final)); mapped.complete = mapped.termsComplete && Number.isSafeInteger(final.monthlyFeeAmount) && final.monthlyFeeAmount >= 0 && Number.isSafeInteger(final.depositAmount) && final.depositAmount >= 0 && Number.isSafeInteger(final.excessMileagePriceAmount) && final.excessMileagePriceAmount >= 0 && Number.isInteger(mapped.termMonths) && mapped.termMonths > 0 && Number.isSafeInteger(final.mileagePerMonthKm) && final.mileagePerMonthKm >= 0 && mapped.startDateText !== '待确认' && mapped.firstDueDateText !== '待确认' && Boolean(mapped.notes && mapped.energyText && final.commercialHash) && Array.isArray(final.benefits); }
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
    if (!TYPES.includes(type)) throw error('无法识别记录类型。', 'VALIDATION');
    return list(await call('GET', '/customer/records/' + type, { page: params.page || 1, pageSize: params.pageSize || 50 })).items;
  }
  async function getRecord(type, id) {
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
    const body = { manifestHash: payload.manifestHash, ...(objection ? { reason: payload.reason || payload.note, fileIds: fileIds(payload) } : { readFileIds: payload.readFileIds || [] }), idempotencyKey: payload.idempotencyKey || idempotencyKey('handover') };
    return call('POST', '/customer/handovers/' + identifier(payload.handoverId) + (objection ? '/object' : '/confirm'), body);
  }
  function validateSignUrl(url) {
    const match = String(url || '').match(/^https:\/\/([a-zA-Z0-9.-]+)(?::443)?\/[\s\S]*$/);
    if (!match || !(options.signingHosts || []).includes(match[1].toLowerCase()) || /[\s\\]/.test(url)) throw error('签署地址尚未通过域名核验，请联系客服。', 'SIGN_URL');
    return url;
  }
  async function startSign(kind, id) {
    const route = kind === 'handover' ? '/customer/handovers/' : '/customer/contracts/';
    const result = await call('POST', route + identifier(id) + '/sign', {});
    if (!result?.taskId) throw error('签署任务响应无效。', 'RESPONSE');
    if (result.url) validateSignUrl(result.url);
    if (!result.url && !result.miniProgram && result.status !== 'SIGNED') throw error('尚未取得有效的签署入口。', 'RESPONSE');
    platform.setStorageSync(pendingKey, { kind, id, task: result });
    if (result.status !== 'SIGNED') await native('navigateTo', { url: '/pages/sign/index?kind=' + kind + '&id=' + identifier(id) });
    return { ...result, status: result.status || 'PENDING', message: '请完成签署后返回查询结果。' };
  }
  async function getSignStatus(id, kind = 'contract') { if (kind === 'identity') { const readiness = await call('POST', '/customer/esign/refresh', {}); return { ...readiness, status: readiness.readyForSigning ? 'VERIFIED' : 'PENDING' }; } return call('GET', (kind === 'handover' ? '/customer/handovers/' : '/customer/contracts/') + identifier(id) + '/sign-status'); }
  function getSigningTask(kind, id) {
    if (!session()) throw error('请重新登录后发起签署。', 'AUTH_REQUIRED');
    const pending = platform.getStorageSync(pendingKey);
    if (!pending || pending.kind !== kind || pending.id !== id) throw error('签署任务已过期，请从合同或交接页重新进入。', 'SIGN_EXPIRED');
    if (pending.task.url) validateSignUrl(pending.task.url);
    return pending.task;
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
  async function performAction(type, id, action, payload = {}) {
    const value = identifier(id);
    if (type === 'application' && ['cancel', 'confirm', 'reject'].includes(action)) {
      if (action === 'reject' && !String(payload.reason || '').trim()) throw error('请填写拒绝当前方案的原因。', 'VALIDATION');
      if (action !== 'cancel' && (!Number.isInteger(payload.revision) || payload.revision < 1 || (action === 'confirm' && !payload.commercialHash))) throw error('当前方案版本不完整，请刷新后重新阅读。', 'VALIDATION');
      return call('POST', '/customer/applications/' + value + '/' + action, action === 'confirm' ? { revision: payload.revision, commercialHash: payload.commercialHash } : action === 'reject' ? { revision: payload.revision, reason: payload.reason.trim() } : { reason: payload.reason });
    }
    if (type === 'bills' && action === 'pay') return pay(id, payload);
    if (type === 'contracts' && action === 'sign') return startSign('contract', id);
    if (type === 'handovers' && action === 'sign') return startSign('handover', id);
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
  return { getContext, refreshContext, loginWechat, requestSms, loginSms, logout, getHome, getVehicles, getVehicle,
    getModelDefinitions: async () => list(await call('GET', '/public/model-definitions', undefined, false)).items,
    getDashboard: async () => { const result = await call('GET', '/customer/dashboard'); return { ...result, ...(result.application ? { application: application(result.application) } : {}), ...(result.subscription ? { subscription: { ...result.subscription, imageUrl: media(result.subscription.imageUrl) } } : {}) }; },
    getApplication: async id => application(await call('GET', '/customer/applications/' + identifier(id))),
    amendApplication: (id, payload) => call('POST', '/customer/applications/' + identifier(id) + '/amend', { profile: { name: payload.profile.name, drivingYears: payload.profile.drivingYears, fileIds: fileIds({ fileIds: payload.profile.fileIds || [] }) }, note: payload.note || '', idempotencyKey: payload.idempotencyKey || idempotencyKey('amend') }),
    getLoginDocuments: () => Promise.all(['terms','privacy'].map(type => call('GET', '/public/legal/' + type, undefined, false))),
    acceptConsents: consents => call('POST', '/customer/consents', { consents: consentSnapshot(consents) }),
    getESignReadiness: () => call('GET', '/customer/esign/readiness'),
    refreshESignReadiness: () => call('POST', '/customer/esign/refresh', {}),
    registerESign: () => call('POST', '/customer/esign/register', {}),
    startESignVerification: async input => { await call('POST', '/customer/esign/register', {}); const result = await call('POST', '/customer/esign/verify', input); validateSignUrl(result.url); const id = session().customer.id; platform.setStorageSync(pendingKey, { kind: 'identity', id, task: { taskId: 'identity', url: result.url, status: 'PENDING' } }); await native('navigateTo', { url: '/pages/sign/index?kind=identity&id=' + identifier(id) }); return result; },
    getLegal: type => call('GET', '/public/legal/' + identifier(type), undefined, false),
    getRecords, getRecord, performAction, saveProfile, submitApplication, uploadFile, submitService, submitMileage, submitHandover,
    getHandover: id => call('GET', '/customer/handovers/' + identifier(id)), getSignStatus, getSigningTask, validateSignUrl, resumePayment, idempotencyKey, openPrivateFile,
    clearSigningCache: () => platform.removeStorageSync(pendingKey),
    openSigningMiniProgram: task => native('navigateToMiniProgram', task.miniProgram),
    readFile: id => call('GET', '/customer/files/' + identifier(id)),
  };
}
module.exports = { createApi, validateBase };
