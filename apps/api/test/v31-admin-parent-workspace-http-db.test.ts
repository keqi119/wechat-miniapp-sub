import test from 'node:test';
import assert from 'node:assert/strict';
import {JourneyHarness} from './seven-module-journey-fixtures';
import {offlineOrder} from './offline-fixtures';
test('actual parent HTTP mounts authentic electronic process and preserves restricted readers',async()=>{
 const h=new JourneyHarness();try{await h.start();const f=await offlineOrder(h.db);await h.db.order.update({where:{id:f.order.id},data:{contractMode:'ELECTRONIC'}});
 for(const actor of [h.maker,h.reviewer,h.finance,h.support]){
  const view=await h.get(`/admin/orders/${f.order.id}/workspace`,actor);
  assert.equal(view.mode,'ELECTRONIC');assert.equal(view.process.orderId,f.order.id);assert.equal(view.process.version,1);assert.equal(view.process.steps.length,7);
  assert.equal(view.nextAction.code,'OPEN_ELECTRONIC');assert.equal(view.capabilities.canUpload,false);assert.equal(view.capabilities.canReview,false);
  assert(!view.process.steps.flatMap((s:any)=>s.actions).some((a:any)=>a.key==='CREATE_ARCHIVE'));
  if(actor===h.support){assert.deepEqual(view.billing,[]);assert.deepEqual(view.process.related.bills,[]);}
 }
 assert.equal(h.externalCalls+h.esignCalls+h.payment.providerCalls,0);
 }finally{await h.close();}
});
