const services = require('../../services/index');
const config = require('../../config');
const { confirm, go } = require('../../utils/page');
const {createLocationEditor,initialLocationData}=require('../../utils/handover-location');
const SLOTS=[{key:'identityFrontFileId',meta:'identityFront',label:'身份证人像面'},{key:'identityBackFileId',meta:'identityBack',label:'身份证国徽面'},{key:'drivingLicenseFileId',meta:'drivingLicense',label:'驾驶证'}];
// Only explicitly classified documents enter this page's editable state.
function classifiedProfile(profile) {
  if (!profile) return null;
  return {identity:profile.identity?.verified===true?{verified:true,locked:true,name:profile.identity.name,maskedIdCardNo:profile.identity.maskedIdCardNo,verifiedAt:profile.identity.verifiedAt}:profile.identity?.locked===true?{verified:false,locked:true}:null,revision:profile.revision,name:profile.name,mobile:profile.mobile,drivingYears:profile.drivingYears,readiness:profile.readiness,...Object.fromEntries(SLOTS.map(slot=>[slot.key,profile[slot.key]||null])),files:Object.fromEntries(SLOTS.map(slot=>[slot.meta,profile.files?.[slot.meta]||null]))};
}
Page({
  data: { ...initialLocationData(), loginMethod:'wechat', feedback:null, name:'', drivingYears:'', profileMobile:'', profileRevision:0, identityFrontFileId:null, identityBackFileId:null, drivingLicenseFileId:null, slots:SLOTS, profileFiles:{},  readiness:null, profileSaving:false, identityLocked:false, maskedIdCardNo:'',profileLoading:false, profileError:'', dirty:false, applicationId:'', reviewNote:'', note:'', choosing:false, identityVerified:false, identityBlocker:'', identityEnabled:false,identityPolicy:'PROVIDER_REQUIRED', identityAccepted:false, idCardNo:'', verifiedAt:'', authenticated: false, profile: null, busy: false, error: '', message: '', mobile: '', code: '', cooldown: 0, termsAccepted: false, privacyAccepted: false, legalDocumentsReady: false, legalDocuments: [], consentCurrent: false, customerServiceTelephone: config.customerServiceTelephone, identityStatusText: '状态待确认', identityLoading: false, identityError: false },
  updateFeedback(patch) {
    if (!this._hidden && !this._disposed && Object.prototype.hasOwnProperty.call(patch, 'authenticated')) wx.setNavigationBarTitle?.({ title: patch.authenticated ? '个人资料' : '登录账户' });
    const error=patch.error||patch.profileError;
    const message=error||patch.message;
    this.setData({...patch,...(message?{feedback:{kind:error?'error':'success',message:String(message)}}:{})});
  },
  showFeedback(message,kind='error') { if(!this._disposed&&message)this.setData({feedback:{kind,message:String(message)}}); },
  dismissFeedback() { this.setData({feedback:null}); },
  stopFeedbackTouch() {},
  onLoad(options={}) { this._disposed=false;this._hidden=false;this.locationEditor=createLocationEditor(this,services,wx,config.storageKey);this.applicationId=typeof options.applicationId==='string'?options.applicationId:'';this.returnSelection=options.vehicleId&&options.planId?{vehicleId:options.vehicleId,planId:options.planId}:null;this.updateFeedback({authenticated:services.getContext().authenticated,applicationId:this.applicationId,returnToApplication:!!this.returnSelection}); },
  onHide(){this._hidden=true;if(!this._keepDraftOnHide){this._pageGeneration=(this._pageGeneration||0)+1;if(this._pendingSave)this.updateFeedback({profileSaving:false,profileError:'本次保存结果尚未确认，返回后请重试保存。'});}if(!this._keepDraftOnHide)this.locationEditor?.hide();this._keepDraftOnHide=false;this.updateFeedback({idCardNo:''});},
  pageSession() { return { customerId: services.getContext().customer?.id || null, token: wx.getStorageSync?.(config.storageKey)?.token || null, generation: this._pageGeneration || 0 }; },
  isCurrentSession(stamp) { const current = this.pageSession(); return !this._disposed && stamp.customerId === current.customerId && stamp.token === current.token && stamp.generation === current.generation; },
  async recoverChangedSession(stamp) {
    // Refresh only while this page still represents the expired/changed session.
    // A late reply must not reset an already displayed new session or its work.
    if(!this._disposed&&!this.isCurrentSession(stamp)&&this._readinessSession?.customerId===stamp.customerId&&this._readinessSession?.token===stamp.token)await this.refresh();
  },
  applyReadiness(readiness) {
    const trusted=readiness?.verified===true&&readiness?.realNameStatus==='VERIFIED';
    const statuses = { NOT_STARTED: '未核验', STARTING: '核验中', PENDING: '核验中', FAILED: '核验失败', EXPIRED: '已过期' };
    const statusText=trusted?'已实名':readiness?.realNameStatus==='VERIFIED'?'需核对':typeof readiness?.realNameStatus==='string'&&Object.prototype.hasOwnProperty.call(statuses,readiness.realNameStatus)?statuses[readiness.realNameStatus]:'状态待确认';
    const blocker=trusted?'':typeof readiness?.blocker?.message==='string'?readiness.blocker.message:readiness?.realNameStatus==='VERIFIED'?'实名结果尚未核实，请核对资料或联系客服。':'';
    this.updateFeedback({identityVerified:this.data.profile?.identity?.verified===true||trusted,identityBlocker:blocker,verifiedAt:trusted?readiness.verifiedAt||'':'',...(trusted?{idCardNo:'',identityAccepted:false}:{}),identityStatusText:statusText,identityError:false});
  },
  onShow() { this._hidden=false;return this.refresh(); },
  async refresh() {
    if (this._disposed) return;
    const context = services.getContext(), stamp = this.pageSession(), revision = this._refreshRevision = (this._refreshRevision || 0) + 1;
    this._identityRevision = (this._identityRevision || 0) + 1;
    const current = () => this.isCurrentSession(stamp) && this._refreshRevision === revision;
    if (!this._readinessSession || this._readinessSession.customerId !== stamp.customerId || this._readinessSession.token !== stamp.token) { if(this._readinessSession?.customerId && this._readinessSession.customerId!==stamp.customerId)this.applicationId='';this._saveRunning=null;this._pendingSave=null;this._saveQueue=[];this._saveConflict=false;this._profileKey=null;this._amendKey=null;this._actionRevision=(this._actionRevision||0)+1;this.updateFeedback({ loginMethod:'wechat',feedback:null,applicationId:this.applicationId||'',note:'',reviewNote:'',choosing:false,profileLoading:false,busy:false,termsAccepted:false,privacyAccepted:false,message:'',name:'',drivingYears:'',profileMobile:'',identityFrontFileId:null,identityBackFileId:null,drivingLicenseFileId:null,profileFiles:{},readiness:null,dirty:false,idCardNo:'',identityAccepted:false,identityLocked:false,maskedIdCardNo:'',profileSaving:false,identityVerified:false,identityBlocker:'',identityEnabled:false,identityPolicy:'PROVIDER_REQUIRED' }); }
    this._readinessSession = stamp;
    this.updateFeedback({ authenticated: context.authenticated, profile: classifiedProfile(context.profile), error: '', legalDocumentsReady: false, identityStatusText: '状态待确认', identityLoading: context.authenticated, identityError: false, ...(!context.authenticated ? { consentCurrent: false } : {}) });
    try {
      const documents = await services.getLoginDocuments();
      if (!current()) return;
      if (documents.length !== 2 || documents.some((doc,index) => doc.type !== ['terms','privacy'][index] || !doc.id || !Number.isInteger(doc.version) || !doc.content)) throw new Error('当前已发布协议暂不可用，请稍后重试。');
      const changed = JSON.stringify(documents.map(doc => [doc.id,doc.version,doc.content])) !== JSON.stringify(this.data.legalDocuments.map(doc => [doc.id,doc.version,doc.content]));
      this._legalDocumentsSession = stamp;
      this.updateFeedback({ legalDocuments: documents, legalDocumentsReady: true, termsAccepted: changed ? false : this.data.termsAccepted, privacyAccepted: changed ? false : this.data.privacyAccepted, identityAccepted:changed?false:this.data.identityAccepted });
      if (!context.authenticated) return;
      const updated = await services.refreshContext();
      if (!current()) return;
      this.updateFeedback({ authenticated: updated.authenticated, profile: classifiedProfile(updated.profile), consentCurrent: documents.every(doc => updated.consents.some(consent => consent.documentId === doc.id && consent.version === doc.version)) });
      await this.refreshProfile();
      if (!current()) return;
      await this.refreshIdentity();
    } catch (error) {
      if (current()) this.updateFeedback({ error: error.message, identityLoading: false, authenticated: services.getContext().authenticated, ...(!this.data.legalDocumentsReady ? { legalDocuments: [], termsAccepted: false, privacyAccepted: false, consentCurrent: false } : {}) });
      else if (!this._disposed && this._refreshRevision === revision) { this.hasCurrentConsentSession(); this.updateFeedback({ authenticated: services.getContext().authenticated }); }
    } finally {
      // A 401 may clear storage inside an optional read; restore login without replaying that request.
      if (!this._disposed && this._refreshRevision === revision && !this.isCurrentSession(stamp)) await this.refresh();
    }
  },
  hasCurrentConsentSession() {
    if (this._legalDocumentsSession && this.isCurrentSession(this._legalDocumentsSession)) return true;
    if (!this._disposed) this.updateFeedback({ termsAccepted: false, privacyAccepted: false, legalDocumentsReady: false, consentCurrent: false });
    return false;
  },
  consentSnapshot() {
    if (!this.hasCurrentConsentSession() || !this.data.legalDocumentsReady || !this.data.termsAccepted || !this.data.privacyAccepted || this.data.legalDocuments.length !== 2) throw new Error('请分别阅读并同意当前已发布的用户协议和隐私政策。');
    return this.data.legalDocuments.map(doc => ({ documentId: doc.id, version: doc.version }));
  },
  async acceptCurrentConsents() { if (this.data.busy) return; await this.run(async current => { await services.acceptConsents(this.consentSnapshot()); if(!current())return;await this.refresh();if(current())this.updateFeedback({ message: '当前版本协议同意已记录。' }); }); },
  callService() { const stamp=this.pageSession();wx.makePhoneCall({ phoneNumber: this.data.customerServiceTelephone, fail: error => { if (this.isCurrentSession(stamp)&&!/cancel/i.test(error.errMsg || '')) this.showFeedback('电话暂时无法拨打，请手动拨号。'); } }); },
  async refreshIdentity() {
    if (this._disposed || !services.getContext().authenticated) return;
    if(this.data.identityPolicy==='MANUAL_REVIEW'){
      this.updateFeedback({identityVerified:false,identityEnabled:false,identityAccepted:false,idCardNo:'',verifiedAt:'',identityLoading:false,identityError:false,identityBlocker:'',identityStatusText:'未进行线上实名认证'});
      return;
    }
    const stamp = this.pageSession(), revision = this._identityRevision = (this._identityRevision || 0) + 1, refreshRevision = this._refreshRevision || 0;
    const current = () => this.isCurrentSession(stamp) && this._identityRevision === revision;
    this.updateFeedback({ identityLoading: true, identityError: false, identityStatusText: '状态待确认' });
    try { const readiness = await services.getESignReadiness(); if (current()) this.applyReadiness(readiness); if(current()&&!(readiness?.verified===true&&readiness?.realNameStatus==='VERIFIED')){try{const capability=await services.getSigningConfig('identity');if(current())this.updateFeedback({identityEnabled:capability.enabled&&capability.signProviderConfigured});}catch{if(current())this.updateFeedback({identityEnabled:false});}} }
    catch(error) { if (current()) { this.updateFeedback({ identityError: true, identityStatusText: '状态待确认' });this.showFeedback('实名状态暂时无法读取，请重试。'); } }
    finally {
      if (current()) this.updateFeedback({ identityLoading: false });
      else if (!this._disposed && this._identityRevision === revision && this._refreshRevision === refreshRevision && !services.getContext().authenticated) await this.refresh();
    }
  },
  input(e) { const field=e.currentTarget.dataset.field;if(this.data.busy||field==='name'&&this.data.identityLocked)return;if(['mobile','code','idCardNo'].includes(field))this.updateFeedback({[field]:e.detail.value});if(['name','drivingYears','note'].includes(field)){this._profileKey=null;this._amendKey=null;this.updateFeedback({[field]:e.detail.value,dirty:true,message:''});} },
  consent(e) {
    if (this.data.busy || !this.hasCurrentConsentSession() || !this.data.legalDocumentsReady) return;
    const type = e.currentTarget?.dataset?.type;
    if (!['terms', 'privacy'].includes(type) || !Array.isArray(e.detail?.value)) return;
    this.updateFeedback({ [type === 'terms' ? 'termsAccepted' : 'privacyAccepted']: e.detail.value.includes(type) });
  },
  async phoneLogin(e) {
    if (this.data.busy) return;
    if (!e.detail.code) return this.showFeedback('手机号授权未完成，可使用短信验证码登录。');
    await this.run(async () => { await services.loginWechat(e.detail.code, this.consentSnapshot());if(this._disposed)return;const stamp=this.pageSession();await this.refresh();if(this.isCurrentSession(stamp)&&services.getContext().authenticated)this.updateFeedback({message:'已登录。'}); });
  },
  selectLoginMethod(e) {
    if (this.data.busy || this.data.authenticated) return;
    const method=e.currentTarget?.dataset?.method;
    if(!['wechat','sms'].includes(method))return;
    this.setData({loginMethod:method,feedback:null,error:'',message:''});
  },
  loginConsent(e) {
    if(this.data.busy||!this.hasCurrentConsentSession()||!this.data.legalDocumentsReady||!Array.isArray(e.detail?.value))return;
    const accepted=e.detail.value.includes('agreements');
    this.updateFeedback({termsAccepted:accepted,privacyAccepted:accepted});
  },
  async sendSms() {
    if (this.data.busy || this.data.cooldown) return;
    await this.run(async current => {
      this.consentSnapshot();
      await services.requestSms(this.data.mobile.trim());if(!current())return;this.updateFeedback({ cooldown: 60, message: '验证码已发送。' });
      this._cooldownTimer = setInterval(() => { this.updateFeedback({ cooldown: Math.max(0, this.data.cooldown - 1) }); if (!this.data.cooldown) clearInterval(this._cooldownTimer); }, 1000);
    });
  },
  async smsLogin() {
    if (this.data.busy) return;
    await this.run(async () => { await services.loginSms(this.data.mobile.trim(),this.data.code.trim(),this.consentSnapshot());if(this._disposed)return;const stamp=this.pageSession();this.updateFeedback({code:''});await this.refresh();if(this.isCurrentSession(stamp)&&services.getContext().authenticated)this.updateFeedback({message:'已登录。'}); });
  },
  async logout() {
    if (this.data.busy) return;
    if (!(await confirm('退出当前账户？', '下次办理业务需重新登录。'))) return;
    await this.run(async () => { await services.logout();if(this._disposed)return;const stamp=this.pageSession();await this.refresh();if(this.isCurrentSession(stamp))this.updateFeedback({message:'已退出。'}); });
  },
  async run(work) {
    const stamp=this.pageSession(),revision=this._actionRevision=(this._actionRevision||0)+1;
    const current=()=>this.isCurrentSession(stamp)&&this._actionRevision===revision;
    this.updateFeedback({busy:true,error:'',message:'',feedback:null});
    try { await work(current); } catch(error) { if(current())this.updateFeedback({error:error.message}); }
    finally { if(current())this.updateFeedback({busy:false});else await this.recoverChangedSession(stamp); }
  },
  openFrozenDocument(document){try{const url=services.previewLegalDocument(document);this._keepDraftOnHide=true;go(url);}catch(error){this.showFeedback(error.message);}},
  openLegal(e) { this.openFrozenDocument(this.data.legalDocuments.find(d=>d.type===e.currentTarget.dataset.type)); },
  applyProfile(profile,force=false){
    profile=classifiedProfile(profile);
    const policy=profile.readiness?.identityPolicy===undefined?'PROVIDER_REQUIRED':profile.readiness.identityPolicy;
    if(!['MANUAL_REVIEW','PROVIDER_REQUIRED','SIGNING_REQUIRED'].includes(policy)){
      this._identityRevision=(this._identityRevision||0)+1;
      this.updateFeedback({identityPolicy:'UNKNOWN',identityEnabled:false,identityVerified:false,identityLoading:false,readiness:{readyForApplication:false,blockers:[{code:'IDENTITY_POLICY_UNKNOWN',message:'资料审核方式尚未核实，请刷新后重试。'}]},profileError:'资料审核方式尚未核实，请刷新后重试。'});return;
    }
    this.updateFeedback({identityLocked:profile.identity?.verified===true||profile.identity?.locked===true,maskedIdCardNo:profile.identity?.maskedIdCardNo||'',profile,readiness:profile.readiness,identityPolicy:policy,profileError:''});
    if(this.data.identityPolicy==='MANUAL_REVIEW'){
      this._identityRevision=(this._identityRevision||0)+1;
      this.updateFeedback({identityVerified:false,identityEnabled:false,identityAccepted:false,idCardNo:'',verifiedAt:'',identityLoading:false,identityError:false,identityBlocker:'',identityStatusText:'未进行线上实名认证'});
    }
    if(force||!this.data.dirty)this.updateFeedback({name:profile.name||'',drivingYears:profile.drivingYears==null?'':String(profile.drivingYears),profileMobile:profile.mobile||'',profileRevision:profile.revision,...Object.fromEntries(SLOTS.map(s=>[s.key,profile[s.key]||null])),profileFiles:profile.files,dirty:false});
  },
  async refreshProfile(){
    if(this._saveRunning||this._pendingSave)return;
    const stamp=this.pageSession(),revision=this._profileRevision=(this._profileRevision||0)+1;this.updateFeedback({profileLoading:true});
    try{const profile=await services.getProfile();if(!this.isCurrentSession(stamp)||revision!==this._profileRevision)return;this.applyProfile(profile);if(this.applicationId){const application=await services.getApplication(this.applicationId);if(!this.isCurrentSession(stamp))return;if(application.status!=='NEEDS_INFO')throw Error('当前申请无需补件，请返回原申请查看进度。');this.updateFeedback({reviewNote:application.note||''});await this.locationEditor?.load(application.profile?.handoverLocation??null);}}
    catch(e){if(this.isCurrentSession(stamp)&&revision===this._profileRevision)this.updateFeedback({profileError:e.message,readiness:null});}
    finally{if(this.isCurrentSession(stamp)&&revision===this._profileRevision)this.updateFeedback({profileLoading:false});}
  },
  async reloadProfile(){if((this.data.dirty||this._pendingSave||this._saveConflict)&&!await confirm('重新读取资料？','尚未保存的修改将被已保存资料替换。'))return;this._pendingSave=null;this._saveQueue=[];this._saveConflict=false;this.updateFeedback({dirty:false});return this.refreshProfile();},
  async commitProfileField(e){
    const field=e.currentTarget.dataset.field;if(!['name','drivingYears'].includes(field)||field==='name'&&this.data.identityLocked)return;
    const value=field==='name'?this.data.name.trim():Number(this.data.drivingYears);
    if(field==='name'?value.length>40:String(this.data.drivingYears).trim()===''||!Number.isInteger(value)||value<0||value>70){this.updateFeedback({profileError:'姓名不超过40字，驾龄请填写0–70年的整数。'});return;}
    return this.queueProfileSave({[field]:value});
  },
  async queueProfileSave(patch){
    this._saveQueue=this._saveQueue||[];this._saveQueue.push({patch,draft:{name:this.data.name,drivingYears:this.data.drivingYears}});
    if(this._saveConflict||this._pendingSave&&!this._saveRunning){this.updateFeedback({profileError:'上次保存尚未完成，请重试保存或重新读取资料。'});return false;}
    return this.flushProfileSaves();
  },
  async retryProfileSave(){return this.flushProfileSaves();},
  async flushProfileSaves(){
    if(this._saveRunning)return this._saveRunning;
    if(this._saveConflict)return false;
    const stamp=this.pageSession();
    const work=async()=>{
      this._profileRevision=(this._profileRevision||0)+1;this.updateFeedback({profileSaving:true,profileLoading:false,profileError:''});
      try{
        while(this._pendingSave||this._saveQueue?.length){
          if(!this.isCurrentSession(stamp))return false;
          if(!this._pendingSave){
            const entries=this._saveQueue.splice(0),patch={},draft={};for(const entry of entries)for(const field of Object.keys(entry.patch)){patch[field]=entry.patch[field];draft[field]=entry.draft[field];}const saved=this.data.profile;
            const body={revision:saved.revision,idempotencyKey:services.idempotencyKey('profile'),name:saved.identity?.verified?saved.identity.name:saved.name||'',drivingYears:saved.drivingYears??0,...Object.fromEntries(SLOTS.map(s=>[s.key,saved[s.key]||null])),...patch};
            if(Object.keys(patch).every(k=>(saved[k]??null)===(body[k]??null))){const normalized={};for(const field of ['name','drivingYears'])if(Object.hasOwn(patch,field)&&this.data[field]===draft[field])normalized[field]=String(body[field]);this.updateFeedback({...normalized,dirty:['name','drivingYears'].some(k=>String(normalized[k]??this.data[k])!==String(saved[k]??''))});continue;}
            this._pendingSave={body};
          }
          const pending=this._pendingSave,before={name:this.data.name,drivingYears:this.data.drivingYears};
          const result=await services.saveProfile(pending.body);
          if(!this.isCurrentSession(stamp))return false;
          this._pendingSave=null;const edits={};
          for(const field of ['name','drivingYears'])if(this.data[field]!==before[field]||String(this.data[field])!==String(pending.body[field]))edits[field]=this.data[field];
          this.applyProfile(result,true);this.updateFeedback({...edits,dirty:Object.keys(edits).some(k=>String(edits[k])!==String(result[k])),message:'资料已保存。'});this._amendKey=null;
        }
        return true;
      }catch(error){if(this.isCurrentSession(stamp)){if(error.statusCode===409){this._saveConflict=true;this._pendingSave=null;}this.updateFeedback({profileError:error.message+(error.statusCode===409?' 请重新读取资料后核对，未覆盖他人更新。':' 本次操作尚未确认保存，请重试保存。')});}return false;}
      finally{if(this.isCurrentSession(stamp))this.updateFeedback({profileSaving:false});else await this.recoverChangedSession(stamp);}
    };
    const running=work();this._saveRunning=running;try{return await running;}finally{if(this._saveRunning===running)this._saveRunning=null;}
  },
  async chooseDocument(e){
    const slot=SLOTS.find(s=>s.key===e.currentTarget.dataset.slot);if(!slot||this.data.busy||this.data.choosing||this.data.profileSaving||this._pendingSave||this._saveConflict)return;
    const stamp=this.pageSession();this.updateFeedback({choosing:true,profileError:''});
    try{this._keepDraftOnHide=true;const result=await new Promise((resolve,reject)=>wx.chooseMedia({count:1,mediaType:['image'],sourceType:['album','camera'],success:resolve,fail:reject}));if(!this.isCurrentSession(stamp))return;const file=await services.uploadFile(result.tempFiles?.[0],'identity');if(!this.isCurrentSession(stamp))return;await this.queueProfileSave({[slot.key]:file.id});}
    catch(error){if(this.isCurrentSession(stamp)&&!/cancel/i.test(error.errMsg||error.message||''))this.updateFeedback({profileError:error.message||'上传失败，请重试。'});}
    finally{if(this.isCurrentSession(stamp))this.updateFeedback({choosing:false});}
  },
  async removeDocument(e){const slot=SLOTS.find(s=>s.key===e.currentTarget.dataset.slot);if(!slot||this.data.busy||this.data.choosing||this.data.profileSaving||this._pendingSave||this._saveConflict)return;return this.queueProfileSave({[slot.key]:null});},
  async openAttachment(e){const stamp=this.pageSession(),id=e.currentTarget.dataset.id,file=SLOTS.map(s=>this.data.profileFiles[s.meta]).find(f=>f?.id===id);if(!file)return;try{this._keepDraftOnHide=true;await services.openPrivateFile(id,file.mimeType);}catch(error){if(this.isCurrentSession(stamp))this.showFeedback(error.message);}finally{await this.recoverChangedSession(stamp);}},
  async submit(){
    if(this.data.busy||this.data.choosing||this.data.profileLoading)return;
    const name=this.data.name.trim(),drivingYears=Number(this.data.drivingYears);if(name.length>40||String(this.data.drivingYears).trim()===''||!Number.isInteger(drivingYears)||drivingYears<0||drivingYears>70){this.updateFeedback({profileError:'姓名不超过40字，驾龄请填写0–70年的整数。'});return;}
    const stamp=this.pageSession();this.updateFeedback({busy:true,profileError:'',message:''});
    try{if(!await this.queueProfileSave({name,drivingYears}))return;if(!this.isCurrentSession(stamp))return;const result=this.data.profile;if(this.applicationId){await services.amendApplication(this.applicationId,{profile:{name:result.name,drivingYears:result.drivingYears,fileIds:SLOTS.map(s=>result[s.key]).filter(Boolean),...(this.locationEditor?.payload()!==undefined?{handoverLocation:this.locationEditor.payload()}:{})},note:this.data.note.trim(),idempotencyKey:this._amendKey||(this._amendKey=services.idempotencyKey('amend'))});if(!this.isCurrentSession(stamp))return;this._amendKey=null;go('/pages/application-detail/index?id='+encodeURIComponent(this.applicationId));}}
    catch(error){if(this.isCurrentSession(stamp))this.updateFeedback({profileError:error.message+(error.statusCode===409?' 输入已保留，请重新读取后核对。':'')});}
    finally{if(this.isCurrentSession(stamp))this.updateFeedback({busy:false});else await this.recoverChangedSession(stamp);}
  },
  onIdentityAccepted(e){if(!this.data.busy)this.updateFeedback({identityAccepted:e.detail.value.includes('identity')});},
  async verifyIdentity(){
    if(this.data.busy||this.data.identityLocked||this.data.identityVerified||!['PROVIDER_REQUIRED','SIGNING_REQUIRED'].includes(this.data.identityPolicy))return;
    if(this.data.profileSaving||this._pendingSave||this.data.dirty){this.updateFeedback({error:'请先完成姓名和驾龄输入，等待资料保存后办理实名。'});return;}
    const privacy=this.data.legalDocuments.find(d=>d.type==='privacy');if(!this.hasCurrentConsentSession()||!this.data.consentCurrent||!privacy||!this.data.identityAccepted){this.updateFeedback({error:'请阅读当前隐私政策，并单独同意实名核验。'});return;}
    const stamp=this.pageSession(),input={name:this.data.name,idCardNo:this.data.idCardNo.trim(),consent:{accepted:true,documentId:privacy.id,version:privacy.version}};
    this.updateFeedback({busy:true,error:'',idCardNo:''});try{await services.startESignVerification(input);}catch(e){if(this.isCurrentSession(stamp))this.updateFeedback({error:e.message});}finally{if(this.isCurrentSession(stamp))this.updateFeedback({busy:false});else await this.recoverChangedSession(stamp);}
  },
  async queryIdentity(){
    if(this.data.busy||!['PROVIDER_REQUIRED','SIGNING_REQUIRED'].includes(this.data.identityPolicy))return;
    const stamp=this.pageSession(),revision=this._identityRevision=(this._identityRevision||0)+1;
    const current=()=>this.isCurrentSession(stamp)&&this._identityRevision===revision&&['PROVIDER_REQUIRED','SIGNING_REQUIRED'].includes(this.data.identityPolicy);
    this.updateFeedback({busy:true});
    try{const result=await services.refreshESignReadiness();if(!current())return;this.applyReadiness(result);await this.refreshProfile();if(current())this.showFeedback(result?.verified===true&&result?.realNameStatus==='VERIFIED'?'实名核验已通过。':this.data.identityBlocker||'实名结果：'+this.data.identityStatusText+'。','info');}
    catch(e){if(current())this.updateFeedback({identityError:true,error:e.message});}
    finally{if(this.isCurrentSession(stamp))this.updateFeedback({busy:false});else await this.recoverChangedSession(stamp);}
  },
  continueApplication(){if(this.data.dirty||this.data.busy||!this.data.readiness?.readyForApplication)return;const selected=this.returnSelection;if(!selected)return;const previous=typeof getCurrentPages==='function'?getCurrentPages().slice(-2,-1)[0]:null;if(previous?.route==='pages/application/index'&&previous.vehicleId===selected.vehicleId&&previous.planId===selected.planId)wx.navigateBack({delta:1});else go('/pages/application/index?vehicleId='+encodeURIComponent(selected.vehicleId)+'&planId='+encodeURIComponent(selected.planId));},
  onLocationInput(e){this._amendKey=null;this.locationEditor?.input(e.currentTarget.dataset.field,e.detail.value);},onLocationAccepted(e){this._amendKey=null;this.locationEditor?.accept(e.detail.value.includes('location'));},toggleLocationNotice(){if(!this.data.locationNoticeOpen)this.locationEditor?.toggleNotice();this.openFrozenDocument(this.data.locationNotice);},async chooseLocation(){this._amendKey=null;const stamp=this.pageSession();await this.locationEditor?.choose();if(this.isCurrentSession(stamp)&&this.data.locationMessage)this.showFeedback(this.data.locationMessage,'info');},clearLocation(){this._amendKey=null;this.locationEditor?.clear();},
  onUnload() { this._disposed = true; this._pageGeneration = (this._pageGeneration || 0) + 1; this._refreshRevision = (this._refreshRevision || 0) + 1; this._identityRevision = (this._identityRevision || 0) + 1; clearInterval(this._cooldownTimer); this.locationEditor?.dispose();this.updateFeedback({idCardNo:'',identityAccepted:false}); },
});
