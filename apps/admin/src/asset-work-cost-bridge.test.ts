import test from 'node:test';
import assert from 'node:assert/strict';
import {manualPaymentPayload} from './asset-model.ts';
import {costSourceLabel,costPlanWritable} from './asset-work-cost-bridge.ts';

test('cash repair/maintenance/towing retain exact original cost and scoped payment proof; depreciation stays non-cash',()=>{
 const base={revision:7,amount:12345,effect:'COST' as const,lockedAt:null,reversal:null,payments:[],files:[{id:'f',name:'真实付款依据.pdf',mimeType:'application/pdf',size:20,sha256:'a'.repeat(64)}]};
 const values={paidAt:'2026-10-30',referenceNo:'actual-reference',reason:'核对原费用',fileIds:['f']};
 for(const category of ['REPAIR','MAINTENANCE','TOWING'] as const)assert.deepEqual(manualPaymentPayload(values,{...base,category},'2026-10-31'),{revision:7,paidAt:'2026-10-30',referenceNo:'actual-reference',reason:'核对原费用',fileIds:['f']});
 assert.throws(()=>manualPaymentPayload(values,{...base,category:'DEPRECIATION'},'2026-10-31'));
 assert.throws(()=>manualPaymentPayload({...values,fileIds:['other']},{...base,category:'REPAIR'},'2026-10-31'));
});
test('work plans use their dedicated source permission and unknown sources never become depreciation',()=>{
 assert.equal(costSourceLabel('WORK_ORDER'),'工单费用');assert.equal(costSourceLabel('DEPRECIATION'),'折旧');assert.equal(costSourceLabel('unknown'),'来源待核对');
 for(const role of ['ADMIN','FINANCE']){assert.equal(costPlanWritable('WORK_ORDER',role,['asset-cost-plans.read','asset-cost-plans.write','asset-work-order-cost-lines.write']),true);assert.equal(costPlanWritable('WORK_ORDER',role,['asset-cost-plans.read','asset-cost-plans.write','depreciation-policies.write']),false);}
 assert.equal(costPlanWritable('WORK_ORDER','OPERATIONS',['*']),false);assert.equal(costPlanWritable('UNKNOWN','ADMIN',['*']),false);
 assert.equal(costPlanWritable('BAAS','OPERATIONS',['*']),true);assert.equal(costPlanWritable('DEPRECIATION','FINANCE',['*']),true);
});
