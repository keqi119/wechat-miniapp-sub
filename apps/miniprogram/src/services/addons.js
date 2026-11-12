const {mileagePackPayment}=require('./mileage-pack-payment');
const sessionStores=new WeakMap();
const {money,date}=require('../utils/format');
const {beijingTime}=require('./vehicle-assignments');
const KINDS=['MILEAGE_PACK','SWAP_CREDIT'];
const STATES={PENDING_PAYMENT:'待支付，尚未发放',ACTIVE:'已到账',EXPIRED:'已失效，不可用',VOID:'已关闭',CONSUMED:'已消费',PAYMENT_REVIEW:'到账待人工核账，不可用',REFUND_PENDING:'退款核对中，不可用',REFUNDED:'已退款，不可用'};
function createAddonApi({call,identifier,error,idempotencyKey,getContext,sessionKey,platform,pendingKey}) {
  if(!sessionStores.has(platform))sessionStores.set(platform,{generation:0,accessRevision:0,scope:null,entries:new Map(),running:new Map(),catalogs:new Map()});
  const state=sessionStores.get(platform),running=state.running,catalogs=state.catalogs;
  // Remove older-version persisted intents. New purchase bodies and receipts exist only in memory.
  if(pendingKey&&typeof platform.removeStorageSync==='function')platform.removeStorageSync(pendingKey);
  const validId=v=>typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=500&&!v.includes('\0');
  const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
  const amount=v=>Number.isSafeInteger(v)&&v>0&&v<=2147483647;
  const invalid=()=>{throw error('加购商品或原账单数据不完整，请刷新或联系人工核对。','RESPONSE');};
  function purge(){state.entries.clear();running.clear();catalogs.clear();}
  function sync(){const c=getContext(),scope={owner:c.customer?.id||null,token:sessionKey()||null,role:c.customer?.role||'',mode:c.mode};if(!state.scope||Object.keys(scope).some(key=>scope[key]!==state.scope[key])){purge();state.generation++;state.scope=scope;}return{...scope,authenticated:!!c.authenticated,generation:state.generation,accessRevision:state.accessRevision};}
  function stamp(){const s=sync();if(!s.authenticated||!s.owner||!s.token)throw error('请先登录本人账户。','AUTH_REQUIRED');return s;}
  function checkSession(s){const now=sync();if(!now.authenticated||now.generation!==s.generation)throw error('登录会话已变化，请重新进入本人订单。','SESSION_CHANGED');}
  function check(s){checkSession(s);if(s.accessRevision!==state.accessRevision)throw error('原订单访问权限已失效，请重新读取本人订单。','ADDON_ACCESS_REVOKED',{statusCode:403});}
  function revokeAddonAccess(){purge();state.accessRevision++;}
  function getAddonAccessLease(){const s=sync();return{generation:s.generation,accessRevision:s.accessRevision};}
  function revokeAddonAccessForPath(path,lease){const now=getAddonAccessLease();if(!lease||lease.generation!==now.generation||lease.accessRevision!==now.accessRevision)return;const bill=/^\/customer\/records\/bills\/([^/]+)$/.exec(path),purchase=/^\/customer\/swap-credit-purchases\/([^/]+)(?:\/close)?$/.exec(path),order=/^\/customer\/orders\/([^/]+)\/(?:addon-products|usage-account|mileage-packs|swap-credits|swap-account)$/.exec(path);if([...state.entries.values()].some(p=>order&&identifier(p.orderId)===order[1]||bill&&p.raw?.bill?.id&&identifier(p.raw.bill.id)===bill[1]||purchase&&p.raw?.purchase?.id&&identifier(p.raw.purchase.id)===purchase[1]))revokeAddonAccess();}
  const accessError=e=>[403,404].includes(e?.statusCode)||['FORBIDDEN','NOT_FOUND','ADDON_ACCESS_REVOKED'].includes(e?.code);
  async function addonCall(s,method,path,data){try{const value=await call(method,path,data);check(s);return value;}catch(e){check(s);if(accessError(e))revokeAddonAccess();throw e;}}
  function slot(orderId,kind){return JSON.stringify([orderId,kind]);}
  function save(s,orderId,kind,value){check(s);if(value)state.entries.set(slot(orderId,kind),value);else state.entries.delete(slot(orderId,kind));}
  function readIntent(orderId,kind){try{const s=stamp();check(s);return state.entries.get(slot(orderId,kind))||null;}catch(_){return null;}}
  function getAddonPurchaseState(orderId,kind){const p=readIntent(orderId,kind);return p?{state:p.state,orderId:p.orderId,kind:p.kind,km:p.km,periodText:p.periodText,expiresAtText:p.expiresAtText,targetModel:p.targetModel,receipt:p.receipt||null}:null;}
  function view(v,orderId,kind,target=''){
    if(!v||v.orderId!==orderId||v.kind!==kind||typeof v.eligible!=='boolean'||!Array.isArray(v.blockers)||!Array.isArray(v.products)||!Array.isArray(v.targetModels))invalid();
    const t=v.terms;if(!t||t.version!==(kind==='MILEAGE_PACK'?'MILEAGE_PACK_V2':'SWAP_CREDIT_ADDON_V1')||!hash(t.hash)||typeof t.content!=='string'||!t.content.trim())invalid();
    const models=v.targetModels.map(m=>{if(!validId(m.id)||!validId(m.brand)||!validId(m.name))invalid();return{...m,label:m.brand+' · '+m.name};});
    const c=v.context;if(v.eligible&&(!c||!validId(c.periodId)||!validId(c.assignmentId)||!validId(c.modelDefinitionId)||!/^\d{4}-\d{2}-\d{2}$/.test(c.startDate)||!/^\d{4}-\d{2}-\d{2}$/.test(c.endDate)||!Number.isFinite(Date.parse(c.expiresAt))||target&&c.targetModelDefinitionId!==target))invalid();
    const quotes=v.products.flatMap(p=>{if(!validId(p.productId)||!validId(p.versionId)||!hash(p.sourceHash)||!Number.isInteger(p.version)||p.version<1||!validId(p.name)||!Array.isArray(p.quotes))invalid();
      if(kind==='MILEAGE_PACK'&&(p.quotes.length!==3||[1000,1500,2000].some(k=>p.quotes.filter(q=>q.km===k).length!==1)))invalid();
      return p.quotes.map(q=>{if(!validId(q.quoteId)||!amount(q.amount)||q.currency!=='CNY'||kind==='SWAP_CREDIT'&&(q.quantity!==1||!target)||kind==='MILEAGE_PACK'&&![1000,1500,2000].includes(q.km))invalid();return{...q,key:p.versionId+':'+q.quoteId,productId:p.productId,name:p.name,versionId:p.versionId,version:p.version,sourceHash:p.sourceHash,amountText:money(q.amount),unitPriceText:kind==='MILEAGE_PACK'?'约 '+(q.amount/q.km/100).toFixed(3).replace(/0+$/,'').replace(/\.$/,'')+'元/km':''};});});
    const blockers=v.blockers.map(b=>typeof b==='string'?b:b?.message).filter(Boolean);
    return{...v,targetModels:models,quotes,blockers,terms:{...t},periodText:c?date(c.startDate)+'—'+date(c.endDate)+'（末日不含）':'',expiresAtText:c?beijingTime(c.expiresAt):'',targetModel:models.find(m=>m.id===target)||null,canPurchase:v.eligible&&blockers.length===0&&quotes.length>0,emptyReason:!v.eligible?blockers.join('；')||'当前主套餐暂不具备加购资格。':kind==='SWAP_CREDIT'&&!target?'请先选择希望换入的品牌和车型。':quotes.length?'':'此车型暂未配置已发布的加购价格，请联系平台。'};
  }
  function catalogKey(s,orderId,kind,target){return JSON.stringify([orderId,kind,target]);}
  const catalogSnapshot=c=>JSON.stringify([c.context,c.terms,c.quotes]);
  async function getAddonProducts(orderId,kind,target=''){if(!KINDS.includes(kind)||!validId(orderId)||target&&!validId(target))throw error('请选择有效的加购分类和订单。','VALIDATION');const s=stamp(),v=await addonCall(s,'GET','/customer/orders/'+identifier(orderId)+'/addon-products',{kind,...(target?{targetModelDefinitionId:target}:{})});check(s);const result=view(v,orderId,kind,target);catalogs.set(catalogKey(s,orderId,kind,target),catalogSnapshot(result));return result;}
  function result(v,pending){const p=v?.purchase,b=v?.bill;if(!p||!validId(p.id)||!validId(p.billId)||b?.id!==p.billId||!STATES[p.status]||p.amount!==pending.amount||b.amount!==pending.amount||pending.kind==='MILEAGE_PACK'&&(p.km!==pending.km||p.periodId!==pending.body.periodId)||pending.kind==='SWAP_CREDIT'&&(p.targetModelDefinitionId!==pending.body.targetModelDefinitionId||p.sku!=='SWAP_CREDIT_ADDON_1'||p.policyVersion!=='SWAP_ADDON_V1'||p.quantity!==1||p.currency!=='CNY'||['productId','versionId','quoteId','sourceHash'].some(key=>p[key]!==pending.body[key])||p.terms?.version!==pending.body.termsVersion||p.terms?.hash!==pending.body.termsHash))invalid();return{purchase:{...p,amountText:money(p.amount),statusText:p.statusText||STATES[p.effectiveStatus||p.status]},bill:{...b,amountText:money(b.amount)}};}
  async function post(s,orderId,kind,pending){
    let raw;try{raw=await addonCall(s,'POST','/customer/orders/'+identifier(orderId)+(kind==='MILEAGE_PACK'?'/mileage-packs':'/swap-credits'),pending.body);check(s);}catch(e){checkSession(s);if(accessError(e))throw e;check(s);if(e.statusCode>=400&&e.statusCode<500&&![408,429].includes(e.statusCode))save(s,orderId,kind,null);throw e;}
    // Retain the accepted response in current-session memory before validating or doing any subsequent GET: never POST it again.
    const committed={...pending,state:'COMMITTED',raw};save(s,orderId,kind,committed);const receipt=result(raw,pending);save(s,orderId,kind,{...committed,receipt});return receipt;
  }
  async function run(orderId,kind,fn){const s=stamp(),key=slot(orderId,kind);if(running.has(key))throw error('原购买正在核对，请稍候。','ADDON_BUSY');const lease={};running.set(key,lease);try{return await fn(s);}finally{if(running.get(key)===lease)running.delete(key);}}
  async function createAddonPurchase(orderId,kind,input){
    const allowed=['productId','versionId','quoteId','sourceHash','termsVersion','termsHash','accepted',...(kind==='MILEAGE_PACK'?['periodId']:['targetModelDefinitionId'])];
    if(!KINDS.includes(kind)||!input||input.accepted!==true||Object.keys(input).some(k=>!allowed.includes(k)))throw error('请选择商品并主动同意本次功能说明，不可提交金额。','VALIDATION');
    return run(orderId,kind,async s=>{if(getAddonPurchaseState(orderId,kind))throw error('请先核对原购买结果及原账单。','ADDON_PENDING');const previous=catalogs.get(catalogKey(s,orderId,kind,input.targetModelDefinitionId||''));const c=await getAddonProducts(orderId,kind,input.targetModelDefinitionId||'');check(s);if(previous&&previous!==catalogSnapshot(c))throw error('价格、适用车型、计费月或服务期限已变化，请重新核对并勾选。','ADDON_QUOTE_CHANGED');const q=c.quotes.find(q=>q.productId===input.productId&&q.versionId===input.versionId&&q.quoteId===input.quoteId&&q.sourceHash===input.sourceHash);
      if(!c.canPurchase||!q||c.terms.version!==input.termsVersion||c.terms.hash!==input.termsHash||kind==='MILEAGE_PACK'&&c.context.periodId!==input.periodId)throw error('价格、适用车型、计费月或功能说明已变化，请重新核对并勾选。','ADDON_QUOTE_CHANGED');
      const body={...input,...(kind==='SWAP_CREDIT'?{sku:'SWAP_CREDIT_ADDON_1'}:{}),idempotencyKey:idempotencyKey('addon')};const pending={state:'UNKNOWN',orderId,kind,body,amount:q.amount,km:q.km||null,context:c.context,periodText:c.periodText,expiresAtText:c.expiresAtText,targetModel:c.targetModel,terms:c.terms};save(s,orderId,kind,pending);return post(s,orderId,kind,pending);
    });
  }
  async function recoverAddonPurchase(orderId,kind){return run(orderId,kind,async s=>{let p=readIntent(orderId,kind);if(!p)throw error('没有待核对的原购买。','ADDON_NOT_PENDING');if(p.state==='UNKNOWN'){await post(s,orderId,kind,p);check(s);p=readIntent(orderId,kind);}let raw;
    if(kind==='MILEAGE_PACK'){const account=await addonCall(s,'GET','/customer/orders/'+identifier(orderId)+'/usage-account');check(s);const row=account?.packs?.find(row=>row.id===p.raw?.purchase?.id&&row.billId===p.raw?.bill?.id);if(!row)invalid();const payment=mileagePackPayment(row,invalid,true);raw={purchase:{...row,...payment},bill:payment.bill};}else {const purchaseId=p.raw?.purchase?.id;if(!validId(purchaseId))invalid();const row=await addonCall(s,'GET','/customer/swap-credit-purchases/'+identifier(purchaseId));check(s);if(row?.orderId!==orderId)invalid();raw={purchase:row,bill:row.bill};}
    const receipt=result(raw,p);save(s,orderId,kind,{...p,raw,receipt});return receipt;
  });}
  function finishAddonPurchase(orderId,kind){const s=stamp(),p=readIntent(orderId,kind);if(p?.state!=='COMMITTED'||!p.receipt)throw error('请先核对原购买结果，未知结果不能重新购买。','ADDON_PENDING');save(s,orderId,kind,null);}
  return{getAddonProducts,createAddonPurchase,getAddonPurchaseState,recoverAddonPurchase,finishAddonPurchase,revokeAddonAccess,getAddonAccessLease,revokeAddonAccessForPath,syncAddonSession(){sync();},getAddonViewIdentity(){const s=sync();return JSON.stringify([s.owner,s.role,s.mode,s.generation]);},clearAddonState(){purge();state.generation++;state.scope=null;if(pendingKey&&typeof platform.removeStorageSync==='function')platform.removeStorageSync(pendingKey);}};
}
module.exports={createAddonApi};
