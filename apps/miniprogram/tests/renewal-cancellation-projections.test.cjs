const {test}=require('node:test');
const assert=require('node:assert/strict');
const {setup,page,renewal}=require('./fixtures/order-renewals.cjs');
const {workspaceView}=require('../src/utils/offline-order');
const {compile}=require('../scripts/compile-templates.cjs');
const vm=require('node:vm');

test('actual renewal record renders safe cancellation and refuses stale server confirmation flags',async()=>{
 const e=setup();e.set(renewal({status:'AWAITING_FINANCE',quote:{...renewal().quote,status:'CONFIRMED'},cancellation:{id:'cancel1',status:'OPEN',completedAt:null,signatureEvidenceFileIds:['secret']}}));const p=page(e);await p.reload();assert.match(p.data.change.statusText,/取消处理中/);assert.equal(p.data.change.canConfirm,false);assert.equal(p.data.change.canReject,false);assert.equal(JSON.stringify(p.data.change).includes('secret'),false);
 const compiled=compile(),render=vm.runInNewContext('(function(global){'+compiled.wxml+'})({})',{window:{},console});const tree=render('pages/record/index.wxml')({...p.data,loading:false});assert.match(JSON.stringify(tree),/取消处理中/);
 p.setData({changeRead:true,renewalSharingAccepted:true});await p.confirmChange();assert.equal(e.calls.some(c=>c.method==='POST'),false);
 e.set(renewal({status:'CANCELLED',cancellation:{id:'cancel1',status:'COMPLETED',completedAt:'2026-10-31T02:00:00Z'}}));await p.reload();assert.match(p.data.change.statusText,/已取消/);
 e.set(renewal({cancellation:{id:'cancel1',status:'UNKNOWN',completedAt:null}}));await p.reload();assert.equal(p.data.change,null);
});

test('offline order bill capabilities apply per bill and cancellation never changes current bill payment',()=>{
 const v=workspaceView({orderId:'order1',mode:'OFFLINE',stage:'ACTIVE',contracts:[],handovers:[],parties:[],capabilities:{canPay:true},billing:[{id:'old',status:'PENDING',amount:10000,paidAmount:0,canPay:true,cancellation:null},{id:'future',status:'PENDING',amount:20000,paidAmount:0,canPay:false,cancellation:{id:'cancel1',status:'OPEN',completedAt:null}}]},'order1');assert.equal(v.bills[0].canPay,true);assert.equal(v.bills[1].canPay,false);assert.match(v.bills[1].statusText,/取消处理中/);
});

function paymentEnv(){const e=setup(),calls=[],pending=[],original=e.wx.request;let cancelled=true,failPost=false;
 e.wx.request=v=>{const path=new URL(v.url).pathname;calls.push(v);if(path==='/api/customer/records/bills/bill1')return v.success({statusCode:200,data:{id:'bill1',status:'PENDING',cancellation:cancelled?{id:'cancel1',status:'OPEN',completedAt:null}:null,actions:cancelled?[]:[{id:'pay'}]}});if(path==='/api/customer/bills/bill1/pay'){if(failPost)return v.fail({});return v.success({statusCode:200,data:{paymentId:'p1',timeStamp:'1',nonceStr:'n',package:'p',signType:'RSA',paySign:'s'}});}if(path==='/api/customer/payments/p1')return v.success({statusCode:200,data:{id:'p1',status:'PENDING'}});return original(v);};e.wx.requestPayment=v=>{pending.push(v);v.fail({errMsg:'cancel'});};
 return{...e,calls,pending,cancel:v=>cancelled=v,failPost:v=>failPost=v};}

test('pay re-reads cancellation before new payment and retains unknown original idempotency key',async()=>{
 const e=paymentEnv();await assert.rejects(e.api.performAction('bills','bill1','pay',{}));assert.equal(e.calls.some(c=>c.method==='POST'),false);e.cancel(false);e.failPost(true);await assert.rejects(e.api.performAction('bills','bill1','pay',{}));const key=e.calls.find(c=>c.method==='POST').data.idempotencyKey;
 e.cancel(true);await assert.rejects(e.api.performAction('bills','bill1','pay',{}));assert.equal(e.calls.filter(c=>c.method==='POST').length,1);e.cancel(false);e.failPost(false);await e.api.performAction('bills','bill1','pay',{});assert.equal(e.calls.filter(c=>c.method==='POST').at(-1).data.idempotencyKey,key);assert.ok(e.storage.get(require('../src/config').storageKey+':pending:payment'));
});

test('actual bill modal cannot submit after customer session changes',async()=>{
 const e=paymentEnv();e.cancel(false);const p=page(e,'record',{type:'bills',id:'bill1'});await p.reload();assert.equal(p.data.record.actions[0].id,'pay');e.wx.showModal=v=>{e.switchSession();v.success({confirm:true});};await p.act({currentTarget:{dataset:{action:'pay'}}});assert.equal(e.calls.some(c=>c.method==='POST'),false);assert.equal(p.data.record,null);
});

test('an already loaded bill is not relabelled into a different customer session on click',async()=>{
 const e=paymentEnv();e.cancel(false);const p=page(e,'record',{type:'bills',id:'bill1'});await p.reload();e.switchSession();await p.act({currentTarget:{dataset:{action:'pay'}}});assert.equal(e.calls.some(c=>c.method==='POST'),false);assert.equal(p.data.record,null);
});
