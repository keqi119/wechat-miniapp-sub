const services = require('../../services/index');
const { load } = require('../../utils/page');
Page({
  data: { loading: true, error: '', signing: null, status: 'UNKNOWN', statusError: '', message: '', busy: false },
  onLoad(options) { this.id = options.id || ''; this.kind = options.kind || 'contract'; this.reload(); },
  reload() { this.setData({ signing: null }); return load(this, async () => ({ signing: await services.getSigningGuidance(this.kind, this.id) })); },
  async onShow() { if (!this.id || !['contract', 'handover', 'order-change', 'identity'].includes(this.kind)) return; await this.refreshStatus(); },
  async refreshStatus() {
    if (this._statusBusy) return;
    this._statusBusy = true; this.setData({ statusError: '' });
    try {
      const result = await services.getSignStatus(this.id, this.kind);
      this.setData({ status: result.status, message: result.status === 'SIGNED' ? '服务端已确认双方签署并归档。实际交付、资金结清或变更生效请查看原业务进度。' : result.status === 'VERIFIED' ? '服务端已确认实名与证书就绪。' : ['REJECTED', 'EXPIRED'].includes(result.status) ? '本次签署已终止或过期，请返回业务记录联系运营处理。' : '服务端尚未确认完成。请在签约网页核对流程，完成后手动返回小程序再查询。' });
    } catch (error) { this.setData({ status: 'UNKNOWN', statusError: error.message, message: '查询未完成，结果尚未核实；复制或返回小程序都不代表签署成功。' }); }
    finally { this._statusBusy = false; }
  },
  async copyEntry() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '', message: '' });
    try { const result = await services.copySigningEntry(this.kind, this.id); this.setData({ message: result.message }); }
    catch (error) { await this.reload(); this.setData({ error: error.message }); }
    finally { this.setData({ busy: false }); }
  },
  back() { wx.navigateBack({ delta: 1 }); },
});
