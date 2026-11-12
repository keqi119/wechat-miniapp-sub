import test from 'node:test';
import assert from 'node:assert/strict';
import {JourneyHarness} from './seven-module-journey-fixtures';
import {offlineOrder} from './offline-fixtures';
test('mounted electronic workspace and paginated lists retain current role restrictions',async()=>{
 const h=new JourneyHarness();try{await h.start();const f=await offlineOrder(h.db);await h.db.order.update({where:{id:f.order.id},data:{contractMode:'ELECTRONIC'}});
 const route='/admin/electronic-documents/workspace/'+f.order.id;
 for(const actor of [h.maker,h.finance,h.support]){const view=await h.get(route,actor);assert.equal(view.contractMode,'ELECTRONIC');assert.equal(view.permissions.prepare,actor===h.maker);assert.ok(view.readiness.some((r:any)=>r.missing.some((m:any)=>m.field==='V31_BUSINESS_MISMATCH')));assert.equal('finalPlanSnapshot' in view,false);}
 const list=await h.get('/admin/electronic-documents?orderId='+f.order.id+'&page=2&pageSize=100');assert.equal(list.total,0);assert.equal(list.page,2);assert.equal(list.pageSize,100);
 await h.reject(route,undefined,h.field,'FORBIDDEN');assert.equal(h.externalCalls+h.esignCalls+h.payment.providerCalls,0);
 }finally{await h.close();}
});
