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
};
Page({
  data: { type: '', title: '记录', loading: true, error: '', items: [], usage: null, usageError: '', settlement: null, settlementError: '', selectedProductId: '', selectedProduct: null, purchaseAccepted: false, purchase: null, busy: false, purchaseError: '', usageMessage: '', disputeReason: '' },
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
    this.setData({ purchaseAccepted: false, selectedProductId: '', selectedProduct: null, usage: null, settlement: null, usageError: '', settlementError: '' });
    return load(this, async () => {
      if (!TITLES[this.data.type]) throw new Error('无法识别记录类型，请从“我的”重新进入。');
      const items = await services.getRecords(this.data.type);
      if (this.data.type !== 'entitlements') return { items };
      try {
        const current = this.orderId ? null : (await services.getDashboard()).subscription;
        const id = this.orderId || current?.orderId || current?.id;
        if (!id) return { items, usage: null };
        const usage = await services.getUsageAccount(id);
        let settlement = null, settlementError = '';
        if (usage.returnSettlement) { try { settlement = await services.getReturnSettlement(usage.returnSettlement.id, id); } catch (error) { settlementError = error.message; } }
        return { items, usage, settlement, settlementError };
      } catch (error) { return { items, usage: null, usageError: error.message }; }
    });
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
