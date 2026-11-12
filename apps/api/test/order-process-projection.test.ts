import {test} from 'node:test';
import assert from 'node:assert/strict';
import {orderProcess} from '../src/orders/order-process';
import {readHandoverCompletion} from '../src/orders/order-process-handover';

function facts(){
 const now=new Date('2026-10-29T04:00:00Z'),handover={id:'handover',orderId:'order',type:'DELIVERY',status:'CUSTOMER_CONFIRMED',customerResponse:'CONFIRM',confirmedAt:now,actualAt:now,manifestHash:'manifest'};
 return{order:{id:'order',applicationId:'app',status:'AWAITING_HANDOVER',revision:4},actor:{id:'admin',role:'ADMIN'},now,snapshot:{startDate:'2026-10-29'},application:{status:'FINAL_PLAN_CONFIRMED'},archives:[{id:'paper',kind:'DELIVERY_RECEIPT',handoverId:'handover',currentApprovedVersionId:'version',versions:[{id:'version',status:'ARCHIVED',businessSnapshotHash:'manifest'}]}],funding:{ready:true,firstReady:true,bills:[]},contract:{ready:true},business:{ready:true,blockers:[]},changes:[],handovers:[handover],tasks:[],receipts:[],settlements:[],fundsVisible:true,archivesVisible:true,related:{bills:[],archives:[],tasks:[],handovers:[],settlements:[]},handoverReadiness:{handover:{ready:false,blockers:[{code:'HANDOVER_DATE_REQUIRED',label:'请核对实际交车时间'}]}}};
}

test('paid rent and deposit finish funding while insurance blocks only delivery without changing stored status',()=>{
 const f:any=facts();f.order.status='AWAITING_PAYMENT';f.handovers=[];f.business={ready:false,blockers:[{code:'INSURANCE_REQUIRED',label:'保险待核',resourceType:'insurance-policies',resourceId:'insurance'}]};
 f.funding.bills=['SUBSCRIPTION','DEPOSIT'].map((type,i)=>({id:type,type,status:'PAID',amount:(i+1)*100,paidAmount:(i+1)*100,payments:[{id:'payment-'+type,status:'SUCCEEDED',amount:(i+1)*100,refunds:[]}]}));
 const p=orderProcess(f),funds=p.steps.find(s=>s.key==='PAYMENT')!;
 assert.equal(p.currentStep,'DELIVERY');assert.equal(f.order.status,'AWAITING_PAYMENT');assert.equal(funds.state,'DONE');
 assert(funds.checks.every(c=>c.code!=='INSURANCE_REQUIRED'&&c.code!=='DELIVERY_RECHECK_REQUIRED'));
 assert(p.blockers.some(c=>c.code==='INSURANCE_REQUIRED'));assert.equal(p.primaryAction.key,'OPEN_BUSINESS_RECORD');
 assert(!p.steps.find(s=>s.key==='DELIVERY')!.actions.some(a=>a.key==='CREATE_DELIVERY_TASK'&&a.enabled));
});

test('funding ready awaiting flow recheck belongs to delivery and never blocks funding',()=>{
 const f:any=facts();f.order.status='AWAITING_PAYMENT';f.handovers=[];
 const p=orderProcess(f);assert.equal(p.currentStep,'DELIVERY');assert.equal(p.steps.find(s=>s.key==='PAYMENT')!.state,'DONE');
 assert(p.blockers.some(c=>c.code==='DELIVERY_RECHECK_REQUIRED'));assert.equal(p.primaryAction.key,'RECHECK_DELIVERY');
 assert.match(p.steps.find(s=>s.key==='DELIVERY')!.summary,/核对/);
});

test('published delivery waits for customer while funded stage remains done',()=>{
 const f:any=facts();f.handovers[0].status='PUBLISHED';f.handovers[0].customerResponse=null;f.handovers[0].confirmedAt=null;
 const p=orderProcess(f);assert.equal(p.currentStep,'DELIVERY');assert.equal(p.steps.find(s=>s.key==='PAYMENT')!.state,'DONE');assert.equal(p.primaryAction.key,'WAIT_CUSTOMER');
 assert(p.blockers.some(c=>c.code==='DELIVERY_CUSTOMER'));
});

test('completed delivery retains completed facts while later refund exceptions stay visible separately',()=>{
 const f:any=facts();f.order.status='ACTIVE';f.handovers[0].status='COMPLETED';f.handovers[0].customerResponse=null;f.handovers[0].confirmedAt=null;f.archives=[];f.usage={startedOn:f.now};
 f.business={ready:false,blockers:[{code:'INSURANCE_EXPIRED',label:'保险过期'}]};f.funding={ready:false,firstReady:false,bills:[{type:'SUBSCRIPTION',amount:100,payments:[{id:'p',status:'SUCCEEDED',amount:100,reconciliationRequired:true,refunds:[{amount:100,status:'PROCESSING'}]}]}]};
 const p=orderProcess(f);for(const key of ['PAYMENT','DELIVERY'])assert.equal(p.steps.find(s=>s.key===key)!.state,'DONE');
 assert(p.steps.find(s=>s.key==='DELIVERY')!.checks.every(c=>c.state==='DONE'));
 assert(p.steps.find(s=>s.key==='PAYMENT')!.checks.every(c=>c.state==='DONE'));
 assert(p.attention.some(c=>c.code==='PAYMENT_RECONCILIATION_REQUIRED'));assert(p.attention.some(c=>c.code==='REFUND_PROCESSING'));
});

test('unfunded and unknown funds remain payment work; unavailable funds never expose money or enabled financial actions',()=>{
 const f:any=facts();f.order.status='AWAITING_PAYMENT';f.handovers=[];f.funding={ready:false,firstReady:false,bills:[]};
 let p=orderProcess(f);assert.equal(p.currentStep,'PAYMENT');assert(p.blockers.some(c=>c.code==='FIRST_RENT_UNPAID'));
 f.funding.bills=[{type:'SUBSCRIPTION',amount:100,payments:[{id:'p',status:'UNRECOGNIZED',amount:100,refunds:[]}]}];
 p=orderProcess(f);assert(p.steps.find(s=>s.key==='PAYMENT')!.checks.some(c=>c.code==='PAYMENT_STATE_UNKNOWN'&&c.state==='UNKNOWN'));
 f.actor.role='SUPPORT';f.fundsVisible=false;p=orderProcess(f);assert.equal(p.steps.find(s=>s.key==='PAYMENT')!.state,'UNKNOWN');assert(!JSON.stringify(p).includes('UNRECOGNIZED'));
 assert(!p.steps.find(s=>s.key==='PAYMENT')!.actions.some(a=>a.enabled&&['bills','payments','refunds'].includes(a.target.resource)));
});
test('completion action cannot claim readiness when the current handover command has unresolved facts',()=>{
 const f=facts(),p=orderProcess(f),step=p.steps.find(s=>s.key==='DELIVERY')!;
 assert(step.checks.some(c=>c.code==='HANDOVER_DATE_REQUIRED'&&c.state==='BLOCKED'));
 assert.equal(step.actions.find(a=>a.key==='COMPLETE_HANDOVER')?.enabled,false);
});
test('independent archive review and permission reasons stay visible without exposing an enabled self-review action',()=>{
 const f=facts();f.actor.role='OPERATIONS';f.archives[0].currentApprovedVersionId='';Object.assign(f.archives[0].versions[0],{status:'SUBMITTED',submittedBy:'admin',files:[]});
 const p=orderProcess(f),step=p.steps.find(s=>s.key==='DELIVERY')!;
 assert(step.checks.some(c=>c.code==='DELIVERY_OTHER_REVIEWER'));
 assert.equal(step.actions.find(a=>a.key==='COMPLETE_HANDOVER')?.enabled,false);
});

test('read-only return completion detects physical receipt mismatch and usage boundary without writes',async()=>{
 const now=new Date('2026-10-29T04:00:00Z'),order={id:'order',customerId:'customer',contractMode:'OFFLINE',status:'ACTIVE',confirmedMileageKm:100};
 const f={order,now,changes:[],archives:[],snapshot:{},vehicle:{reservedOrderId:'order',status:'IN_USE',mileageKm:100},usage:{id:'usage',startedOn:new Date('2026-10-01')},receipts:[{receivedAt:now,readingKm:100}]};
 const h={type:'RETURN',customerId:'customer',executionMode:'OFFLINE',readingKm:110,actualAt:now};
 const tx={vehicleAssignment:{count:async()=>0},usagePeriod:{aggregate:async()=>({_max:{endReadingKm:0}}),findMany:async()=>[]}};
 const r=await readHandoverCompletion(tx,f,h);assert(!r.ready);assert(r.blockers.some(b=>b.code==='PHYSICAL_RECEIPT_MISMATCH'));assert(r.blockers.some(b=>b.code==='RETURN_OUTSIDE_TERM'));
});

test('matching recorded physical receipt permits a valid formal return and does not require duplicate receipt work',async()=>{
 const now=new Date('2026-10-29T04:00:00Z'),order={id:'order',customerId:'customer',contractMode:'OFFLINE',status:'ACTIVE',confirmedMileageKm:100};
 const f={order,now,changes:[],archives:[],snapshot:{},vehicle:{reservedOrderId:'order',status:'IN_USE',mileageKm:100},usage:{id:'usage',startedOn:new Date('2026-10-01')},receipts:[{receivedAt:now,readingKm:110}]};
 const h={type:'RETURN',customerId:'customer',executionMode:'OFFLINE',readingKm:110,actualAt:now};
 const tx={vehicleAssignment:{count:async()=>0},usagePeriod:{aggregate:async()=>({_max:{endReadingKm:105}}),findMany:async()=>[{id:'month',sequence:1,status:'OPEN',startDate:new Date('2026-10-01'),endDate:new Date('2026-11-01')} ]}};
 assert.deepEqual(await readHandoverCompletion(tx,f,h),{ready:true,blockers:[]});
});

test('read-only delivery completion shows future time, confirmed-date mismatch, and unresolved document feedback',async()=>{
 const now=new Date('2026-10-29T04:00:00Z'),actualAt=new Date('2026-11-01T04:00:00Z');
 const f={order:{id:'order',customerId:'customer',contractMode:'OFFLINE',status:'AWAITING_HANDOVER',confirmedMileageKm:100},now,changes:[],archives:[{versions:[{feedback:[{}]}]}],snapshot:{startDate:'2026-10-29'},vehicle:{reservedOrderId:'order',status:'RESERVED',mileageKm:100},receipts:[]};
 const r=await readHandoverCompletion({},f,{type:'DELIVERY',customerId:'customer',executionMode:'OFFLINE',readingKm:100,actualAt});
 for(const code of ['HANDOVER_DATE_REQUIRED','DELIVERY_DATE_AMENDMENT_REQUIRED','ARCHIVE_FEEDBACK_OPEN'])assert(r.blockers.some(b=>b.code===code));
});

test('early-return settlement retains termination and refund blockers without offering completion',()=>{
 const f:any=facts();f.order.status='SETTLING';f.settlements=[{id:'settlement',status:'PENDING_PAYMENT',revision:2,unsettledPeriodIds:[],depositRefundRequiredAmount:100,documentBlockers:['TERMINATION_REQUIRED'],canComplete:false}];
 const r=orderProcess(f);assert.equal(r.currentStep,'SETTLEMENT');assert(r.blockers.some(b=>b.code==='TERMINATION_REQUIRED'));assert(r.blockers.some(b=>b.code==='DEPOSIT_REFUND_REQUIRED'));assert(!r.steps.flatMap(s=>s.actions).some(a=>a.key==='COMPLETE_SETTLEMENT'&&a.enabled));
});


test('electronic closeout shows separate financial source action and no paper termination route',()=>{
 const f:any=facts();f.order.contractMode='ELECTRONIC';f.order.status='SETTLING';f.settlements=[{id:'settlement',status:'READINGS_REQUIRED',unsettledPeriodIds:[],documentBlockers:['TERMINATION_BASIS_REQUIRED'],financialBlockers:['EXIT_AMOUNT_CONFIRMATION_REQUIRED','EXIT_FINANCE_SOURCE_REVIEW_REQUIRED'],canComplete:false,depositRefundRequiredAmount:0}];
 const p=orderProcess(f),checks=p.steps.flatMap(s=>s.checks);assert.ok(checks.some(c=>c.code==='EXIT_FINANCE_SOURCE_REVIEW_REQUIRED'));const legal=checks.find(c=>c.code==='TERMINATION_BASIS_REQUIRED')!;assert.equal(legal.action?.target.resource,'orders');
});

test('delivery insurance blockers guide to this vehicles insurance tab, separate from paid funding',()=>{const f:any=facts();f.business={ready:false,blockers:[{code:'DELIVERY_INSURANCE_COMMERCIAL_REQUIRED',label:'实际交付时商业险尚未齐备',resourceType:'vehicles',resourceId:'car'}]};const p=orderProcess(f),b=p.steps.find(s=>s.key==='DELIVERY')!.checks.find(c=>c.code==='DELIVERY_INSURANCE_COMMERCIAL_REQUIRED')!;assert.equal(b.state,'BLOCKED');assert.equal(b.action?.target.resource,'vehicles');assert.equal(b.action?.target.id,'car');assert.equal(b.action?.target.section,'insurance');assert.equal(p.steps.find(s=>s.key==='PAYMENT')!.state,'DONE');});
