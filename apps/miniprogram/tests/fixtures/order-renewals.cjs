const config = require('../../src/config');
const {createApi} = require('../../src/services/api');
const hash = ch => ch.repeat(64);
const copy = value => structuredClone(value);
function renewal(extra = {}) {
  const periods = Array.from({length:12},(_,i)=>({sequence:13+i,stageSequence:i+1,startDate:`2097-${String(i+1).padStart(2,'0')}-01`,endDate:i===11?'2098-01-01':`2097-${String(i+2).padStart(2,'0')}-01`,dueDate:`2097-${String(i+1).padStart(2,'0')}-01`,amount:20000}));
  const quote={id:'rq1',revision:1,status:'PUBLISHED',commercialHash:hash('a'),kind:'SUBSCRIPTION_EXTENSION',startDate:'2097-01-01',endDate:'2098-01-01',months:12,monthlyFeeAmount:20000,depositAmount:50000,totalAmount:240000,periods,productName:'同车十二月',listingId:'goods1',listingRevision:2,productVersionId:'pv1',listingSourceHash:hash('b'),usagePricing:{policyVersion:'USAGE_V2',baseAllowanceKm:0,excessPriceAmount:0},swapPolicy:{policyVersion:'SWAP_TERM_V2',includedCount:0,extraFeeAmount:35000},lessorHash:hash('c'),noticeHash:hash('d'),lessor:{ownerId:'owner1',name:'实际出租方',subjectType:'ENTERPRISE',creditCode:'91310000000000000X'},sharingNotice:{id:'notice1',version:1,title:'必要资料告知',content:'向本合同实际出租方提供履约所需资料。',contentHash:hash('d'),templateHash:hash('e')},coverage:{currentReady:true,futureReady:true,futureBlockers:[]},previewHash:hash('f'),expiresAt:'2096-12-31T15:59:59Z',reason:'双方协商同车续期',settlementExplanation:'原押金保留，新月费逐期主动支付。',cancellationTerms:'按确认的补充协议办理取消。',document:{id:'doc1',type:'OFFLINE_ORDER_AMENDMENT',version:2,templateHash:hash('e'),bodyHash:hash('f'),content:'同一实际车辆续期十二个月。原期费用、历史里程和原押金不变。'},confirmedAt:null};
  return {id:'renewal1',orderId:'order1',kind:'SUBSCRIPTION_EXTENSION',status:'AWAITING_CONFIRMATION',revision:3,reason:quote.reason,createdAt:'2096-01-01T00:00:00Z',quote,contract:{id:'contract1',kind:'AMENDMENT',executionMode:'OFFLINE',status:'DRAFT',delayQuoteId:'rq1',offlineArchiveId:null},history:[{id:'rq1',revision:1,status:'PUBLISHED',commercialHash:quote.commercialHash}],stage:null,blockers:[],canConfirm:true,canReject:true,canSign:false,canSync:false,...extra};
}
function summary(row){const q=row.quote;return{id:row.id,orderId:row.orderId,kind:row.kind,status:row.status,revision:row.revision,reason:row.reason,createdAt:row.createdAt,blockers:[],quoteSummary:q?{id:q.id,revision:q.revision,newStartDate:q.startDate,newEndDate:'2097-12-31',months:q.months,monthlyFeeAmount:q.monthlyFeeAmount,depositAmount:q.depositAmount,productName:q.productName,commercialHash:q.commercialHash,expiresAt:q.expiresAt,confirmationExpired:false}:null};}
function setup(){
  let current=renewal(),failure=null,hold=false,rows=null,readFailAfterPost=false;
  const calls=[],deferred=[],navigations=[],storage=new Map([[config.storageKey,{token:'synthetic-renewal',expiresAt:'2099-01-01T00:00:00Z',customer:{id:'customer1'}}]]);
  const wx={getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,v),removeStorageSync:k=>storage.delete(k),showToast(){},setNavigationBarTitle(){},showModal:v=>v.success({confirm:true}),navigateTo:v=>navigations.push(v.url),requestPayment(){throw Error('renewal must not pay');},request(v){
    calls.push(v);const route=v.url.replace(/^https:\/\/[^/]+\/api/,'');
    if(hold&&v.method==='GET'){deferred.push(v);return;}
    if(failure&&(failure.all||v.method==='POST')){if(failure.status==='NETWORK')return v.fail({});return v.success({statusCode:failure.status,data:{error:{code:'SYNTHETIC_FAILURE',message:'合成请求失败'}}});}
    let data;
    if(route==='/customer/order-renewals'&&v.method==='GET'){const all=rows||[summary(current)],page=v.data.page,pageSize=v.data.pageSize;data={items:all.slice((page-1)*pageSize,page*pageSize),total:all.length,page,pageSize};}
    else if(route==='/customer/order-renewals/renewal1'&&v.method==='GET')data=copy(current);
    else if(route.endsWith('/confirm')||route.endsWith('/reject')){const confirmed=route.endsWith('/confirm');current={...current,status:confirmed?(current.contract.executionMode==='ELECTRONIC'?'AWAITING_SIGNATURE':'AWAITING_ARCHIVE'):'REJECTED',revision:4,quote:{...current.quote,status:confirmed?'CONFIRMED':'REJECTED',confirmedAt:confirmed?'2096-10-31T00:00:00Z':null},canConfirm:false,canReject:false};data={id:current.id,revision:4,status:current.status,quoteId:'rq1'};}
    else if(route==='/customer/order-changes')data={items:[],total:0,page:1,pageSize:50};
    else if(route==='/customer/auth/logout')data={ok:true};
    else throw Error('Unexpected route '+route);
    if(v.method==='POST'&&readFailAfterPost)failure={status:503,all:true};
    v.success({statusCode:200,data});
  }};
  return{api:createApi(config,v=>wx.request(v),wx),wx,calls,deferred,navigations,storage,set:v=>{current=copy(v);},get:()=>copy(current),fail:(status,all=false)=>{failure=status?{status,all}:null;},hold:v=>{hold=v;},failReadAfterPost:()=>{readFailAfterPost=true;},rows:v=>{rows=v;},switchSession(){storage.set(config.storageKey,{token:'other-session',expiresAt:'2099-01-01T00:00:00Z',customer:{id:'customer2'}});}};
}
function page(env,name='record',options={type:'orderchanges',kind:'SUBSCRIPTION_EXTENSION',id:'renewal1'}){
  global.wx=env.wx;let definition;global.Page=v=>{definition=v;};
  for(const p of ['../../src/services/index','../../src/pages/'+name+'/index'])delete require.cache[require.resolve(p)];
  require('../../src/pages/'+name+'/index');
  const p={...definition,data:copy(definition.data),setData(v){Object.assign(this.data,v);}};p.onLoad(options);return p;
}
const confirmInput=row=>({revision:row.revision,quoteId:row.quote.id,quoteRevision:row.quote.revision,commercialHash:row.quote.commercialHash,bodyHash:row.quote.document.bodyHash,lessorHash:row.quote.lessorHash,noticeHash:row.quote.noticeHash,read:true,sharingAccepted:true});
module.exports={renewal,summary,setup,page,confirmInput,copy};
