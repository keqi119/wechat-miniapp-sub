const services = require('../../services/index');
const { load, go } = require('../../utils/page');
Page({
  openLogin() { require('../../utils/page').go('/pages/settings/index'); },
  data: {
    loading: true,
    error: '',
    profile: {},
    application: null,
    links: [
      { type: 'orders', title: '我的订阅与订单' },
      { type: 'orderchanges', title: '延期交车方案' },
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
    this.reload();
  },
  reload() {
    return load(this, async () => {
      const context = await services.refreshContext();
      const dashboard = await services.getDashboard();
      return { profile: context.profile || {}, application: dashboard.application || null };
    });
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
