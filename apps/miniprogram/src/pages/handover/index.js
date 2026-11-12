const services = require('../../services/index');
const { load, go, toastError } = require('../../utils/page');
const { handoverSigning } = require('../../utils/customer-handover');
Page({
  data: { loading: true, error: '', subscription: null, handover: null, signing: handoverSigning(null), decision: 'confirm', name: '', note: '', evidenceOpen: false, evidenceRead: false, readFileIds: [], accepted: false, busy: false, submitted: null, canRespond: false },
  onLoad(options = {}) { this.handoverId = options.id || ''; this.reload(); },
  reload() {
    this.setData({ signing: handoverSigning(null) });
    return load(this, async () => {
      const dashboard = await services.getDashboard();
      const handoverId = this.handoverId || dashboard.handover?.id || dashboard.subscription?.handoverId;
      const handover = handoverId ? await services.getHandover(handoverId) : null;
      const same = handover && this.data.handover?.id === handover.id && this.data.handover?.revision === handover.revision && this.data.handover?.manifestHash === handover.manifestHash && this.data.handover?.actualAt === handover.actualAt && this.data.handover?.confirmationMode === handover.confirmationMode && this.data.handover?.onlineRecord?.termsHash === handover.onlineRecord?.termsHash && this.data.handover?.onlineRecord?.termsVersion === handover.onlineRecord?.termsVersion && this.data.handover?.onlineRecord?.documentId === handover.onlineRecord?.documentId;
      if (!same) this._submitKey = null;
      const responded = handover && (handover.customerResponse || ['CUSTOMER_CONFIRMED','OBJECTION_SUBMITTED','COMPLETED','SUPERSEDED'].includes(handover.status));
      const signing=handoverSigning(handover);
      return { canRespond:!!handover && !responded && handover.status==='PUBLISHED' && !signing.confirmationBlocked, subscription: handover ? { ...dashboard.subscription, ...(handover.vehicleTitle ? { vehicleName: handover.vehicleTitle } : {}) } : null, handover, signing, name: services.getContext().profile?.name || '', submitted: responded ? handover : null, decision: responded ? (handover.customerResponse === 'OBJECT' ? 'dispute' : 'confirm') : (same ? this.data.decision : 'confirm'), note: responded ? handover.responseReason || '' : (same ? this.data.note : ''), evidenceRead: same && !responded ? this.data.evidenceRead : false, evidenceOpen: same ? this.data.evidenceOpen : false, accepted: same && !responded ? this.data.accepted : false, readFileIds: same ? this.data.readFileIds : [] };
    });
  },
  onShow() { if (this.data.handover) this.reload(); },
  async openSigned() { try { if (!this.data.loading && !this.data.error && handoverSigning(this.data.handover).canOpenSigned) await services.openPrivateFile(this.data.handover.signedFileId); } catch(error) { toastError(error); } },
  input(e) { const key = e.currentTarget.dataset.field; if (['name', 'note'].includes(key)) this.setData({ [key]: e.detail.value }); },
  selectDecision(e) { if (!this.data.busy && !this.data.submitted && ['confirm', 'dispute'].includes(e.currentTarget.dataset.value)) this.setData({ decision: e.currentTarget.dataset.value, accepted: false }); },
  showEvidence() { this.setData({ evidenceOpen: !this.data.evidenceOpen }); },
  async openEvidence(e) {
    const id = e.currentTarget.dataset.id;
    if (!(this.data.handover?.fileIds || []).includes(id)) return;
    try { await services.openPrivateFile(id); this.setData({ readFileIds: [...new Set(this.data.readFileIds.concat(id))] }); }
    catch (error) { toastError(error); }
  },
  acknowledgeEvidence(e) {
    if (this.data.busy || this.data.loading || this.data.error || this.data.submitted || !this.data.evidenceOpen) return;
    const checked = e?.detail ? e.detail.value.includes('read') : !this.data.evidenceRead;
    if (!checked) return this.setData({ evidenceRead: false, accepted: false });
    if (!(this.data.handover?.fileIds || []).every(id => this.data.readFileIds.includes(id))) {
      this.setData({ evidenceRead: false, accepted: false });
      return toastError(new Error('请先逐项打开交接附件。'));
    }
    this.setData({ evidenceRead: true });
  },
  consent(e) { if(this.data.busy || this.data.loading || this.data.error || this.data.submitted)return; this.setData({ accepted: e.detail.value.includes('accepted') }); },
  async submit() {
    if (this.data.busy || this.data.loading || this.data.error || this.data.submitted) return;
    if(!this.data.canRespond || handoverSigning(this.data.handover).confirmationBlocked)return toastError(new Error('当前交接版本不能提交意见，请刷新后核对。'));
    if (!this.data.handover) return toastError(new Error('当前没有待确认的交接'));
    if (this.data.decision === 'confirm' && !this.data.handover.actualAtValid) return toastError(new Error('当前交接缺少有效实际交车/还车时间，请联系后台核对；可以提出异议。'));
    if (!this.data.evidenceRead || !this.data.accepted) return toastError(new Error('请先阅读全部交接证据并确认意见'));
    if (this.data.decision === 'dispute' && this.data.note.trim().length < 5) return toastError(new Error('请至少用 5 个字说明异议'));
    this.setData({ busy: true });
    try {
      const submitted = await services.submitHandover({ handoverId: this.data.handover.id, manifestHash: this.data.handover.manifestHash, ...(this.data.handover.confirmationMode==='ONLINE_RECORD'?{revision:this.data.handover.revision,documentId:this.data.handover.onlineRecord.documentId,termsVersion:this.data.handover.onlineRecord.termsVersion,termsHash:this.data.handover.onlineRecord.termsHash,termsAccepted:this.data.decision==='confirm'&&this.data.accepted}:{}), actualAt: this.data.handover.actualAt, readFileIds: this.data.readFileIds, decision: this.data.decision, name: this.data.name.trim(), note: this.data.note.trim(), evidenceRead: this.data.evidenceRead, accepted: this.data.accepted, idempotencyKey: this._submitKey || (this._submitKey = services.idempotencyKey('handover')) });
      this.setData({ submitted, signing: handoverSigning(null) });
      await this.reload();
    } catch (error) { if (error.statusCode === 409) await this.reload(); toastError(error); }
    finally { this.setData({ busy: false }); }
  },
  async sign() {
    if (this.data.busy || this.data.loading || this.data.error || !this.data.handover) return;
    const signing = handoverSigning(this.data.handover);
    if (!signing.canSign) return toastError(new Error(signing.message));
    this.setData({ busy: true });
    try { await services.performAction('handovers', this.data.handover.id, 'sign'); }
    catch (error) { toastError(error); }
    finally { await this.reload(); this.setData({ busy: false }); }
  },
  openRecord() { this.reload(); },
  openArchive(){const h=this.data.handover,s=handoverSigning(h);if(s.offline&&s.canReadArchive&&h.orderId)go('/pages/order-detail/index?id='+encodeURIComponent(h.orderId)+'&archiveId='+encodeURIComponent(s.archiveId));},
  openUse() { go('/pages/use/index'); },
});
