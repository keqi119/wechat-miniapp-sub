const services = require('../../services/index');
const { load, go } = require('../../utils/page');
const { navigation } = require('../../utils/tab-navigation');
Page({
  openLogin() { go('/pages/profile/index'); },
  data: {
    loading: true,
    error: '',
    authenticated: false,
    profile: {},
    application: null,
    links: [
      { type: 'orders', title: '我的订阅与订单' },
      { type: 'orderchanges', title: '订阅变更方案' },
      { type: 'contracts', title: '合同文件' },
      { type: 'bills', title: '账单' },
      { type: 'payments', title: '支付记录' },
      { type: 'deposits', title: '押金流水' },
      { type: 'entitlements', title: '权益明细' },
      { type: 'notifications', title: '消息通知' },
      { type: 'services', title: '服务记录' },
      { type: 'mileages', title: '里程复核' },
    ],
  },
  onShow() {
    navigation.onShow(this, 3);
    return this.reload();
  },
  onHide() { navigation.onHide(this); },
  onUnload() {
    navigation.onHide(this);
    this._disposed = true;
    this._loadRevision = (this._loadRevision || 0) + 1;
  },
  async reload() {
    if (this._disposed) return null;
    const authenticated = services.getContext().authenticated;
    const pending = load(this, async () => {
      if (!authenticated) return { authenticated: false, profile: {}, application: null };
      const context = await services.refreshContext();
      if (!context.authenticated) return { authenticated: false, profile: {}, application: null };
      const dashboard = await services.getDashboard();
      return { authenticated: true, profile: context.profile || {}, application: dashboard.application || null };
    });
    const revision = this._loadRevision;
    this.setData({ authenticated });
    const result = await pending;
    if (!this._disposed && this._loadRevision === revision && !services.getContext().authenticated) {
      this.setData({ authenticated: false, profile: {}, application: null });
    }
    return result;
  },
  open(e) {
    go(e.currentTarget.dataset.url);
  },
  openRecords(e) {
    go('/pages/records/index?type=' + e.currentTarget.dataset.type);
  },
  openApplication() {
    go(
      this.data.application
        ? '/pages/application-detail/index?id=' + encodeURIComponent(this.data.application.id)
        : '/pages/catalog/index',
    );
  },
});
