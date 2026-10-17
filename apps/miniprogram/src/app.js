const services = require('./services/index');
App({
  onLaunch() {
    this.globalData = { frontendVersion: '0.1.0' };
    services.purgeLegacySigningCache();
  },
  async onShow(options = {}) {
    services.observeSigningAppShow(options);
    if (!services.getContext().authenticated) return;
    try { await services.resumePayment(); }
    catch (error) { this.globalData.paymentRecoveryError = error.code || 'PAYMENT_QUERY_FAILED'; }
    try { await services.resumeSigning(); }
    catch (error) { this.globalData.signingRecoveryError = error.code || 'SIGNING_QUERY_FAILED'; }
  },
});
