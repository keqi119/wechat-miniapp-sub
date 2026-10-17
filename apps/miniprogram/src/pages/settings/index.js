const services = require('../../services/index');
const config = require('../../config');
const { toastError, confirm, go } = require('../../utils/page');
Page({
  data: { authenticated: false, profile: null, busy: false, error: '', message: '', mobile: '', code: '', cooldown: 0, termsAccepted: false, privacyAccepted: false, legalDocumentsReady: false, legalDocuments: [], consentCurrent: false, customerServiceTelephone: config.customerServiceTelephone, readiness: null, identityVerified: false, identityStatusText: '实名状态尚待核验', certificateStatusText: '签署证书尚待核验', identityName: '', idCardNo: '', identityAccepted: false, signingConfig: null, signingError: '', paymentVerifications: [], verificationError: '', verificationMessage: '', technicalAcceptances: [], technicalError: '' },
  pageSession() { return { customerId: services.getContext().customer?.id || null, token: wx.getStorageSync?.(config.storageKey)?.token || null, generation: this._pageGeneration || 0 }; },
  isCurrentSession(stamp) { const current = this.pageSession(); return !this._disposed && stamp.customerId === current.customerId && stamp.token === current.token && stamp.generation === current.generation; },
  applyReadiness(readiness) {
    const identityVerified = readiness?.realNameStatus === 'VERIFIED';
    this.setData({ readiness, identityVerified, identityStatusText: identityVerified ? '已完成实名核验' : readiness?.realNameStatus === 'PENDING' ? '实名核验处理中，请主动查询结果' : '实名状态尚待核验', certificateStatusText: identityVerified && readiness.certBound === true && readiness.readyForSigning === true ? '签署证书已就绪' : '签署证书尚待核验', ...(identityVerified ? { identityName: '', idCardNo: '', identityAccepted: false } : {}) });
  },
  onShow() { return this.refresh(); },
  async refresh() {
    if (this._disposed) return;
    const context = services.getContext(), stamp = this.pageSession(), revision = this._refreshRevision = (this._refreshRevision || 0) + 1;
    const current = () => this.isCurrentSession(stamp) && this._refreshRevision === revision;
    if (this._identityQuery && !this.isCurrentSession(this._identityQuery.stamp)) { this._identityQuery = null; this.setData({ busy: false }); }
    if (!this._readinessSession || this._readinessSession.customerId !== stamp.customerId || this._readinessSession.token !== stamp.token) { this.applyReadiness(null); this.setData({ termsAccepted: false, privacyAccepted: false, identityName: '', idCardNo: '', identityAccepted: false, message: '' }); }
    this._readinessSession = stamp;
    this.setData({ authenticated: context.authenticated, profile: context.profile, error: '', legalDocumentsReady: false, signingConfig: null, signingError: '', ...(!context.authenticated ? { paymentVerifications: [], verificationError: '', verificationMessage: '', consentCurrent: false, identityName: '', idCardNo: '', identityAccepted: false } : {}) });
    try {
      await this.refreshTechnicalAcceptances(); if (!current()) return;
      const documents = await services.getLoginDocuments();
      if (!current()) return;
      if (documents.length !== 2 || documents.some((doc,index) => doc.type !== ['terms','privacy'][index] || !doc.id || !Number.isInteger(doc.version) || !doc.content)) throw new Error('当前已发布协议暂不可用，请稍后重试。');
      const changed = JSON.stringify(documents.map(doc => [doc.id,doc.version,doc.content])) !== JSON.stringify(this.data.legalDocuments.map(doc => [doc.id,doc.version,doc.content]));
      this._legalDocumentsSession = stamp;
      this.setData({ legalDocuments: documents, legalDocumentsReady: true, termsAccepted: changed ? false : this.data.termsAccepted, privacyAccepted: changed ? false : this.data.privacyAccepted, identityAccepted: changed ? false : this.data.identityAccepted });
      if (!context.authenticated) return;
      const updated = await services.refreshContext();
      if (!current()) return;
      this.setData({ authenticated: updated.authenticated, profile: updated.profile, consentCurrent: documents.every(doc => updated.consents.some(consent => consent.documentId === doc.id && consent.version === doc.version)) });
      await this.refreshPaymentVerifications();
      if (!current()) return;
      if (!this._identityQuery) {
        const identityRevision = this._identityRevision || 0;
        try { const readiness = await services.getESignReadiness(); if (!current()) return; if (identityRevision === (this._identityRevision || 0)) this.applyReadiness(readiness); }
        catch (error) { if (!current()) return; if (identityRevision === (this._identityRevision || 0)) throw error; }
      }
      try { const signingConfig = await services.getSigningConfig(); if (current()) this.setData({ signingConfig }); } catch (error) { if (current()) this.setData({ signingConfig: null, signingError: error.message }); }
    } catch (error) {
      if (current()) this.setData({ error: error.message, authenticated: services.getContext().authenticated, ...(!this.data.legalDocumentsReady ? { legalDocuments: [], termsAccepted: false, privacyAccepted: false, consentCurrent: false } : {}) });
      else if (!this._disposed && this._refreshRevision === revision) { this.hasCurrentConsentSession(); this.setData({ authenticated: services.getContext().authenticated }); }
    }
  },
  async refreshTechnicalAcceptances() {
    const stamp = this.pageSession(), revision = this._technicalRevision = (this._technicalRevision || 0) + 1;
    this.setData({ technicalAcceptances: [], technicalError: '' }); if (!services.getContext().authenticated) return;
    try { const items = await services.getTechnicalAcceptances(); if (this.isCurrentSession(stamp) && this._technicalRevision === revision) this.setData({ technicalAcceptances: items }); }
    catch (error) { if (this.isCurrentSession(stamp) && this._technicalRevision === revision) this.setData({ technicalError: error.message }); }
  },
  openTechnicalAcceptance(event) { const id = event.currentTarget.dataset.id; if (this.data.technicalAcceptances.some(row => row.id === id)) go('/pages/technical-acceptance/index?id=' + encodeURIComponent(id)); },
  verificationRow(record,resumeAllowed=false) {
    const active=Number.isFinite(Date.parse(record.expiresAt))&&Date.parse(record.expiresAt)>Date.now();
    const permitted=record.canPay===true&&record.amount===1&&record.currency==='CNY'&&active&&['AUTHORIZED','CREATING','PENDING'].includes(record.status);
    return {...record,resumeAllowed:permitted&&resumeAllowed&&record.status!=='AUTHORIZED',canStart:permitted&&(record.status==='AUTHORIZED'||resumeAllowed),payText:record.status==='AUTHORIZED'?'支付 0.01 元':'继续本次验收（0.01 元）'};
  },
  async refreshPaymentVerifications() {
    if(this._verificationBusy)return;
    const context=services.getContext(),stamp=this.pageSession(),revision=(this._verificationRevision||0)+1;this._verificationRevision=revision;
    if(!context.authenticated){this.setData({paymentVerifications:[]});return;}
    try{const records=await services.getPaymentVerifications();if(this._verificationRevision===revision&&this.isCurrentSession(stamp))this.setData({paymentVerifications:records.map(record=>this.verificationRow(record)),verificationError:''});}
    catch(error){if(this._verificationRevision===revision&&this.isCurrentSession(stamp)){this.setData({paymentVerifications:[],verificationError:error.message});if(!services.getContext().authenticated)this.setData({authenticated:false,consentCurrent:false});}}
  },
  setVerification(record,resumeAllowed=false) { this.setData({paymentVerifications:this.data.paymentVerifications.map(row=>row.id===record.id?this.verificationRow(record,resumeAllowed):row)}); },
  disableVerification(id) { this.setData({paymentVerifications:this.data.paymentVerifications.map(row=>row.id===id?{...row,canStart:false,resumeAllowed:false}:row)}); },
  async payVerification(event) {
    if(this.data.busy)return;
    const id=event.currentTarget.dataset.id,record=this.data.paymentVerifications.find(row=>row.id===id);
    if(!this.data.authenticated||!this.data.consentCurrent){this.setData({verificationError:'请先同意当前正式用户协议与隐私政策。'});return;}
    if(!record?.canStart||record.amount!==1||record.currency!=='CNY'){this.setData({verificationError:'当前验收不能付款，请先查询最新状态。'});return;}
    this._verificationBusy=true;
    this._verificationRevision=(this._verificationRevision||0)+1;
    this.setData({busy:true,verificationError:'',verificationMessage:''});this.disableVerification(id);
    try{const result=await services.payPaymentVerification(id,{resume:record.resumeAllowed===true});this.setVerification(result.verification);this.setData({verificationMessage:result.message});}
    catch(error){this.disableVerification(id);this.setData({verificationError:error.message+' 请查询本次验收状态，不要重复付款。'});if(!services.getContext().authenticated)this.setData({authenticated:false,consentCurrent:false,paymentVerifications:[]});}
    finally{this._verificationBusy=false;this.setData({busy:false});}
  },
  async queryVerification(event) {
    if(this.data.busy)return;
    const id=event.currentTarget.dataset.id;if(!this.data.authenticated||!this.data.paymentVerifications.some(row=>row.id===id))return;
    this._verificationBusy=true;
    this._verificationRevision=(this._verificationRevision||0)+1;this.disableVerification(id);this.setData({busy:true,verificationError:'',verificationMessage:''});
    try{const result=await services.queryPaymentVerification(id);this.setVerification(result,true);this.setData({verificationMessage:result.manualReviewRequired?result.statusMessage:result.status==='SUCCEEDED'?'微信支付验收支付成功。':result.canPay&&['CREATING','PENDING'].includes(result.status)?'可以继续同一验收记录，沿用同一次付款；不会自动付款。':result.statusText});}
    catch(error){this.disableVerification(id);this.setData({verificationError:'查询未完成：'+error.message+' 结果尚未核实，请稍后重新查询。'});if(!services.getContext().authenticated)this.setData({authenticated:false,consentCurrent:false,paymentVerifications:[]});}
    finally{this._verificationBusy=false;this.setData({busy:false});}
  },
  hasCurrentConsentSession() {
    if (this._legalDocumentsSession && this.isCurrentSession(this._legalDocumentsSession)) return true;
    if (!this._disposed) this.setData({ termsAccepted: false, privacyAccepted: false, legalDocumentsReady: false, consentCurrent: false });
    return false;
  },
  consentSnapshot() {
    if (!this.hasCurrentConsentSession() || !this.data.legalDocumentsReady || !this.data.termsAccepted || !this.data.privacyAccepted || this.data.legalDocuments.length !== 2) throw new Error('请分别阅读并同意当前已发布的用户协议和隐私政策。');
    return this.data.legalDocuments.map(doc => ({ documentId: doc.id, version: doc.version }));
  },
  async acceptCurrentConsents() { if (this.data.busy) return; await this.run(async () => { await services.acceptConsents(this.consentSnapshot()); await this.refresh(); this.setData({ message: '当前版本协议同意已记录。' }); }); },
  callService() { wx.makePhoneCall({ phoneNumber: this.data.customerServiceTelephone, fail: error => { if (!/cancel/i.test(error.errMsg || '')) toastError(new Error('电话暂时无法拨打，请手动拨号。')); } }); },
  async verifyIdentity() {
    if (this.data.busy || this.data.identityVerified || this.data.readiness?.realNameStatus === 'VERIFIED') return;
    if (!this.data.consentCurrent || !this.data.identityAccepted) return toastError(new Error('请先更新一般协议同意，并单独选择本次实名信息处理同意。'));
    const privacy = this.data.legalDocuments.find(doc => doc.type === 'privacy');
    if (!privacy) return toastError(new Error('当前隐私政策尚不可用，请刷新后阅读。'));
    await this.run(async () => { await services.startESignVerification({ name: this.data.identityName.trim(), idCardNo: this.data.idCardNo.trim(), consent: { accepted: true, documentId: privacy.id, version: privacy.version } }); this.setData({ identityName: '', idCardNo: '', identityAccepted: false }); });
  },
  onIdentityConsent(event) { if (!this.data.busy) this.setData({ identityAccepted: event.detail.value.includes('identity') }); },
  async refreshIdentity() {
    if (this.data.busy || this._disposed) return;
    const stamp = this.pageSession(), lease = { stamp }, revision = this._identityRevision = (this._identityRevision || 0) + 1;
    this._identityQuery = lease; this.setData({ busy: true, error: '', message: '' });
    const current = () => this.isCurrentSession(stamp) && this._identityRevision === revision && this._identityQuery === lease;
    try { const readiness = await services.refreshESignReadiness(); if (!current()) return; this.applyReadiness(readiness); this.setData({ message: readiness.realNameStatus === 'VERIFIED' ? readiness.readyForSigning && readiness.certBound ? '已完成实名核验，签署证书已就绪。' : '已完成实名核验，签署证书尚待核验。' : '实名或证书仍未就绪，请查看准备状态。' }); }
    catch (error) { if (current()) { this.setData({ error: error.message }); toastError(error); } }
    finally { if (current()) this.setData({ busy: false }); if (this._identityQuery === lease) this._identityQuery = null; }
  },
  input(e) { const field = e.currentTarget.dataset.field; if (['mobile', 'code', 'identityName', 'idCardNo'].includes(field)) this.setData({ [field]: e.detail.value }); },
  consent(e) {
    if (this.data.busy || !this.hasCurrentConsentSession() || !this.data.legalDocumentsReady) return;
    const type = e.currentTarget?.dataset?.type;
    if (!['terms', 'privacy'].includes(type) || !Array.isArray(e.detail?.value)) return;
    this.setData({ [type === 'terms' ? 'termsAccepted' : 'privacyAccepted']: e.detail.value.includes(type) });
  },
  async phoneLogin(e) {
    if (this.data.busy) return;
    if (!e.detail.code) return toastError(new Error('手机号授权未完成，可使用短信验证码登录。'));
    await this.run(async () => { await services.loginWechat(e.detail.code, this.consentSnapshot()); await this.refresh(); this.setData({ message: '已登录。' }); });
  },
  async sendSms() {
    if (this.data.busy || this.data.cooldown) return;
    await this.run(async () => {
      this.consentSnapshot();
      await services.requestSms(this.data.mobile.trim()); this.setData({ cooldown: 60, message: '验证码已发送。' });
      this._cooldownTimer = setInterval(() => { this.setData({ cooldown: Math.max(0, this.data.cooldown - 1) }); if (!this.data.cooldown) clearInterval(this._cooldownTimer); }, 1000);
    });
  },
  async smsLogin() {
    if (this.data.busy) return;
    await this.run(async () => { await services.loginSms(this.data.mobile.trim(), this.data.code.trim(), this.consentSnapshot()); this.setData({ code: '', message: '已登录。' }); await this.refresh(); });
  },
  async logout() {
    if (this.data.busy) return;
    if (!(await confirm('退出当前账户？', '下次办理业务需重新登录。'))) return;
    await this.run(async () => { await services.logout(); await this.refresh(); this.setData({ message: '已退出。' }); });
  },
  async run(work) {
    this.setData({ busy: true, error: '', message: '' });
    try { await work(); } catch (error) { this.setData({ error: error.message }); toastError(error); }
    finally { this.setData({ busy: false }); }
  },
  clearCache() { services.clearSigningCache(); services.clearSigningState(); this.setData({ identityName: '', idCardNo: '', identityAccepted: false, message: '已清理实名与签署恢复缓存，业务记录由服务端保存。' }); },
  openLegal(e) { go('/pages/legal/index?type=' + e.currentTarget.dataset.type); },
  openProfile() { go('/pages/profile/index'); },
  openHome() { go('/pages/home/index'); },
  onUnload() { this._disposed = true; this._pageGeneration = (this._pageGeneration || 0) + 1; this._refreshRevision = (this._refreshRevision || 0) + 1; this._identityRevision = (this._identityRevision || 0) + 1; clearInterval(this._cooldownTimer); },
  onHide() { this.setData({ identityName: '', idCardNo: '', identityAccepted: false }); },
});
