const services = require('../../services/index');
const {go} = require('../../utils/page');
const KINDS = {SUBSCRIPTION:'01 / 汽车订阅合同',DELIVERY_DELAY:'交付延期协议',VEHICLE_SWAP:'03 / 换车补充协议',RENEWAL:'05 / 同车续期协议',PRE_DELIVERY_CANCELLATION:'04 / 交付前取消协议',EARLY_TERMINATION:'06 / 协商终止协议',RETURN_SETTLEMENT:'退车结算协议',RENEWAL_CANCELLATION:'续期取消协议',COOPERATION:'02 / 车辆合作协议',COOPERATION_GRANT:'02 / 独立用印授权',COOPERATION_AMENDMENT:'合作变更协议',COOPERATION_TERMINATION:'合作终止协议'};
const CUSTOMER_KINDS=['SUBSCRIPTION','VEHICLE_SWAP','PRE_DELIVERY_CANCELLATION','RENEWAL','EARLY_TERMINATION'];
const STATES = {PREPARED:'已准备，待发起',SIGNING:'各方签署中',SIGNED:'各方已签署，待归档',FILING:'存证中',ARCHIVING:'归档中',ARCHIVED:'已归档',WITHDRAWN:'已撤回',DECLINED:'签署被拒绝',EXPIRED:'已过期',RETIRED:'历史版本'};
function localSigningDate(value) {
  const date=new Date(value);if(!value || !Number.isFinite(date.getTime()))return '';
  const local=new Date(date.getTime()+8*60*60*1000),pad=n=>String(n).padStart(2,'0');
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth()+1)}-${pad(local.getUTCDate())} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}（北京时间）`;
}
function signingHelp(task,{workspaceError,identity,channelEnabled,canSign}) {
  if(!CUSTOMER_KINDS.includes(task?.kind))return '此处可阅读本份文书与历史签署记录。';
  const customer=task.parties.find(p=>p.role==='CUSTOMER');
  if(task.status==='SIGNING' && !task.stopStatus && customer && ['PENDING','ISSUED','UNKNOWN'].includes(customer.status)) {
    if(workspaceError)return '您本人的签署待办尚未核对完成，请刷新办理条件后继续。';
    if(identity?.verified!==true || identity?.realNameStatus!=='VERIFIED')return '签署前请先在个人资料中完成本人渠道实名核验。';
    if(!channelEnabled)return '您仍有客户签署待办；签署入口暂未开放，请联系运营核对渠道后继续。';
    if(!canSign)return '请等待当前签署顺序到达客户本人，并刷新核对待办。';
  }
  return '请查看各方当前签署进度；待办企业动作由对应企业本人办理，归档结果以核验进度为准。';
}
function view(row) {
  if (!row || typeof row.id !== 'string' || !Number.isInteger(row.revision) || !/^[a-f0-9]{64}$/.test(row.sourceSha256) || !Array.isArray(row.parties)) throw Error('合同任务或原文版本暂未核实，请重新读取。');
  const closed=['WITHDRAWN','DECLINED','EXPIRED','RETIRED'].includes(row.status),archived=row.status==='ARCHIVED'&&row.archivedAt&&row.finalFileAvailable,allSigned=row.parties.length>0&&row.parties.every(p=>p.status==='SIGNED');
  return {...row,contractLabel:row.archive?.contractNumber || '合同编号待核对',parties:row.parties.map(p=>({...p,signed:p.status==='SIGNED',signedAtText:localSigningDate(p.signedAt)})),title:KINDS[row.kind] || '电子协议',statusText:closed?STATES[row.status]:archived?'已归档':allSigned||['SIGNED','FILING','ARCHIVING'].includes(row.status)?'待归档':'待签署',finalLabel:archived?'查看签后文件':'查看签署证据'};
}
function signer(row) {
  const parties=row?.parties?.filter(p=>p.role==='CUSTOMER') || [],action=row?.nextAction;
  return CUSTOMER_KINDS.includes(row?.kind) && !row.stopStatus && row.status==='SIGNING' && parties.length===1 && parties[0].mode==='MANUAL' && ['PENDING','ISSUED','UNKNOWN'].includes(parties[0].status) && ['SIGN','QUERY'].includes(action?.kind) && action.role==='CUSTOMER';
}
Page({
  data:{workspaceError:'',loading:true,error:'',busy:false,items:[],task:null,workspace:null,identity:null,readiness:[],page:1,total:0,hasNext:false,sourceRead:false,accepted:false,canSign:false,message:''},
  onLoad(options={}) { this.orderId=options.orderId || '';this.selectedId=options.taskId || '';this._disposed=false;return this.reload(); },
  onShow() {
    if(!this._started || this._disposed)return;
    if(this._foregroundRefresh)return this._foregroundRefresh;
    // Native openDocument success can precede onShow, or complete after it.
    // Wait for an in-flight read, then always revalidate against the server.
    const refresh=(async()=>{
      if(this._reading)await this._readCompletion;
      if(!this._disposed)return this.reload({retainRead:true});
    })();
    this._foregroundRefresh=refresh;
    return refresh.finally(()=>{if(this._foregroundRefresh===refresh)this._foregroundRefresh=null;});
  },
  onUnload() { this._disposed=true;this._revision=(this._revision||0)+1;this.setData({task:null,items:[],workspace:null,identity:null,readiness:[],sourceRead:false,accepted:false,canSign:false}); },
  binding(row=this.data.task,identity=this.data.identity) { return JSON.stringify([row?.id,row?.revision,row?.sourceSha256,identity?.identityVersion,identity?.snapshot?.identityHash,identity?.verified,identity?.realNameStatus]); },
  current(ticket) { return !this._disposed && ticket.revision===this._revision && ticket.session===services.renewalSessionStamp() && ticket.id===this.selectedId; },
  async reload({retainRead=false}={}) {
    if(this._disposed)return;
    this._started=true;const ticket={revision:this._revision=(this._revision||0)+1,session:services.renewalSessionStamp(),id:this.selectedId};
    const receipt=retainRead && this.data.sourceRead && this._readSession===ticket.session && this._readBinding===this.binding()
      ? {binding:this._readBinding,session:this._readSession,accepted:this.data.accepted} : null;
    this._readBinding=null;this._readSession=null;this.setData({loading:true,error:'',task:null,items:[],workspace:null,identity:null,readiness:[],sourceRead:false,accepted:false,canSign:false});
    try {
      const list=await services.getElectronicDocuments({orderId:this.orderId,page:this.data.page});
      if(!this.current(ticket))return;
      if(!Array.isArray(list?.items)||!Number.isInteger(list.total))throw Error('合同列表暂未核实，请重新读取。');
      const task=this.selectedId ? view(await services.getElectronicDocument(this.selectedId)) : null;
      if(!this.current(ticket))return;
      if(task && (task.id!==this.selectedId || this.orderId && task.orderId!==this.orderId))throw Error('选中的合同不属于当前订单。');
      const orderId=this.orderId || task?.orderId;
      const [workspaceResult,identityResult,capabilityResult]=await Promise.allSettled([
        orderId ? services.getElectronicWorkspace(orderId) : Promise.resolve(null),
        task?.kind==='SUBSCRIPTION' || orderId ? services.getIdentityReadiness() : Promise.resolve(null),
        services.getSigningConfig('electronic'),
      ]);
      if(!this.current(ticket))return;
      const workspace=workspaceResult.status==='fulfilled'?workspaceResult.value:null;
      const identity=identityResult.status==='fulfilled'?identityResult.value:null;
      const capability=capabilityResult.status==='fulfilled'?capabilityResult.value:{};
      const workspaceError=[workspaceResult,identityResult,capabilityResult].filter(v=>v.status==='rejected').map(v=>v.reason.message).join('；');
      const readiness=(workspace?.readiness || []).filter(r=>!task || r.kind===task.kind && (!task.resourceId || !r.resourceId || r.resourceId===task.resourceId)).flatMap(r=>r.missing || []);
      const canSign=!workspaceError && signer(task) && identity?.verified===true && identity?.realNameStatus==='VERIFIED' && capability.enabled && capability.signProviderConfigured;
      const sourceRead=!!receipt && !workspaceError && receipt.session===ticket.session && receipt.binding===this.binding(task,identity);
      if(sourceRead){this._readBinding=receipt.binding;this._readSession=receipt.session;}
      const channelEnabled=capability.enabled && capability.signProviderConfigured;
      const signHelp=signingHelp(task,{workspaceError,identity,channelEnabled,canSign});
      this.setData({signHelp,items:list.items.map(view),total:list.total,hasNext:this.data.page*20<list.total,task,workspace,identity,readiness,workspaceError,canSign,sourceRead,accepted:sourceRead && !!canSign && receipt.accepted,channelEnabled:capability.enabled && capability.signProviderConfigured,loading:false});
    } catch(e) { if(this.current(ticket)){this._readBinding=null;this._readSession=null;this.setData({loading:false,task:null,items:[],workspace:null,identity:null,readiness:[],canSign:false,sourceRead:false,accepted:false,error:e.message});} }
  },
  select(event) { if(this.data.busy || this.data.loading)return;const id=event.currentTarget.dataset.id;if(!this.data.items.some(row=>row.id===id))return;this.selectedId=id;return this.reload(); },
  next() { if(!this.data.loading&&!this.data.busy&&this.data.hasNext){this.setData({page:this.data.page+1});return this.reload();} },
  previous() { if(!this.data.loading&&!this.data.busy&&this.data.page>1){this.setData({page:this.data.page-1});return this.reload();} },
  async read(variant) {
    const row=this.data.task;if(!row || this.data.loading || this.data.busy || variant==='signed'&&!row.finalFileAvailable)return;
    const binding=this.binding(),ticket={revision:this._revision,session:services.renewalSessionStamp(),id:this.selectedId};
    let finishRead;this._readCompletion=new Promise(resolve=>{finishRead=resolve;});
    this._reading=true;this._readBinding=null;this._readSession=null;this.setData({busy:true,message:'',sourceRead:false,accepted:false});
    try { await services.openElectronicFile(row.id,variant);if(this.current(ticket)&&binding===this.binding()&&variant==='source'){this._readBinding=binding;this._readSession=ticket.session;this.setData({sourceRead:true});} }
    catch(e) { if(this.current(ticket)){this._readBinding=null;this.setData({sourceRead:false,message:e.message});} }
    finally { this._reading=false;finishRead();if(!this._disposed)this.setData({busy:false}); }
  },
  openSource() { return this.read('source'); },openFinal() { return this.read('signed'); },
  accept(event) { if(!this.data.busy && this.data.sourceRead && this._readBinding===this.binding() && this._readSession===services.renewalSessionStamp())this.setData({accepted:event.detail.value.includes('sign')}); },
  async sign() {
    const row=this.data.task;if(this.data.loading||this.data.busy||!this.data.canSign||!signer(row)||!this.data.accepted||!this.data.sourceRead||this._readBinding!==this.binding()||this._readSession!==services.renewalSessionStamp())return;
    const binding=this.binding(),ticket={revision:this._revision,session:services.renewalSessionStamp(),id:this.selectedId};this.setData({busy:true,message:''});
    try { const [latest,identity]=await Promise.all([services.getElectronicDocument(row.id),services.getIdentityReadiness()]);if(!this.current(ticket))return;if(this.binding(latest,identity)!==binding || !signer(latest))throw Error('合同或实名版本已变化，请重新阅读确认。');await services.startSigning('electronic',row.id,{revision:row.revision,sourceSha256:row.sourceSha256,accepted:true,idempotencyKey:services.idempotencyKey('electronic-sign')}); }
    catch(e) { if(this.current(ticket)){await this.reload();if(!this._disposed)this.setData({message:e.message});} }
    finally { if(!this._disposed)this.setData({busy:false,accepted:false}); }
  },
  async sync() {
    const row=this.data.task;if(!row||this.data.loading||this.data.busy)return;
    const ticket={revision:this._revision,session:services.renewalSessionStamp(),id:this.selectedId};this.setData({busy:true,message:''});
    try { await services.syncElectronicSigningStatus(row.id);if(this.current(ticket))await this.reload(); }
    catch(e) { if(this.current(ticket)){await this.reload();if(!this._disposed)this.setData({message:'结果尚未核实：'+e.message});} }
    finally { if(!this._disposed)this.setData({busy:false}); }
  },
  toggleTechnical() { this.setData({showTechnical:!this.data.showTechnical}); },
  openIdentity() { go('/pages/profile/index'); },
  openOrder() { const id=this.orderId || this.data.task?.orderId;if(id)go('/pages/record/index?type=orders&id='+encodeURIComponent(id)); },
});
