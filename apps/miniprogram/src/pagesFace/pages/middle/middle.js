const services = require('../../../services/index');
Page({
  data: { ready: false, busy: false, error: '', message: '' },
  onLoad(options = {}) {
    this.disposed = false;
    try {
      const pages = getCurrentPages(); this.parent = pages[pages.length - 2];
      const context = this.parentContext();
      this.bridge = services.prepareFaceBridge(options, context);
      this.setData({ ready: true });
    } catch { this.setData({ ready: false, error: '当前刷脸入口尚未核实或已过期，请返回原实名认证页面重新进入。' }); }
  },
  parentContext() {
    const pages = getCurrentPages(), parent = pages[pages.length - 2];
    if (!parent || parent !== this.parent || parent.route !== 'pages/sign/index' || typeof parent.reloadPage !== 'function') throw new Error('原认证页面已变化');
    return { kind: parent.kind, id: parent.id, url: parent.data.url };
  },
  async startFace() {
    if (!this.data.ready || this.data.busy || this.disposed) return;
    this.jumpRequested = true; this.leftForFace = false; this.setData({ busy: true, error: '' });
    try { await services.startFaceBridge(this.bridge.bridgeId, this.parentContext()); this.resumeFaceReturn(); }
    catch (error) { this.jumpRequested = false; this.leftForFace = false; if (!this.disposed) this.setData({ error: error.message }); }
    finally { if (!this.disposed) this.setData({ busy: false }); }
  },
  onHide() { if (this.jumpRequested) this.leftForFace = true; },
  onShow() { this.resumeFaceReturn(); },
  resumeFaceReturn() {
    if (this.disposed || !this.jumpRequested || !this.leftForFace) return;
    try {
      const result = services.completeFaceBridge(this.bridge.bridgeId, undefined, this.parentContext());
      if (!result) return;
      this.jumpRequested = false; this.leftForFace = false;
      if (!this.parent.reloadPage(result.reloadUrl)) throw new Error('原认证页面无法继续');
      this.setData({ ready: false, message: '正在返回原实名认证页面，认证结果仍需核验。' });
      wx.navigateBack({ delta: 1 });
    } catch { this.jumpRequested = false; this.leftForFace = false; this.setData({ ready: false, error: '本次刷脸返回尚未核实，请返回原认证流程查询或重新进入。' }); }
  },
  onUnload() { this.disposed = true; if (this.bridge) services.cancelFaceBridge(this.bridge.bridgeId); this.bridge = null; this.parent = null; },
  back() { if (this.bridge) services.cancelFaceBridge(this.bridge.bridgeId); wx.navigateBack({ delta: 1 }); },
});
