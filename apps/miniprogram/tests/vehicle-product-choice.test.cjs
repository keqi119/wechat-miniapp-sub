const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module');
function setup(options={}){
 const navigations=[],wx={navigateTo:o=>{navigations.push(o.url);o.success?.({});}},pending=[];
 const service={getVehicle:()=>new Promise(resolve=>pending.push(resolve))};let definition;
 const helper={module:{exports:{}},wx,require:createRequire(path.join(__dirname,'../src/utils/page.js'))};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/utils/page.js'),'utf8'),helper);
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/pages/vehicle/index.js'),'utf8'),{Page:d=>definition=d,require:p=>p.includes('services')?service:helper.module.exports,wx});
 const page={...definition,data:structuredClone(definition.data),setData(v){Object.assign(this.data,v);}};page.onLoad({vehicleId:'vehicle',...options});
 const result=plans=>({vehicle:{id:'vehicle',available:true},plans,report:null});return{page,navigations,pending,result};
}
const plans=()=>[{id:'12months',available:true,monthlyFeeAmount:320000},{id:'24months',available:true,monthlyFeeAmount:280000}];
test('vehicle offers multiple products and preserves the exact explicit choice through refresh',async()=>{
 const f=setup(),read=f.page.refresh();f.pending.shift()(f.result(plans()));await read;
 f.page.selectPlan({currentTarget:{dataset:{id:'24months'}}});const next=f.page.refresh();f.page.apply();assert.deepEqual(f.navigations,[],'no application while current product availability is being refreshed');f.pending.shift()(f.result(plans()));await next;
 assert.equal(f.page.data.selectedPlan.id,'24months');f.page.apply();assert.deepEqual(f.navigations,['/pages/application/index?vehicleId=vehicle&planId=24months']);
});
test('withdrawn selected product does not silently substitute another product, including consecutive refreshes',async()=>{
 const f=setup({planId:'24months'}),first=f.page.refresh();f.pending.shift()(f.result(plans()));await first;assert.equal(f.page.data.selectedPlan.id,'24months');
 for(let i=0;i<2;i++){const read=f.page.refresh();f.pending.shift()(f.result([plans()[0],{...plans()[1],available:false}]));await read;assert.equal(f.page.data.selectedPlan,null);f.page.apply();assert.deepEqual(f.navigations,[]);assert.match(f.page.data.selectionNotice,/重新选择/);}
 f.page.selectPlan({currentTarget:{dataset:{id:'12months'}}});assert.equal(f.page.data.selectionNotice,'');f.page.apply();assert.ok(f.navigations[0].endsWith('planId=12months'));
});
test('an older vehicle response cannot replace the latest selected product list',async()=>{
 const f=setup(),old=f.page.refresh(),latest=f.page.refresh();f.pending[1](f.result([plans()[1]]));await latest;f.pending[0](f.result([plans()[0]]));await old;assert.equal(f.page.data.selectedPlan.id,'24months');
});
test('returning from the application retains the chosen product identifier',()=>{
 let definition;const urls=[];vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/pages/application/index.js'),'utf8'),{Page:d=>definition=d,require:p=>p.includes('utils/page')?{go:url=>urls.push(url)}:p.includes('handover-location')?{initialLocationData:()=>({})}:{},wx:{}});
 definition.returnVehicle.call({vehicleId:'vehicle',planId:'24months'});assert.deepEqual(urls,['/pages/vehicle/index?vehicleId=vehicle&planId=24months']);
});
test('even the initial default choice is never silently replaced after withdrawal',async()=>{
 const f=setup(),first=f.page.refresh();f.pending.shift()(f.result(plans()));await first;
 for(let i=0;i<2;i++){const read=f.page.refresh();f.pending.shift()(f.result([plans()[1]]));await read;assert.equal(f.page.data.selectedPlan,null);}
});
