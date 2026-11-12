const {test}=require('node:test');
const assert=require('node:assert/strict');
const {workspaceView}=require('../src/utils/offline-order');
const {renderPage}=require('./helpers/wxml-view.cjs');
const base={orderId:'o',mode:'OFFLINE',stage:'AWAITING_PAYMENT',contracts:[],parties:[],handovers:[],capabilities:{canPay:true}};
test('bills expose deposit, actual rental sequence and verified service period, and actual fee descriptions',()=>{
 const bills=[{id:'d',type:'DEPOSIT',sequence:1},{id:'r1',type:'SUBSCRIPTION',sequence:1,period:{sequence:1,startDate:'2026-10-31',endDate:'2026-11-30'}},{id:'r3',type:'SUBSCRIPTION',sequence:3,period:{sequence:3,startDate:'2026-12-31',endDate:'2027-01-31'}},{id:'fee',type:'OTHER',description:'右前轮轮胎更换费用'}].map(b=>({...b,status:'PENDING',amount:100,paidAmount:0,dueDate:'2026-10-30'}));
 const view=workspaceView({...base,billing:bills},'o');
 assert.equal(view.bills[0].reasonText,'押金');assert.equal(view.bills[1].reasonText,'首期租金');assert.equal(view.bills[2].reasonText,'第3期租金');assert.match(view.bills[1].periodText,/2026.10.31.*2026.11.30.*末日不含/);assert.equal(view.bills[3].description,'右前轮轮胎更换费用');
 const text=renderPage('order-detail',{order:view,loading:false,summaryRows:[],insurance:{coverage:{}},entitlements:[]});
 assert.doesNotMatch(text,/线上确认查验事实，纸质交接单单独归档/);
 for(const word of ['押金','首期租金','第3期租金','2026.10.31','右前轮轮胎更换费用'])assert.ok(text.includes(word),word);
 const unknown=workspaceView({...base,billing:[{...bills[1],period:null}]},'o').bills[0];assert.match(unknown.periodText,/待核对/);
});
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{createRequire}=require('node:module');
test('bill detail and payment confirmation show actual reason period and amount',async()=>{
 let definition,dialog;
 const record={id:'bill1',type:'bills',billType:'SUBSCRIPTION',amount:100,amountText:'¥1.00',title:'账单',status:'PENDING',description:'正式租金',period:{sequence:2,startDate:'2026-11-30',endDate:'2026-12-31'},actions:[{id:'pay',label:'支付'}],details:[],documents:[],timeline:[]};
 const services={renewalSessionStamp:()=> 'session',getRecord:async()=>record,performAction:async()=>({message:'已核对'})};
 const file=path.resolve(__dirname,'../src/pages/record/index.js'),realRequire=createRequire(file);
 const helpers={load:async(p,work)=>{const result=await work();p.setData({...result,loading:false});return result;},confirm:async(title,body)=>{dialog=body;return false;},toastError:e=>{throw e;}};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{Page:v=>definition=v,require:name=>name.includes('/services/')?services:name==='../../utils/page'?helpers:realRequire(name)});
 const page={...definition,data:{...structuredClone(definition.data),type:'bills',id:'bill1'},setData(v){Object.assign(this.data,v);}};
 await page.reload();const text=renderPage('record',page.data);assert.match(text,/第2期租金/);assert.match(text,/2026.11.30/);
 page._recordSession='session';await page.act({currentTarget:{dataset:{action:'pay'}}});assert.match(dialog,/第2期租金/);assert.match(dialog,/2026.11.30/);assert.match(dialog,/¥1.00/);
});

test('pending actual delivery period is explained without treating unknown dates as verified',()=>{
 const {billDetails}=require('../src/utils/offline-order');
 const pending={type:'SUBSCRIPTION',period:{sequence:1,startDate:null,endDate:null,basis:'PENDING_HANDOVER'}};
 assert.equal(billDetails(pending).reasonText,'首期租金');
 assert.equal(billDetails(pending).periodText,'服务期以实际交车记录为准');
 assert.equal(billDetails({...pending,period:{...pending.period,basis:'UNVERIFIED'}}).periodText,'服务期待核对');
});
for(const [type,label] of Object.entries({MILEAGE_EXCESS:'超里程费用',DEPOSIT_ADJUSTMENT:'押金调整',DELAY_ADJUSTMENT:'延期费用',RETURN_SETTLEMENT:'还车结算费用',EXTRA_FEE:'附加费用',PAYMENT_TEST:'测试支付'}))test('actual bill type '+type+' retains its reason and original fee description',()=>{
 const {billDetails}=require('../src/utils/offline-order');
 const detail=billDetails({billType:type,type:'bills',description:' 本笔费用实际说明 ',amount:100});
 assert.equal(detail.reasonText,label);assert.equal(detail.description,'本笔费用实际说明');
});
test('pending handover message renders once in the order bill and generic bill detail',()=>{
 const {billDetails}=require('../src/utils/offline-order');
 const detail=billDetails({billType:'SUBSCRIPTION',period:{sequence:1,startDate:null,endDate:null,basis:'PENDING_HANDOVER'}});
 const order=workspaceView({...base,billing:[{id:'b',type:'SUBSCRIPTION',status:'PENDING',amount:100,paidAmount:0,period:{sequence:1,startDate:null,endDate:null,basis:'PENDING_HANDOVER'}}]},'o');
 const orderText=renderPage('order-detail',{order,loading:false,insurance:{coverage:{}},entitlements:[]});
 const recordText=renderPage('record',{loading:false,type:'bills',record:{id:'b',title:'首期租金',billDetails:detail,details:[],timeline:[],documents:[],actions:[]}});
 for(const text of [orderText,recordText]){assert.match(text,/服务期以实际交车记录为准/);assert.doesNotMatch(text,/服务期 服务期/);}
});
