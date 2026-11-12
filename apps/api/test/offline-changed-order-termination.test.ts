import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../src/common/data';
import {agreementFixture} from './offline-change-agreement-fixture';
import {readTerminationContext,terminationPrintSections,terminationSourceFactHash} from '../src/offline-documents/termination';

function fixture(swapped=false,returned=false){
 const f=agreementFixture();Object.assign(f.initial,{commercialTerms:{vehicleIdentification:'原车辆 VIN：LSVNV2182E2182777',earlyTerminationRule:'按原合同核清实际费用',depositRefundRule:'按原实收核对退款'}});
 const c=f.addChange(true),startAt=new Date('2026-10-01T01:00:00Z'),swapAt=new Date('2026-11-01T01:00:00Z'),endAt=new Date('2026-11-09T02:00:00Z');
 const delivery:any={id:'initial-delivery',orderId:f.order.id,customerId:f.order.customerId,vehicleId:'vehicle',assignmentId:'initial-assignment',changeId:null,type:'DELIVERY',status:'COMPLETED',actualAt:startAt,completedAt:startAt};
 const original:any={id:'initial-assignment',orderId:f.order.id,customerId:f.order.customerId,vehicleId:'vehicle',changeId:null,deliveryHandoverId:delivery.id,returnHandoverId:null,startAt,endAt:null,status:'ACTIVE'};
 const assignments:any[]=[original],handovers:any[]=[delivery];let current=original;
 if(swapped){
  Object.assign(c.change,{kind:'VEHICLE_CHANGE',targetVehicleId:'target'});Object.assign(c.quote.snapshot,{originalAssignmentId:original.id,targetVehicleId:'target'});
  Object.assign(c.version.scopeSnapshot,{originalAssignmentId:original.id,targetVehicleId:'target'});
  Object.assign(c.terms!.snapshot,{vehicleId:'target',lessorSnapshot:{ownerId:'owner',vehicleId:'target'},commercialTerms:{...(f.initial as any).commercialTerms,vehicleIdentification:'换入车辆 VIN：LSVNV2182E2182888'}});
  const oldReturn={...delivery,id:'swap-return',type:'SWAP_RETURN',changeId:c.change.id,actualAt:swapAt,completedAt:swapAt};
  const newDelivery={...delivery,id:'swap-delivery',type:'SWAP_DELIVERY',changeId:c.change.id,vehicleId:'target',assignmentId:'next-assignment',actualAt:swapAt,completedAt:swapAt};
  Object.assign(c.change,{returnHandoverId:oldReturn.id,deliveryHandoverId:newDelivery.id});
  Object.assign(original,{returnHandoverId:oldReturn.id,endAt:swapAt,status:'CLOSED'});
  current={...original,id:'next-assignment',vehicleId:'target',changeId:c.change.id,deliveryHandoverId:newDelivery.id,returnHandoverId:null,startAt:swapAt,endAt:null,status:'ACTIVE'};
  assignments.push(current);handovers.push(oldReturn,newDelivery);f.order.vehicleId='target';
 }
 Object.assign(f.order,{status:returned?'SETTLING':'ACTIVE',currentAssignmentId:returned?null:current.id});
 let receipt:any=null;
 if(returned){const final={id:'final-return',orderId:f.order.id,customerId:f.order.customerId,vehicleId:current.vehicleId,assignmentId:current.id,changeId:null,type:'RETURN',status:'COMPLETED',actualAt:endAt,completedAt:endAt,readingKm:250};handovers.push(final);Object.assign(current,{returnHandoverId:final.id,endAt,status:'CLOSED'});receipt={id:'physical-return',orderId:f.order.id,vehicleId:current.vehicleId,assignmentId:current.id,handoverId:final.id,receivedAt:endAt,storageLocation:'合成收车点',readingKm:250};}
 Object.assign(f.tx.documentArchive,{findFirst:async()=>f.rental});
 Object.assign(f.tx.orderTermsVersion,{findUnique:async({where}:any)=>f.terms.find(t=>t.id===where.id)??null});
 Object.assign(f.tx,{legalDocument:{findUnique:async({where}:any)=>({title:where.id==='template-RENTAL'?'原租赁合同':'已生效补充协议',type:where.id==='template-RENTAL'?'OFFLINE_RENTAL':'OFFLINE_ORDER_AMENDMENT'})},handover:{findMany:async()=>handovers},vehicleAssignment:{findMany:async()=>assignments,findFirst:async()=>current},vehicleReceiptEvent:{findFirst:async()=>receipt},payment:{findMany:async()=>[{amount:100,status:'SUCCEEDED',bill:{type:'DEPOSIT'},refunds:[]}]}});
 return{...f,...c,terms:f.terms,assignments,handovers,current,get receipt(){return receipt;}};
}

test('effective delay retains the real original and explicitly references the archived amendment',async()=>{
 const f=fixture(),before=JSON.stringify({order:f.order,terms:f.terms,assignments:f.assignments});
 const result:any=await readTerminationContext(f.tx,f.order);
 assert.deepEqual(result.blockers,[]);assert.equal(result.originalContract.versionId,f.rental.versions[0].id);assert.equal(result.amendments[0].versionId,f.version.id);assert.equal(result.effectiveTermsVersionId,f.terms[0].id);assert.equal(result.delivery.state,'AWAITING_RETURN');assert.equal(result.relevantTerms.earlyTerminationRule,(f.initial as any).commercialTerms.earlyTerminationRule);
 assert.equal(JSON.stringify({order:f.order,terms:f.terms,assignments:f.assignments}),before);
});
test('after a genuine swap final return uses the new vehicle and assignment, retaining old sides as history',async()=>{
 const f=fixture(true,true),result:any=await readTerminationContext(f.tx,f.order);
 assert.deepEqual(result.blockers,[]);assert.equal(result.vehicle.id,'target');assert.equal(result.vehicle.vin,'LSVNV2182E2182888');assert.equal(result.delivery.state,'RETURNED');assert.equal(result.delivery.deliveryId,'swap-delivery');assert.equal(result.delivery.returnId,'physical-return');assert.equal(result.delivery.source,'PHYSICAL_RECEIPT');assert.equal(result.amendments[0].number,f.version.contractNumber);
 const rows=terminationPrintSections({reasonType:'MUTUAL_AGREEMENT',reason:'合成测试',effectiveAt:'2026-11-09T10:00:00+08:00',conditionSummary:'已收车',violationStatus:'NONE',violationSummary:'无',additionalPaymentAmount:0,refundAmount:0,retainedDepositAmount:0,retainedDepositHandling:'无',settlementBasis:'依原实收核对',unresolvedMatters:'无'},result);
 assert.match(JSON.stringify(rows),new RegExp(f.version.contractNumber));assert.match(JSON.stringify(rows),/当前车辆/);
});
test('swap return is never final return and missing or foreign actual assignment evidence stays blocked',async()=>{
 const active=fixture(true),read=await readTerminationContext(active.tx,active.order);assert.equal(read.delivery.state,'AWAITING_RETURN');
 for(const change of [
  (f:any)=>f.current.customerId='foreign',(f:any)=>f.current.vehicleId='foreign',(f:any)=>f.current.changeId='foreign',
  (f:any)=>f.handovers.find((h:any)=>h.type==='SWAP_DELIVERY').changeId='foreign',
  (f:any)=>f.handovers.find((h:any)=>h.type==='SWAP_RETURN').status='PUBLISHED',
  (f:any)=>f.handovers.find((h:any)=>h.type==='RETURN').type='SWAP_RETURN',
  (f:any)=>f.receipt.assignmentId='foreign',(f:any)=>f.current.endAt=new Date('2026-11-10'),
 ]){const f=fixture(true,true);change(f);const result=await readTerminationContext(f.tx,f.order);assert.equal(result.delivery.state,'UNKNOWN',change.toString());assert.ok(result.blockers.length,change.toString());}
});
test('invalidated paper and mismatched effective snapshot cannot be bypassed for a termination',async()=>{
 for(const change of [(f:any)=>f.version.status='INVALIDATED',(f:any)=>f.rental.versions[0].status='INVALIDATED',(f:any)=>f.terms[0].snapshot.commercialHash=hash('wrong'),(f:any)=>f.order.vehicleId='foreign']){const f=fixture(true);change(f);const result=await readTerminationContext(f.tx,f.order);assert.ok(result.blockers.length,change.toString());}
});
test('printed source pins amendment identity while later money remains only a dated reference',async()=>{
 const f=fixture(true,true),result:any=await readTerminationContext(f.tx,f.order);assert.deepEqual(result.blockers,[]);
 const changed=structuredClone(result);changed.amendments[0].versionId='another-paper';assert.notEqual(terminationSourceFactHash(result),terminationSourceFactHash(changed));
 changed.amendments=structuredClone(result.amendments);changed.funds.receivedAmount++;assert.equal(terminationSourceFactHash(result),terminationSourceFactHash(changed));
});
test('internally consistent old-side records cannot substitute a car absent from the frozen original contract',async()=>{
 const f=fixture(true,true);f.assignments[0].vehicleId='foreign';
 for(const h of f.handovers.filter(h=>h.assignmentId===f.assignments[0].id))h.vehicleId='foreign';
 const result=await readTerminationContext(f.tx,f.order);assert.equal(result.delivery.state,'UNKNOWN');assert.ok(result.blockers.some(b=>b.code==='TERMINATION_DELIVERY_UNCONFIRMED'));
});
