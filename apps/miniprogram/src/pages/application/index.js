const service = require('../../services/index');
const { load, go, toastError } = require('../../utils/page');

Page({
  data: {
    loading: true,
    error: '',
    busy: false,
    vehicle: null,
    plan: null,
    name: '',
    mobile: '',
    accepted: false,
    formError: '',
    context: {},
  },
  onLoad(options) {
    this.vehicleId = options.vehicleId;
    this.planId = options.planId;
    const context = service.getContext();
    const profile = context.profile || {};
    this.setData({ context, name: profile.name || '', mobile: profile.mobile || '' });
    this.refresh();
  },
  refresh() {
    return load(this, async () => {
      if (!this.vehicleId || !this.planId) throw new Error('缺少车辆或套餐信息，请重新选择方案。');
      const result = await service.getVehicle(this.vehicleId);
      const plan = (result.plans || []).find((item) => item.id === this.planId) || null;
      const legal = await service.getLegal('application');
      const context = service.getContext();
      const changed = this.data.legal && (this.data.legal.id !== legal.id || this.data.legal.version !== legal.version);
      return { vehicle: result.vehicle, plan, legal, context, accepted: changed ? false : this.data.accepted, mobile: context.profile?.mobile || '', name: this.data.name || context.profile?.name || '' };
    });
  },
  onName(event) {
    this.setData({ name: event.detail.value, formError: '' });
  },
  onMobile(event) {
    this.setData({ mobile: event.detail.value, formError: '' });
  },
  onAccepted(event) {
    this.setData({ accepted: event.detail.value.includes('accepted'), formError: '' });
  },
  onShow() { if (this.vehicleId) this.refresh(); },
  openLogin() { go('/pages/settings/index'); },
  openTerms() {
    go('/pages/legal/index?type=application');
  },
  openCatalog() {
    go('/pages/catalog/index');
  },
  returnVehicle() {
    if (this.vehicleId) go('/pages/vehicle/index?vehicleId=' + encodeURIComponent(this.vehicleId));
    else this.openCatalog();
  },
  async submit() {
    if (this.data.busy || this._submitted) return;
    const { vehicle, plan, accepted } = this.data;
    const name = this.data.name.trim();
    const mobile = this.data.mobile.trim();
    let formError = '';
    if (!service.getContext().authenticated)
      formError = '请先在账户设置中登录，再提交申请。';
    else if (!vehicle || !vehicle.available || !plan || !plan.available)
      formError = '车辆或套餐当前不可申请，请重新选择。';
    else if (name.length < 2 || name.length > 30) formError = '请填写 2–30 个字符的称呼。';
    else if (!/^1[3-9]\d{9}$/.test(mobile)) formError = '请填写正确的 11 位认证手机号。';
    else if (!accepted) formError = '请先阅读并同意申请说明。';
    if (formError) {
      this.setData({ formError });
      return;
    }
    this.setData({ busy: true, formError: '' });
    try {
      const application = await service.submitApplication({
        vehicleId: vehicle.id,
        planId: plan.id,
        name,
        mobile,
        accepted,
        consents: this.data.legal ? [{ documentId: this.data.legal.id, version: this.data.legal.version }] : [],
        idempotencyKey: this._submitKey || (this._submitKey = service.idempotencyKey('application')),
      });
      this._submitted = true;
      this.setData({ submittedId: application.id });
      go('/pages/application-detail/index?id=' + encodeURIComponent(application.id));
    } catch (error) {
      this.setData({ formError: error.message || '提交失败，请稍后重试。' });
      toastError(error);
    } finally {
      this.setData({ busy: false });
    }
  },
  openSubmitted() {
    if (this.data.submittedId)
      go('/pages/application-detail/index?id=' + encodeURIComponent(this.data.submittedId));
  },
});
