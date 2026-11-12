const service = require('../../services/index');
const { load, go, toastError } = require('../../utils/page');

Page({
  data: {
    loading: true,
    busy: false,
    selectionNotice: '',
    error: '',
    vehicle: null,
    galleryIndex: 0,
    plans: [],
    report: null,
    selectedPlan: null,
    showConditions: false,
    showReport: false,
  },
  onLoad(options) {
    this.vehicleId = options.vehicleId || options.id;
    this.preferredPlanId = options.planId || null;
  },
  onShow() {
    this.refresh();
  },
  refresh() {
    if (this.data.selectedPlan) this.preferredPlanId = this.data.selectedPlan.id;
    return load(this, async () => {
      if (!this.vehicleId) throw new Error('缺少车辆编号，请返回选车页重新选择。');
      const result = await service.getVehicle(this.vehicleId);
      const viewedPhoto = this.data.vehicle && (this.data.vehicle.galleryUrls || [])[this.data.galleryIndex];
      const galleryIndex = Math.max(0, ((result.vehicle && result.vehicle.galleryUrls) || []).indexOf(viewedPhoto));
      const plans = result.plans || [];
      const previousId = (this.data.selectedPlan && this.data.selectedPlan.id) || this.preferredPlanId;
      const selectedPlan = previousId
        ? plans.find((plan) => plan.id === previousId && plan.available) || null
        : plans.find((plan) => plan.available) || null;
      return { ...result, galleryIndex, plans, selectedPlan, selectionNotice: previousId && !selectedPlan ? '原选择的订阅产品暂不可售，请重新选择。' : '' };
    });
  },
  onUnload() { this._loadRevision = (this._loadRevision || 0) + 1; },
  galleryChanged(event) {
    const index = event.detail && event.detail.current;
    const images = (this.data.vehicle && this.data.vehicle.galleryUrls) || [];
    if (Number.isInteger(index) && index >= 0 && index < images.length) this.setData({ galleryIndex: index });
  },
  previewGallery(event) {
    if (this.data.loading || this.data.error) return;
    const images = (this.data.vehicle && this.data.vehicle.galleryUrls) || [];
    const current = event.currentTarget.dataset.src;
    if (!images.includes(current)) return;
    wx.previewImage({ current, urls: images, fail: () => toastError(new Error('车辆图片暂时无法打开，请稍后重试。')) });
  },
  selectPlan(event) {
    if (this.data.loading || this.data.busy || this.data.error) return;
    const selectedPlan = this.data.plans.find(
      (plan) => plan.id === event.currentTarget.dataset.id && plan.available,
    );
    if (selectedPlan) { this.preferredPlanId = selectedPlan.id; this.setData({ selectedPlan, selectionNotice: '' }); }
  },
  toggleConditions() {
    this.setData({ showConditions: !this.data.showConditions });
  },
  toggleReport() {
    this.setData({ showReport: !this.data.showReport });
  },
  previewReport(event) {
    const images = (this.data.report && this.data.report.images) || [];
    const current = event.currentTarget.dataset.src;
    if (!images.includes(current)) return;
    wx.previewImage({
      current,
      urls: images,
      fail: () => toastError(new Error('资料图片暂时无法打开，请稍后重试。')),
    });
  },
  openCatalog() {
    go('/pages/catalog/index');
  },
  apply() {
    if (
      this.data.loading || this.data.busy || !!this.data.error ||
      !this.data.vehicle ||
      !this.data.vehicle.available ||
      !this.data.selectedPlan ||
      !this.data.selectedPlan.available
    )
      return;
    go(
      '/pages/application/index?vehicleId=' +
        encodeURIComponent(this.data.vehicle.id) +
        '&planId=' +
        encodeURIComponent(this.data.selectedPlan.id),
    );
  },
});
