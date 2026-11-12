const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createApi}=require('../../src/services/api'),config=require('../../src/config');
const {paidAccount,terms,product,purchase}=require('./paid-swap.cjs');
const rule={...terms,version:'SWAP_CREDIT_V2',templateContent:'单次 {{extraFeeYuan}} 元',templateHash:'c'.repeat(64),content:'本次321元一次，按本笔确认有效期及全额退款规则办理。'};
const goods={...product,id:'SWAP_CREDIT_TERM_1',policyVersion:'SWAP_TERM_V2',pricingHash:'d'.repeat(64),amount:32100};
const termAccount=(extra={})=>paidAccount({contractMode:'OFFLINE',serviceStageId:'stage-renewal',stageSourceHash:'e'.repeat(64),startedOn:'2025-10-01',endDate:'2028-09-30',policyVersion:'SWAP_TERM_V2',cycle:undefined,term:{startDate:'2026-10-01',endDate:'2027-10-01',includedCount:1,remaining:1,reserved:0,consumed:0,available:1},product:goods,purchaseTerms:rule,...extra});
const bought=()=>purchase({policyVersion:'SWAP_TERM_V2',pricingHash:goods.pricingHash,amount:32100,terms:rule,expiresOn:'2027-09-30',bill:{...purchase().bill,amount:32100}});
function setup(value=termAccount()){
 let current=value,failure=null;const calls=[],navigations=[],dialogs=[],storage=new Map([[config.storageKey,{token:'synthetic',customer:{id:'c1'},expiresAt:'2099-01-01T00:00:00Z'}]]);
 const wx={getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,v),removeStorageSync:k=>storage.delete(k),setNavigationBarTitle(){},showToast(){}};
 const api=createApi(config,request=>{
  const route=new URL(request.url).pathname.replace(/^\/api/,'');calls.push({route,method:request.method,data:request.data});
  if(request.method==='POST'&&failure)return request.success({statusCode:failure,data:{error:{code:'UNKNOWN',message:'合成结果未知'}}});
  let data;if(route.endsWith('/swap-account'))data=current;
  else if(route.endsWith('/usage-account'))return request.success({statusCode:503,data:{error:{message:'合成用量暂不可读'}}});
  else if(route==='/customer/dashboard')data={subscription:{id:'o1',orderId:'o1',status:'ACTIVE',vehicleName:'合成车辆',contractMode:'OFFLINE'}};
  else if(route==='/customer/records/entitlements')data={items:[],total:0};
  else if(route.endsWith('/vehicle-changes'))data={id:'change-new',kind:'VEHICLE_CHANGE'};
  else if(route.endsWith('/swap-credits'))data={purchase:bought(),bill:bought().bill};
  else throw Error('Unexpected local route '+route);request.success({statusCode:200,data});
 },wx);
 function page(name,options={}){
  let definition;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../src/pages',name,'index.js'),'utf8'),{Page:v=>definition=v,wx,require:id=>id.includes('/services/')?api:id.includes('/config')?config:{load:async(p,work)=>{p.setData({loading:true,error:''});try{const result=await work();p.setData({...result,loading:false});return result;}catch(error){p.setData({loading:false,error:error.message});return null;}},go:url=>navigations.push(url),toastError(){},confirm:async(title,content)=>{dialogs.push({title,content});return true;}}});
  const p={...definition,data:structuredClone(definition.data),setData:v=>Object.assign(p.data,v)};p.onLoad?.(options);return p;
 }
 return{api,page,calls,navigations,dialogs,set:v=>current=v,fail:v=>failure=v};
}
module.exports={setup,termAccount,rule,goods};
