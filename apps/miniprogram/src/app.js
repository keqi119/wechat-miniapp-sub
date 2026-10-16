const services = require('./services/index');
App({
  onLaunch() {
    this.globalData = { frontendVersion: '0.1.0' };
  },
  async onShow() {
    if (!services.getContext().authenticated) return;
    try { await services.resumePayment(); }
    catch (error) { this.globalData.paymentRecoveryError = error.code || 'PAYMENT_QUERY_FAILED'; }
  },
});
