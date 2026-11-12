const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const vm=require('node:vm');
const sourceRoot=path.resolve(process.env.MINIAPP_SOURCE_ROOT||process.env.MINIAPP_SOURCE_DIR||path.join(__dirname,'../src'));
const {createApi}=require(path.join(sourceRoot,'services/api'));
const config=require(path.join(sourceRoot,'config'));
const base=(status='AWAITING_SIGNATURE')=>({id:'order-offline',orderId:'order-offline',status,statusText:'待签约',vehicleName:'离线ET5T订阅车型',vehicle:{id:'vehicle-offline',name:'离线ET5T订阅车型'},imageUrl:'/api/public/media/offline-image',currentAssignment:null,activeChangeId:null,deliveryDelayChangeId:null,mileageText:'每月1500公里',monthlyFeeText:'¥0.01',planTitle:'12个月订阅'});
const current={id:'assignment-offline',status:'ACTIVE',vehicle:{id:'current-vehicle',title:'实际已交付车型'},startAt:'2026-10-26T00:00:00Z',endAt:null,startReadingKm:23456,endReadingKm:null};
async function dashboard(subscription,extra={}){
  const calls=[];
  const platform={getStorageSync:()=>({token:'offline-token',expiresAt:'2099-01-01T00:00:00Z',customer:{id:'offline-customer'}})};
  const api=createApi(config,request=>{calls.push(request.method);request.success({statusCode:200,data:{subscription,active:subscription.status==='ACTIVE',mileage:0,todos:[],...extra}})},platform);
  return {result:await api.getDashboard(),calls};
}
test('initial signature/payment/handover retain the subscribed vehicle without inventing a physical assignment',async()=>{
  for(const status of ['AWAITING_SIGNATURE','AWAITING_PAYMENT','AWAITING_HANDOVER']){
    const {result,calls}=await dashboard(base(status));
    assert.equal(result.subscription.vehicleName,'离线ET5T订阅车型');
    assert.equal(result.subscription.imageUrl,'https://api.evsub.ndacar.com/api/public/media/offline-image');
    assert.equal(result.subscription.currentAssignment,null);
    assert.equal(result.subscription.mileageText,'每月1500公里');
    assert.match(result.subscription.vehicleStageText,/尚未交付/);
    assert.doesNotMatch(result.subscription.vehicleStageText,/换车|已交付/);
    assert.deepEqual(calls,['GET']);
  }
});
test('an active assignment uses the real current vehicle while preserving the package mileage meaning',async()=>{
  const {result}=await dashboard({...base('ACTIVE'),currentAssignment:current});
  assert.equal(result.subscription.vehicleName,'实际已交付车型');
  assert.equal(result.subscription.currentAssignment.startReadingKm,23456);
  assert.equal(result.subscription.mileageText,'每月1500公里');
});
test('returned swap vehicle is never shown as current, and final return is not described as a swap',async()=>{
  const gap=await dashboard({...base('ACTIVE'),vehicle:null,imageUrl:'/stale-vehicle.png',activeChangeId:'swap-offline'});
  assert.match(gap.result.subscription.vehicleName,/暂无.*车辆/);
  assert.match(gap.result.subscription.vehicleStageText,/换车|新车/);
  assert.equal(gap.result.subscription.currentAssignment,null);assert.equal(gap.result.subscription.imageUrl,'');
  const settled=await dashboard({...base('SETTLING'),vehicle:null,activeChangeId:'historical-change'});
  assert.match(settled.result.subscription.vehicleStageText,/已还车|结算/);
  assert.doesNotMatch(settled.result.subscription.vehicleStageText,/换车|新车/);
});
test('delivery delay before first delivery and untracked older payloads do not turn into a swap gap',async()=>{
  const delayed=await dashboard({...base('AWAITING_HANDOVER'),activeChangeId:'delay1',deliveryDelayChangeId:'delay1'});
  assert.equal(delayed.result.subscription.vehicleName,'离线ET5T订阅车型');assert.doesNotMatch(delayed.result.subscription.vehicleStageText,/换车/);
  const legacy=base('ACTIVE');delete legacy.currentAssignment;
  const old=await dashboard(legacy);assert.equal(old.result.subscription.vehicleName,'离线ET5T订阅车型');assert.equal(Object.hasOwn(old.result.subscription,'currentAssignment'),false);
});
test('null assignment without supporting vehicle or swap facts is shown as unverified instead of fabricated delivery',async()=>{
  const {result}=await dashboard({...base('ACTIVE'),vehicle:null});
  assert.match(result.subscription.vehicleStageText,/核对|核实/);assert.doesNotMatch(result.subscription.vehicleStageText,/换车/);assert.equal(result.subscription.imageUrl,'');
});
test('server next action remains an exact read-only navigation target; no contract is invented',async()=>{
  const nextAction={title:'合同待签署',description:'请核对本单正式合同',label:'查看合同',url:'/pages/record/index?type=contracts&id=contract-offline'};
  const provided=await dashboard(base(),{nextAction});assert.deepEqual(provided.result.nextAction,nextAction);
  const missing=await dashboard(base());assert.equal(missing.result.nextAction,undefined);assert.equal(missing.calls.filter(method=>method==='POST').length,0);
});
test('closed assignments are not accepted as the current physical vehicle',async()=>{
  await assert.rejects(dashboard({...base('ACTIVE'),currentAssignment:{...current,status:'CLOSED',endAt:'2026-10-27T00:00:00Z',endReadingKm:23500}}),{code:'RESPONSE'});
});
test('cancelled and completed orders do not describe a current car or a pending swap',async()=>{
  for(const status of ['CANCELLED','COMPLETED']){
    const {result}=await dashboard({...base(status),activeChangeId:'historical-change'});
    assert.match(result.subscription.vehicleStageText,status==='CANCELLED'?/已取消/:/已完成/);
    assert.doesNotMatch(result.subscription.vehicleStageText,/待交付|换车|当前交付/);
  }
  const unknown=await dashboard({...base('UNKNOWN'),vehicle:null,activeChangeId:'unverified-change'});
  assert.doesNotMatch(unknown.result.subscription.vehicleStageText,/换车/);
});
function usePage(result){
  let definition;const navigations=[];
  vm.runInNewContext(fs.readFileSync(path.join(sourceRoot,'pages/use/index.js'),'utf8'),{Page:v=>definition=v,require:name=>name.includes('/services/')?{getDashboard:async()=>result}:{go:url=>navigations.push(url),load:async(p,fn)=>{const value=await fn();p.setData({...value,loading:false});return value;}}});
  return {page:{...definition,data:structuredClone(definition.data),setData(value){Object.assign(this.data,value)}},navigations};
}
test('initial-order page gives the true next step and opens exactly that order with no signing action',async()=>{
  for(const [status,pattern] of [['AWAITING_SIGNATURE',/签署.*运营|运营.*合同/],['AWAITING_PAYMENT',/账单.*支付/],['AWAITING_HANDOVER',/交接|交付/]]){
    const {result,calls}=await dashboard(base(status));const env=usePage(result);await env.page.reload();
    assert.match(env.page.data.nextStep,pattern);assert.equal(env.page.data.showDrivingServices,false);
    assert.doesNotMatch(env.page.data.nextStep,/立即签|已完成签|已支付|已交付/);
    env.page.openSubscription();assert.equal(env.navigations.at(-1),'/pages/record/index?type=orders&id=order-offline');
    assert.deepEqual(calls,['GET']);
  }
});
test('active services and stage guidance follow refreshed order state, including no subscription',async()=>{
  const {result}=await dashboard({...base('ACTIVE'),currentAssignment:current});const env=usePage(result);await env.page.reload();
  assert.equal(env.page.data.showDrivingServices,true);assert.equal(env.page.data.nextStep,'');
  result.subscription=null;await env.page.reload();assert.equal(env.page.data.showDrivingServices,false);assert.equal(env.page.data.nextStep,'');
  env.page.openSubscription();assert.equal(env.navigations.length,0);
});
