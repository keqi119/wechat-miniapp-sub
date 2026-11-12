import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recordView} from '../src/orders/customer';
import {workspaceProjection} from '../src/offline-documents/workspace.service';
import {withBillPeriods} from '../src/billing/display';

const period={sequence:1,startDate:'2026-11-01',endDate:'2026-12-01',basis:'ACTUAL'};
const bill={id:'bill',orderId:'order',customerId:'customer',type:'SUBSCRIPTION',sequence:1,status:'PENDING',amount:100,paidAmount:0,description:'流程测试产品首期月租',period,dueDate:new Date('2026-11-01T00:00:00Z')};
test('generic customer bill preserves resource type and exposes concrete bill type and actual period',()=>{
 const result:any=recordView('bills',bill);
 assert.equal(result.type,'bills');assert.equal(result.billType,'SUBSCRIPTION');assert.deepEqual(result.period,period);assert.equal(result.description,bill.description);
});
test('offline workspace keeps the same bill purpose and verified period',()=>{
 const result=workspaceProjection({id:'order',customerId:'customer',contractMode:'OFFLINE',status:'ACTIVE',finalPlanSnapshot:{commercialHash:'hash'},bills:[bill],handovers:[]},[],{id:'customer',role:'CUSTOMER'});
 assert.equal(result.billing[0].type,'SUBSCRIPTION');assert.equal((result.billing[0] as any).description,bill.description);assert.deepEqual((result.billing[0] as any).period,period);
});
test('bill display reads actual service months and agreed adjustment periods without using payment due dates',async()=>{
 const original={...bill,dueDate:new Date('2026-10-25'),period:undefined};
 const adjustment={...original,id:'adjustment',type:'SWAP_ADJUSTMENT',sequence:88};
 const tx:any={order:{findMany:async()=>[{id:'order',customerId:'customer',status:'ACTIVE'}]},usagePeriod:{findMany:async()=>[{orderId:'order',sequence:1,startDate:new Date('2026-11-01'),endDate:new Date('2026-12-01'),serviceStageId:null}]},serviceObligation:{findMany:async()=>[{orderId:'order',sequence:3,chargeBillId:'adjustment',startDate:new Date('2027-01-01'),endDate:new Date('2027-02-01')}]}};
 const before=JSON.stringify([original,adjustment]),result=await withBillPeriods(tx,[original,adjustment]);
 assert.deepEqual(result[0].period,period);assert.deepEqual(result[1].period,{sequence:3,startDate:'2027-01-01',endDate:'2027-02-01',basis:'AGREED'});assert.equal(JSON.stringify([original,adjustment]),before);
});
test('unstarted first rent is identified without inventing a service date and foreign sources are hidden',async()=>{
 const tx:any={order:{findMany:async()=>[{id:'order',customerId:'customer',status:'AWAITING_PAYMENT'}]},usagePeriod:{findMany:async()=>[{orderId:'other',sequence:1,startDate:new Date('2020-01-01'),endDate:new Date('2020-02-01')}]},serviceObligation:{findMany:async()=>[]}};
 const result=await withBillPeriods(tx,[{...bill,period:undefined},{...bill,id:'foreign',customerId:'other'}]);
 assert.deepEqual(result[0].period,{sequence:1,startDate:null,endDate:null,basis:'PENDING_HANDOVER'});assert.equal(result[1].period,null);
});
test('renewal service period must match the bill stage',async()=>{
 const tx:any={order:{findMany:async()=>[{id:'order',customerId:'customer',status:'ACTIVE'}]},usagePeriod:{findMany:async()=>[{orderId:'order',sequence:13,serviceStageId:'foreign-stage',startDate:new Date('2027-11-01'),endDate:new Date('2027-12-01')}]},serviceObligation:{findMany:async()=>[]}};
 const result=await withBillPeriods(tx,[{...bill,sequence:13,serviceStageId:'renewal-stage'}]);
 assert.equal(result[0].period?.basis,'UNVERIFIED');assert.equal(result[0].period?.startDate,null);
});
