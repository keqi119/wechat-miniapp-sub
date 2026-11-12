const service = require('../../services/index');
const config = require('../../config');
const { load, go, toastError, confirm } = require('../../utils/page');

function actionDialog(title, content, showCancel = false) {
  return new Promise((resolve, reject) => wx.showModal({
    title, content, showCancel, confirmColor: '#252723',
    success: result => resolve(showCancel ? Boolean(result.confirm) : true),
    fail: () => reject(new Error('确认窗口暂时无法打开，本次未提交，请重试。')),
  }));
}

Page({
  data: {
    loading: true,
    error: '',
    busy: false,
    application: null,
    reviewStatus:null,
    planRead: false,
    ownerSharingAccepted: false,
    actionMessage: '',
    actionError: '',
    rejectReason: '',
    creditReview: null,
    creditAccepted: false,
    creditError: '',
    creditMessage: '',
    showPlanDetails: false,
    showCreditDetails: false,
    showLessorDetails: false,
    showRejectForm: false,
  },
  onLoad(options) {
    this.applicationId = options.id;
  },
  onShow() { if(this._legalReturn){const token=this._legalReturn;this._legalReturn=null;try{service.getLegalPreview(token);return;}catch(_){}} return this.refresh(); },
  openFrozenDocument(document) { try { const url=service.previewLegalDocument(document); this._legalReturn=url.split('preview=')[1];go(url); } catch(error){toastError(error);} },
  onUnload() { this._disposed = true; this._loadRevision = (this._loadRevision || 0) + 1; },
  refresh() {
    this.setData({ creditAccepted: false, creditError: '', planRead: false, ownerSharingAccepted:false });
    return load(this, async () => {
      const application=await service.getApplication(this.applicationId);
      const credit=await service.getCreditReview(this.applicationId).then(creditReview=>({creditReview,creditError:''})).catch(error=>({creditReview:null,creditError:error.message||'核验状态暂不可用，请联系人工。'}));
      let reviewStatus=null;
      if(service.getApplicationRisk&&service.getQualifications){
        const labels={PENDING:'等待人工审核',SUBMITTED:'审核中',APPROVED:'已审核',NEEDS_INFO:'待补充资料',REJECTED:'暂未通过',RECHECK_REQUIRED:'需要重新核对'};
        const safeRead=async(fn)=>{try{const value=await fn();return{status:value.status,statusText:labels[value.status]||'待人工核对',instructions:value.status==='NEEDS_INFO'?value.supplementaryInstructions||'请联系平台核对所需材料。':''};}catch(error){if(error.statusCode===401)throw error;return{status:'UNAVAILABLE',statusText:'暂无法读取，请刷新',instructions:''};}};
        const [qualification,risk]=await Promise.all([safeRead(()=>service.getQualifications()),safeRead(()=>service.getApplicationRisk(this.applicationId))]);reviewStatus={qualification,risk};
      }
      return { application, reviewStatus, planRead: false, ...credit };
    }, { clearOnError: ['creditReview'] });
  },
  onCreditAccepted(event) { if (!this.data.busy) this.setData({ creditAccepted: event.detail.value.includes('credit'), creditError: '' }); },
  openCreditExplanation() { this.openFrozenDocument(this.data.creditReview?.document); },
  openUsageTerms() { this.openFrozenDocument(this.data.application?.finalPlan?.usagePolicy); },
  openSharingNotice() { this.openFrozenDocument(this.data.application?.finalPlan?.lessorSnapshot?.sharingNotice); },
  openCreditSettings() { go('/pages/profile/index'); },
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
  togglePlanDetails() { if (!this.data.busy) this.setData({ showPlanDetails: !this.data.showPlanDetails }); },
  toggleCreditDetails() { if (!this.data.busy) this.setData({ showCreditDetails: !this.data.showCreditDetails }); },
  toggleLessorDetails() { if (!this.data.busy) this.setData({ showLessorDetails: !this.data.showLessorDetails }); },
  beginReject() {
    if (this.data.busy) return;
    const showing = !this.data.showRejectForm;
    this.setData({ showRejectForm: showing }, () => {
      if (showing && typeof wx.pageScrollTo === 'function') wx.pageScrollTo({ selector: '#rejection-section', duration: 250 });
    });
  },
  onRejectReason(event) { this.setData({ rejectReason: event.detail.value, actionError: '' }); },
  onPlanRead(event) {
    if (!this.data.busy) this.setData({ planRead: event.detail.value.includes('read'), actionError: '' });
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
  async actionFeedback(title, message, isError = false) {
    this.setData({ actionError: isError ? message : '', actionMessage: isError ? '' : message });
    try { await actionDialog(title, message); }
    catch (_) { toastError(message); }
  },
  async cancelApplication() {
    if (this.data.busy) return;
    const application = this.data.application;
    this.setData({ busy: true, actionError: '', actionMessage: '' });
    try {
      if (!application || !['SUBMITTED', 'IN_REVIEW', 'NEEDS_INFO', 'AWAITING_CONFIRMATION'].includes(application.status)) {
        await this.actionFeedback('当前无法取消', '申请状态已变化，请重新加载最新申请。', true); return;
      }
      const accepted = await actionDialog(
        '取消这份申请？',
        '取消后将停止当前申请流程。之后可以重新选择车辆和套餐申请。',
        true,
      );
      if (!accepted) { await this.actionFeedback('已保留申请', '本次未取消申请。'); return; }
      const result = await service.performAction('application', application.id, 'cancel');
      const refreshed = await this.refresh();
      await this.actionFeedback('申请已取消', refreshed ? result.message || '申请已取消。' : '取消结果已保存，但最新申请暂未加载成功，请重新加载查看。');
    } catch (error) {
      if (error.statusCode === 409) await this.refresh();
      this.setData({ planRead: false, ownerSharingAccepted: false });
      const message = error.code === 'NETWORK' ? '网络中断，取消结果尚待核实，请刷新申请后再决定下一步。' : error.message || '取消失败，请稍后重试。';
      await this.actionFeedback('请核对申请状态', message, true);
    } finally {
      this.setData({ busy: false });
    }
  },
  async act(action) {
    if (this.data.busy) return;
    const application = this.data.application;
    this.setData({ busy: true, actionError: '', actionMessage: '' });
    try {
      if (!application || application.status !== 'AWAITING_CONFIRMATION' || !application.finalPlan) {
        await this.actionFeedback('方案状态已变化', '当前申请没有可确认的最终方案，请重新加载最新申请。', true); return;
      }
      if (action === 'reject' && !this.data.rejectReason.trim()) { await this.actionFeedback('请补充原因', '请在最终方案下方填写暂不接受方案的原因。', true); return; }
      if (action === 'confirm') {
        const credit = this.data.creditReview, final = application.finalPlan;
        if ((credit?.canConfirmFinalPlan !== true || credit.verificationCurrent !== true || !Number.isInteger(final.creditRevision) || final.creditRevision < 0 || final.creditRuleVersion !== credit.ruleVersion || final.creditRevision !== credit.creditRevision)) {
          this.setData({ planRead: false, ownerSharingAccepted: false });
          await this.actionFeedback('请核对信用核验', '信用核验授权或押金依据尚未就绪、已变更，请联系运营重新核验并出具方案。', true); return;
        }
        if (!final.complete) {
          await this.actionFeedback('方案资料待补齐', final.usagePolicyComplete === false ? '最终方案的月里程与退订规则尚未完整固定，请联系运营核对后重新发布。' : '最终方案信息不完整，请等待后台补齐费用、日期和商业约定后重新确认。', true); return;
        }
        if (final.lessorSnapshot && !this.data.ownerSharingAccepted) { await this.actionFeedback('请确认资料提供说明', '请阅读页面“本单实际出租方”说明，并单独勾选同意为履行本单合同向该实际出租方提供说明中的必要资料。', true); return; }
        if (!this.data.planRead) { await this.actionFeedback('请确认最终方案', '请先阅读并勾选确认最终方案内容。', true); return; }
      }
      const accepted = await actionDialog(
        action === 'confirm' ? '确认这份最终方案？' : '暂不接受这份方案？',
        action === 'confirm'
          ? (application.finalPlan.contractMode === 'OFFLINE'
            ? '你将确认当前展示的方案版本并创建正式订单；之后由你、实际出租方与宁达平台三方办理纸质合同签署，经平台审核归档后继续付款与交车。'
            : '你将确认当前展示的方案版本，确认后进入正式订单和待签约流程。')
          : '将记录你暂不接受当前方案，不会生成该方案的订单。',
        true,
      );
      if (!accepted) { await this.actionFeedback('本次未提交', '已取消本次操作，申请和方案保持原状态。'); return; }
      const result = await service.performAction('application', application.id, action, {
        revision: application.finalPlan.revision,
        commercialHash: application.finalPlan.commercialHash,
        ...(action==='confirm'&&application.finalPlan.lessorSnapshot?{ownerSharing:{accepted:true,lessorHash:application.finalPlan.lessorHash,noticeHash:application.finalPlan.lessorSnapshot.sharingNotice.contentHash}}:{}),
        reason: this.data.rejectReason.trim(),
      });
      const refreshed = await this.refresh();
      const title = action === 'confirm' ? '最终方案已确认' : '已记录暂不接受';
      const message = refreshed ? result.message || (action === 'confirm' ? '最终方案已确认，可前往“查看用车与待办”继续订单流程。' : '已记录暂不接受当前方案。') : '处理结果已保存，但最新申请暂未加载成功，请重新加载查看，不要重复提交。';
      await this.actionFeedback(title, message);
    } catch (error) {
      if (error.statusCode === 409) await this.refresh();
      this.setData({ planRead: false, ownerSharingAccepted: false });
      const message = error.code === 'NETWORK' ? '网络中断，本次操作结果尚待核实。请刷新申请查看最新状态，不要重复提交。' : error.message || '操作失败，请刷新方案后重试。';
      await this.actionFeedback('请核对处理结果', message, true);
    } finally {
      this.setData({ busy: false });
    }
  },
});
