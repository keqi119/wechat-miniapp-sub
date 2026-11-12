import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deriveFieldHandoverBatch,fieldBatchInput,fieldBatchOccupancy,legacyFieldTaskBatch,isReturnFieldHandover,fieldReceiptKind,type FieldBatchFacts} from '../src/field-handover/batches';

function fixture(){
 const facts:any={order:{id:'order',customerId:'customer',vehicleId:'car-1',currentAssignmentId:null,effectiveTermsVersionId:null},termsVersions:[],changes:[],quotes:[],assignments:[],handovers:[],tasks:[]};
 const handover=(id:string,type:string,vehicleId:string,assignmentId:string|null,changeId:string|null,status='COMPLETED')=>({id,orderId:'order',customerId:'customer',vehicleId,assignmentId,changeId,type,status,actualAt:new Date('2026-10-01T00:00:00Z'),readingKm:100,fieldTaskId:null});
 function delivered(id='assignment-1',vehicleId='car-1',changeId:string|null=null){const h=handover('delivery-'+id,changeId?'SWAP_DELIVERY':'DELIVERY',vehicleId,id,changeId);if(changeId){const change=facts.changes.find((c:any)=>c.id===changeId),returned=facts.handovers.find((r:any)=>r.id===change?.returnHandoverId);if(returned)h.actualAt=new Date(returned.actualAt.getTime()+86400000);}const a={id,orderId:'order',customerId:'customer',vehicleId,changeId,status:'ACTIVE',startAt:h.actualAt,startReadingKm:100,endAt:null,endReadingKm:null,deliveryHandoverId:h.id,returnHandoverId:null};facts.handovers.push(h);facts.assignments.push(a);facts.order.currentAssignmentId=id;facts.order.vehicleId=vehicleId;return{assignment:a,handover:h};}
 function swap(n:number,old:any,target:string){const c:any={id:'change-'+n,orderId:'order',customerId:'customer',kind:'VEHICLE_CHANGE',status:'AWAITING_FINANCE',activeQuoteId:'quote-'+n,targetVehicleId:target,returnHandoverId:null,deliveryHandoverId:null},q={id:c.activeQuoteId,changeId:c.id,revision:1,status:'CONFIRMED',snapshot:{originalAssignmentId:old.id,targetVehicleId:target}};facts.changes.push(c);facts.quotes.push(q);return{change:c,quote:q};}
 function returned(c:any,a:any){const h=handover('return-'+c.id,'SWAP_RETURN',a.vehicleId,a.id,c.id);h.actualAt=new Date(Math.max(new Date('2026-10-10T00:00:00Z').getTime(),a.startAt.getTime()+86400000));h.readingKm=200;facts.handovers.push(h);Object.assign(a,{status:'CLOSED',endAt:h.actualAt,endReadingKm:h.readingKm,returnHandoverId:h.id});c.returnHandoverId=h.id;c.status='SWAP_RETURNED';facts.order.currentAssignmentId=null;return h;}
 const batch=(type:string,changeId?:string)=>deriveFieldHandoverBatch({orderId:'order',type,...(changeId?{changeId}:{})},facts);
 return{facts: facts as FieldBatchFacts & any,delivered,swap,returned,batch,handover};
}
const error=(code:string)=>(e:any)=>e.getResponse?.().error?.code===code;

test('task batch input accepts only service-selected identifiers and maps all four physical types explicitly',()=>{
 for(const type of ['DELIVERY','RETURN','SWAP_RETURN','SWAP_DELIVERY']){assert.equal(fieldReceiptKind(type),type.endsWith('RETURN')?'RETURN_RECEIPT':'DELIVERY_RECEIPT');assert.equal(isReturnFieldHandover(type),type.endsWith('RETURN'));}
 assert.throws(()=>fieldReceiptKind('OTHER'));for(const extra of [{batchKey:'arbitrary'},{vehicleId:'foreign'},{vehicleAssignmentId:'foreign'},{termsVersionId:'other'},{quoteId:'old'}])assert.equal(fieldBatchInput.safeParse({orderId:'order',type:'DELIVERY',...extra}).success,false);
 assert.equal(fieldBatchInput.safeParse({orderId:'order',type:'SWAP_RETURN'}).success,false);assert.equal(fieldBatchInput.safeParse({orderId:'order',type:'RETURN',changeId:'change'}).success,false);assert.equal(fieldBatchInput.safeParse({orderId:'a\0',type:'DELIVERY'}).success,false);
});
test('first delivery freezes INITIAL or the real current terms row, never an arbitrary request version',()=>{
 const f=fixture(),initial=f.batch('DELIVERY');assert.deepEqual(initial,{orderId:'order',customerId:'customer',type:'DELIVERY',batchKey:'DELIVERY:INITIAL',changeId:null,quoteId:null,termsVersionId:null,vehicleId:'car-1',vehicleAssignmentId:null,currentHandoverId:null});
 f.facts.termsVersions.push({id:'terms-1',orderId:'order',version:1});f.facts.order.effectiveTermsVersionId='terms-1';assert.equal(f.batch('DELIVERY').batchKey,'DELIVERY:terms-1');assert.equal(f.batch('DELIVERY').termsVersionId,'terms-1');f.facts.termsVersions[0].orderId='foreign';assert.throws(()=>f.batch('DELIVERY'),error('FIELD_BATCH_TERMS_INVALID'));
});
test('final return binds the actual assigned vehicle and completed same-person delivery',()=>{
 const f=fixture(),d=f.delivered();assert.equal(f.batch('RETURN').batchKey,'FINAL_RETURN:assignment-1');assert.equal(f.batch('RETURN').vehicleAssignmentId,d.assignment.id);
 for(const mutate of [(g:any)=>g.facts.assignments[0].customerId='other',(g:any)=>g.facts.handovers[0].assignmentId='other',(g:any)=>g.facts.handovers[0].status='CUSTOMER_CONFIRMED',(g:any)=>g.facts.order.vehicleId='other']){const g=fixture();g.delivered();mutate(g);assert.throws(()=>g.batch('RETURN'),error('FIELD_BATCH_ASSIGNMENT_INVALID'));}
});
test('swap return resolves the active quote original assignment and rejects wrong quote, order or handover',()=>{
 const f=fixture(),d=f.delivered(),s=f.swap(1,d.assignment,'car-2'),b=f.batch('SWAP_RETURN',s.change.id);assert.equal(b.vehicleId,'car-1');assert.equal(b.batchKey,'CHANGE:change-1:RETURN');assert.equal(b.quoteId,s.quote.id);assert.equal(b.changeId,s.change.id);assert.equal(b.termsVersionId,null);
 for(const mutate of [(g:any,c:any,q:any)=>q.changeId='foreign',(g:any,c:any,q:any)=>q.status='SUPERSEDED',(g:any,c:any)=>c.customerId='foreign',(g:any,c:any,q:any)=>q.snapshot.originalAssignmentId='missing',(g:any,c:any)=>c.activeQuoteId='missing']){const g=fixture(),d=g.delivered(),s=g.swap(1,d.assignment,'car-2');mutate(g,s.change,s.quote);assert.throws(()=>g.batch('SWAP_RETURN',s.change.id));}
});
test('swap delivery has no invented assignment before delivery and later binds only its own completed handover',()=>{
 const f=fixture(),d=f.delivered(),s=f.swap(1,d.assignment,'car-2');assert.throws(()=>f.batch('SWAP_DELIVERY',s.change.id),error('FIELD_BATCH_RETURN_REQUIRED'));f.returned(s.change,d.assignment);const pending=f.batch('SWAP_DELIVERY',s.change.id);assert.equal(pending.vehicleId,'car-2');assert.equal(pending.vehicleAssignmentId,null);assert.equal(pending.batchKey,'CHANGE:change-1:DELIVERY');
 const next=f.delivered('assignment-2','car-2',s.change.id);s.change.deliveryHandoverId=next.handover.id;s.change.status='APPLIED';assert.equal(f.batch('SWAP_DELIVERY',s.change.id).vehicleAssignmentId,next.assignment.id);next.handover.customerId='other';assert.throws(()=>f.batch('SWAP_DELIVERY',s.change.id),error('FIELD_BATCH_ASSIGNMENT_INVALID'));
});
test('two genuine swaps and final return retain distinct batches without changing historical inputs',()=>{
 const f=fixture(),initial=f.batch('DELIVERY'),d=f.delivered(),s1=f.swap(1,d.assignment,'car-2'),r1=f.batch('SWAP_RETURN',s1.change.id);f.returned(s1.change,d.assignment);const i1=f.batch('SWAP_DELIVERY',s1.change.id),a2=f.delivered('assignment-2','car-2',s1.change.id);s1.change.deliveryHandoverId=a2.handover.id;s1.change.status='APPLIED';const s2=f.swap(2,a2.assignment,'car-3'),r2=f.batch('SWAP_RETURN',s2.change.id);f.returned(s2.change,a2.assignment);const i2=f.batch('SWAP_DELIVERY',s2.change.id),a3=f.delivered('assignment-3','car-3',s2.change.id);s2.change.deliveryHandoverId=a3.handover.id;s2.change.status='APPLIED';const before=JSON.stringify(f.facts),last=f.batch('RETURN');assert.equal(new Set([initial,r1,i1,r2,i2,last].map(b=>b.batchKey)).size,6);assert.equal(f.batch('SWAP_RETURN',s1.change.id).vehicleId,'car-1');assert.equal(JSON.stringify(f.facts),before);
});
test('legacy task classification uses explicit assignment or absence of all terms and never current terms timing guesses',()=>{
 const f=fixture(),task:any={id:'legacy',orderId:'order',type:'DELIVERY',vehicleId:'car-1',vehicleAssignmentId:null,currentHandoverId:null,status:'ASSIGNED'};assert.equal(legacyFieldTaskBatch(task,f.facts).batchKey,'DELIVERY:INITIAL');f.facts.termsVersions.push({id:'terms',orderId:'order',version:1});f.facts.order.effectiveTermsVersionId='terms';assert.equal(legacyFieldTaskBatch(task,f.facts).batchKey,'LEGACY:legacy');
 const d=f.delivered();Object.assign(task,{type:'RETURN',vehicleAssignmentId:d.assignment.id});assert.equal(legacyFieldTaskBatch(task,f.facts).batchKey,'FINAL_RETURN:assignment-1');task.vehicleAssignmentId='missing';assert.throws(()=>legacyFieldTaskBatch(task,f.facts),error('FIELD_BATCH_ASSIGNMENT_INVALID'));
});
test('same server-derived key is occupied even after cancellation; changed source requires explicit versioned review',()=>{
 const f=fixture(),batch=f.batch('DELIVERY');f.facts.tasks.push({...batch,id:'task',status:'CANCELLED'});let result=fieldBatchOccupancy(batch,f.facts);assert.equal(result.canCreate,false);assert.equal(result.existingTaskId,'task');assert.ok(result.blockers.includes('FIELD_BATCH_TASK_EXISTS'));
 const g=fixture(),d=g.delivered(),s=g.swap(1,d.assignment,'car-2'),b=g.batch('SWAP_RETURN',s.change.id);g.facts.tasks.push({...b,id:'task-swap',status:'ASSIGNED',quoteId:'previous-quote'});result=fieldBatchOccupancy(b,g.facts);assert.equal(result.canCreate,false);assert.ok(result.blockers.includes('FIELD_BATCH_SOURCE_CHANGED'));
});
test('LEGACY keys do not permit another completed delivery or another return of the same assignment',()=>{
 const f=fixture(),b=f.batch('DELIVERY'),d=f.delivered();f.facts.termsVersions.push({id:'new-terms',orderId:'order',version:1});f.facts.order.effectiveTermsVersionId='new-terms';f.facts.tasks.push({id:'legacy-task',orderId:'order',type:'DELIVERY',vehicleId:'car-1',vehicleAssignmentId:null,batchKey:'LEGACY:legacy-task',status:'COMPLETED',currentHandoverId:d.handover.id});const result=fieldBatchOccupancy({...b,batchKey:'DELIVERY:new-terms',termsVersionId:'new-terms'},f.facts);assert.equal(result.canCreate,false);assert.ok(result.existingHandoverIds.includes(d.handover.id));
 const g=fixture(),old=g.delivered(),s=g.swap(1,old.assignment,'car-2'),swap=g.batch('SWAP_RETURN',s.change.id);g.facts.tasks.push({id:'legacy-return',orderId:'order',type:'RETURN',vehicleId:'car-1',vehicleAssignmentId:old.assignment.id,batchKey:'LEGACY:legacy-return',status:'ASSIGNED',currentHandoverId:null});assert.equal(fieldBatchOccupancy(swap,g.facts).canCreate,false);
});
test('ambiguous live legacy tasks block creation, while explicit cancellation without published facts is retained safely',()=>{
 const f=fixture();f.facts.termsVersions.push({id:'new-terms',orderId:'order',version:1});f.facts.order.effectiveTermsVersionId='new-terms';const b=f.batch('DELIVERY'),task:any={id:'legacy-task',orderId:'order',type:'DELIVERY',vehicleId:'car-1',vehicleAssignmentId:null,batchKey:'LEGACY:legacy-task',status:'ASSIGNED',currentHandoverId:null};f.facts.tasks.push(task);assert.ok(fieldBatchOccupancy(b,f.facts).blockers.includes('FIELD_BATCH_LEGACY_REVIEW_REQUIRED'));task.status='CANCELLED';assert.equal(fieldBatchOccupancy(b,f.facts).canCreate,true);
 const h=f.handover('old-published','DELIVERY','car-1',null,null,'PUBLISHED');h.fieldTaskId=task.id;f.facts.handovers.push(h);task.currentHandoverId=h.id;assert.equal(fieldBatchOccupancy(b,f.facts).canCreate,false);
});
test('superseded earlier delivery facts do not masquerade as a completed delivery in a new terms batch',()=>{
 const f=fixture();f.facts.termsVersions.push({id:'new-terms',orderId:'order',version:1});f.facts.order.effectiveTermsVersionId='new-terms';const b=f.batch('DELIVERY'),h=f.handover('old','DELIVERY','car-1',null,null,'SUPERSEDED');f.facts.handovers.push(h);f.facts.tasks.push({id:'old-task',orderId:'order',type:'DELIVERY',vehicleId:'car-1',vehicleAssignmentId:null,batchKey:'DELIVERY:INITIAL',termsVersionId:null,quoteId:null,changeId:null,status:'ASSIGNED',currentHandoverId:h.id});assert.equal(fieldBatchOccupancy(b,f.facts).canCreate,true);
});
test('batch source rejects fabricated handovers and never fills missing historical assignment links',()=>{
 const f=fixture(),d=f.delivered(),s=f.swap(1,d.assignment,'car-2');f.returned(s.change,d.assignment);s.change.returnHandoverId='other';assert.throws(()=>f.batch('SWAP_DELIVERY',s.change.id),error('FIELD_BATCH_RETURN_REQUIRED'));
 const g=fixture(),task={id:'old-return',orderId:'order',type:'RETURN',vehicleId:'car-1',vehicleAssignmentId:null,currentHandoverId:null,status:'ASSIGNED'};assert.equal(legacyFieldTaskBatch(task,g.facts).batchKey,'LEGACY:old-return');assert.equal(g.facts.assignments.length,0);
});
test('a genuine final return cannot be borrowed as the old side of a swap',()=>{
 const f=fixture(),d=f.delivered(),s=f.swap(1,d.assignment,'car-2'),h=f.returned(s.change,d.assignment);h.type='RETURN';h.changeId=null;
 assert.throws(()=>f.batch('SWAP_RETURN',s.change.id),error('FIELD_BATCH_RETURN_REQUIRED'));
 assert.throws(()=>f.batch('SWAP_DELIVERY',s.change.id),error('FIELD_BATCH_RETURN_REQUIRED'));
});
