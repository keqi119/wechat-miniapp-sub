const services = require('../../services/index');
const { load, go } = require('../../utils/page');
function routeId(value) {
  if (typeof value !== 'string') return '';
  try { return decodeURIComponent(value); } catch { return ''; }
}
Page({
  data: { loading: true, error: '', url: '', kind: '', title: '实名与签署', status: 'UNKNOWN', statusError: '', message: '', busy: false, enabled: false, faceBridgeConfigured: false },
  onLoad(options = {}) {
    this.id = routeId(options.id); this.kind = typeof options.kind === 'string' ? options.kind : ''; this._disposed = false; this._pageGeneration = (this._pageGeneration || 0) + 1; this._terminal = false; this._statusRevision = 0; this.setData({ kind: this.kind });
    this._unsupportedKind = !['contract', 'handover', 'order-change', 'identity', 'electronic'].includes(this.kind);
    if (this._unsupportedKind) {
      this.setData({ loading: false, url: '', enabled: false });
      wx.showModal({ title: '请从正确入口办理', content: this.kind.startsWith('owner-') ? '企业车主业务请从“宁达汽车订阅”服务号进入办理。此小程序用于客户租车。' : '当前入口无效，请到个人资料或原业务记录重新进入。', showCancel: false, success: () => go('/pages/profile/index') });
      return;
    }
    this.reload();
  },
  onUnload() { this._disposed = true; this._pageGeneration++; this._loadRevision = (this._loadRevision || 0) + 1; if (!this._unsupportedKind) services.clearFaceBridgeContext(this.kind, this.id); this.setData({ url: '' }); },
  reload() {
    if (this._disposed || this._unsupportedKind) return;
    const statusRevision = this._statusRevision;
    this.setData({ url: '', error: '' });
    return load(this, async () => {
      services.getSigningTask(this.kind, this.id);
      const config = await services.getSigningConfig(this.kind);
      if (this._disposed) return;
      if (!config.enabled || !config.signProviderConfigured) return { url: '', enabled: false, status: 'UNAVAILABLE', message: '当前签署办理未开放，请返回原记录查看已有资料。' };
      if(await this.stopOffline())return{title:'线下合同资料',url:'',enabled:false,status:'OFFLINE',message:'本单采用线下签署，由平台上传并审核归档，请返回原业务记录查看。'};
      services.getSigningTask(this.kind, this.id);
      const task = services.getSigningTask(this.kind, this.id), enabled = config.enabled && config.signProviderConfigured;
      return { title: task.title, url: enabled && !this._checkingCapability && !this._terminal ? task.url : '', enabled, faceBridgeConfigured: false, ...(statusRevision === this._statusRevision ? { status: task.status } : {}) };
    });
  },
  async onShow() { if (!this._unsupportedKind && this.id && ['contract', 'handover', 'order-change', 'identity', 'electronic'].includes(this.kind)) await this.refreshStatus(undefined, true, true); },
  async refreshStatus(event, passive = false, foreground = false) {
    if (this._disposed || this._unsupportedKind || this._querying && !foreground) return;
    const generation = this._pageGeneration, previousUrl = this.data.url, queryRevision = this._queryRevision = (this._queryRevision || 0) + 1;
    const current = () => !this._disposed && generation === this._pageGeneration && queryRevision === this._queryRevision;
    this._querying = true; this._checkingCapability = foreground; this._statusRevision = (this._statusRevision || 0) + 1;
    if (foreground) { this._webRevision = (this._webRevision || 0) + 1; this._loadRevision = (this._loadRevision || 0) + 1; }
    this.setData({ statusError: '', ...(foreground ? { url: '' } : {}) });
    try {
      services.getSigningTask(this.kind, this.id);
      const config = await services.getSigningConfig(this.kind);
      if (!current()) return;
      if (!config.enabled || !config.signProviderConfigured) {
        this.setData({ loading: false, url: '', enabled: false, status: 'UNAVAILABLE', message: '当前签署办理未开放，请返回原记录查看已有资料。' }); return;
      }
      if (await this.stopOffline()) { if (current()) this.setData({ loading: false }); return; }
      if (!current()) return;
      const task = services.getSigningTask(this.kind, this.id), resumeUrl = previousUrl || task.url;
      let result;
      if (this.kind === 'electronic' && (!passive || foreground && !!task.url)) result = await services.syncElectronicSigningStatus(this.id);
      else if(this.kind==='identity'&&!passive){const identity=await services.refreshESignReadiness();result={...identity,status:identity?.verified===true&&identity?.realNameStatus==='VERIFIED'?'VERIFIED':'PENDING'};}else result = await services.getSignStatus(this.id, this.kind);
      if (!current()) return;
      this._checkingCapability = false; this._statusRevision++;
      const needsIdentityReview=this.kind==='identity'&&result.realNameStatus==='VERIFIED'&&result.verified!==true;
      const done = ['SIGNED', 'VERIFIED', 'REJECTED', 'EXPIRED', 'CLOSED'].includes(result.status);
      const closed = done;
      if (closed) { this._terminal = true; services.forgetSigningTask(this.kind, this.id); }
      this.setData({ loading: false, title: task.title, enabled: true, status: result.status, message: this.kind==='identity'&&result.status!=='VERIFIED'&&typeof result.blocker?.message==='string'?result.blocker.message:result.status === 'SIGNED' ? '服务端已确认各方签署并归档。实际交付、资金或变更生效请查看原业务进度。' : result.status === 'VERIFIED' ? '服务端已确认实名认证完成。' : done ? '本流程已终止或过期，请联系运营。' : '服务端尚未确认完成。页面返回或提示完成都不代表已实名或已签署，请查询最新结果。', ...(closed||needsIdentityReview ? { url: '' } : {}) });
      if (foreground && resumeUrl && !this._terminal && !needsIdentityReview) this.reloadPage(resumeUrl);
    } catch (error) {
      if (!current()) return;
      this._statusRevision++; this.setData({ loading: false, status: 'UNKNOWN', url: '', statusError: error.message, message: '结果尚未核实，请稍后重新查询；不会按页面消息认定成功。' });
    } finally { if (current()) { this._querying = false; this._checkingCapability = false; } }
  },
  async stopOffline(){
    if(this._offline)return true;
    if(!['contract','handover'].includes(this.kind)||typeof services.getSigningBusinessContext!=='function')return false;
    const context=await services.getSigningBusinessContext(this.kind,this.id);
    if(context.offline&&!this._disposed){this._offline=true;this._terminal=true;services.forgetSigningTask(this.kind,this.id);this.setData({url:'',enabled:false,status:'OFFLINE',message:'本单采用线下签署，请返回原业务记录查看纸质资料归档。'});return true;}
    return false;
  },
  reloadPage(url) {
    if (this._disposed || this._terminal || this._checkingCapability || this._unsupportedKind) return false;
    const generation = this._pageGeneration, revision = this._webRevision = (this._webRevision || 0) + 1;
    try {
      const target = services.reloadSigningPage(this.kind, this.id, url);
      services.clearSigningWebLoaded(this.kind, this.id);
      // Removing the web-view first guarantees reload even for an identical opaque URL.
      this.setData({ url: '', statusError: '' }, () => {
        if (this._disposed || this._terminal || this._checkingCapability || generation !== this._pageGeneration || revision !== this._webRevision) return;
        try { this.setData({ url: services.reloadSigningPage(this.kind, this.id, target) }); }
        catch (error) { this.setData({ url: '', statusError: error.message }); }
      });
      return true;
    } catch (error) { this.setData({ url: '', statusError: error.message }); return false; }
  },
  onWebLoad() { if (this._unsupportedKind) return; try { services.markSigningWebLoaded(this.kind, this.id, this.data.url); this.setData({ message: '请在实名或签署页面自行核对并操作，返回后查询真实结果。' }); } catch { this.setData({ url: '', error: '当前认证页面已变化，请返回原记录重新进入。' }); } },
  onWebError() { if (this._unsupportedKind) return; this.setData({ url: '', error: '实名或签署页面暂时无法打开，请联系运营核对业务域名，或返回原记录查询。' }); },
  onWebMessage() { return this.refreshStatus(undefined, this.kind !== 'electronic'); },
  async retry() {
    if (this.data.busy || !this.data.enabled || this._unsupportedKind) return;
    if (this.kind === 'electronic') return go('/pages/electronic-contracts/index?taskId=' + encodeURIComponent(this.id));
    if (this.kind === 'identity') return go('/pages/profile/index');
    this.setData({ busy: true, error: '' });
    try { if (this.kind === 'order-change') { const current = await services.getOrderChange(this.id); await services.signOrderChange(this.id, { revision: current.revision }); } else if (['contract', 'handover'].includes(this.kind)) await services.performAction(this.kind === 'handover' ? 'handovers' : 'contracts', this.id, 'sign'); else throw new Error('请从原业务记录重新进入。'); }
    catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ busy: false }); }
  },
  back() { if (this._unsupportedKind) return go('/pages/profile/index'); wx.navigateBack({ delta: 1 }); },
});
