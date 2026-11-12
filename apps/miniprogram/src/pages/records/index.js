const services = require('../../services/index');
const { load, go, toastError, confirm } = require('../../utils/page');
const config = require('../../config');
function addonPage(services,go){
  function identity(){const c=services.getContext();return services.getAddonViewIdentity?services.getAddonViewIdentity():JSON.stringify([c.customer?.id,c.expiresAt,c.mode,c.customer?.role,c.authenticated]);}
  function stamp(page){return{revision:page._addonRevision||0,identity:identity(),orderId:page.orderId,kind:page.data.addonKind,target:page.data.addonTargetId};}
  function current(page,s){if(page._disposed||page._addonHidden||page._addonRevision!==s.revision||page.orderId!==s.orderId||page.data.addonKind!==s.kind||page.data.addonTargetId!==s.target)return false;if(identity()!==s.identity){page.setData({addonCatalog:null,addonSelected:null,addonAccepted:false,addonSheet:false,addonPending:null,addonReceipt:null,addonTargetId:'',addonTargetIndex:-1,addonNotice:'',addonReceiptUnverified:false,addonError:'登录会话已变化，请重新登录后核对本人订单。',loading:false,busy:false});return false;}return true;}
  return{
    addonInitial:{addonKind:'MILEAGE_PACK',addonCatalog:null,addonSelected:null,addonAccepted:false,addonSheet:false,addonTargetId:'',addonTargetIndex:-1,addonPending:null,addonReceipt:null,addonNotice:'',addonError:'',addonAccessDenied:false,addonReceiptUnverified:false},
    addonAccessError(e){return[403,404].includes(e?.statusCode)||['FORBIDDEN','NOT_FOUND','ADDON_ACCESS_REVOKED'].includes(e?.code);},
    clearAddonAccess(e){this._addonRevision=(this._addonRevision||0)+1;this.setData({addonCatalog:null,addonPending:null,addonReceipt:null,addonSelected:null,addonSheet:false,addonAccepted:false,addonTargetId:'',addonTargetIndex:-1,addonNotice:'',addonAccessDenied:true,addonReceiptUnverified:false,addonError:e?.message||'原订单访问已失效，请重新读取本人订单。',loading:false,busy:false});},
    addonHide(){this._addonHidden=true;this._addonRevision=(this._addonRevision||0)+1;if(this.data.type==='addons')this.setData({addonAccepted:false,addonSheet:false,addonSelected:null,busy:false});},
    async reloadAddon(){
      this._addonHidden=false;this._addonRevision=(this._addonRevision||0)+1;const s=stamp(this),changed=this._addonIdentity&&this._addonIdentity!==s.identity,previous=this.data.addonCatalog;this._addonIdentity=s.identity;
      this.setData({loading:!previous||!!changed,error:'',addonError:'',addonAccepted:false,addonSheet:false,addonSelected:null,busy:false,...(changed?{addonCatalog:null,addonReceipt:null,addonPending:null,addonTargetId:'',addonTargetIndex:-1,addonNotice:''}:{})});
      // Resolve an explicit owned order first. A stale default order never authorizes another order.
      if(changed){s.target='';}
      try{
        if(!this.orderId){const dashboard=await services.getDashboard();if(!current(this,s))return;const id=dashboard.subscription?.orderId||dashboard.subscription?.id;if(!id)throw new Error('暂无正在履行的主套餐订单，暂不可加购。');this.orderId=id;s.orderId=id;}
        const pending=services.getAddonPurchaseState(this.orderId,this.data.addonKind);if(current(this,s))this.setData({addonPending:pending,addonReceipt:pending?.receipt||null,addonReceiptUnverified:!!pending?.receipt});
        const c=await services.getAddonProducts(this.orderId,this.data.addonKind,this.data.addonTargetId);if(!current(this,s))return;
        const changedQuote=previous&&JSON.stringify([previous.context,previous.terms,previous.quotes])!==JSON.stringify([c.context,c.terms,c.quotes]);
        this.setData({addonCatalog:c,addonTargetIndex:c.targetModels?.findIndex(m=>m.id===this.data.addonTargetId)??-1,loading:false,addonAccessDenied:false,addonNotice:changedQuote?'价格、适用范围、期限或功能说明已更新，请重新核对并主动勾选。':this.data.addonNotice});
        if(pending?.state==='COMMITTED')await this.recoverAddon(true);
      }catch(e){if(!current(this,s))return;if(this.addonAccessError(e)){this.clearAddonAccess(e);return;}this.setData({loading:false,addonCatalog:null,addonSelected:null,addonAccepted:false,addonError:e.message||'加购资料暂不可用，请重试。'});}
    },
    selectAddonQuote(event){if(this.data.busy||this.data.addonPending)return;const selected=this.data.addonCatalog?.quotes.find(q=>q.key===event.currentTarget.dataset.key)||null;this.setData({addonSelected:selected,addonAccepted:false,addonError:'',addonSheet:!!selected});},
    chooseAddonTarget(event){if(this.data.busy||this.data.addonPending)return;const index=Number(event.detail.value),model=this.data.addonCatalog?.targetModels[index];if(!model)return;this.setData({addonTargetId:model.id,addonTargetIndex:index,addonSelected:null,addonAccepted:false,addonSheet:false});return this.reloadAddon();},
    onAddonAccepted(event){if(!this.data.busy)this.setData({addonAccepted:event.detail.value.includes('addon')});},
    closeAddonSheet(){if(!this.data.busy)this.setData({addonSheet:false,addonAccepted:false});},
    async submitAddon(){
      const c=this.data.addonCatalog,q=this.data.addonSelected;if(this.data.busy||!c?.canPurchase||!q||!this.data.addonAccepted||this.data.addonPending)return;
      const s=stamp(this);this.setData({busy:true,addonError:'',addonNotice:''});
      try{const receipt=await services.createAddonPurchase(this.orderId,this.data.addonKind,{productId:q.productId,versionId:q.versionId,quoteId:q.quoteId,sourceHash:q.sourceHash,termsVersion:c.terms.version,termsHash:c.terms.hash,accepted:true,...(this.data.addonKind==='MILEAGE_PACK'?{periodId:c.context.periodId}:{targetModelDefinitionId:this.data.addonTargetId})});if(!current(this,s))return;this.setData({addonReceipt:receipt,addonReceiptUnverified:false,addonPending:services.getAddonPurchaseState(this.orderId,this.data.addonKind),addonSheet:false,addonSelected:null,addonAccepted:false,addonNotice:'原购买账单已核实。创建账单不会付款或发放权益，请到原账单核对支付及到账状态。'});
      }catch(e){if(!current(this,s))return;if(this.addonAccessError(e)){this.clearAddonAccess(e);return;}const pending=services.getAddonPurchaseState(this.orderId,this.data.addonKind);this.setData({addonPending:pending,addonReceipt:pending?.receipt||null,addonAccepted:false,addonSheet:false,addonSelected:null,addonError:e.message+(pending?' 请继续核对原购买结果，不要另建账单。':'')});if(!pending){const message=this.data.addonError;await this.reloadAddon();if(current(this,{...s,revision:this._addonRevision}))this.setData({addonError:message,addonNotice:'请重新核对当前报价和功能说明，再主动勾选。'});}}
      finally{if(current(this,s))this.setData({busy:false});}
    },
    async recoverAddon(quiet=false){if(this.data.busy)return;const s=stamp(this);this.setData({busy:true,addonAccepted:false,addonError:'',addonReceiptUnverified:!!this.data.addonReceipt});try{const receipt=await services.recoverAddonPurchase(this.orderId,this.data.addonKind);if(current(this,s))this.setData({addonReceipt:receipt,addonReceiptUnverified:false,addonPending:services.getAddonPurchaseState(this.orderId,this.data.addonKind),addonNotice:quiet?this.data.addonNotice:'已回读原购买。支付到账与是否可用以原记录为准。'});}catch(e){if(!current(this,s))return;if(this.addonAccessError(e)){this.clearAddonAccess(e);return;}this.setData({addonReceiptUnverified:true,addonPending:services.getAddonPurchaseState(this.orderId,this.data.addonKind),addonError:'原购买结果尚待核实：'+e.message+'，请继续查询原记录或联系人工。'});}finally{if(current(this,s))this.setData({busy:false});}},
    startAnotherAddon(){if(this.data.busy)return;try{services.finishAddonPurchase(this.orderId,this.data.addonKind);this.setData({addonPending:null,addonReceipt:null,addonNotice:'请核对原购买与账单后，再选择另一笔加购。'});return this.reloadAddon();}catch(e){this.setData({addonError:e.message});}},
    openAddonBill(){const receipt=this.data.addonReceipt;if(!receipt||this._addonIdentity!==identity())return;const pending=services.getAddonPurchaseState(this.orderId,this.data.addonKind);if(pending?.receipt?.bill.id!==receipt.bill.id){this.clearAddonAccess();return;}go('/pages/record/index?type=bills&id='+encodeURIComponent(receipt.bill.id));},
    openAddonHistory(){wx.redirectTo({url:'/pages/records/index?type=entitlements&orderId='+encodeURIComponent(this.orderId)});},
  };
}


const addons=addonPage(services,go);
const TITLES = {
  orders: '订阅与订单',
  contracts: '合同文件',
  bills: '账单',
  payments: '支付记录',
  deposits: '押金流水',
  entitlements: '权益明细',
  notifications: '消息通知',
  services: '服务记录',
  mileages: '里程复核',
  orderchanges: '订阅变更方案',
};
Page({
  openElectronicContracts() { const id = this.data.type === 'orders' ? this.data.id : this.orderId || (this.data.order ? this.data.id : ''); go('/pages/electronic-contracts/index' + (id ? '?orderId=' + encodeURIComponent(id) : '')); },
  ...addons,
  reloadAddon(event) { return addons.reloadAddon.call(this, event); },
  selectAddonQuote(event) { return addons.selectAddonQuote.call(this, event); },
  chooseAddonTarget(event) { return addons.chooseAddonTarget.call(this, event); },
  onAddonAccepted(event) { return addons.onAddonAccepted.call(this, event); },
  closeAddonSheet(event) { return addons.closeAddonSheet.call(this, event); },
  submitAddon(event) { return addons.submitAddon.call(this, event); },
  recoverAddon(event) { return addons.recoverAddon.call(this, event === true); },
  startAnotherAddon(event) { return addons.startAnotherAddon.call(this, event); },
  openAddonBill(event) { return addons.openAddonBill.call(this, event); },
  openAddonHistory(event) { return addons.openAddonHistory.call(this, event); },

  data: { ...addons.addonInitial, changeKind: '', renewalPage: 1, renewalTotal: 0, renewalHasNext: false, type: '', title: '记录', loading: true, error: '', items: [], usage: null, usageError: '', swap: null, offlineSwap: false, swapModeMismatch: false, swapError: '', swapReason: '', swapMessage: '', swapPurchaseAccepted: false, swapPurchase: null, swapPurchaseError: '', swapPurchaseMessage: '', settlement: null, settlementError: '', selectedProductId: '', selectedProduct: null, purchaseAccepted: false, purchase: null, busy: false, purchaseError: '', usageMessage: '', disputeReason: '' },
  onLoad(options) {
    const type = options.type || 'orders';
    if(type==='addons'){this.setData({addonKind:options.kind==='SWAP_CREDIT'?'SWAP_CREDIT':'MILEAGE_PACK'});}
    this.orderId = options.orderId || '';
    this.setData({ type, changeKind: options.kind === 'SUBSCRIPTION_EXTENSION' ? options.kind : '', title: type==='addons' ? (this.data.addonKind==='MILEAGE_PACK'?'里程包':'换车权益') : TITLES[type] || '记录' });
    wx.setNavigationBarTitle({ title: this.data.title });
  },
  onShow() { if(this._legalReturn){const token=this._legalReturn;this._legalReturn=null;try{services.getLegalPreview(token);return;}catch(_){}} return this.reload(); },
  openFrozenDocument(document) { try { const url=services.previewLegalDocument(document); this._legalReturn=url.split('preview=')[1];go(url); } catch(error){toastError(error);} },
  onHide() { this.addonHide(); },
  onUnload() { this.addonHide(); this._disposed = true; this._loadRevision = (this._loadRevision || 0) + 1; },
  reload() {
    if(this.data.type==='addons')return this.reloadAddon();
    this.setData({ purchaseAccepted: false, swapPurchaseAccepted: false });
    return load(this, async () => {
      if (!TITLES[this.data.type]) throw new Error('无法识别记录类型，请从“我的”重新进入。');
      const kind = this.data.changeKind, requestedPage = this.data.renewalPage;
      const renewalList = this.data.type === 'orderchanges' && kind === 'SUBSCRIPTION_EXTENSION' ? await services.getOrderRenewals({page:requestedPage,pageSize:12,...(this.orderId?{orderId:this.orderId}:{})}) : null;
      const items = renewalList ? renewalList.items : await services.getRecords(this.data.type);
      if (renewalList) return {items, renewalTotal:renewalList.total, renewalHasNext:requestedPage*12<renewalList.total};
      const empty = { usage: null, swap: null, offlineSwap: false, swapModeMismatch: false, swapError: '', settlement: null, usageError: '', settlementError: '', selectedProductId: '', selectedProduct: null };
      if (this.data.type !== 'entitlements') return { items, ...empty };
      try {
        const current = this.orderId ? null : (await services.getDashboard()).subscription;
        const id = this.orderId || current?.orderId || current?.id;
        if (!id) return { items, ...empty };
        this.resolvedOrderId = id;
        const [usageResult, swapResult] = await Promise.allSettled([services.getUsageAccount(id), services.getSwapAccount(id)]);
        const usage = usageResult.status === 'fulfilled' ? usageResult.value : null;
        const swap = swapResult.status === 'fulfilled' ? swapResult.value : null;
        const offlineSwap = current?.contractMode === 'OFFLINE' || swap?.contractMode === 'OFFLINE';
        const swapModeMismatch = !!(current?.contractMode && swap && current.contractMode !== swap.contractMode);
        if(swapModeMismatch){swap.canRequest=false;swap.canPurchase=false;swap.blockers=['本单签署模式与账户资料不一致，请重新核对'];}
        let settlement = null, settlementError = '';
        if (usage?.returnSettlement) { try { settlement = await services.getReturnSettlement(usage.returnSettlement.id, id); } catch (error) { settlementError = error.message; } }
        const selectedProduct = usage?.products.find(row => row.id === this.data.selectedProductId) || null;
        return { items, usage, swap, offlineSwap, swapModeMismatch, selectedProductId: selectedProduct?.id || '', selectedProduct, usageError: usageResult.status === 'rejected' ? usageResult.reason.message : '', swapError: swapResult.status === 'rejected' ? swapResult.reason.message : '', settlement, settlementError };
      } catch (error) { return { items, ...empty, usageError: error.message }; }
    }, { clearOnError: ['usage', 'swap', 'settlement', 'selectedProduct', ...(this.data.changeKind === 'SUBSCRIPTION_EXTENSION' ? ['items'] : [])] }).then(result => { if (!this._disposed && this.data.changeKind === 'SUBSCRIPTION_EXTENSION' && this.data.items === null) this.setData({items:[]}); return result; });
  },
  inputSwapReason(event) { if (!this.data.busy) this.setData({ swapReason: event.detail.value, swapError: '' }); },
  async requestSwap() {
    if (this.data.loading || this.data.busy || this.data.swapModeMismatch || !this.data.swap?.canRequest) return;
    if (!this.data.swapReason.trim()) { this.setData({ swapError: '请填写真实换车原因，运营将据此联系并出具逐单报价。' }); return; }
    this.setData({ busy: true, swapError: '', swapMessage: '' });
    try {
      if (!(await confirm('提交换车申请？', '这里只提交申请，不扣次数、不付款。后续需完整报价确认、补充协议签署、资金核对及两侧真实交接；原订阅期限和里程月不重置。'))) return;
      const result = await services.requestVehicleChange(this.data.swap.orderId, { reason: this.data.swapReason.trim() });
      this.setData({ swapReason: '', swapMessage: result.message });
      await this.reload(); go('/pages/record/index?type=orderchanges&id=' + encodeURIComponent(result.id));
    } catch (error) { await this.reload(); this.setData({ swapError: error.message + ' 请查询已有变更记录，不要反复申请。', swapMessage: '' }); }
    finally { this.setData({ busy: false }); }
  },
  openSwapChange(event) { const id = event.currentTarget.dataset.id; if (id) go('/pages/record/index?type=orderchanges&id=' + encodeURIComponent(id)); },
  openAllChanges() { go('/pages/records/index?type=orderchanges'); },
  onSwapPurchaseAccepted(event) { if (!this.data.busy) this.setData({ swapPurchaseAccepted: event.detail.value.includes('swap-purchase'), swapPurchaseError: '' }); },
  async buySwapCredit() {
    if (this.data.loading || this.data.busy || this.data.swapModeMismatch) return;
    const account = this.data.swap, terms = account?.purchaseTerms;
    if (!account?.canPurchase || !terms || !this.data.swapPurchaseAccepted) { this.setData({ swapPurchaseError: '请核对本订单、显示的单次金额，并单独勾选当前完整购买说明。' }); return; }
    const owner = services.getContext().customer?.id, orderId = account.orderId;
    this.setData({ busy: true, swapPurchaseError: '', swapPurchaseMessage: '' });
    try {
      if (!(await confirm('创建' + account.product.amountLabel + '换车次数账单？', '本订单一次换车权益，金额' + account.product.amountLabel + '；'+(account.term?'有效期与退款依本笔已阅读的购买说明，续期不延长原付费次数。':'仅本订阅期有效，退订或到期未使用也失效且费用不退，例外依法处理。')+'只创建普通账单，不会自动付款或发放次数。'))) return;
      if (services.getContext().customer?.id !== owner) throw new Error('登录账户已变化，请重新进入本人订单。');
      const result = await services.createSwapCredit(orderId, { productId: account.product.id, ...(account.product.policyVersion === 'SWAP_TERM_V2' ? { pricingHash: account.product.pricingHash } : {}), termsVersion: terms.version, termsDocumentId: terms.documentId, termsDocumentVersion: terms.documentVersion, termsHash: terms.hash, accepted: true });
      await this.reload();
      if (services.getContext().customer?.id !== owner || this.resolvedOrderId !== orderId) return;
      this._swapPurchaseCustomerId = owner; this.setData({ swapPurchase: result, swapPurchaseAccepted: false, swapPurchaseMessage: result.purchase.status === 'PENDING_PAYMENT' ? '本次普通账单已创建，尚未发放次数。请另行核对账单后主动付款，返回查询可信到账状态。' : '已回读原购买记录：' + result.purchase.statusText + '。请核对当前次数与原账单，本次未再次发起付款。' });
    } catch (error) { await this.reload(); this.setData({ swapPurchaseError: error.message + ' 请查询已有购买与原账单，不要重复付款。', swapPurchaseAccepted: false }); }
    finally { this.setData({ busy: false }); }
  },
  swapPurchaseRow(id) { return this.data.swap?.purchases.find(row => row.id === id) || (this._swapPurchaseCustomerId === services.getContext().customer?.id && this.data.swapPurchase?.purchase.id === id ? this.data.swapPurchase.purchase : null); },
  openSwapPurchaseBill(event) { const id = event.currentTarget.dataset.id; if (this.data.swap?.purchases.some(row => row.billId === id) || (this._swapPurchaseCustomerId === services.getContext().customer?.id && this.data.swapPurchase?.bill.id === id)) go('/pages/record/index?type=bills&id=' + encodeURIComponent(id)); },
  async querySwapPurchase(event) { return this.swapPurchaseAction('query', event); },
  async closeSwapPurchase(event) { return this.swapPurchaseAction('close', event); },
  async swapPurchaseAction(action, event) {
    if (this.data.busy) return; const row = this.swapPurchaseRow(event.currentTarget.dataset.id); if (!row || (action === 'close' && !row.canClose)) return;
    const owner = services.getContext().customer?.id;
    this.setData({ busy: true, swapPurchaseError: '', swapPurchaseMessage: '' });
    try {
      if (action === 'close' && !(await confirm('查询并撤销本次未支付购买？', '如已有渠道任务，将先核对原支付与关单；未知结果不代表已关闭或未扣款，不会创建另一笔付款。'))) return;
      const result = await services[action === 'close' ? 'closeSwapCreditPurchase' : 'querySwapCreditPurchase'](row.orderId, row.id); await this.reload();
      if (services.getContext().customer?.id !== owner || this.resolvedOrderId !== row.orderId) return;
      this._swapPurchaseCustomerId = owner; this.setData({ swapPurchase: { purchase: result, bill: result.bill }, swapPurchaseMessage: action === 'close' && result.status === 'VOID' ? '服务端已核实本次购买撤销；不会发放次数。' : result.statusMessage || result.statusText });
    } catch (error) { await this.reload(); this.setData({ swapPurchaseError: '结果尚未核实：' + error.message + ' 请继续查询原记录或联系人工，不要重复付款。' }); }
    finally { this.setData({ busy: false }); }
  },
  selectMileageProduct(event) {
    if (this.data.busy) return;
    const selectedProduct = this.data.usage?.products.find(row => row.id === event.detail.value) || null;
    this.setData({ selectedProductId: selectedProduct?.id || '', selectedProduct, purchaseAccepted: false, purchaseError: '' });
  },
  onPurchaseAccepted(event) { if (!this.data.busy) this.setData({ purchaseAccepted: event.detail.value.includes('purchase'), purchaseError: '' }); },
  async buyMileagePack() {
    if (this.data.busy) return;
    const usage = this.data.usage, product = this.data.selectedProduct, terms = usage?.purchaseTerms;
    if (!usage?.canPurchase || !product || !terms || !this.data.purchaseAccepted) { this.setData({ purchaseError: '请选择里程包，并单独勾选同意当前完整购买规则。' }); return; }
    this.setData({ busy: true, purchaseError: '', usageMessage: '' });
    try {
      if (!(await confirm('创建里程包账单？', product.km + '公里 · ' + product.amountText + '。仅当前订阅期有效，退订时剩余额度失效且不退未使用费用；点击只创建账单，不会自动付款。'))) return;
      const purchase = await services.createMileagePack(usage.orderId, { productId: product.id, termsVersion: terms.version, termsDocumentId: terms.documentId, termsDocumentVersion: terms.documentVersion, termsHash: terms.hash, accepted: true });
      this.setData({ purchase, purchaseAccepted: false, usageMessage: '里程包账单已创建，尚不代表支付到账或额度发放。请到普通账单详情核对后主动付款，返回刷新可信到账额度。' });
      await this.reload();
    } catch (error) {
      await this.reload(); this.setData({ purchaseError: error.message + ' 请查询账单和额度，不要重复创建。', purchaseAccepted: false }); toastError(error);
    } finally { this.setData({ busy: false }); }
  },
  openPurchaseBill() { if (this.data.purchase?.bill.id) go('/pages/record/index?type=bills&id=' + encodeURIComponent(this.data.purchase.bill.id)); },
  openUsageBill(event) { const id = event.currentTarget.dataset.id; if (id) go('/pages/record/index?type=bills&id=' + encodeURIComponent(id)); },
  openUsagePeriod(event) { if (this.data.usage) go('/pages/mileage/index?orderId=' + encodeURIComponent(this.data.usage.orderId) + '&periodId=' + encodeURIComponent(event.currentTarget.dataset.id)); },
  openPackTerms() { this.openFrozenDocument(this.data.usage?.purchaseTerms); },
  openSwapTerms() { this.openFrozenDocument(this.data.swap?.purchaseTerms); },
  inputDispute(event) { if (!this.data.busy) this.setData({ disputeReason: event.detail.value }); },
  async disputeSettlement() {
    if (this.data.busy || !this.data.settlement?.canDispute || !this.data.usage) return;
    if (!this.data.disputeReason.trim()) { this.setData({ settlementError: '请填写需要人工核对的结算异议。' }); return; }
    const id = this.data.settlement.id, orderId = this.data.usage.orderId;
    this.setData({ busy: true, settlementError: '' });
    try { const settlement = await services.disputeReturnSettlement(id, { orderId, reason: this.data.disputeReason.trim() }); this.setData({ settlement, disputeReason: '', usageMessage: '结算异议已提交人工处理，尚未结清；不会自动扣取押金。' }); }
    catch (error) { await this.reload(); this.setData({ settlementError: error.message }); toastError(error); }
    finally { this.setData({ busy: false }); }
  },
  contactUsageService() { wx.makePhoneCall({ phoneNumber: config.customerServiceTelephone, fail: error => { if (!/cancel/i.test(error?.errMsg || '')) toastError(new Error('客服暂时无法拨通，请稍后重试。')); } }); },
  selectChangeKind(event) {
    const kind = event.currentTarget.dataset.kind; if (this.data.type !== 'orderchanges' || !['', 'SUBSCRIPTION_EXTENSION'].includes(kind)) return;
    this.setData({changeKind:kind,renewalPage:1,renewalTotal:0,renewalHasNext:false,items:[]}); return this.reload();
  },
  nextRenewalPage() { if (this.data.loading || this.data.busy || !this.data.renewalHasNext) return; this.setData({renewalPage:this.data.renewalPage+1,items:[]}); return this.reload(); },
  previousRenewalPage() { if (this.data.loading || this.data.busy || this.data.renewalPage<=1) return; this.setData({renewalPage:this.data.renewalPage-1,items:[]}); return this.reload(); },
  openRecord(e) {
    go(
      '/pages/record/index?type=' +
        this.data.type +
        '&id=' +
        encodeURIComponent(e.currentTarget.dataset.id) + (this.data.type === 'orderchanges' && this.data.changeKind === 'SUBSCRIPTION_EXTENSION' ? '&kind=SUBSCRIPTION_EXTENSION' : ''),
    );
  },
  openNewAddon(event) { const id=this.resolvedOrderId||this.orderId; if(id)wx.redirectTo({url:'/pages/records/index?type=addons&orderId='+encodeURIComponent(id)+'&kind='+event.currentTarget.dataset.kind}); },
  openMine() {
    go('/pages/mine/index');
  },
});
