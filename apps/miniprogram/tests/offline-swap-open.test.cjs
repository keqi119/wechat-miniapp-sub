const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup,termAccount,rule,goods}=require('./fixtures/offline-swap-open.cjs');
const {renderPage}=require('./helpers/wxml-view.cjs');

test('current renewal swap period differs from original account and a prepared later period without rewriting either',async()=>{
 const f=setup(),v=await f.api.getSwapAccount('o1');assert.equal(v.startedOn,'2025-10-01');assert.equal(v.endDate,'2028-09-30');assert.equal(v.term.startDate,'2026-10-01');assert.equal(v.term.endDate,'2027-10-01');assert.equal(v.serviceStageId,'stage-renewal');assert.equal(v.canRequest,true);assert.equal(v.canPurchase,true);
 for(const change of [{stageSourceHash:null},{serviceStageId:'',stageSourceHash:'e'.repeat(64)},{term:{...termAccount().term,startDate:'2024-10-01'}},{term:{...termAccount().term,endDate:'2029-10-01'}}]){f.set(termAccount(change));await assert.rejects(f.api.getSwapAccount('o1'),{code:'RESPONSE'});}
});

test('old-stage free ordinals and legacy cycle history remain readable beside a different current gift count',async()=>{
 const f=setup(termAccount({reservations:[{id:'old-r',changeId:'old-change',source:'FREE',status:'CONSUMED',scope:'TERM',termSequence:5,serviceStageId:'stage-old'}],ledger:[{id:'legacy',type:'CONSUME',source:'FREE',cycleSequence:1,serviceStageId:null,changeId:'legacy-change',recordedAt:'2025-10-31T00:00:00Z'}]}));
 const v=await f.api.getSwapAccount('o1');assert.equal(v.term.includedCount,1);assert.equal(v.reservations[0].termSequence,5);assert.equal(v.ledger[0].cycleSequence,1);
 f.set(termAccount({reservations:[{id:'wrong',changeId:'c',source:'FREE',status:'RESERVED',scope:'TERM',termSequence:5,serviceStageId:'stage-renewal'}]}));await assert.rejects(f.api.getSwapAccount('o1'),{code:'RESPONSE'});
});

test('actual OFFLINE account entry and records page expose only current server-approved requests and dynamic purchases',async()=>{
 const f=setup(),home=f.page('use');await home.reload();assert.match(renderPage('use',home.data),/换车次数与申请/);home.openSwapAccount();assert.match(f.navigations.at(-1),/entitlements&orderId=o1/);
 const p=f.page('records',{type:'entitlements',orderId:'o1'});await p.reload();let text=renderPage('records',p.data);assert.match(text,/提交换车申请/);assert.match(text,/选择目标车型加购/);assert.doesNotMatch(text,/创建321元一次普通账单/);assert.doesNotMatch(text,/当前线下订单未开放|未使用也失效且费用不退|未使用费用不退/);
 p.setData({swapReason:'同价或升级真实需求'});await p.requestSwap();assert.equal(f.calls.filter(c=>c.route.endsWith('/vehicle-changes')&&c.method==='POST').length,1);
 p.setData({swapPurchaseAccepted:true});await p.buySwapCredit();const body=f.calls.find(c=>c.route.endsWith('/swap-credits')&&c.method==='POST').data;assert.equal(body.pricingHash,goods.pricingHash);assert.equal(body.amount,undefined);assert.doesNotMatch(f.dialogs.at(-1).content,/费用不退/);assert.equal(p.data.swapPurchase.bill.amount,32100);
});

test('blocked current capabilities refuse service writes and a failed submission retries the exact original request key',async()=>{
 const f=setup(termAccount({canRequest:false,canPurchase:false,blockers:['原合同待核对'],purchaseBlockers:['尚未正式开放']}));
 const p=f.page('records',{type:'entitlements',orderId:'o1'});await p.reload();assert.doesNotMatch(renderPage('records',p.data),/提交换车申请|创建321元一次普通账单/);
 await assert.rejects(f.api.requestVehicleChange('o1',{reason:'真实需求'}),{code:'SWAP_UNAVAILABLE'});assert.equal(f.calls.some(c=>c.method==='POST'),false);
 f.set(termAccount());f.fail(503);await assert.rejects(f.api.requestVehicleChange('o1',{reason:'真实需求'}));f.fail(null);await f.api.requestVehicleChange('o1',{reason:'真实需求'});const writes=f.calls.filter(c=>c.method==='POST');assert.equal(writes[0].data.idempotencyKey,writes[1].data.idempotencyKey);
});
