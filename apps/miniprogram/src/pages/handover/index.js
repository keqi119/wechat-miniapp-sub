const services = require('../../services/index');
const { load, go, toastError } = require('../../utils/page');
Page({
  data: { loading: true, error: '', subscription: null, handover: null, decision: 'confirm', name: '', note: '', evidenceOpen: false, evidenceRead: false, readFileIds: [], accepted: false, busy: false, submitted: null },
  onLoad() { this.reload(); },
  reload() {
    return load(this, async () => {
      const dashboard = await services.getDashboard();
      const handoverId = dashboard.handover?.id || dashboard.subscription?.handoverId;
      const handover = handoverId ? await services.getHandover(handoverId) : null;
      const same = handover && this.data.handover?.id === handover.id && this.data.handover?.manifestHash === handover.manifestHash;
      if (!same) this._submitKey = null;
      const responded = handover && (handover.customerResponse || ['CUSTOMER_CONFIRMED','OBJECTION_SUBMITTED','COMPLETED','SUPERSEDED'].includes(handover.status));
      return { subscription: handover ? dashboard.subscription : null, handover, name: services.getContext().profile?.name || '', submitted: responded ? handover : null, decision: responded ? (handover.customerResponse === 'OBJECT' ? 'dispute' : 'confirm') : (same ? this.data.decision : 'confirm'), note: responded ? handover.responseReason || '' : (same ? this.data.note : ''), evidenceRead: same ? this.data.evidenceRead : false, evidenceOpen: same ? this.data.evidenceOpen : false, accepted: same ? this.data.accepted : false, readFileIds: same ? this.data.readFileIds : [] };
    });
  },
  onShow() { if (this.data.handover) this.reload(); },
  async openSigned() { try { if (this.data.handover?.signedFileId) await services.openPrivateFile(this.data.handover.signedFileId); } catch(error) { toastError(error); } },
  input(e) { const key = e.currentTarget.dataset.field; if (['name', 'note'].includes(key)) this.setData({ [key]: e.detail.value }); },
  selectDecision(e) { if (!this.data.busy && ['confirm', 'dispute'].includes(e.currentTarget.dataset.value)) this.setData({ decision: e.currentTarget.dataset.value, accepted: false }); },
  showEvidence() { this.setData({ evidenceOpen: !this.data.evidenceOpen }); },
  async openEvidence(e) {
    const id = e.currentTarget.dataset.id;
    if (!(this.data.handover?.fileIds || []).includes(id)) return;
    try { await services.openPrivateFile(id); this.setData({ readFileIds: [...new Set(this.data.readFileIds.concat(id))] }); }
    catch (error) { toastError(error); }
  },
  acknowledgeEvidence() {
    if (!this.data.evidenceOpen) return;
    if (!(this.data.handover?.fileIds || []).every(id => this.data.readFileIds.includes(id))) return toastError(new Error('请先逐项打开交接附件。'));
    this.setData({ evidenceRead: true });
  },
  consent(e) { this.setData({ accepted: e.detail.value.includes('accepted') }); },
  async submit() {
    if (this.data.busy || this.data.submitted) return;
    if (!this.data.handover) return toastError(new Error('当前没有待确认的交接'));
    if (!this.data.evidenceRead || !this.data.accepted) return toastError(new Error('请先阅读全部交接证据并确认意见'));
    if (this.data.decision === 'dispute' && this.data.note.trim().length < 5) return toastError(new Error('请至少用 5 个字说明异议'));
    this.setData({ busy: true });
    try {
      const submitted = await services.submitHandover({ handoverId: this.data.handover.id, manifestHash: this.data.handover.manifestHash, readFileIds: this.data.readFileIds, decision: this.data.decision, name: this.data.name.trim(), note: this.data.note.trim(), evidenceRead: this.data.evidenceRead, accepted: this.data.accepted, idempotencyKey: this._submitKey || (this._submitKey = services.idempotencyKey('handover')) });
      this.setData({ submitted, handover: { ...this.data.handover, ...submitted } });
    } catch (error) { if (error.statusCode === 409) await this.reload(); toastError(error); }
    finally { this.setData({ busy: false }); }
  },
  async sign() { if (this.data.busy || !this.data.handover) return; this.setData({ busy: true }); try { await services.performAction('handovers', this.data.handover.id, 'sign'); } catch (error) { toastError(error); } finally { this.setData({ busy: false }); } },
  openRecord() { this.reload(); },
  openUse() { go('/pages/use/index'); },
});
