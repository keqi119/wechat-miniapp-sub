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
  'orderchanges',
];
Page({
  data: { type: '', id: '', loading: true, error: '', record: null, busy: false, message: '', change: null, changeRead: false, changeError: '', changeRejectReason: '' },
  onLoad(options) {
    this.setData({ type: options.type || '', id: options.id || '' });
    this.reload();
  },
  reload() {
    this.setData({ changeRead: false, change: null });
    return load(this, async () => {
      if (!TYPES.includes(this.data.type) || !this.data.id)
        throw new Error('记录地址不完整，请从记录列表重新进入。');
      const record = await services.getRecord(this.data.type, this.data.id);
      return this.data.type === 'orderchanges' ? { record, change: record } : { record };
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
        action.id === 'pay' ? '即将发起微信支付，金额以当前账单为准。' : action.id === 'sign' ? '将查看签约指引。请主动复制签约入口，在微信中用相同手机号登录并核对文档；返回后查询真实结果。' : '将提交当前操作，请确认。',
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
  openOrderChanges() { go('/pages/records/index?type=orderchanges'); },
  onChangeRead(e) { if (!this.data.busy) this.setData({ changeRead: e.detail.value.includes('change'), changeError: '' }); },
  inputChangeRejectReason(e) { if (!this.data.busy) this.setData({ changeRejectReason: e.detail.value }); },
  confirmChange() { return this.changeAction('confirm'); },
  rejectChange() { return this.changeAction('reject'); },
  signChange() { return this.changeAction('sign'); },
  syncChange() { return this.changeAction('sync'); },
  async changeAction(action) {
    if (this.data.busy || !this.data.change) return;
    const current = this.data.change;
    if (action === 'confirm' && !this.data.changeRead) { this.setData({ changeError: '请完整阅读日期、逐期款项安排及正式补充条款，再勾选确认。' }); return; }
    if (action === 'reject' && !this.data.changeRejectReason.trim()) { this.setData({ changeError: '请填写拒绝当前延期方案的原因。' }); return; }
    this.setData({ busy: true, changeError: '', message: '' });
    try {
      if (action !== 'sync' && !(await confirm(action === 'confirm' ? '确认本版本延期方案？' : action === 'reject' ? '拒绝本版本延期方案？' : '查看补充协议签约指引？', action === 'confirm' ? '请核对新起止日期、原款沿用、补收及退款安排。确认后仍需正式签署与资金核对，不代表已经交车或方案已生效。' : action === 'reject' ? '此意见将提交运营处理，不会自动退订或退款。' : '请主动复制签约入口，用相同手机号登录后核对正式文档。签署后手动返回小程序查询。'))) return;
      const method = { confirm: 'confirmOrderChange', reject: 'rejectOrderChange', sign: 'signOrderChange', sync: 'syncOrderChange' }[action];
      await services[method](current.id, { revision: current.revision, commercialHash: current.quote?.commercialHash, read: this.data.changeRead, reason: this.data.changeRejectReason.trim() });
      await this.reload();
      this.setData({ changeRejectReason: '', message: action === 'confirm' ? '当前版本确认意见已提交，后续签署、资金及生效状态请查看服务端进度。' : action === 'reject' ? '拒绝意见已提交人工处理。' : action === 'sign' ? '签约指引已打开，请按指引操作后返回查询。' : '已读取服务端最新进度；仅显示当前真实签署、资金和生效状态。' });
    } catch (error) { await this.reload(); this.setData({ changeError: error.message, changeRead: false, message: '' }); toastError(error); }
    finally { this.setData({ busy: false }); }
  },
  openChangeBill(e) { if (e.currentTarget.dataset.id) go('/pages/record/index?type=bills&id=' + encodeURIComponent(e.currentTarget.dataset.id)); },
});
