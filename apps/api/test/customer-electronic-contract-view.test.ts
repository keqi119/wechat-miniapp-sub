import test from 'node:test';
import assert from 'node:assert/strict';
import {customerContractRecord} from '../src/orders/customer-contract-view';

test('electronic contract summary routes to the bound three-party workspace without legacy signing capabilities',async()=>{
 const order:any={id:'order',customerId:'customer',contractMode:'ELECTRONIC',finalPlanSnapshot:{commercialTerms:{vehicleIdentification:'合成车辆'}}};
 const c:any={id:'contract',orderId:order.id,customerId:'customer',executionMode:'ELECTRONIC',kind:'SUBSCRIPTION',status:'PENDING',order,createdAt:new Date(),updatedAt:new Date()};
 const task:any={id:'task',orderId:'order',customerId:'customer',contractId:'contract',status:'SIGNING',parties:[{role:'CUSTOMER',subjectId:'customer',status:'SIGNED'},{role:'OWNER',status:'SIGNED'},{role:'PLATFORM',status:'PENDING'}]};
 const db:any={electronicSigningTask:{findFirst:async(q:any)=>{assert.equal(q.where.customerId,'customer');assert.equal(q.where.orderId,'order');assert.equal(q.where.contractId,'contract');return task;}}};
 let result=await customerContractRecord(db,'customer',c);
 assert.equal(result.contractDetail.executionMode,'ELECTRONIC');
 assert.equal(result.contractDetail.phaseText,'待签署');
 assert.doesNotMatch(result.contractDetail.guidance.description,/关闭|纸质|人工签署/);
 assert.equal(result.contractDetail.canSign,false);
 assert.equal(result.contractDetail.canQuery,false);
 assert.match(result.contractDetail.workspaceUrl,/electronic-contracts\/index\?orderId=order/);
 task.parties[2].status='SIGNED';result=await customerContractRecord(db,'customer',c);assert.equal(result.contractDetail.phaseText,'待归档');
 Object.assign(task,{status:'ARCHIVED',archivedAt:new Date(),finalFileId:'signed',archiveVersion:{status:'ARCHIVED'}});
 result=await customerContractRecord(db,'customer',c);assert.equal(result.contractDetail.phaseText,'已归档');
 task.customerId='foreign';result=await customerContractRecord(db,'customer',c);assert.notEqual(result.contractDetail.phaseText,'已归档');assert.equal(result.contractDetail.taskId,null);
});
