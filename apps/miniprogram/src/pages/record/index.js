const services = require('../../services/index');
const { load, go, toastError, confirm } = require('../../utils/page');
const TYPES = [
  'orders',
  'contracts',
  'bills',
  'payments',
  'deposits',
  'entitlements',
  'notifications',
  'services',
  'mileages',
];
Page({
  data: { type: '', id: '', loading: true, error: '', record: null, busy: false, message: '' },
  onLoad(options) {
    this.setData({ type: options.type || '', id: options.id || '' });
    this.reload();
  },
  reload() {
    return load(this, async () => {
      if (!TYPES.includes(this.data.type) || !this.data.id)
        throw new Error('记录地址不完整，请从记录列表重新进入。');
      return { record: await services.getRecord(this.data.type, this.data.id) };
    });
  },
  onShow() { if (this.data.id) this.reload(); },
  async openDocument(e) {
    try { await services.openPrivateFile(e.currentTarget.dataset.id); } catch (error) { toastError(error); }
  },
  async act(e) {
    if (this.data.busy) return;
    const action = (this.data.record.actions || []).find(
      (item) => item.id === e.currentTarget.dataset.action,
    );
    if (!action) return;
    this.setData({ busy: true, message: '' });
    try {
      const accepted = await confirm(
        action.label,
        action.id === 'pay' ? '即将发起微信支付，金额以当前账单为准。' : action.id === 'sign' ? '即将进入电子签署，请核对正式文档。' : '将提交当前操作，请确认。',
      );
      if (!accepted) return;
      const result = await services.performAction(this.data.type, this.data.id, action.id, {});
      this.setData({
        message: result.message || '操作已提交，请刷新查看最新状态。',
        record: result.record || this.data.record,
      });
      await this.reload();
    } catch (error) {
      toastError(error);
    } finally {
      this.setData({ busy: false });
    }
  },
  openList() {
    go('/pages/records/index?type=' + (TYPES.includes(this.data.type) ? this.data.type : 'orders'));
  },
  openOrderUsage() { if (this.data.type === 'orders' && this.data.record) go('/pages/records/index?type=entitlements&orderId=' + encodeURIComponent(this.data.record.id)); },
});
