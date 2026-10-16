const services = require('../../services/index');
const config = require('../../config');
const { confirm, go } = require('../../utils/page');
Page({
  data: { loading: true, error: '', message: '', record: null, busy: false, documentRead: false, dataAccepted: false, consentUpdateRequired: false },
  onLoad(options = {}) { this.id = options.id || ''; this._pageGeneration = (this._pageGeneration || 0) + 1; return this.reload(); },
  stamp() { return { customerId: services.getContext().customer?.id, token: wx.getStorageSync(config.storageKey)?.token, generation: this._pageGeneration || 0 }; },
  current(s) { const c = this.stamp(); return !this._disposed && !!s.customerId && s.customerId === c.customerId && s.token === c.token && s.generation === c.generation; },
  async reload(options = {}) {
    if (this._disposed || this._operation && this.current(this._operation.stamp) && options.force !== true) return; const s = this.stamp(), revision = this._loadRevision = (this._loadRevision || 0) + 1;
    if (this._operation && !this.current(this._operation.stamp)) { this._operation = null; this.setData({ busy: false, message: '' }); }
    this.setData({ loading: true, error: '', record: null, documentRead: false, dataAccepted: false, consentUpdateRequired: false });
    try { if (!this.id) throw new Error('请从账户设置进入本人验证文件。'); const record = await services.getTechnicalAcceptance(this.id); if (this.current(s) && revision === this._loadRevision) this.setData({ record, loading: false, consentUpdateRequired: record.consentRequirementsMet === false && !record.confirmedAt && !record.stoppedAt && record.status !== 'PURGED' }); }
    catch (error) { if (this.current(s) && revision === this._loadRevision) this.setData({ loading: false, error: error.message }); }
  },
  onShow() { return this.reload(); },
  onDocumentRead(event) { if (!this.data.busy) this.setData({ documentRead: event.detail.value.includes('read'), error: '' }); },
  onDataConsent(event) { if (!this.data.busy) this.setData({ dataAccepted: event.detail.value.includes('data'), error: '' }); },
  async run(work) {
    if (this.data.busy || this._disposed) return; const stamp = this.stamp(), lease = { stamp }; this._operation = lease; this._loadRevision = (this._loadRevision || 0) + 1;
    const current = () => this.current(stamp) && this._operation === lease;
    this.setData({ busy: true, error: '', message: '' });
    try { await work(current); } catch (error) { if (current()) { this.setData({ documentRead: false, dataAccepted: false }); if (error.statusCode === 409) await this.reload({ force: true }); if (current()) { const consentUpdateRequired = ['CONSENT_REQUIRED','CONSENT_VERSION','CONSENT_STALE'].includes(error.code); this.setData({ ...(consentUpdateRequired ? { consentUpdateRequired: true } : {}), error: consentUpdateRequired ? '请到账户设置阅读并明确同意当前用户协议与隐私政策，再返回本份文件重新阅读和选择单独同意；无需重复实名。' : error.message + ' 请读取本份最新结果，不要重复提交。' }); } } }
    finally { if (current()) this.setData({ busy: false }); if (this._operation === lease) this._operation = null; }
  },
  async confirmDocument() {
    const record = this.data.record;
    if (!record?.canConfirm || !this.data.documentRead || !this.data.dataAccepted) { if (!this.data.busy) this.setData({ error: '请完整阅读本份文件，并单独选择本次必要信息处理同意。' }); return; }
    const d = record.document, c = record.disclosure;
    return this.run(async current => { if (!(await confirm('确认本份验证文件？', '本次仅验证真实电子签署，无租赁、订阅费、押金或交车义务。确认不代表已经签署或整套系统验收通过。')) || !current()) return;
      const result = await services.confirmTechnicalAcceptance(this.id, { revision: record.revision, documentHash: d.documentHash, bodyHash: d.bodyHash, templateHash: d.templateHash, read: true, consent: { accepted: true, disclosureVersion: c.version, privacyDocumentId: c.privacyDocumentId, privacyVersion: c.privacyVersion } });
      if (current()) this.setData({ record: result, documentRead: false, dataAccepted: false, message: '本份确认及单独同意已记录；仍须本文件双人用印复核和本人实际签署。' });
    });
  },
  async signDocument() { if (!this.data.record?.canSign) return; return this.run(async current => { if (!(await confirm('进入本人签署？', '请在法大大页面核对本份验证文件并自行签署。打开或返回页面不代表双方已签署归档。')) || !current()) return; await services.signTechnicalAcceptance(this.id); if (current()) this.setData({ message: '完成本人操作后返回，主动核验双方签署与归档结果。' }); }); },
  async syncSignature() { if (!this.data.record?.canSync) return; return this.run(async current => { const record = await services.syncTechnicalAcceptance(this.id); if (current()) this.setData({ record, documentRead: false, dataAccepted: false, message: record.signatureCompleted ? '服务端已确认本份双方签署并归档；不表示整套系统或商业服务验收通过。' : record.statusMessage || '双方签署或归档尚未完成，请核对真实结果。' }); }); },
  async stopParticipation() { if (!this.data.record?.canStop) return; return this.run(async current => { if (!(await confirm('停止后续验证？', '停止后不再发起新的签署或企业章，不表示供应商在途任务已撤销；已经发生和迟到的签署事实仍须核验保存，不产生租赁或收费义务。')) || !current()) return; const record = await services.stopTechnicalAcceptance(this.id); if (current()) this.setData({ record, documentRead: false, dataAccepted: false, message: '停止请求已记录。渠道在途结果仍待按事实核对，不能认定供应商已撤销。' }); }); },
  async openFile(event) { const id = event.currentTarget.dataset.id; if (!this.data.record || ![this.data.record.sourceFileId,this.data.record.signedFileId].includes(id)) return; return this.run(async () => { await services.openTechnicalAcceptanceFile(this.id,id); }); },
  openSettings() { go('/pages/settings/index'); },
  onHide() { this.setData({ documentRead: false, dataAccepted: false }); },
  onUnload() { this._disposed = true; this._pageGeneration = (this._pageGeneration || 0) + 1; this._loadRevision = (this._loadRevision || 0) + 1; },
});
