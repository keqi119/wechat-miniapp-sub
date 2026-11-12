const services = require('../../services/index');
const { load, go, toastError, confirm } = require('../../utils/page');
const { billDetails } = require('../../utils/offline-order');
const { contractOverview } = require('../../utils/customer-contract');
const TYPES = [
  'orders',
  'contracts',
  'bills',
  'payments',
  'deposits',
  'entitlements',
  'notifications',
  'services',
  'mileages',
  'orderchanges',
];
function beijingTime(value) {
  const time = typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ') + '（北京时间）' : '待核对';
}
function orderOverview(record, id) {
  const detail = record.orderDetail;
  const fallback = { available: false, id, status: record.status || '', statusText: record.statusText || '状态待核对', createdAtText: typeof record.createdAtText === 'string' && record.createdAtText ? record.createdAtText : beijingTime(record.createdAt) };
  const rowsValid = rows => Array.isArray(rows) && rows.every(row => typeof row?.label === 'string' && typeof row.value === 'string');
  const relatedValid = rows => Array.isArray(rows) && rows.every(row => row && ['id', 'title', 'status', 'statusText', 'description', 'dateText', 'amountText', 'url'].every(key => typeof row[key] === 'string') && Array.isArray(row.documents) && row.documents.every(file => file && ['id', 'title', 'url'].every(key => typeof file[key] === 'string')));
  if (record.id !== id || detail?.version !== 1 || detail.orderId !== id || detail.status !== record.status || typeof detail.statusText !== 'string' || typeof detail.createdAtText !== 'string' || typeof detail.vehicle?.title !== 'string' || typeof detail.guidance?.title !== 'string' || typeof detail.guidance?.description !== 'string' || !rowsValid(detail.summaryRows) || !detail.summaryRows.length || !Array.isArray(detail.sections) || !detail.sections.every(section => typeof section?.id === 'string' && typeof section.title === 'string' && rowsValid(section.rows)) || !['contracts', 'bills', 'handovers'].every(key => relatedValid(detail[key]))) return fallback;
  return { available: true, id, status: detail.status, statusText: detail.statusText, createdAtText: detail.createdAtText, vehicle: detail.vehicle, guidance: detail.guidance, summaryRows: detail.summaryRows, sections: detail.sections, hasExpandableTerms: detail.sections.some(section => section.collapsible), contracts: detail.contracts, bills: detail.bills, handovers: detail.handovers };
}
Page({
  openElectronicContracts() { const id = this.data.type === 'orders' ? this.data.id : this.orderId || this.data.change?.orderId || this.data.record?.orderId || (this.data.order ? this.data.id : ''); go('/pages/electronic-contracts/index' + (id ? '?orderId=' + encodeURIComponent(id) : '')); },
  data: { changeKind: '', renewalSharingAccepted: false, type: '', id: '', loading: true, error: '', record: null, busy: false, message: '', change: null, changeRead: false, changeError: '', changeRejectReason: '', order: null, showOrderTerms: false, contract: null },
  onLoad(options) {
    this.setData({ type: options.type || '', id: options.id || '', changeKind: options.kind === 'SUBSCRIPTION_EXTENSION' ? options.kind : '' });
    if (options.type === 'orders') wx.setNavigationBarTitle?.({ title: '订单详情' });
    if (options.type === 'contracts') wx.setNavigationBarTitle?.({ title: '合同详情' });
    this.reload();
  },
  reload() {
    this.setData({ changeRead: false, renewalSharingAccepted: false });
    const readStamp=this.data.type==='bills'?services.renewalSessionStamp():null;
    return load(this, async () => {
      if (!TYPES.includes(this.data.type) || !this.data.id)
        throw new Error('记录地址不完整，请从记录列表重新进入。');
      const record = await services.getRecord(this.data.type, this.data.id, {kind:this.data.changeKind});
      if(this.data.type==='bills')record.billDetails=billDetails(record);
      if(readStamp&&readStamp!==services.renewalSessionStamp())throw new Error('登录会话已变化，请重新读取本人记录。');
      if (record?.isRenewal) this._renewalSession = services.renewalSessionStamp();
      const empty = { change: null, order: null, contract: null };
      return this.data.type === 'orderchanges' ? { ...empty, record, change: record } : this.data.type === 'orders' ? { ...empty, record, order: orderOverview(record, this.data.id) } : this.data.type === 'contracts' ? { ...empty, record, contract: contractOverview(record, this.data.id) } : { ...empty, record };
    }, { clearOnError: ['record', 'change', 'order', 'contract'], onLoaded: result => {
      this._recordSession=readStamp;
      if(this.data.type==='contracts'&&result.record?.contractDetail?.executionMode==='ELECTRONIC'&&/^[-\w]+$/.test(result.record.contractDetail.orderId||'')){
        wx.redirectTo({url:'/pages/electronic-contracts/index?orderId='+encodeURIComponent(result.record.contractDetail.orderId)});return;
      }
      if (this.data.type === 'orders' && result.record?.contractMode === 'OFFLINE') {
        result.record = null; result.order = null; this.setData({ record: null, order: null });
        wx.redirectTo({ url: '/pages/order-detail/index?id=' + encodeURIComponent(this.data.id) });
      }
    } });
  },
  onShow() { if(this._legalReturn){const token=this._legalReturn;this._legalReturn=null;try{services.getLegalPreview(token);return;}catch(_){}} if (this.data.id) return this.reload(); },
  allowRenewalRead() {
    if(this.data.changeKind !== 'SUBSCRIPTION_EXTENSION') return true;
    if(this._disposed || this._renewalSession !== services.renewalSessionStamp()){this.setData({record:null,change:null,changeRead:false,renewalSharingAccepted:false,changeRejectReason:'',message:'',changeError:'登录会话已变化，请重新读取本人续期记录。'});return false;}return true;
  },
  openFrozenDocument(document) { if(!this.allowRenewalRead())return; try { const url=services.previewLegalDocument(document); this._legalReturn=url.split('preview=')[1];go(url); } catch(error){toastError(error);} },
  onUnload() { this._disposed = true; this._loadRevision = (this._loadRevision || 0) + 1; },
  async openDocument(e) {
    if (this.data.type === 'contracts') return this.openContractDocument(e);
    try { await services.openPrivateFile(e.currentTarget.dataset.id); } catch (error) { toastError(error); }
  },
  async act(e) {
    if (this.data.type === 'contracts') return this.contractAction(e);
    if (this.data.busy) return;
    const action = (this.data.record.actions || []).find(
      (item) => item.id === e.currentTarget.dataset.action,
    );
    if (!action) return;
    const identity=this._recordSession,recordId=this.data.id,recordType=this.data.type;
    const same=()=>!this._disposed&&(recordType!=='bills'||identity===services.renewalSessionStamp())&&this.data.id===recordId&&this.data.type===recordType;
    const clear=()=>this.setData({record:null,change:null,order:null,contract:null,message:'',error:'登录会话或记录已变化，请重新读取。'});
    if(!same()){clear();return;}
    this.setData({ busy: true, message: '' });
    try {
      const accepted = await confirm(
        action.label,
        action.id === 'pay' ? [this.data.record.billDetails?.reasonText,this.data.record.billDetails?.description,this.data.record.billDetails?.periodText,this.data.record.amountText,'即将发起微信支付，支付结果以服务端核验为准。'].filter(Boolean).join('\n') : action.id === 'sign' ? '即将打开本记录签署页面，请核对正式文档后自行签署，返回后查询服务端结果。' : '将提交当前操作，请确认。',
      );
      if (!accepted) return;
      if(!same()){clear();return;}
      const result = await services.performAction(this.data.type, this.data.id, action.id, {});
      if(!same()){clear();return;}
      this.setData({
        message: result.message || '操作已提交，请刷新查看最新状态。',
        record: result.record || this.data.record,
      });
      await this.reload();
    } catch (error) {
      if(!same()){clear();return;}
      if(action.id==='pay')await this.reload();
      toastError(error);
    } finally {
      this.setData({ busy: false });
    }
  },
  openChangeTerms() { this.openFrozenDocument(this.data.change?.quote?.document); },
  contractNotice(content) { wx.showModal({ title: '合同提示', content, showCancel: false, confirmText: '知道了' }); },
  async openContractDocument(event) {
    if (this.data.busy || this.data.type !== 'contracts') return;
    const contract = contractOverview(this.data.record, this.data.id);
    const id = event.currentTarget.dataset.id || contract.sourceFileId;
    if (!contract.available || !contract.documents.some(file => file.id === id)) return this.contractNotice('合同文件暂不可用，请重新加载后核对。');
    this.setData({ busy: true });
    try { const file=contract.documents.find(f=>f.id===id); if(contract.offline) await services.openOfflineArchiveFile(file.archiveId,file.versionId,id,/\.png$/i.test(file.title)?"image/png":/\.jpe?g$/i.test(file.title)?"image/jpeg":"application/pdf"); else await services.openPrivateFile(id); } catch (error) { if(error.statusCode===401)await this.reload();this.contractNotice(error.message || '合同文件暂时无法打开，请稍后重试。'); }
    finally { this.setData({ busy: false }); }
  },
  async contractAction(event) {
    if (this.data.busy || this.data.type !== 'contracts') return;
    const contract = contractOverview(this.data.record, this.data.id);
    const action = event.currentTarget.dataset.action;
    if (!contract.available || !contract.primaryAction || action !== contract.primaryAction.id) return this.contractNotice('当前合同不能执行此操作，请刷新核对进度。');
    if (action === 'query') return this.refreshContract();
    this.setData({ busy: true, message: '' });
    try {
      if (!(await confirm('签署合同', '请核对合同全文、车辆、出租方及冻结费用后自行签署。返回后请主动查询签署结果。'))) return;
      const result = await services.performAction('contracts', this.data.id, 'sign', {});
      await this.reload();
      this.contractNotice(result?.message || '签署页面已打开，请自行操作后返回查询结果。');
    } catch (error) { await this.reload(); this.contractNotice(error.message || '签署暂未完成，请先查询原交易结果。'); }
    finally { this.setData({ busy: false }); }
  },
  async refreshContract() {
    if (this.data.busy || this.data.type !== 'contracts') return;
    const contract = contractOverview(this.data.record, this.data.id);
    this.setData({ busy: true, message: '' });
    let queryError;
    try {
      if (contract.available && contract.canQuery) {
        try { await services.getSignStatus(this.data.id, 'contract'); } catch (error) { queryError = error; }
      }
      const result = await this.reload();
      this.contractNotice(queryError?.message || (result ? '已读取合同最新进度，请以页面显示的核实结果为准。' : this.data.error || '合同暂时无法读取，请稍后重试。'));
    } finally { this.setData({ busy: false }); }
  },
  openOfflineContract(){const contract=contractOverview(this.data.record,this.data.id);if(contract.offline)go('/pages/order-detail/index?id='+encodeURIComponent(contract.orderId)+(contract.archiveId?'&archiveId='+encodeURIComponent(contract.archiveId):''));},
  openList() {
    go('/pages/records/index?type=' + (TYPES.includes(this.data.type) ? this.data.type : 'orders') + (this.data.changeKind === 'SUBSCRIPTION_EXTENSION' ? '&kind=SUBSCRIPTION_EXTENSION' : ''));
  },
  openOrderUsage() { if (this.data.type === 'orders' && this.data.record) go('/pages/records/index?type=entitlements&orderId=' + encodeURIComponent(this.data.record.id)); },
  toggleOrderTerms() { this.setData({ showOrderTerms: !this.data.showOrderTerms }); },
  orderNotice(content) { wx.showModal({ title: '订单提示', content, showCancel: false, confirmText: '知道了' }); },
  orderRelated(group, id) { return ['contracts', 'bills', 'handovers'].includes(group) && this.data.order?.available ? this.data.order[group].find(item => item.id === id) : null; },
  openOrderRelated(event) {
    const { group, id } = event.currentTarget.dataset;
    const item = this.orderRelated(group, id);
    const expected = group === 'handovers' ? '/pages/handover/index?id=' + encodeURIComponent(id) : '/pages/record/index?type=' + group + '&id=' + encodeURIComponent(id);
    if (!item || item.url !== expected) return this.orderNotice('记录入口已更新，请重新加载订单后查看。');
    go(item.url);
  },
  async openOrderDocument(event) {
    if (this.data.busy) return;
    const { group, id, fileId } = event.currentTarget.dataset;
    const item = this.orderRelated(group, id);
    if (!Array.isArray(item?.documents) || !item.documents.some(file => file.id === fileId)) return this.orderNotice('文件入口已更新，请重新加载订单后查看。');
    this.setData({ busy: true });
    try { await services.openPrivateFile(fileId); } catch (error) { this.orderNotice(error.message || '文件暂时无法打开，请稍后重试。'); }
    finally { this.setData({ busy: false }); }
  },
  async refreshOrder() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try { const result = await this.reload(); this.orderNotice(result ? '已读取订单最新信息。' : (this.data.error || '订单暂时无法读取，请稍后重试。')); }
    finally { this.setData({ busy: false }); }
  },
  openOrderChanges() { go('/pages/records/index?type=orderchanges'); },
  openChangeHandover(event) { const id = event.currentTarget.dataset.id; if (id && [this.data.change?.returnHandover?.id, this.data.change?.deliveryHandover?.id].includes(id)) go('/pages/handover/index?id=' + encodeURIComponent(id)); },
  onChangeRead(e) { if (!this.data.busy) this.setData({ changeRead: e.detail.value.includes('change'), changeError: '' }); },
  inputChangeRejectReason(e) { if (!this.data.busy) this.setData({ changeRejectReason: e.detail.value }); },
  confirmChange() { return this.changeAction('confirm'); },
  rejectChange() { return this.changeAction('reject'); },
  signChange() { return this.changeAction('sign'); },
  syncChange() { return this.changeAction('sync'); },
  onRenewalSharing(event) { if (!this.data.busy) this.setData({renewalSharingAccepted:event.detail.value.includes('sharing'),changeError:''}); },
  openRenewalNotice() { this.openFrozenDocument(this.data.change?.quote?.sharingNotice); },
  async renewalAction(action) {
    if (this.data.busy || this.data.loading || !this.data.change?.isRenewal || !['confirm','reject'].includes(action)) return;
    const current=this.data.change, stamp=this._renewalSession;
    const same=()=>!this._disposed && this.data.id===current.id && stamp===services.renewalSessionStamp();
    const clear=()=>this.setData({record:null,change:null,changeRead:false,renewalSharingAccepted:false,changeRejectReason:'',message:'',changeError:'登录会话已变化，请重新读取本人续期记录。'});
    if (!same()) { clear(); return; }
    if (action==='confirm' && (!this.data.changeRead || !this.data.renewalSharingAccepted)) { this.setData({changeError:'请阅读本版本续期协议和实际出租方资料告知，并分别勾选确认。'}); return; }
    const q=current.quote, reason=this.data.changeRejectReason.trim();
    if(action==='reject'&&!reason){this.setData({changeError:'请填写拒绝本版本续期的原因。'});return;}
    const body=action==='confirm'?{revision:current.revision,quoteId:q?.id,quoteRevision:q?.revision,commercialHash:q?.commercialHash,bodyHash:q?.document.bodyHash,lessorHash:q?.lessorHash,noticeHash:q?.noticeHash,read:true,sharingAccepted:true}:{revision:current.revision,reason};
    this.setData({busy:true,changeError:'',message:''});
    try {
      if(!(await confirm(action==='confirm'?'确认本版本同车续期？':'拒绝本版本同车续期？',action==='confirm'?'请核对新增租期、逐期月费、原押金及实际出租方资料告知。确认后仍须协议签署归档、资金核清及到期生效；当前租期、里程和赠送不提前改变。':'只提交当前方案的拒绝意见，不自动退订或退款。')))return;
      if(!same()){clear();return;}
      await services[action==='confirm'?'confirmOrderRenewal':'rejectOrderRenewal'](current.id,body);
      if(!same()){clear();return;}
      const refreshed=await this.reload();if(!same()){clear();return;}
      this.setData({changeRejectReason:'',message:refreshed?(action==='confirm'?'本版本续期已确认，仍待协议归档、资金核清及正式办理，尚未生效。':'续期拒绝意见已提交。'):'操作已提交，详情暂时读取失败；请只刷新原续期记录核对，无需重复提交。'});
    }catch(error){if(!same()){clear();return;}await this.reload();if(!same()){clear();return;}this.setData({changeError:error.message,changeRead:false,renewalSharingAccepted:false,message:''});toastError(error);}
    finally{if(!this._disposed)this.setData({busy:false});}
  },
  async changeAction(action) {
    if (this.data.changeKind === 'SUBSCRIPTION_EXTENSION') return this.renewalAction(action);
    if (this.data.busy || !this.data.change) return;
    const current = this.data.change;
    if (action === 'confirm' && !this.data.changeRead) { this.setData({ changeError: '请完整阅读日期、逐期款项安排及正式补充条款，再勾选确认。' }); return; }
    if (action === 'reject' && !this.data.changeRejectReason.trim()) { this.setData({ changeError: '请填写拒绝当前方案的原因。' }); return; }
    this.setData({ busy: true, changeError: '', message: '' });
    try {
      if (action !== 'sync' && !(await confirm(action === 'confirm' ? (current.isSwap ? '确认本版本换车方案？' : '确认本版本延期方案？') : action === 'reject' ? '拒绝本版本方案？' : '签署本版本补充协议？', action === 'confirm' ? (current.isSwap ? '请核对两侧车辆、原期限与月界、逐项费用及旧车交还前资金门槛。确认后仍需补充签署和两侧真实交接，不代表换车已完成或次数已消费。' : '请核对新起止日期、原款沿用、补收及退款安排。确认后仍需正式签署与资金核对，不代表已经交车或方案已生效。') : action === 'reject' ? '此意见将提交运营处理，不会自动退订或退款。' : '即将打开本版本补充协议页面。请自行核对并签署，返回后查询真实结果；不代表换车或延期已生效。'))) return;
      const method = { confirm: 'confirmOrderChange', reject: 'rejectOrderChange', sign: 'signOrderChange', sync: 'syncOrderChange' }[action];
      await services[method](current.id, { revision: current.revision, commercialHash: current.quote?.commercialHash, read: this.data.changeRead, reason: this.data.changeRejectReason.trim() });
      const refreshed=await this.reload();
      if(!refreshed){this.setData({message:'操作已提交，详情暂时读取失败；请刷新真实流程状态核对，无需重复提交。'});return;}
      this.setData({ changeRejectReason: '', message: action === 'confirm' ? (current.isOffline ? '本版本已确认，待线下纸质签署、审核归档及财务核清；尚未交车或生效。' : '当前版本确认意见已提交，后续签署、资金及生效状态请查看服务端进度。') : action === 'reject' ? '拒绝意见已提交人工处理。' : action === 'sign' ? '签署页面已打开，请自行核对操作后返回查询。' : '已读取服务端最新进度；仅显示当前真实签署、资金和生效状态。' });
    } catch (error) { await this.reload(); this.setData({ changeError: error.message, changeRead: false, message: '' }); toastError(error); }
    finally { this.setData({ busy: false }); }
  },
  openChangeContract() { if(!this.allowRenewalRead())return; const c=this.data.change?.contract;if(this.data.change?.isElectronic)return this.openElectronicContracts();if(c?.id && this.data.change?.isOffline)go('/pages/record/index?type=contracts&id='+encodeURIComponent(c.id)); },
  openSwapSettlement(){const c=this.data.change;if(c?.factSettlementId)go('/pages/swap-settlement/index?id='+encodeURIComponent(c.factSettlementId)+'&changeId='+encodeURIComponent(c.id));},
  openChangeBill(e) { if (e.currentTarget.dataset.id) go('/pages/record/index?type=bills&id=' + encodeURIComponent(e.currentTarget.dataset.id)); },
});
