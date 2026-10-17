const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLocationEditor, initialLocationData } = require('../src/utils/handover-location');
const { createApi } = require('../src/services/api');
const cap = {enabled:true,mapEnabled:true,policyHash:'a'.repeat(64),notice:{id:'notice1',version:1,title:'交接地点选择说明',content:'合成测试说明'}};
function fixture() {
  let identity={token:'t1',customer:{id:'c1'}}, picker, picks=0, capability=structuredClone(cap);
  const page={data:{...initialLocationData(),busy:false},setData(data){Object.assign(this.data,data);}};
  const platform={getStorageSync:()=>identity,chooseLocation(opts){picks++;picker=opts;}};
  const service={getHandoverLocationCapability:async()=>capability};
  const editor=createLocationEditor(page,service,platform,'session');
  return{page,editor,get picker(){return picker;},get picks(){return picks;},swap(){identity={token:'t2',customer:{id:'c2'}};},setCapability(value){capability=value;}};
}
test('load never locates; map needs explicit current notice consent; output contains text only',async()=>{
  const f=fixture();await f.editor.load();assert.equal(f.picks,0);assert.equal(f.page.data.locationAccepted,false);
  await f.editor.choose();assert.equal(f.picks,0);
  f.editor.accept(true);await f.editor.choose();assert.equal(f.picks,0,'must open the notice before agreeing');
  f.editor.toggleNotice();f.editor.accept(true);const pending=f.editor.choose();await Promise.resolve();await Promise.resolve();assert.equal(f.picks,1);
  f.picker.success({name:'测试入口',address:'测试路100号',latitude:31,longitude:121});await pending;
  assert.deepEqual(f.editor.payload(),{source:'MAP',name:'测试入口',address:'测试路100号',accepted:true,policyHash:cap.policyHash});
  assert.equal(/latitude|longitude/.test(JSON.stringify(f.page.data)),false);
});
test('manual fallback, clear, omitted unchanged saved location and text edit remove map consent',async()=>{
  const f=fixture();f.setCapability({...cap,mapEnabled:false});await f.editor.load({source:'MAP',name:'已提交点',address:'旧地址',consent:{version:1}});
  assert.equal(f.editor.payload(),undefined);
  f.editor.input('address','新地址');assert.deepEqual(f.editor.payload(),{source:'MANUAL',name:'已提交点',address:'新地址'});
  f.editor.clear();assert.equal(f.editor.payload(),null);assert.equal(f.picks,0);
});
test('cancel or denied picker leaves no map data and duplicate clicks launch once',async()=>{
  for(const message of ['chooseLocation:fail cancel','chooseLocation:fail auth deny']){
    const f=fixture();await f.editor.load();f.editor.toggleNotice();f.editor.accept(true);
    const pending=f.editor.choose();await Promise.resolve();await Promise.resolve();await f.editor.choose();assert.equal(f.picks,1);
    f.picker.fail({errMsg:message});await pending;assert.equal(f.editor.payload(),undefined);assert.equal(f.page.data.locationChoosing,false);
  }
});
test('late picker replies after unload or account switch never retain location',async()=>{
  for(const change of ['dispose','swap']){const f=fixture();await f.editor.load();f.editor.toggleNotice();f.editor.accept(true);const pending=f.editor.choose();await Promise.resolve();await Promise.resolve();if(change==='dispose')f.editor.dispose();else f.swap();f.picker.success({name:'不可保留',address:'不可保留的地址',latitude:31,longitude:121});await pending;assert.equal(f.page.data.locationAddress,'');assert.equal(f.editor.payload(),undefined);}
});
test('capability change between opening form and selecting invalidates consent',async()=>{
  const f=fixture();await f.editor.load();f.editor.toggleNotice();f.editor.accept(true);f.setCapability({...cap,policyHash:'b'.repeat(64)});await f.editor.choose();assert.equal(f.picks,0);assert.equal(f.page.data.locationAccepted,false);assert.equal(f.editor.payload(),undefined);
});
test('leaving during capability preflight never opens a hidden-page picker, but native picker hide can return',async()=>{
  const f=fixture();await f.editor.load();f.editor.toggleNotice();f.editor.accept(true);
  let release;f.setCapability(new Promise(resolve=>{release=resolve;}));
  const pending=f.editor.choose();f.editor.hide();release(cap);
  await Promise.resolve();await Promise.resolve();await Promise.resolve();
  if(f.picker)f.picker.success({name:'不可保留',address:'旧页面地址'});
  await pending;assert.equal(f.picks,0);assert.equal(f.editor.payload(),undefined);assert.equal(f.page.data.locationAddress,'');
  const native=fixture();await native.editor.load();native.editor.toggleNotice();native.editor.accept(true);const selecting=native.editor.choose();await Promise.resolve();await Promise.resolve();
  native.editor.hide();native.picker.success({name:'当前页面',address:'本人核对的地点'});await selecting;assert.equal(native.editor.payload().address,'本人核对的地点');
});
test('API serialization drops picker coordinates; omitted amendment remains omitted and explicit null survives',async()=>{
  const calls=[],memory=new Map([['test',{token:'token',customer:{id:'c'},expiresAt:'2099-01-01'}]]);
  const platform={getStorageSync:key=>memory.get(key),setStorageSync:(key,v)=>memory.set(key,v),removeStorageSync:key=>memory.delete(key)};
  const api=createApi({apiBase:'https://example.test',storageKey:'test'},opts=>{calls.push(opts);opts.success({statusCode:200,data:{id:'a1'}});},platform);
  const location={source:'MAP',name:'入口',address:'测试地址',accepted:true,policyHash:cap.policyHash,latitude:31,longitude:121};
  await api.submitApplication({vehicleId:'v',planId:'p',accepted:true,consents:[{documentId:'d',version:1}],profile:{name:'合成测试',handoverLocation:location},idempotencyKey:'key-00001'});
  assert.equal(JSON.stringify(calls).includes('latitude'),false);
  await api.amendApplication('a1',{profile:{name:'测试',fileIds:[]},idempotencyKey:'key-00002'});assert.equal(Object.hasOwn(calls.at(-1).data.profile,'handoverLocation'),false);
  await api.amendApplication('a1',{profile:{name:'测试',fileIds:[],handoverLocation:null},idempotencyKey:'key-00003'});assert.equal(calls.at(-1).data.profile.handoverLocation,null);
});
