import {test} from 'node:test';
import assert from 'node:assert/strict';
import {orderRecordSummary} from '../src/orders/customer-order-view';
import {WorkflowsController} from '../src/operations/workflows';
test('order lists retain the persisted mode for their correct detail route',()=>{
 for(const contractMode of ['OFFLINE','ESIGN'])assert.equal(orderRecordSummary({id:'order',status:'ACTIVE',contractMode,finalPlanSnapshot:{monthlyFeeAmount:1},createdAt:new Date()}).contractMode,contractMode);
});
test('service applications select the named customer order when multiple leases exist',async()=>{
 const selected=new Error('selected');const tx:any={serviceRequest:{findUnique:async()=>null},order:{findFirst:async({where}:any)=>{assert.deepEqual(where,{id:'second-order',customerId:'customer',status:'ACTIVE'});throw selected;}}},db:any={serial:async(fn:any)=>fn(tx)};
 const controller=new WorkflowsController(db,{} as any,{} as any);
 await assert.rejects(controller.service({orderId:'second-order',type:'benefit',entitlementId:'benefit',location:'合成服务地点',description:'合成服务',mobile:'13900000000',fileIds:[],idempotencyKey:'service-order-selection'},{customer:{id:'customer'}}),e=>e===selected);
});
