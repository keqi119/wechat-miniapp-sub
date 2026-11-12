import test from 'node:test';
import assert from 'node:assert/strict';
import {readCancellationReadiness, scopedCancellationAction, cancellationContext,cancellationExternalRoute} from './order-cancellation-model.ts';
import {orderStepKeys, type OrderProcess} from './order-process.ts';

const action=(key:string,resource='orders',id='o1',expectedRevision?:number)=>({key,label:key,kind:'OPEN_FORM' as const,enabled:true,target:{resource,id,orderId:'o1'},...(expectedRevision===undefined?{}:{expectedRevision})});
function fixture(){return {version:1,orderId:'o1',orderRevision:3,orderStatus:'AWAITING_PAYMENT',observedAt:'2026-10-30T00:11:00Z',mode:'PRE_DELIVERY_CANCEL',canCancel:false,currentStep:'EVIDENCE',steps:['EVIDENCE','TERMINATION','FUNDS','CONFIRM','RESULT'].map(key=>({key,label:key,state:key==='FUNDS'?'DONE':'BLOCKED',summary:key,checks:[],actions:[]})),blockers:[{code:'CANCELLATION_REVIEW_REQUIRED',label:'独立复核待完成',state:'BLOCKED'}],attention:[],actions:[action('REVIEW_CANCELLATION_EVIDENCE','orders','o1',1)],related:{review:{id:'r1',orderId:'o1',revision:1,status:'SUBMITTED',paperStatus:'SIGNED'},terminationArchive:null,bills:[],payments:[],refunds:[],tasks:[],changes:[]},effects:['未结束账单作废','车辆解除预留并转未上架']};}
test('cancellation projection refuses unknown, foreign and contradictory readiness before enabling a command',()=>{
 const good=fixture();assert.equal(readCancellationReadiness(good,'o1')?.related.review?.paperStatus,'SIGNED');
 for(const value of [{...good,orderId:'o2'},{...good,mode:'GUESS'},{...good,canCancel:true},{...good,related:{...good.related,payments:[{id:'foreign',orderId:'o2'}]}},{...good,related:{...good.related,review:{...good.related.review,orderId:'o2'}}}])assert.equal(readCancellationReadiness(value,'o1'),null);
 const ready={...good,canCancel:true,blockers:[],steps:good.steps.map(s=>({...s,state:'DONE'}))};assert.equal(readCancellationReadiness(ready,'o1')?.canCancel,true);
 assert.equal(readCancellationReadiness({...ready,mode:'POST_DELIVERY_RETURN'},'o1'),null);assert.equal(readCancellationReadiness({...ready,steps:good.steps},'o1'),null);
});
test('cancel, evidence review and archives bind separate revisions and exact order records',()=>{
 const r=readCancellationReadiness(fixture(),'o1')!;assert.ok(scopedCancellationAction(action('REVIEW_CANCELLATION_EVIDENCE','orders','o1',1),r));
 assert.equal(scopedCancellationAction(action('REVIEW_CANCELLATION_EVIDENCE','orders','o1',3),r),null);
 assert.equal(scopedCancellationAction(action('CANCEL_ORDER','orders','o1',1),r),null);
 assert.ok(scopedCancellationAction(action('CANCEL_ORDER','orders','o1',3),r));
 assert.equal(scopedCancellationAction({...action('CANCEL_ORDER','orders','o2',3),target:{resource:'orders',id:'o2',orderId:'o2'}},r),null);
 assert.equal(scopedCancellationAction(action('OPEN_ARCHIVE','offline-archives','a2',0),r),null);
 assert.equal(scopedCancellationAction({...action('CREATE_ARCHIVE','offline-archives'),target:{resource:'offline-archives',orderId:'o1',section:'RENTAL'}},r),null);
 assert.ok(scopedCancellationAction({...action('CREATE_ARCHIVE','offline-archives'),target:{resource:'offline-archives',orderId:'o1',section:'TERMINATION'}},r));
});
test('cancellation panels reuse only the cancellation-scoped financial and termination records',()=>{
 const r=readCancellationReadiness({...fixture(),related:{...fixture().related,terminationArchive:{id:'a1',orderId:'o1',kind:'TERMINATION',revision:2,status:'DRAFT'},bills:[{id:'b1',orderId:'o1',payments:[]}]}},'o1')!;
 const base={version:1,orderId:'o1',orderRevision:3,currentStep:'PAYMENT',steps:orderStepKeys.map(key=>({key,label:key,state:'WAITING',summary:'',checks:[],actions:[]})),blockers:[],attention:[],related:{archives:[{id:'rental',orderId:'o1',kind:'RENTAL'}],bills:[{id:'other',orderId:'o1'}],tasks:[],handovers:[],settlements:[]}} as OrderProcess;
 const p=cancellationContext(r,base);assert.deepEqual(p.related.archives.map(a=>a.id),['a1']);assert.deepEqual(p.related.bills.map(a=>a.id),['b1']);assert.equal(base.related.archives[0].id,'rental');
});
test('change blockers route vehicle changes and delivery delays to their actual operation pages',()=>{
 const r=readCancellationReadiness({...fixture(),related:{...fixture().related,changes:[{id:'swap',orderId:'o1',kind:'VEHICLE_CHANGE'},{id:'delay',orderId:'o1',kind:'DELIVERY_DELAY'},{id:'unknown',orderId:'o1',kind:'FUTURE_KIND'}]}},'o1')!;
 assert.equal(cancellationExternalRoute(action('OPEN_CHANGE','order-changes','swap'),r),'vehicle-changes');
 assert.equal(cancellationExternalRoute(action('OPEN_CHANGE','order-changes','delay'),r),'order-changes');
 assert.equal(cancellationExternalRoute(action('OPEN_CHANGE','order-changes','unknown'),r),null);
 assert.equal(cancellationExternalRoute(action('OPEN_CHANGE','order-changes','foreign'),r),null);
});
