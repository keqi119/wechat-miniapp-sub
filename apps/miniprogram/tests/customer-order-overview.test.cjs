const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const sourceRoot=path.resolve(process.env.MINIAPP_SOURCE_ROOT||process.env.MINIAPP_SOURCE_DIR||path.join(__dirname,'../src'));
const {createApi}=require(path.join(sourceRoot,'services/api'));
const config=require(path.join(sourceRoot,'config'));
const {orderRecord,related}=require('./fixtures/customer-order-overview.cjs');
async function setup(record=orderRecord(),type='orders'){
  const calls=[],navigations=[],dialogs=[],files=[];let current=record,fail=false,fileFail=false,definition;
  const platform={getStorageSync:()=>({token:'offline-token',expiresAt:'2099-01-01T00:00:00Z',customer:{id:'offline-customer'}}),showModal:v=>{dialogs.push(v);v.success?.({confirm:true});},setNavigationBarTitle(){}};
  const api=createApi(config,request=>{calls.push({method:request.method,url:request.url});if(fail)return request.fail({});request.success({statusCode:200,data:structuredClone(current)});},platform);
  const helpers={...require(path.join(sourceRoot,'utils/page')),go:url=>navigations.push(url)};
  const services={...api,async openPrivateFile(id){files.push(id);if(fileFail)throw Error('离线文件暂不可用');}};
  vm.runInNewContext(fs.readFileSync(path.join(sourceRoot,'pages/record/index.js'),'utf8'),{Page:v=>definition=v,wx:platform,require:name=>name.includes('/services/')?services:name.includes('/utils/page')?helpers:require(path.resolve(sourceRoot,'pages/record',name))});
  const page={...definition,data:structuredClone(definition.data),setData(v){Object.assign(this.data,v)}};
  page.setData({type,id:record.id});await page.reload();
  return {page,calls,navigations,dialogs,files,set:v=>current=v,fail:()=>fail=true,fileFail:()=>fileFail=true};
}
test('order view preserves server confirmed summary, section rows and pending contract without granting sign or pay',async()=>{
  const env=await setup();assert.equal(env.page.data.order.available,true);
  assert.equal(env.page.data.order.vehicle.title,'ET5T · 离线合成订阅车辆');
  assert.equal(env.page.data.order.summaryRows[0].value,'¥0.01');assert.equal(env.page.data.order.summaryRows[1].value,'¥0.00');
  assert.equal(env.page.data.order.contracts[0].canSign,false);assert.equal(env.page.data.showOrderTerms,false);
  env.page.toggleOrderTerms();assert.equal(env.page.data.showOrderTerms,true);assert.equal(env.calls.some(c=>c.method!=='GET'),false);
});
test('order links are limited to authoritative related records and open read-only details',async()=>{
  const record=orderRecord({detail:{contracts:[related('c1','合同','PENDING','/pages/record/index?type=contracts&id=c1',{canSign:true})],bills:[related('b1','首期账单','PENDING','/pages/record/index?type=bills&id=b1',{amountText:'¥0.01',canPay:true})],handovers:[related('h1','交车单','PUBLISHED','/pages/handover/index?id=h1')]}});
  const env=await setup(record);
  for(const [group,id,url]of [['contracts','c1','/pages/record/index?type=contracts&id=c1'],['bills','b1','/pages/record/index?type=bills&id=b1'],['handovers','h1','/pages/handover/index?id=h1']]){env.page.openOrderRelated({currentTarget:{dataset:{group,id}}});assert.equal(env.navigations.at(-1),url);}
  env.page.openOrderRelated({currentTarget:{dataset:{group:'contracts',id:'forged'}}});assert.equal(env.navigations.length,3);assert.ok(env.dialogs.at(-1)?.content);assert.equal(env.calls.some(c=>c.method!=='GET'),false);
});
test('old or mismatched DTO displays explicit unavailable overview without raw snapshot and formats known legacy time in Beijing',async()=>{
  for(const change of [r=>delete r.orderDetail,r=>r.orderDetail.version=2,r=>r.orderDetail.orderId='another-order']){
    const r=orderRecord();change(r);r.planSnapshot={internalMarker:'never expose raw payload'};
    const env=await setup(r);assert.equal(env.page.data.order.available,false);assert.equal(env.page.data.order.statusText,'待签约');assert.equal(env.page.data.order.createdAtText,'2026-10-26 01:10:00（北京时间）');assert.equal(env.page.data.order.planSnapshot,undefined);
  }
  const currentSummary=orderRecord({record:{orderDetail:undefined,createdAt:undefined,createdAtText:'2026-10-26 01:10（北京时间）'}});
  const summary=await setup(currentSummary);assert.equal(summary.page.data.order.createdAtText,'2026-10-26 01:10（北京时间）');
});
test('order file and reload failures are floating feedback and do not create a business action',async()=>{
  const r=orderRecord();r.orderDetail.contracts[0].documents=[{id:'file-offline',title:'本单合同',url:'/api/customer/files/file-offline'}];const env=await setup(r);
  env.fileFail();await env.page.openOrderDocument({currentTarget:{dataset:{group:'contracts',id:'offline-contract',fileId:'file-offline'}}});assert.deepEqual(env.files,['file-offline']);assert.match(env.dialogs.at(-1)?.content||'',/文件暂不可用/);assert.equal(env.page.data.message,'');
  env.fail();await env.page.refreshOrder();assert.ok(env.dialogs.at(-1)?.content);assert.equal(env.page.data.busy,false);assert.equal(env.calls.some(c=>c.method!=='GET'),false);
});
test('same-session refresh preserves expanded details and switching to a non-order preserves its existing record view',async()=>{
  const env=await setup();env.page.toggleOrderTerms();await env.page.reload();assert.equal(env.page.data.showOrderTerms,true);
  const bill={id:'bill-offline',title:'实际账单',status:'PENDING',amountText:'¥0.01',details:[{label:'金额',value:'¥0.01'}],actions:[{id:'pay',label:'立即支付'}]};env.set(bill);env.page.setData({id:bill.id,type:'bills'});await env.page.reload();
  assert.equal(env.page.data.order,null);assert.equal(env.page.data.record.title,'实际账单');assert.equal(env.page.data.record.actions[0].id,'pay');
});
test('malformed overview rows or related records fall back without partially trusted information',async()=>{
  for(const change of [r=>r.orderDetail.sections=[null],r=>r.orderDetail.contracts=[null],r=>r.orderDetail.summaryRows=[{label:'费用',value:1}]]){
    const record=orderRecord();change(record);const env=await setup(record);assert.equal(env.page.data.error,'');assert.equal(env.page.data.order.available,false);
  }
});
test('forged URLs and files cannot escape authoritative order records',async()=>{
  const record=orderRecord();record.orderDetail.contracts[0].url='https://outside.invalid/sign';const env=await setup(record);
  env.page.openOrderRelated({currentTarget:{dataset:{group:'contracts',id:'offline-contract'}}});
  await env.page.openOrderDocument({currentTarget:{dataset:{group:'contracts',id:'offline-contract',fileId:'another-file'}}});
  assert.equal(env.navigations.length,0);assert.equal(env.files.length,0);assert.equal(env.dialogs.length,2);assert.equal(env.calls.some(c=>c.method!=='GET'),false);
});
if(process.env.MINIAPP_ORDER_DTO_FIXTURE)test('actual server-produced synthetic DTO is accepted without rewriting authoritative values',async()=>{
  const fixture=JSON.parse(fs.readFileSync(process.env.MINIAPP_ORDER_DTO_FIXTURE,'utf8'));
  assert.equal(fixture.synthetic,true);const env=await setup(fixture.record);
  assert.equal(env.page.data.order.available,true);assert.equal(env.page.data.order.vehicle.title,fixture.record.orderDetail.vehicle.title);
  assert.deepEqual(JSON.parse(JSON.stringify(env.page.data.order.summaryRows)),fixture.record.orderDetail.summaryRows);
  assert.equal(env.page.data.order.createdAtText,fixture.record.orderDetail.createdAtText);
  assert.equal(env.calls.some(c=>c.method!=='GET'),false);
});
module.exports={setup};
