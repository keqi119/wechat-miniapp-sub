const test=require('node:test'),assert=require('node:assert/strict');
const {createContractPlanApi}=require('../src/services/contract-plan');
const row=()=>({orderId:'order',orderRevision:3,sourceHash:'a'.repeat(64),canPropose:false,blockers:[],case:{id:'case',kind:'AGREED06',revision:2,state:'VERIFIED',proposalHash:'b'.repeat(64),reason:'合成协商原因',plannedReturnAt:'2026-11-15T10:00:00+08:00',returnPlace:'合成地点'}});
test('customer agreement confirmation uses server-owned case/version/hash and stable command, not client amounts',async()=>{
 let value=row(),token='session';const calls=[];
 const api=createContractPlanApi({call:async(m,p,b)=>{calls.push([m,p,b]);return m==='GET'?value:{...value.case,state:'CONFIRMED'};},identifier:encodeURIComponent,sessionKey:()=>token});
 const read=await api.getContractPlan('order','termination');assert.equal(read.canConfirm,true);
 await api.confirmContractPlan(read);const sent=calls.find(c=>c[0]==='POST');assert.equal(sent[1],'/customer/terminations/case/confirm');assert.deepEqual(sent[2],{revision:2,proposalHash:'b'.repeat(64),accepted:true,idempotencyKey:'contract-plan-case-2-'+ 'b'.repeat(32)});
 token='other';await assert.rejects(api.confirmContractPlan(read),/会话/);
});
test('wrong order, changed proposal and already completed plans cannot be confirmed',async()=>{
 let value=row();const api=createContractPlanApi({call:async()=>value,identifier:encodeURIComponent,sessionKey:()=> 'same'});
 value.orderId='foreign';await assert.rejects(api.getContractPlan('order','termination'),/订单/);
 value=row();let read=await api.getContractPlan('order','termination');value.case.proposalHash='c'.repeat(64);await assert.rejects(api.confirmContractPlan(read),/变化/);
 value.case.state='ARCHIVED';read=await api.getContractPlan('order','termination');assert.equal(read.canConfirm,false);await assert.rejects(api.confirmContractPlan(read));
});

test('06 actual amount responses pin receipt, source and prior response; unknown writes retain the exact command',async()=>{
 let value=row();value.case.state='ARCHIVED';value.settlementSource={orderId:'order',hash:'d'.repeat(64),actualReceiptAt:'2026-11-15T02:00:00Z',amounts:{remainingRentAmount:1000,compensationAmount:200,stopAt:'2026-11-15T02:00:00Z'},depositBalanceAmount:100,periods:[{sequence:1,startDate:'2026-11-01',endDate:'2026-12-01',amount:1000}],paymentReferences:[{paymentId:'payment',amount:1000}],responses:{version:0,headId:null,current:null,history:[]}};let unknown=true,token='same';const posts=[];
 const api=createContractPlanApi({call:async(m,p,b)=>{if(m==='GET')return value;posts.push([p,b]);if(unknown)throw Error('network');return{id:'response'};},identifier:encodeURIComponent,sessionKey:()=>token,idempotencyKey:()=> 'exact-exit-command'});
 const view=await api.getContractPlan('order','termination');assert.equal(view.settlement.remainingRentText,'¥10.00');assert.equal(view.settlement.canConfirm,true);
 await assert.rejects(api.respondExitAmounts(view,'CONFIRM','已核对实际还车金额'),/network/);await assert.rejects(api.respondExitAmounts(view,'OBJECT','改为异议'),/未知/);unknown=false;await api.respondExitAmounts(view,'CONFIRM','已核对实际还车金额');assert.deepEqual(posts[0],posts[1]);assert.equal(posts[0][0],'/customer/orders/order/exit-amounts/respond');assert.equal(posts[0][1].sourceHash,'d'.repeat(64));assert.equal(posts[0][1].responseVersion,0);
 value.settlementSource.responses.version=1;value.settlementSource.responses.headId='new';await assert.rejects(api.respondExitAmounts(view,'OBJECT','新异议'),/变化/);token='other';await assert.rejects(api.respondExitAmounts(view,'OBJECT','异议'),/会话|本人/);
});
