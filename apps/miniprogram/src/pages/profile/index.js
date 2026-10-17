const services = require('../../services/index');
const { load, toastError, go } = require('../../utils/page');
const { createLocationEditor, initialLocationData } = require('../../utils/handover-location');
const { storageKey } = require('../../config');
Page({
  data: { ...initialLocationData(), loading: true, error: '', name: '', mobile: '', drivingYears: '', note: '', applicationId: '', reviewNote: '', attachments: [], choosing: false, busy: false, message: '' },
  onLoad(options = {}) { this.locationEditor=createLocationEditor(this,services,wx,storageKey); this.applicationId = options.applicationId || ''; this.reload(); },
  onLocationInput(e) { this.locationEditor.input(e.currentTarget.dataset.field,e.detail.value); },
  onLocationAccepted(e) { this.locationEditor.accept(e.detail.value.includes('location')); },
  toggleLocationNotice() { this.locationEditor.toggleNotice(); },
  chooseLocation() { return this.locationEditor.choose(); },
  clearLocation() { this.locationEditor.clear(); },
  onHide() { this.locationEditor.hide(); },
  onUnload() { this._loadRevision=(this._loadRevision||0)+1;this.locationEditor.dispose(); },
  openLogin() { go('/pages/settings/index'); },
  onShow() { this.locationEditor?.sync(); },
  reload() {
    return load(this, async () => {
      const context = await services.refreshContext();
      const application = this.applicationId ? await services.getApplication(this.applicationId) : null;
      if (application && application.status !== 'NEEDS_INFO') throw new Error('申请当前无需补件，请返回申请详情查看最新状态。');
      const profile = application?.profile || context.profile || {};
      if (application) await this.locationEditor.load(profile.handoverLocation ?? null);
      return { name: profile.name || '', drivingYears: String(profile.drivingYears ?? ''), mobile: context.profile?.mobile || '', applicationId: this.applicationId, reviewNote: application?.note || '', attachments: (profile.fileIds || []).map((id,index) => ({ id, name: '资料附件 ' + (index + 1) })) };
    });
  },
  input(e) { const key = e.currentTarget.dataset.field; if (['name','drivingYears','note'].includes(key)) this.setData({ [key]: e.detail.value, message: '' }); },
  async chooseAttachments() {
    if (this.data.busy || this.data.choosing || this.data.attachments.length >= 4) return;
    this.setData({ choosing: true });
    try {
      const files = await new Promise((resolve,reject) => wx.chooseMedia({count:4-this.data.attachments.length,mediaType:['image'],sourceType:['album','camera'],success:resolve,fail:reject}));
      const uploaded = await Promise.all((files.tempFiles || []).map(file => services.uploadFile(file,'profile')));
      this.setData({ attachments: this.data.attachments.concat(uploaded) });
    } catch(error) { if (!/cancel/i.test(error.errMsg || error.message || '')) toastError(error); }
    finally { this.setData({ choosing: false }); }
  },
  removeAttachment(e) { if (!this.data.busy) this.setData({ attachments: this.data.attachments.filter((_,index) => index !== Number(e.currentTarget.dataset.index)) }); },
  async openAttachment(e) { const id=e.currentTarget.dataset.id; if(!this.data.attachments.some(file=>file.id===id))return; try { await services.openPrivateFile(id); } catch(error) { toastError(error); } },
  async submit() {
    if (this.data.busy || this.data.choosing || this.data.locationChoosing) return;
    if (!this.locationEditor.sync()) return toastError(new Error('登录账户已变化，请重新加载资料。'));
    const name=this.data.name.trim(),drivingYears=Number(this.data.drivingYears);
    if (!name || name.length > 30) return toastError(new Error('请填写不超过30字的姓名'));
    if (String(this.data.drivingYears).trim() === '' || !Number.isInteger(drivingYears) || drivingYears<0 || drivingYears>70) return toastError(new Error('驾龄请输入0–70的整数'));
    this.setData({ busy: true, message: '' });
    try {
      const selected=this.applicationId?this.locationEditor.payload():undefined;
      const profile={name,drivingYears,fileIds:this.data.attachments.map(file=>file.id),...(selected!==undefined?{handoverLocation:selected}:{})};
      if (this.applicationId) { await services.amendApplication(this.applicationId,{profile,note:this.data.note.trim(),idempotencyKey:this._submitKey || (this._submitKey=services.idempotencyKey('amend'))});this.setData({message:'补充资料已提交审核。'});go('/pages/application-detail/index?id='+encodeURIComponent(this.applicationId)); }
      else { await services.saveProfile(profile);this.setData({message:'资料已保存。'}); }
    } catch(error) { toastError(error); }
    finally { this.setData({ busy: false }); }
  },
});
