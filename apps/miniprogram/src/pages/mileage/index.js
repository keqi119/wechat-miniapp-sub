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
  },
  onLoad() {
    this.reload();
  },
  reload() {
    return load(this, async () => ({
      subscription: (await services.getDashboard()).subscription || null,
    }));
  },
  input(e) {
    const key = e.currentTarget.dataset.field;
    if (['reading', 'comment'].includes(key)) this.setData({ [key]: e.detail.value });
  },
  async chooseAttachments() {
    if (this.data.busy || this.data.choosing) return;
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
      if (!/cancel/i.test(error.errMsg || error.message || '')) toastError(error);
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
    if (!this.data.subscription) return toastError(new Error('当前没有可复核里程的订阅'));
    const reading = Number(this.data.reading);
    if (
      String(this.data.reading).trim() === '' ||
      !Number.isInteger(reading) ||
      reading < 0 ||
      reading > 9999999
    )
      return toastError(new Error('请输入有效的整数公里读数'));
    if (!this.data.attachments.length) return toastError(new Error('请添加至少一张已上传里程凭证'));
    this.setData({ busy: true });
    try {
      const submitted = await services.submitMileage({
        reading,
        comment: this.data.comment.trim(),
        attachments: this.data.attachments,
        orderId: this.data.subscription.orderId || this.data.subscription.id,
        idempotencyKey: this._submitKey || (this._submitKey = services.idempotencyKey('mileage')),
      });
      this.setData({ submitted });
    } catch (error) {
      toastError(error);
    } finally {
      this.setData({ busy: false });
    }
  },
  openRecord() {
    if (this.data.submitted)
      go('/pages/record/index?type=mileages&id=' + encodeURIComponent(this.data.submitted.id));
  },
  openUse() {
    go('/pages/use/index');
  },
});
