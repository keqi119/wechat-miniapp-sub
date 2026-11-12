const { storageKey } = require('../config');
function loadSession() {
  const session = typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function' ? wx.getStorageSync(storageKey) : null;
  return { token: session?.token || null, customerId: session?.customer?.id || null };
}
function sameLoadSession(a, b) { return !!a && a.token === b.token && a.customerId === b.customerId; }
function clearPrivateData(page) {
  const cleared = {};
  for (const key of ['entry','capability','record','order','archive','application','subscription','handover','change','profile','creditReview','insurance','entitlement','reviewStatus','qualification','bill','usage','swap','settlement','purchase','swapPurchase','submitted','selectedProduct','selectedPeriod','selectedSegment','contract','nextAction']) if (Object.prototype.hasOwnProperty.call(page.data,key)) cleared[key] = null;
  for (const key of ['items','entitlements','services','todos','bills','attachments','summaryRows','readFileIds']) if (Object.prototype.hasOwnProperty.call(page.data,key)) cleared[key] = [];
  for (const key of ['name','mobile','drivingYears','note','reviewNote','feedback','feedbackNote','rejectReason','swapReason','disputeReason','reading','comment','recordedDate','recordedTime','periodId','segmentId','boundaryDate','selectedProductId','message','actionMessage','actionError','creditMessage','creditError','usageMessage','usageError','swapMessage','swapError','swapPurchaseMessage','swapPurchaseError','purchaseError','settlementError','changeError','changeRejectReason']) if (Object.prototype.hasOwnProperty.call(page.data,key)) cleared[key] = '';
  for (const key of ['consented','accepted','planRead','ownerSharingAccepted','creditAccepted','purchaseAccepted','swapPurchaseAccepted','evidenceRead','evidenceOpen','showOrderTerms','showPlanDetails','showCreditDetails','showLessorDetails','showRejectForm','documentRead','dataAccepted','consentUpdateRequired']) if (Object.prototype.hasOwnProperty.call(page.data,key)) cleared[key] = false;
  if (Object.prototype.hasOwnProperty.call(page.data,'context')) cleared.context = {};
  return cleared;
}
async function load(page, loader, options = {}) {
  if (page._disposed || page.disposed) return null;
  const revision = (page._loadRevision || 0) + 1;
  page._loadRevision = revision;
  const session = loadSession(), changed = page._loadStartedSession && !sameLoadSession(page._loadStartedSession, session);
  const current = () => !page._disposed && !page.disposed && page._loadRevision === revision;
  const retained = !changed && !page.data.error && sameLoadSession(page._loadedSession, session);
  page._loadStartedSession = session;
  // A refresh may borrow an idle business guard; it must never release an operation's guard.
  const lease = Object.prototype.hasOwnProperty.call(page.data,'busy') && (!page.data.busy || page._loadBusyLease) ? {} : null;
  if (lease) page._loadBusyLease = lease;
  page.setData({ ...(changed ? clearPrivateData(page) : {}), loading: !retained, error: '', authRequired: false, ...(lease ? { busy: true } : {}) });
  const invalidateSession = () => {
    const anonymous = !loadSession().token;
    page._loadedSession = null;
    page.setData({ ...clearPrivateData(page), loading: false, authRequired: anonymous, error: anonymous ? '登录已失效，请重新登录。' : '登录账户已变化，请重新加载。' });
  };
  try {
    const result = await loader();
    if (!current()) return null;
    // Optional page branches may catch a 401; the final session check still removes their old data.
    if (!sameLoadSession(session, loadSession())) { invalidateSession(); return null; }
    page._loadedSession = session;
    page.setData(Object.assign({}, result || {}, { loading: false, error: '' }));
    if (options.onLoaded) options.onLoaded(result);
    return result;
  } catch (error) {
    if (current()) {
      if (!sameLoadSession(session, loadSession())) { invalidateSession(); return null; }
      const authRequired=['AUTH_REQUIRED', 'SESSION_EXPIRED', 'UNAUTHORIZED'].includes(error.code)||error.statusCode===401;
      const cleared = authRequired || error.code === 'SESSION_CHANGED' ? clearPrivateData(page) : {};
      for (const key of options.clearOnError || []) cleared[key] = null;
      page._loadedSession = null;
      page.setData({ ...cleared, loading: false, error: error.message || '暂时无法加载，请重试。', authRequired });
    }
    return null;
  } finally {
    if (!page._disposed && !page.disposed && lease && page._loadBusyLease === lease) { page._loadBusyLease = null; page.setData({ busy: false }); }
  }
}
function go(url) {
  if (typeof url !== 'string' || !url.startsWith('/pages/')) return;
  const tabs = [
    '/pages/home/index',
    '/pages/catalog/index',
    '/pages/use/index',
    '/pages/mine/index',
  ];
  const path = url.split('?')[0];
  const method = tabs.includes(path) ? 'switchTab' : 'navigateTo';
  wx[method]({
    url: method === 'switchTab' ? path : url,
    fail() {
      wx.showToast({ title: '页面暂时无法打开', icon: 'none' });
    },
  });
}
function toastError(error) {
  wx.showToast({
    title: typeof error === 'string' ? error : error.message || '操作失败，请重试',
    icon: 'none',
    duration: 2600,
  });
}
function confirm(title, content) {
  return new Promise((resolve) =>
    wx.showModal({
      title,
      content,
      confirmColor: '#252723',
      success: (result) => resolve(Boolean(result.confirm)),
      fail: () => resolve(false),
    }),
  );
}
module.exports = { load, go, toastError, confirm, loadSession, sameLoadSession };
