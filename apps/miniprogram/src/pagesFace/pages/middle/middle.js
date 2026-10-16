const services = require('../../../services/index');
Page({
  data: { ready: false, busy: false, error: '', message: '' },
  onLoad(options = {}) { try { this.bridge = services.prepareFaceBridge(options); this.setData({ ready: true }); } catch (error) { this.setData({ ready: false, error: '刷脸跳转尚未配置完成，请返回当前实名或签署流程查询，并联系运营。' }); } },
  startFace() { if (!this.data.ready || this.data.busy) return; this.setData({ ready: false, error: '刷脸跳转尚未配置完成，暂不能继续。' }); },
  onShow() {},
  back() { wx.navigateBack({ delta: 1 }); },
});
