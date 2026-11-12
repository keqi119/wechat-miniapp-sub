import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renewalPaymentFixture} from './order-renewals-payment-fixture';
import {readDeliveryBusinessReady} from '../src/orders/business-gates';

async function active(){
 const f=await renewalPaymentFixture(),at=new Date('2027-10-01T00:00:00+08:00');
 Object.assign(f.stages.find(s=>s.kind==='INITIAL')!,{status:'ENDED',endedAt:at});
 Object.assign(f.stage,{status:'ACTIVE',scheduledBy:'finance',scheduledAt:new Date('2027-09-30'),activatedBy:'ops',activatedAt:at,termsVersionId:'renewal-current-terms'});f.change.status='APPLIED';
 const terms={id:f.stage.termsVersionId,orderId:f.order.id,quoteId:f.quote.id,version:1,snapshot:structuredClone(f.quote.snapshot.renewalTerms),hash:f.quote.commercialHash,offlineArchiveVersionId:f.quote.approvedArchiveVersionId,effectiveAt:at};f.terms.push(terms);f.order.effectiveTermsVersionId=terms.id;
 f.tx.orderTermsVersion.findUnique=async({where}:any)=>f.terms.find(t=>t.id===where.id)??null;
 return{...f,termsVersion:terms,at};
}
test('current same-car renewal uses its new product and service range without inventing a swap assignment',async()=>{
 const f=await active(),original=structuredClone(f.initial),result=await readDeliveryBusinessReady(f.tx,f.order.id,f.at);
 assert.equal(result.ready,true,JSON.stringify(result.blockers));assert.equal(result.coverageEvidence?.productVersionId,f.product.id);assert.equal(f.assignment.changeId??null,null);assert.deepEqual(f.initial,original);
});
test('missing stage, foreign actual car or tampered frozen product cannot fall back to initial coverage',async()=>{
 for(const mutate of [(f:any)=>f.termsVersion.snapshot.serviceStageId='missing',(f:any)=>f.assignment.customerId='foreign',(f:any)=>f.termsVersion.snapshot.currentVehicleProductSnapshot.productVersionId='old-product',(f:any)=>f.stage.termsVersionId='foreign-terms',(f:any)=>f.termsVersion.effectiveAt=new Date('2027-09-01')]){
  const f=await active();mutate(f);const result=await readDeliveryBusinessReady(f.tx,f.order.id,f.at);assert.equal(result.ready,false);assert.ok(result.blockers.length);
 }
});
