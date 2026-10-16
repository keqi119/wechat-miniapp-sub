const services = require('../../services/index');
const { load, toastError } = require('../../utils/page');
Page({
  data: { loading: true, error: '', url: '', task: null, status: '', message: '' },
  onLoad(options) { this.id = options.id; this.kind = ['handover', 'identity'].includes(options.kind) ? options.kind : 'contract'; this.reload(); },
  onShow() { if (this.id) this.refreshStatus(); },
  reload() { return load(this, async () => { const task = services.getSigningTask(this.kind, this.id); return { task, url: task.url || '', status: task.status || 'PENDING' }; }); },
  async refreshStatus() {
    try { const status = await services.getSignStatus(this.id, this.kind); this.setData({ status: status.status, message: ['SIGNED','VERIFIED'].includes(status.status) ? '服务端已确认本次操作完成。' : '签署结果确认中，可稍后重新查询。', ...(['SIGNED','VERIFIED'].includes(status.status) ? { url: '' } : {}) }); }
    catch (error) { this.setData({ message: error.message }); }
  },
  async openMiniProgram() { try { await services.openSigningMiniProgram(this.data.task); } catch (error) { toastError(error); } },
  onWebLoad() { this.setData({ message: '请在签署页面完成操作后返回查询。' }); },
  onWebError() { this.setData({ url: '', error: '签署页面无法打开，请检查微信业务域名或稍后重试。' }); },
  onWebMessage() { this.refreshStatus(); },
  back() { wx.navigateBack({ delta: 1 }); },
});
