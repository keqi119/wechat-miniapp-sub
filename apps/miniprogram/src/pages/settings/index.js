const services = require('../../services/index');
const config = require('../../config');
const { toastError, confirm, go } = require('../../utils/page');
Page({
  data: { authenticated: false, profile: null, busy: false, error: '', message: '', mobile: '', code: '', cooldown: 0, accepted: false, legalDocuments: [], consentCurrent: false, customerServiceTelephone: config.customerServiceTelephone, readiness: null, paymentVerifications: [], verificationError: '', verificationMessage: '' },
  onShow() { this.refresh(); },
  async refresh() {
    const context = services.getContext();
    this.setData({ authenticated: context.authenticated, profile: context.profile, error: '', ...(!context.authenticated ? { paymentVerifications: [], verificationError: '', verificationMessage: '', consentCurrent: false } : {}) });
    try {
      const documents = await services.getLoginDocuments();
      if (documents.length !== 2 || documents.some((doc,index) => doc.type !== ['terms','privacy'][index] || !doc.id || !Number.isInteger(doc.version) || !doc.content)) throw new Error('当前已发布协议暂不可用，请稍后重试。');
      const changed = JSON.stringify(documents.map(doc => [doc.id,doc.version])) !== JSON.stringify(this.data.legalDocuments.map(doc => [doc.id,doc.version]));
      this.setData({ legalDocuments: documents, accepted: changed ? false : this.data.accepted });
      if (!context.authenticated) return;
      const updated = await services.refreshContext();
      this.setData({ authenticated: updated.authenticated, profile: updated.profile, consentCurrent: documents.every(doc => updated.consents.some(consent => consent.documentId === doc.id && consent.version === doc.version)) });
      await this.refreshPaymentVerifications();
      const readiness = await services.getESignReadiness(); this.setData({ readiness });
    } catch (error) { this.setData({ error: error.message, authenticated: services.getContext().authenticated }); }
  },
  verificationRow(record,resumeAllowed=false) {
    const active=Number.isFinite(Date.parse(record.expiresAt))&&Date.parse(record.expiresAt)>Date.now();
    const permitted=record.canPay===true&&record.amount===1&&record.currency==='CNY'&&active&&['AUTHORIZED','CREATING','PENDING'].includes(record.status);
    return {...record,resumeAllowed:permitted&&resumeAllowed&&record.status!=='AUTHORIZED',canStart:permitted&&(record.status==='AUTHORIZED'||resumeAllowed),payText:record.status==='AUTHORIZED'?'支付 0.01 元':'继续本次验收（0.01 元）'};
  },
  async refreshPaymentVerifications() {
    if(this._verificationBusy)return;
    const context=services.getContext(),revision=(this._verificationRevision||0)+1;this._verificationRevision=revision;
    if(!context.authenticated){this.setData({paymentVerifications:[]});return;}
    try{const records=await services.getPaymentVerifications();if(this._verificationRevision===revision&&services.getContext().customer?.id===context.customer.id)this.setData({paymentVerifications:records.map(record=>this.verificationRow(record)),verificationError:''});}
    catch(error){if(this._verificationRevision===revision){this.setData({paymentVerifications:[],verificationError:error.message});if(!services.getContext().authenticated)this.setData({authenticated:false,consentCurrent:false});}}
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
  consentSnapshot() {
    if (!this.data.accepted || this.data.legalDocuments.length !== 2) throw new Error('请阅读并同意当前已发布的用户协议和隐私政策。');
    return this.data.legalDocuments.map(doc => ({ documentId: doc.id, version: doc.version }));
  },
  async acceptCurrentConsents() { await this.run(async () => { await services.acceptConsents(this.consentSnapshot()); await this.refresh(); this.setData({ message: '当前版本协议同意已记录。' }); }); },
  callService() { wx.makePhoneCall({ phoneNumber: this.data.customerServiceTelephone, fail: error => { if (!/cancel/i.test(error.errMsg || '')) toastError(new Error('电话暂时无法拨打，请手动拨号。')); } }); },
  async verifyIdentity() {
    if (this.data.busy) return;
    await this.run(async () => { await services.startESignVerification(); });
  },
  async refreshIdentity() { await this.run(async () => { const readiness = await services.refreshESignReadiness(); this.setData({ readiness, message: readiness.readyForSigning ? '供应商已确认实名与证书就绪。' : '实名或证书仍未就绪，请查看准备状态。' }); }); },
  input(e) { const field = e.currentTarget.dataset.field; if (['mobile', 'code'].includes(field)) this.setData({ [field]: e.detail.value }); },
  consent(e) { this.setData({ accepted: e.detail.value.includes('accepted') }); },
  async phoneLogin(e) {
    if (this.data.busy) return;
    if (!this.data.accepted) return toastError(new Error('请先阅读并同意用户协议和隐私政策。'));
    if (!e.detail.code) return toastError(new Error('手机号授权未完成，可使用短信验证码登录。'));
    await this.run(async () => { await services.loginWechat(e.detail.code, this.consentSnapshot()); await this.refresh(); this.setData({ message: '已登录。' }); });
  },
  async sendSms() {
    if (this.data.busy || this.data.cooldown) return;
    if (!this.data.accepted) return toastError(new Error('请先阅读并同意用户协议和隐私政策。'));
    await this.run(async () => {
      await services.requestSms(this.data.mobile.trim()); this.setData({ cooldown: 60, message: '验证码已发送。' });
      this._cooldownTimer = setInterval(() => { this.setData({ cooldown: Math.max(0, this.data.cooldown - 1) }); if (!this.data.cooldown) clearInterval(this._cooldownTimer); }, 1000);
    });
  },
  async smsLogin() {
    if (this.data.busy) return;
    if (!this.data.accepted) return toastError(new Error('请先阅读并同意用户协议和隐私政策。'));
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
  clearCache() { services.clearSigningCache(); this.setData({ message: '已清理签约指引恢复缓存，业务记录由服务端保存。' }); },
  openLegal(e) { go('/pages/legal/index?type=' + e.currentTarget.dataset.type); },
  openProfile() { go('/pages/profile/index'); },
  openHome() { go('/pages/home/index'); },
  onUnload() { clearInterval(this._cooldownTimer); },
});
