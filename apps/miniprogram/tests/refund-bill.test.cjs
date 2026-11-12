const test=require('node:test');const assert=require('node:assert/strict');
const {workspaceView}=require('../src/utils/offline-order');
const raw={orderId:'order-1',mode:'OFFLINE',stage:'AWAITING_PAYMENT',contracts:[],handovers:[],parties:[],capabilities:{canPay:true}};
const bill={id:'bill-1',type:'SUBSCRIPTION',status:'PENDING',amount:369900,paidAmount:269900,dueDate:'2026-11-05',canPay:true};
test('refunded partial invoice shows and pays only its outstanding balance',()=>{const v=workspaceView({...raw,billing:[bill]},raw.orderId);assert.equal(v.bills[0].canPay,true);assert.equal(v.hasPendingBills,true);assert.match(v.bills[0].amountText,/1,?000/);});
test('server refusal, cancellation, paid bills and invalid balances cannot open payment',()=>{for(const data of [{canPay:false},{cancellation:{status:'OPEN'}},{status:'PAID'},{paidAmount:369900},{paidAmount:-1},{paidAmount:370000}])assert.equal(workspaceView({...raw,billing:[{...bill,...data}]},raw.orderId).bills[0].canPay,false);});
