import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readContractReady,contractReady} from '../src/offline-documents/readiness';
import {readDelayPaymentGuard,guardDelayPayment} from '../src/order-changes/finance';
import {billPublicationView} from '../src/billing/publication-view';
import {AdminController} from '../src/operations/admin';
import {workspaceProjection} from '../src/offline-documents/workspace.service';

const now=new Date('2026-10-29T16:00:00Z'); // 北京10月30日
function fixture(){
 let writes=0,locks=0;
 const order={id:'order',customerId:'customer',status:'AWAITING_PAYMENT',contractMode:'OFFLINE',finalPlanSnapshot:{commercialHash:'a'.repeat(64)}};
 const archive:any={id:'archive',currentApprovedVersionId:'version',versions:[{id:'version',status:'ARCHIVED',businessSnapshotHash:'a'.repeat(64)}]};
 const tx:any={$queryRaw:async()=>{locks++;},order:{findUnique:async()=>order,findUniqueOrThrow:async()=>order,update:async()=>{writes++;return order;}},documentArchive:{findFirst:async()=>archive},archiveFeedback:{count:async()=>0},orderChange:{findFirst:async()=>null},vehicleReceiptEvent:{findFirst:async()=>null},usageAccount:{findUnique:async()=>null}};
 const bill:any={id:'bill',orderId:'order',customerId:'customer',type:'SUBSCRIPTION',status:'DRAFT',amount:489900,paidAmount:0,dueDate:new Date('2026-11-03')};
 return {tx,order,archive,bill,counts:()=>({writes,locks})};
}

test('read-only contract and change checks preserve revisions; existing guarded paths retain locks and revision writes',async()=>{
 const f=fixture();assert.equal((await readContractReady(f.tx,'order')).ready,true);await readDelayPaymentGuard(f.tx,f.bill);assert.deepEqual(f.counts(),{writes:0,locks:0});
 assert.equal((await contractReady(f.tx,'order')).ready,true);await guardDelayPayment(f.tx,f.bill);assert.deepEqual(f.counts(),{writes:1,locks:1});
});

test('automatic view shows Beijing calendar schedule and due window without writing business records',async()=>{
 const f=fixture();const upcoming=await billPublicationView(f.tx,f.bill,now,true);assert.equal(upcoming.mode,'AUTOMATIC');assert.equal(upcoming.scheduledDate,'2026-10-31');assert.equal(upcoming.state,'SCHEDULED');assert.match(upcoming.message,/2026-10-31/);
 const due=await billPublicationView(f.tx,f.bill,new Date('2026-10-30T16:00:00Z'),true);assert.equal(due.state,'WAITING');assert.match(due.message,/自动发布/);assert.deepEqual(f.counts(),{writes:0,locks:0});
});

test('archive blockers and disabled service are explained instead of promising a publish time',async()=>{
 const f=fixture();f.archive.currentApprovedVersionId=null;
 const blocked=await billPublicationView(f.tx,f.bill,now,true);assert.equal(blocked.state,'BLOCKED');assert.deepEqual(blocked.blockers,['OFFLINE_ARCHIVE_REQUIRED']);assert.match(blocked.message,/合同.*归档/);
 const disabled=await billPublicationView(f.tx,f.bill,now,false);assert.equal(disabled.state,'BLOCKED');assert.deepEqual(disabled.blockers,['BILL_AUTO_PUBLICATION_DISABLED']);assert.match(disabled.message,/暂未启用/);
});

test('published/closed/manual projections need no hidden business reads or sensitive fields',async()=>{
 const f=fixture();
 for(const status of ['PENDING','PAID'])assert.equal((await billPublicationView({}, {...f.bill,status},now,true)).state,'PUBLISHED');
 assert.equal((await billPublicationView({}, {...f.bill,status:'VOID'},now,true)).state,'CLOSED');
 const manual=await billPublicationView({}, {...f.bill,type:'EXTRA_FEE'},now,true);assert.equal(manual.mode,'MANUAL');assert.equal(manual.scheduledDate,null);assert.deepEqual(Object.keys(manual).sort(),['blockers','message','mode','scheduledDate','state']);
});

test('unexpected evaluation failure does not turn into a raw server error or expose its details',async()=>{
 const f=fixture();f.tx.order.findUnique=async()=>{throw new Error('private database connection');};f.tx.order.findUniqueOrThrow=f.tx.order.findUnique;
 const result=await billPublicationView(f.tx,f.bill,now,true);assert.equal(result.state,'BLOCKED');assert.deepEqual(result.blockers,['BILL_AUTO_PUBLICATION_CHECK_FAILED']);assert.doesNotMatch(result.message,/private|database/);
});

test('bill list and detail carry the same allowlisted publication projection',async()=>{
 const f=fixture(),bill={...f.bill,status:'PENDING'},db:any={bill:{findMany:async()=>[bill],count:async()=>1,findUnique:async()=>bill}};
 const controller=new AdminController(db),request={admin:{role:'FINANCE'}};
 const list=await controller.list('bills',{},request),detail=await controller.detail('bills',bill.id,request);
 assert.equal(list.items[0].publication.state,'PUBLISHED');assert.deepEqual(detail.publication,list.items[0].publication);
});

test('order workspace exposes publication plans only to internal financial readers',()=>{
 const f=fixture(),publication={mode:'AUTOMATIC',state:'SCHEDULED',scheduledDate:'2026-10-31',message:'预计自动发布',blockers:[]};
 const order={...f.order,bills:[{...f.bill,status:'PENDING',publication}],handovers:[]};
 const archive={...f.archive,kind:'RENTAL'};
 for(const role of ['ADMIN','OPERATIONS','FINANCE'])assert.deepEqual(workspaceProjection(order,[archive],{id:'staff',role}).billing[0].publication,publication);
 assert.equal(workspaceProjection(order,[archive],{id:'customer',role:'CUSTOMER'}).billing[0].publication,undefined);
});
