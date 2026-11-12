import test from 'node:test';
import assert from 'node:assert/strict';
import {exitCashLines} from '../src/billing/refund-exit-cash';
test('exact exit cash mapping excludes unpaid relief and prior03 refund excess',async()=>{
 const payment={paymentId:'payment',billId:'bill',billType:'SUBSCRIPTION',amount:10000,transactionId:'synthetic',succeededAt:'2026-11-12T00:00:00Z'},period={sequence:1,startDate:'2026-11-12',endDate:'2026-12-12',amount:10000,stageId:'stage'},statement={scenario:'ACTUAL_RETURN',paymentReferences:[payment],financialObservation:{payments:[{...payment,refundedAmount:0}]},periods:[period],amounts:{stopAt:'2026-11-13T04:00:00Z',compensationAmount:0},occupancyClaim:null};
 let obligation:any={id:'service',sequence:1,amount:10000,sourceBillIds:['bill'],chargeBillId:null,allocations:[]};const tx={bill:{findMany:async()=>[{id:'bill',sequence:1}]},serviceObligation:{findMany:async()=>[obligation]}},money={payments:[payment]};
 assert.equal((await exitCashLines(tx,{id:'order'},statement,money))[0].amount,9500);
 const partial={...payment,amount:4000};assert.equal((await exitCashLines(tx,{id:'order'},{...statement,paymentReferences:[partial],financialObservation:{payments:[{...partial,refundedAmount:0}]}},{payments:[partial]}))[0].amount,3500);
 obligation={...obligation,amount:6000,swapSettlementId:'verified03',allocations:[{id:'allocation',paymentId:'payment',amount:6000}]};const swapped={...statement,amounts:{...statement.amounts,stopAt:'2026-12-02T00:00:00+08:00'}};
 assert.equal((await exitCashLines(tx,{id:'order'},swapped,money))[0].amount,3333,'4000 already released from service remains the03 debt, not a second exit refund');
 assert.equal((await exitCashLines(tx,{id:'order'},{...swapped,financialObservation:{payments:[{...payment,refundedAmount:4000}]}},money))[0].amount,3333,'performing that03 refund does not change exit principal');
});
