const services = require('../../services/index');
const { load, go, toastError } = require('../../utils/page');
Page({
  data: {
    loading: true,
    error: '',
    subscription: null,
    reading: '',
    comment: '',
    attachments: [],
    busy: false,
    choosing: false,
    submitted: null,
    usage: null,
    periodId: '',
    selectedPeriod: null,
    recordedDate: '',
    recordedTime: '',
  },
  onLoad(options = {}) {
    this.orderId = options.orderId || '';
    this.requestedPeriodId = options.periodId || '';
    this.reload();
  },
  onShow() { if (this.data.usage && !this.data.busy && !this.data.choosing) this.reload(); },
  reload() {
    const selectedId = this.data.periodId || this.requestedPeriodId;
    this.setData({ usage: null, selectedPeriod: null, periodId: '' });
    return load(this, async () => {
      const current = (await services.getDashboard()).subscription;
      const id = this.orderId || current?.orderId || current?.id;
      if (!id) return { subscription: null, usage: null };
      const usage = await services.getUsageAccount(id);
      const selectedPeriod = usage.periods.find(row => row.id === selectedId && row.canSubmit) || null;
      return { subscription: current && (current.orderId || current.id) === id ? current : { id, orderId: id, vehicleName: '本订阅的月度里程' }, usage, selectedPeriod, periodId: selectedPeriod?.id || '' };
    });
  },
  selectUsagePeriod(event) {
    if (this.data.busy || this.data.choosing) return;
    const selectedPeriod = this.data.usage?.periods.find(row => row.id === event.detail.value && row.canSubmit);
    if (!selectedPeriod) return;
    this.requestedPeriodId = '';
    this.setData({ periodId: selectedPeriod.id, selectedPeriod, reading: '', recordedDate: '', recordedTime: '', comment: '', attachments: [], submitted: null });
  },
  captureDate(event) { if (!this.data.busy) this.setData({ recordedDate: event.detail.value }); },
  captureTime(event) { if (!this.data.busy) this.setData({ recordedTime: event.detail.value }); },
  input(e) {
    const key = e.currentTarget.dataset.field;
    if (['reading', 'comment'].includes(key)) this.setData({ [key]: e.detail.value });
  },
  async chooseAttachments() {
    if (this.data.busy || this.data.choosing) return;
    if (!this.data.selectedPeriod?.canSubmit) return toastError(new Error('请先选择需要申报或补证的订阅月'));
    if (this.data.attachments.length >= 4) return toastError(new Error('最多添加 4 张凭证'));
    this.setData({ choosing: true });
    try {
      const result = await new Promise((resolve, reject) =>
        wx.chooseMedia({
          count: 4 - this.data.attachments.length,
          mediaType: ['image'],
          sourceType: ['album', 'camera'],
          success: resolve,
          fail: reject,
        }),
      );
      const files = result.tempFiles || [];
      if (files.some((file) => file.size > 10 * 1024 * 1024))
        throw new Error('单张图片请小于 10 MB');
      this.setData({
        attachments: this.data.attachments.concat(
          await Promise.all(files.map(file => services.uploadFile(file, 'mileage'))),
        ),
      });
    } catch (error) {
      if (!/cancel/i.test(error?.errMsg || error?.message || '')) toastError(error || new Error('未完成仪表凭证选择'));
    } finally {
      this.setData({ choosing: false });
    }
  },
  removeAttachment(e) {
    if (!this.data.busy)
      this.setData({
        attachments: this.data.attachments.filter(
          (_, index) => index !== Number(e.currentTarget.dataset.index),
        ),
      });
  },
  async submit() {
    if (this.data.busy || this.data.choosing || this.data.submitted) return;
    if (!this.data.usage || !this.data.selectedPeriod?.canSubmit) return toastError(new Error('请先选择服务端允许申报的订阅月'));
    const reading = Number(this.data.reading);
    if (
      String(this.data.reading).trim() === '' ||
      !Number.isInteger(reading) ||
      reading < 0 ||
      reading > 9999999
    )
      return toastError(new Error('请输入有效的整数公里读数'));
    if (!this.data.attachments.length) return toastError(new Error('请添加至少一张已上传里程凭证'));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(this.data.recordedDate) || !/^\d{2}:\d{2}$/.test(this.data.recordedTime)) return toastError(new Error('请填写仪表照片实际拍摄日期和时间（北京时间）'));
    const captured = new Date(this.data.recordedDate + 'T' + this.data.recordedTime + ':00+08:00');
    if (!Number.isFinite(captured.getTime())) return toastError(new Error('实际拍摄时间无效，请重新选择'));
    this.setData({ busy: true });
    try {
      const submitted = await services.submitUsageReading({
        readingKm: reading,
        recordedAt: captured.toISOString(),
        fileIds: this.data.attachments.map(file => file.id),
        orderId: this.data.usage.orderId,
        periodId: this.data.periodId,
      });
      this.setData({ submitted });
    } catch (error) {
      toastError(error);
      await this.reload();
    } finally {
      this.setData({ busy: false });
    }
  },
  openRecord() {
    if (this.data.submitted)
      go('/pages/record/index?type=mileages&id=' + encodeURIComponent(this.data.submitted.id));
  },
  returnToPeriods() { this.setData({ submitted: null, periodId: '', selectedPeriod: null, attachments: [], reading: '', recordedDate: '', recordedTime: '' }); return this.reload(); },
  openUse() {
    go('/pages/use/index');
  },
  openUsage() { if (this.data.usage) go('/pages/records/index?type=entitlements&orderId=' + encodeURIComponent(this.data.usage.orderId)); },
});
