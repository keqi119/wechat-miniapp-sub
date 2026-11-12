const service = require('../../services/index');
const { load, go, toastError } = require('../../utils/page');

const { createLocationEditor, initialLocationData } = require('../../utils/handover-location');
const { storageKey } = require('../../config');
Page({
  data: { ...initialLocationData(),
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
    profileRequired: false, profileBlockers: [],
  },
  onLoad(options) {
    this.locationEditor=createLocationEditor(this,service,wx,storageKey);
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
      await this.locationEditor.load();
      const context = service.getContext();
      const profile=context.authenticated?await service.getProfile():null;
      const changed = this.data.legal && (this.data.legal.id !== legal.id || this.data.legal.version !== legal.version);
      return { vehicle: result.vehicle, plan, legal, context, profileRequired:profile?.readiness?.readyForApplication!==true,profileBlockers:profile?.readiness?.blockers||[], accepted: changed ? false : this.data.accepted, mobile: profile?.mobile || context.profile?.mobile || '', name: profile?.name || context.profile?.name || '' };
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
  onShow() { this.locationEditor?.sync();if(this._legalReturn){const token=this._legalReturn;this._legalReturn=null;try{service.getLegalPreview(token);return;}catch(_){}} if (this.vehicleId) return this.refresh(); },
  onLocationInput(e) { this.locationEditor.input(e.currentTarget.dataset.field,e.detail.value); },
  onLocationAccepted(e) { this.locationEditor.accept(e.detail.value.includes('location')); },
  toggleLocationNotice() { if(!this.data.locationNoticeOpen)this.locationEditor.toggleNotice();this.openFrozenDocument(this.data.locationNotice); },
  chooseLocation() { return this.locationEditor.choose(); },
  clearLocation() { this.locationEditor.clear(); },
  onHide() { if(!this._keepDraftOnHide)this.locationEditor.hide();this._keepDraftOnHide=false; },
  onUnload() { this._loadRevision=(this._loadRevision||0)+1;this.locationEditor.dispose(); },
  openLogin() { this.openProfile(); },
  openProfile() { this._keepDraftOnHide=true;go('/pages/profile/index?vehicleId='+encodeURIComponent(this.vehicleId||'')+'&planId='+encodeURIComponent(this.planId||'')); },
  openFrozenDocument(document){try{const url=service.previewLegalDocument(document);this._legalReturn=url.split('preview=')[1];this._keepDraftOnHide=true;go(url);}catch(error){toastError(error);}},
  openTerms() {
    this.openFrozenDocument(this.data.legal);
  },
  openCatalog() {
    go('/pages/catalog/index');
  },
  returnVehicle() {
    if (this.vehicleId) go('/pages/vehicle/index?vehicleId=' + encodeURIComponent(this.vehicleId) + (this.planId ? '&planId=' + encodeURIComponent(this.planId) : ''));
    else this.openCatalog();
  },
  async submit() {
    if (this.data.busy || this.data.locationChoosing || this._submitted) return;
    if (!this.locationEditor.sync()) return toastError(new Error('登录账户已变化，请重新核对申请。'));
    const { vehicle, plan, accepted } = this.data;
    const name = this.data.name.trim();
    const mobile = this.data.mobile.trim();
    let formError = '';
    if (!service.getContext().authenticated)
      formError = '请先在个人资料中登录，再提交申请。';
    else if (!vehicle || !vehicle.available || !plan || !plan.available)
      formError = '车辆或套餐当前不可申请，请重新选择。';
    else if (name.length < 2 || name.length > 40) formError = '请填写 2–40 个字符的称呼。';
    else if (!/^1[3-9]\d{9}$/.test(mobile)) formError = '请填写正确的 11 位认证手机号。';
    else if (!accepted) formError = '请先阅读并同意申请说明。';
    if (formError) {
      this.setData({ formError });
      return;
    }
    this.setData({ busy: true, formError: '' });
    try {
      const profile=await service.getProfile();
      if(profile?.readiness?.readyForApplication!==true){this.setData({profileRequired:true,profileBlockers:profile?.readiness?.blockers||[],formError:'请先完善个人资料，再返回继续申请。'});return;}
      this.setData({profileRequired:false,profileBlockers:[]});
      const application = await service.submitApplication({
        vehicleId: vehicle.id,
        planId: plan.id,
        profile: {name,mobile,...(this.locationEditor.payload() !== undefined ? {handoverLocation:this.locationEditor.payload()} : {})},
        accepted,
        consents: this.data.legal ? [{ documentId: this.data.legal.id, version: this.data.legal.version }] : [],
        idempotencyKey: this._submitKey || (this._submitKey = service.idempotencyKey('application')),
      });
      this._submitted = true;
      this.setData({ submittedId: application.id });
      go('/pages/application-detail/index?id=' + encodeURIComponent(application.id));
    } catch (error) {
      this.setData({ formError: error.message || '提交失败，请稍后重试。',...(/PROFILE|IDENTITY|REALNAME/.test(error.code||'')?{profileRequired:true}:{}) });
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
