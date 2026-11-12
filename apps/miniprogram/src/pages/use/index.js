const services = require('../../services/index');
const { load, go } = require('../../utils/page');
const { navigation } = require('../../utils/tab-navigation');
const nextSteps = {
  AWAITING_CONTRACT_REVIEW: '请按工作人员安排完成线下签署，平台审核归档后继续付款与交车。',
  AWAITING_SIGNATURE: '最终方案已确认，下一步办理合同签署。请联系运营核对合同准备与签署进度。',
  AWAITING_PAYMENT: '请查看本单账单，核对金额后按账单要求完成支付。',
  AWAITING_HANDOVER: '请按双方确认的时间与地点办理车辆交接，核对本单交接记录。',
  SETTLING: '车辆已交还，请查看本单费用与押金结算进度。',
};
Page({
  openLogin() { require('../../utils/page').go('/pages/settings/index'); },
  data: {
    loading: true,
    error: '',
    subscription: null,
    application: null,
    bill: null,
    entitlements: [],
    services: [],
    todos: [],
    nextStep: '',
    showDrivingServices: false,
  },
  onShow() {
    navigation.onShow(this, 2);
    this.reload();
  },
  onHide() { navigation.onHide(this); },
  onUnload() { navigation.onHide(this); },
  reload() {
    return load(this, async () => {
      const result = await services.getDashboard();
      return Object.assign(
        {
          subscription: null,
          application: null,
          bill: null,
          entitlements: [],
          services: [],
          todos: [],
        },
        result,
        { nextStep: nextSteps[result.subscription?.status] || '', showDrivingServices: result.subscription?.status === 'ACTIVE' },
      );
    });
  },
  open(e) {
    go(e.currentTarget.dataset.url);
  },
  openApplication() {
    if (this.data.application)
      go('/pages/application-detail/index?id=' + encodeURIComponent(this.data.application.id));
  },
  openBill() {
    if (this.data.bill)
      go('/pages/record/index?type=bills&id=' + encodeURIComponent(this.data.bill.id));
  },
  openSubscription() {
    const id = this.data.subscription?.orderId || this.data.subscription?.id;
    if (id) go((this.data.subscription.contractMode === 'OFFLINE' ? '/pages/order-detail/index?id=' : '/pages/record/index?type=orders&id=') + encodeURIComponent(id));
  },
  openDeliveryDelay() { const id = this.data.subscription?.deliveryDelayChangeId; if (id) go('/pages/record/index?type=orderchanges&id=' + encodeURIComponent(id)); },
  openVehicleChange() { const id = this.data.subscription?.activeChangeId; if (id) go('/pages/record/index?type=orderchanges&id=' + encodeURIComponent(id)); else this.openSwapAccount(); },
  openAddon(event) { const id=this.data.subscription?.orderId||this.data.subscription?.id; const kind=event.currentTarget.dataset.kind; if(id && ['MILEAGE_PACK','SWAP_CREDIT'].includes(kind))go('/pages/records/index?type=addons&orderId='+encodeURIComponent(id)+'&kind='+kind); },
  openSwapAccount() { const id = this.data.subscription?.orderId || this.data.subscription?.id; if (id) go('/pages/records/index?type=entitlements&orderId=' + encodeURIComponent(id)); },
});
