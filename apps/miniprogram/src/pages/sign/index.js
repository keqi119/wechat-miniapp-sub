const services = require('../../services/index');
const { load, go } = require('../../utils/page');
function routeId(value) {
  if (typeof value !== 'string') return '';
  try { return decodeURIComponent(value); } catch { return ''; }
}
Page({
  data: { loading: true, error: '', url: '', kind: '', title: '实名与签署', status: 'UNKNOWN', statusError: '', message: '', busy: false, enabled: false, faceBridgeConfigured: false },
  onLoad(options = {}) { this.id = routeId(options.id); this.kind = options.kind || ''; this._disposed = false; this._pageGeneration = (this._pageGeneration || 0) + 1; this._terminal = false; this._statusRevision = 0; this.setData({ kind: this.kind }); this.reload(); },
  onUnload() { this._disposed = true; this._pageGeneration++; this._loadRevision = (this._loadRevision || 0) + 1; services.clearFaceBridgeContext(this.kind, this.id); this.setData({ url: '' }); },
  reload() {
    if (this._disposed) return;
    const statusRevision = this._statusRevision;
    this.setData({ url: '', error: '' });
    return load(this, async () => {
      services.getSigningTask(this.kind, this.id);
      const technical = this.kind === 'technical-acceptance', record = technical ? await services.getTechnicalAcceptance(this.id) : null;
      const terminal = technical && (record.signatureCompleted || record.stoppedAt || ['REJECTED','EXPIRED','PURGED'].includes(record.status));
      if (technical && (!record.canSign || terminal)) services.forgetSigningTask(this.kind,this.id);
      const config = await services.getSigningConfig(), task = services.getSigningTask(this.kind, this.id), enabled = config.enabled && config.signProviderConfigured && (!technical || record.enabled);
      const status = terminal ? record.signatureCompleted ? 'SIGNED' : record.stoppedAt || record.status === 'PURGED' ? 'CLOSED' : record.signatureStatus : task.status;
      return { title: task.title, url: enabled && !this._terminal && (!technical || record.canSign && !terminal) ? task.url : '', enabled, faceBridgeConfigured: false, ...(technical ? { technicalStopped: !!record.stoppedAt } : {}), ...(statusRevision === this._statusRevision ? { status } : {}) };
    });
  },
  async onShow() { if (this.id && ['contract', 'handover', 'order-change', 'identity', 'technical-acceptance','owner-identity','owner-contract','owner-authority','owner-revoke'].includes(this.kind)) await this.refreshStatus(undefined, true); },
  async refreshStatus(event, passive = false) {
    if (this._querying || this._disposed) return; const generation = this._pageGeneration; this._querying = true; this._statusRevision = (this._statusRevision || 0) + 1; this.setData({ statusError: '' });
    try { const technical = this.kind === 'technical-acceptance'; let result; if (technical && !passive) { const record = await services.syncTechnicalAcceptance(this.id); result = { ...record, status: record.signatureCompleted ? 'SIGNED' : record.stoppedAt ? 'CLOSED' : record.signatureStatus }; } else result = await services.getSignStatus(this.id, this.kind); if (this._disposed || generation !== this._pageGeneration) return; this._statusRevision++; const done = ['SIGNED', 'VERIFIED', 'REJECTED', 'EXPIRED', 'CLOSED'].includes(result.status); if (done || technical && !result.enabled) { this._terminal = true; services.forgetSigningTask(this.kind, this.id); } this.setData({ status: result.status, technicalStopped: technical && !!result.stoppedAt, ...(technical ? { enabled: this.data.enabled && result.enabled && !result.stoppedAt } : {}), message: result.status === 'SIGNED' ? technical ? '本份双方真实签署已核验并归档，不表示整套系统、租赁或商业服务验收通过。' + (result.stoppedAt ? '后续验证已停止，原签署事实保留。' : '') : '服务端已确认双方签署并归档。实际交付、资金或变更生效请查看原业务进度。' : result.status === 'VERIFIED' ? '服务端已确认实名与证书就绪。' : done ? technical && result.stoppedAt ? '后续验证已停止；不能据此认定供应商在途任务已撤销，迟到结果仍按事实核对。' : '本流程已终止或过期，请联系运营。' : '服务端尚未确认完成。页面返回或提示完成都不代表已实名或已签署，请查询最新结果。', ...(done || technical && (!result.enabled || result.stoppedAt) ? { url: '' } : {}) }); }
    catch (error) { if (this._disposed || generation !== this._pageGeneration) return; this._statusRevision++; this.setData({ status: 'UNKNOWN', url: '', statusError: error.message, message: '结果尚未核实，请稍后重新查询；不会按页面消息认定成功。' }); }
    finally { this._querying = false; }
  },
  reloadPage(url) {
    if (this._disposed || this._terminal) return false;
    const generation = this._pageGeneration, revision = this._webRevision = (this._webRevision || 0) + 1;
    try {
      const target = services.reloadSigningPage(this.kind, this.id, url);
      services.clearSigningWebLoaded(this.kind, this.id);
      // Removing the web-view first guarantees reload even for an identical opaque URL.
      this.setData({ url: '', statusError: '' }, () => {
        if (this._disposed || this._terminal || generation !== this._pageGeneration || revision !== this._webRevision) return;
        try { this.setData({ url: services.reloadSigningPage(this.kind, this.id, target) }); }
        catch (error) { this.setData({ url: '', statusError: error.message }); }
      });
      return true;
    } catch (error) { this.setData({ url: '', statusError: error.message }); return false; }
  },
  onWebLoad() { try { services.markSigningWebLoaded(this.kind, this.id, this.data.url); this.setData({ message: '请在实名或签署页面自行核对并操作，返回后查询真实结果。' }); } catch { this.setData({ url: '', error: '当前认证页面已变化，请返回原记录重新进入。' }); } },
  onWebError() { this.setData({ url: '', error: '实名或签署页面暂时无法打开，请联系运营核对业务域名，或返回原记录查询。' }); },
  onWebMessage() { return this.refreshStatus(undefined, true); },
  async retry() {
    if (this.data.busy || !this.data.enabled) return;
    if(this.kind.startsWith('owner-'))return go('/pages/owner/index?id='+encodeURIComponent(this.id.split(':')[0]));
    if (this.kind === 'identity') return go('/pages/settings/index');
    if (this.kind === 'technical-acceptance') return go('/pages/technical-acceptance/index?id=' + encodeURIComponent(this.id));
    this.setData({ busy: true, error: '' });
    try { if (this.kind === 'order-change') { const current = await services.getOrderChange(this.id); await services.signOrderChange(this.id, { revision: current.revision }); } else if (['contract', 'handover'].includes(this.kind)) await services.performAction(this.kind === 'handover' ? 'handovers' : 'contracts', this.id, 'sign'); else throw new Error('请从原业务记录重新进入。'); }
    catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ busy: false }); }
  },
  back() { wx.navigateBack({ delta: 1 }); },
});
