const service = require('../../services/index');
const config = require('../../config');
const { load, go, toastError, confirm } = require('../../utils/page');

Page({
  data: {
    loading: true,
    error: '',
    busy: false,
    application: null,
    planRead: false,
    ownerSharingAccepted: false,
    actionMessage: '',
    actionError: '',
    rejectReason: '',
    creditReview: null,
    creditAccepted: false,
    creditError: '',
    creditMessage: '',
  },
  onLoad(options) {
    this.applicationId = options.id;
  },
  onShow() {
    this.refresh();
  },
  refresh() {
    this.setData({ creditAccepted: false, creditReview: null, creditError: '', planRead: false, ownerSharingAccepted:false });
    return load(this, async () => {
      const [application, credit] = await Promise.all([
        service.getApplication(this.applicationId),
        service.getCreditReview(this.applicationId).then(creditReview => ({ creditReview, creditError: '' })).catch(error => ({ creditReview: null, creditError: error.message || '核验状态暂不可用，请联系人工。' })),
      ]);
      return { application, planRead: false, ...credit };
    });
  },
  onCreditAccepted(event) { if (!this.data.busy) this.setData({ creditAccepted: event.detail.value.includes('credit'), creditError: '' }); },
  openCreditExplanation() { go('/pages/legal/index?type=credit-verification'); },
  openCreditSettings() { go('/pages/settings/index'); },
  contactCreditService() { wx.makePhoneCall({ phoneNumber: config.customerServiceTelephone, fail: error => { if (!/cancel/i.test(error?.errMsg || '')) toastError(new Error('电话暂时无法拨打，请手动拨打客服。')); } }); },
  acceptCreditConsent() { return this.creditAction('ACCEPT'); },
  declineCreditConsent() { return this.creditAction('DECLINE'); },
  withdrawCreditConsent() { return this.creditAction('WITHDRAW'); },
  async creditAction(decision) {
    if (this.data.busy || !this.data.application) return;
    const review = this.data.creditReview;
    if (decision === 'ACCEPT' && review?.consentCurrent) { this.setData({ creditAccepted: false, creditError: '本申请当前版本授权已记录，无需重复授权；可查询状态或联系人工复核。' }); return; }
    if (!review || (decision === 'WITHDRAW' ? !review.canWithdraw : !review.document || !(decision === 'ACCEPT' ? review.canConsent : review.canDecline))) { this.setData({ creditError: '当前核验授权不可操作，请刷新或联系人工。' }); return; }
    if (decision === 'ACCEPT' && !this.data.creditAccepted) { this.setData({ creditError: '请阅读说明，并单独勾选同意本申请的人工信用核验。' }); return; }
    this.setData({ busy: true, creditError: '', creditMessage: '', planRead: false });
    try {
      if (decision === 'WITHDRAW' && !(await confirm('撤回本申请后续核验授权？', '将停止新的信用核验，未确认方案需重新人工处理；已有合同金额及必要历史凭据不会因此改写。'))) return;
      if (decision === 'WITHDRAW') await service.withdrawCreditConsent(this.applicationId, { consentId: review.consent.id });
      else await service.submitCreditConsent(this.applicationId, { documentId: review.document.id, version: review.document.version, decision });
      await this.refresh();
      this.setData({ creditMessage: decision === 'ACCEPT' ? '本申请单独授权已记录，请联系运营安排人工核验。' : decision === 'DECLINE' ? '已记录暂不授权，转人工联系处理；不会生成正式方案。' : '已撤回后续核验授权，已有合同金额保持原确认记录。' });
    } catch (error) {
      await this.refresh();
      this.setData({ creditError: error.message || '核验授权操作未完成，请刷新确认。', creditAccepted: false, planRead: false });
      toastError(error);
    } finally { this.setData({ busy: false }); }
  },
  openAmendment() { go('/pages/profile/index?applicationId=' + encodeURIComponent(this.applicationId)); },
  onRejectReason(event) { this.setData({ rejectReason: event.detail.value, actionError: '' }); },
  onPlanRead(event) {
    this.setData({ planRead: event.detail.value.includes('read'), actionError: '' });
  },
  onOwnerSharing(event) {if(!this.data.busy)this.setData({ownerSharingAccepted:event.detail.value.includes('owner'),actionError:''});},
  openCatalog() {
    go('/pages/catalog/index');
  },
  openUse() {
    go('/pages/use/index');
  },
  async confirmPlan() {
    return this.act('confirm');
  },
  async rejectPlan() {
    return this.act('reject');
  },
  async cancelApplication() {
    const application = this.data.application;
    if (
      this.data.busy ||
      !application ||
      !['SUBMITTED', 'IN_REVIEW', 'NEEDS_INFO', 'AWAITING_CONFIRMATION'].includes(application.status)
    )
      return;
    this.setData({ busy: true, actionError: '', actionMessage: '' });
    try {
      const accepted = await confirm(
        '取消这份申请？',
        '取消后将停止当前申请流程。之后可以重新选择车辆和套餐申请。',
      );
      if (!accepted) return;
      const result = await service.performAction('application', application.id, 'cancel');
      this.setData({ actionMessage: result.message || '申请已取消。' });
      await this.refresh();
    } catch (error) {
      this.setData({ actionError: error.message || '取消失败，请稍后重试。' });
      if (error.statusCode === 409) { await this.refresh(); this.setData({ actionError: error.message, planRead: false }); }
      toastError(error);
    } finally {
      this.setData({ busy: false });
    }
  },
  async act(action) {
    const application = this.data.application;
    if (
      this.data.busy ||
      !application ||
      application.status !== 'AWAITING_CONFIRMATION' ||
      !application.finalPlan
    )
      return;
    if (action === 'reject' && !this.data.rejectReason.trim()) { this.setData({ actionError: '请填写暂不接受方案的原因。' }); return; }
    if (action === 'confirm') {
      const credit = this.data.creditReview, final = application.finalPlan;
      if (!credit?.canConfirmFinalPlan || !credit.verification || final.creditVerificationId !== credit.verification.id || final.creditRuleVersion !== credit.ruleVersion || final.creditBand !== credit.verification.band || final.creditRevision !== credit.creditRevision) { this.setData({ actionError: '信用核验授权或押金依据尚未就绪、已变更，请联系运营重新核验并出具方案。', planRead: false }); return; }
    }
    if (action === 'confirm' && !application.finalPlan.complete) { this.setData({ actionError: '最终方案信息不完整，请等待后台补齐费用和日期后重新确认。' }); return; }
    if(action==='confirm'&&application.finalPlan.lessorSnapshot&&!this.data.ownerSharingAccepted){this.setData({actionError:'请单独阅读并同意向本单实际出租方提供必要合同资料。'});return;}
    if (action === 'confirm' && !this.data.planRead) {
      this.setData({ actionError: '请先阅读并勾选确认最终方案内容。' });
      return;
    }
    this.setData({ busy: true, actionError: '', actionMessage: '' });
    try {
      const accepted = await confirm(
        action === 'confirm' ? '确认这份最终方案？' : '暂不接受这份方案？',
        action === 'confirm'
          ? '你将确认当前展示的方案版本，确认后进入正式订单和待签约流程。'
          : '将记录你暂不接受当前方案，不会生成该方案的订单。',
      );
      if (!accepted) return;
      const result = await service.performAction('application', application.id, action, {
        revision: application.finalPlan.revision,
        commercialHash: application.finalPlan.commercialHash,
        ...(action==='confirm'&&application.finalPlan.lessorSnapshot?{ownerSharing:{accepted:true,lessorHash:application.finalPlan.lessorHash,noticeHash:application.finalPlan.lessorSnapshot.sharingNotice.contentHash}}:{}),
        reason: this.data.rejectReason.trim(),
      });
      this.setData({ actionMessage: result.message || '处理已保存。' });
      await this.refresh();
    } catch (error) {
      this.setData({
        actionError: error.message || '操作失败，请刷新方案后重试。',
        planRead: false,
      });
      toastError(error);
    } finally {
      this.setData({ busy: false });
    }
  },
});
