const services = require('../../services/index');
const { load, go, toastError, confirm } = require('../../utils/page');
const config = require('../../config');
const TITLES = {
  orders: '订阅与订单',
  contracts: '合同文件',
  bills: '账单',
  payments: '支付记录',
  deposits: '押金流水',
  entitlements: '权益明细',
  notifications: '消息通知',
  services: '服务记录',
  mileages: '里程复核',
  orderchanges: '订阅变更方案',
};
Page({
  data: { type: '', title: '记录', loading: true, error: '', items: [], usage: null, usageError: '', swap: null, swapError: '', swapReason: '', swapMessage: '', swapPurchaseAccepted: false, swapPurchase: null, swapPurchaseError: '', swapPurchaseMessage: '', settlement: null, settlementError: '', selectedProductId: '', selectedProduct: null, purchaseAccepted: false, purchase: null, busy: false, purchaseError: '', usageMessage: '', disputeReason: '' },
  onLoad(options) {
    const type = options.type || 'orders';
    this.orderId = options.orderId || '';
    this.setData({ type, title: TITLES[type] || '记录' });
    wx.setNavigationBarTitle({ title: this.data.title });
  },
  onShow() {
    this.reload();
  },
  reload() {
    this.setData({ purchaseAccepted: false, swapPurchaseAccepted: false, swapPurchase: null, selectedProductId: '', selectedProduct: null, usage: null, swap: null, swapError: '', settlement: null, usageError: '', settlementError: '' });
    return load(this, async () => {
      if (!TITLES[this.data.type]) throw new Error('无法识别记录类型，请从“我的”重新进入。');
      const items = await services.getRecords(this.data.type);
      if (this.data.type !== 'entitlements') return { items };
      try {
        const current = this.orderId ? null : (await services.getDashboard()).subscription;
        const id = this.orderId || current?.orderId || current?.id;
        if (!id) return { items, usage: null };
        this.resolvedOrderId = id;
        const [usageResult, swapResult] = await Promise.allSettled([services.getUsageAccount(id), services.getSwapAccount(id)]);
        const usage = usageResult.status === 'fulfilled' ? usageResult.value : null;
        const swap = swapResult.status === 'fulfilled' ? swapResult.value : null;
        let settlement = null, settlementError = '';
        if (usage?.returnSettlement) { try { settlement = await services.getReturnSettlement(usage.returnSettlement.id, id); } catch (error) { settlementError = error.message; } }
        return { items, usage, swap, usageError: usageResult.status === 'rejected' ? usageResult.reason.message : '', swapError: swapResult.status === 'rejected' ? swapResult.reason.message : '', settlement, settlementError };
      } catch (error) { return { items, usage: null, usageError: error.message }; }
    });
  },
  inputSwapReason(event) { if (!this.data.busy) this.setData({ swapReason: event.detail.value, swapError: '' }); },
  async requestSwap() {
    if (this.data.busy || !this.data.swap?.canRequest) return;
    if (!this.data.swapReason.trim()) { this.setData({ swapError: '请填写真实换车原因，运营将据此联系并出具逐单报价。' }); return; }
    this.setData({ busy: true, swapError: '', swapMessage: '' });
    try {
      if (!(await confirm('提交换车申请？', '这里只提交申请，不扣次数、不付款。后续需完整报价确认、补充协议签署、资金核对及两侧真实交接；原订阅期限和里程月不重置。'))) return;
      const result = await services.requestVehicleChange(this.data.swap.orderId, { reason: this.data.swapReason.trim() });
      this.setData({ swapReason: '', swapMessage: result.message });
      await this.reload(); go('/pages/record/index?type=orderchanges&id=' + encodeURIComponent(result.id));
    } catch (error) { await this.reload(); this.setData({ swapError: error.message + ' 请查询已有变更记录，不要反复申请。', swapMessage: '' }); }
    finally { this.setData({ busy: false }); }
  },
  openSwapChange(event) { const id = event.currentTarget.dataset.id; if (id) go('/pages/record/index?type=orderchanges&id=' + encodeURIComponent(id)); },
  openAllChanges() { go('/pages/records/index?type=orderchanges'); },
  onSwapPurchaseAccepted(event) { if (!this.data.busy) this.setData({ swapPurchaseAccepted: event.detail.value.includes('swap-purchase'), swapPurchaseError: '' }); },
  async buySwapCredit() {
    if (this.data.busy) return;
    const account = this.data.swap, terms = account?.purchaseTerms;
    if (!account?.canPurchase || !terms || !this.data.swapPurchaseAccepted) { this.setData({ swapPurchaseError: '请核对本订单及800元一次规格，并单独勾选当前完整购买说明。' }); return; }
    const owner = services.getContext().customer?.id, orderId = account.orderId;
    this.setData({ busy: true, swapPurchaseError: '', swapPurchaseMessage: '' });
    try {
      if (!(await confirm('创建800元换车次数账单？', '本订单一次换车权益，固定800元；仅本订阅期有效，退订或到期未使用也失效且费用不退，例外依法处理。只创建普通账单，不会自动付款或发放次数。'))) return;
      if (services.getContext().customer?.id !== owner) throw new Error('登录账户已变化，请重新进入本人订单。');
      const result = await services.createSwapCredit(orderId, { productId: account.product.id, termsVersion: terms.version, termsDocumentId: terms.documentId, termsDocumentVersion: terms.documentVersion, termsHash: terms.hash, accepted: true });
      await this.reload();
      if (services.getContext().customer?.id !== owner || this.resolvedOrderId !== orderId) return;
      this._swapPurchaseCustomerId = owner; this.setData({ swapPurchase: result, swapPurchaseAccepted: false, swapPurchaseMessage: result.purchase.status === 'PENDING_PAYMENT' ? '本次普通账单已创建，尚未发放次数。请另行核对账单后主动付款，返回查询可信到账状态。' : '已回读原购买记录：' + result.purchase.statusText + '。请核对当前次数与原账单，本次未再次发起付款。' });
    } catch (error) { await this.reload(); this.setData({ swapPurchaseError: error.message + ' 请查询已有购买与原账单，不要重复付款。', swapPurchaseAccepted: false }); }
    finally { this.setData({ busy: false }); }
  },
  swapPurchaseRow(id) { return this.data.swap?.purchases.find(row => row.id === id) || (this._swapPurchaseCustomerId === services.getContext().customer?.id && this.data.swapPurchase?.purchase.id === id ? this.data.swapPurchase.purchase : null); },
  openSwapPurchaseBill(event) { const id = event.currentTarget.dataset.id; if (this.data.swap?.purchases.some(row => row.billId === id) || (this._swapPurchaseCustomerId === services.getContext().customer?.id && this.data.swapPurchase?.bill.id === id)) go('/pages/record/index?type=bills&id=' + encodeURIComponent(id)); },
  async querySwapPurchase(event) { return this.swapPurchaseAction('query', event); },
  async closeSwapPurchase(event) { return this.swapPurchaseAction('close', event); },
  async swapPurchaseAction(action, event) {
    if (this.data.busy) return; const row = this.swapPurchaseRow(event.currentTarget.dataset.id); if (!row || (action === 'close' && !row.canClose)) return;
    const owner = services.getContext().customer?.id;
    this.setData({ busy: true, swapPurchaseError: '', swapPurchaseMessage: '' });
    try {
      if (action === 'close' && !(await confirm('查询并撤销本次未支付购买？', '如已有渠道任务，将先核对原支付与关单；未知结果不代表已关闭或未扣款，不会创建另一笔付款。'))) return;
      const result = await services[action === 'close' ? 'closeSwapCreditPurchase' : 'querySwapCreditPurchase'](row.orderId, row.id); await this.reload();
      if (services.getContext().customer?.id !== owner || this.resolvedOrderId !== row.orderId) return;
      this._swapPurchaseCustomerId = owner; this.setData({ swapPurchase: { purchase: result, bill: result.bill }, swapPurchaseMessage: action === 'close' && result.status === 'VOID' ? '服务端已核实本次购买撤销；不会发放次数。' : result.statusMessage || result.statusText });
    } catch (error) { await this.reload(); this.setData({ swapPurchaseError: '结果尚未核实：' + error.message + ' 请继续查询原记录或联系人工，不要重复付款。' }); }
    finally { this.setData({ busy: false }); }
  },
  selectMileageProduct(event) {
    if (this.data.busy) return;
    const selectedProduct = this.data.usage?.products.find(row => row.id === event.detail.value) || null;
    this.setData({ selectedProductId: selectedProduct?.id || '', selectedProduct, purchaseAccepted: false, purchaseError: '' });
  },
  onPurchaseAccepted(event) { if (!this.data.busy) this.setData({ purchaseAccepted: event.detail.value.includes('purchase'), purchaseError: '' }); },
  async buyMileagePack() {
    if (this.data.busy) return;
    const usage = this.data.usage, product = this.data.selectedProduct, terms = usage?.purchaseTerms;
    if (!usage?.canPurchase || !product || !terms || !this.data.purchaseAccepted) { this.setData({ purchaseError: '请选择里程包，并单独勾选同意当前完整购买规则。' }); return; }
    this.setData({ busy: true, purchaseError: '', usageMessage: '' });
    try {
      if (!(await confirm('创建里程包账单？', product.km + '公里 · ' + product.amountText + '。仅当前订阅期有效，退订时剩余额度失效且不退未使用费用；点击只创建账单，不会自动付款。'))) return;
      const purchase = await services.createMileagePack(usage.orderId, { productId: product.id, termsVersion: terms.version, termsDocumentId: terms.documentId, termsDocumentVersion: terms.documentVersion, termsHash: terms.hash, accepted: true });
      this.setData({ purchase, purchaseAccepted: false, usageMessage: '里程包账单已创建，尚不代表支付到账或额度发放。请到普通账单详情核对后主动付款，返回刷新可信到账额度。' });
      await this.reload();
    } catch (error) {
      await this.reload(); this.setData({ purchaseError: error.message + ' 请查询账单和额度，不要重复创建。', purchaseAccepted: false }); toastError(error);
    } finally { this.setData({ busy: false }); }
  },
  openPurchaseBill() { if (this.data.purchase?.bill.id) go('/pages/record/index?type=bills&id=' + encodeURIComponent(this.data.purchase.bill.id)); },
  openUsageBill(event) { const id = event.currentTarget.dataset.id; if (id) go('/pages/record/index?type=bills&id=' + encodeURIComponent(id)); },
  openUsagePeriod(event) { if (this.data.usage) go('/pages/mileage/index?orderId=' + encodeURIComponent(this.data.usage.orderId) + '&periodId=' + encodeURIComponent(event.currentTarget.dataset.id)); },
  openPackTerms() { go('/pages/legal/index?type=mileage-pack'); },
  inputDispute(event) { if (!this.data.busy) this.setData({ disputeReason: event.detail.value }); },
  async disputeSettlement() {
    if (this.data.busy || !this.data.settlement?.canDispute || !this.data.usage) return;
    if (!this.data.disputeReason.trim()) { this.setData({ settlementError: '请填写需要人工核对的结算异议。' }); return; }
    const id = this.data.settlement.id, orderId = this.data.usage.orderId;
    this.setData({ busy: true, settlementError: '' });
    try { const settlement = await services.disputeReturnSettlement(id, { orderId, reason: this.data.disputeReason.trim() }); this.setData({ settlement, disputeReason: '', usageMessage: '结算异议已提交人工处理，尚未结清；不会自动扣取押金。' }); }
    catch (error) { await this.reload(); this.setData({ settlementError: error.message }); toastError(error); }
    finally { this.setData({ busy: false }); }
  },
  contactUsageService() { wx.makePhoneCall({ phoneNumber: config.customerServiceTelephone, fail: error => { if (!/cancel/i.test(error?.errMsg || '')) toastError(new Error('客服暂时无法拨通，请稍后重试。')); } }); },
  openRecord(e) {
    go(
      '/pages/record/index?type=' +
        this.data.type +
        '&id=' +
        encodeURIComponent(e.currentTarget.dataset.id),
    );
  },
  openMine() {
    go('/pages/mine/index');
  },
});
