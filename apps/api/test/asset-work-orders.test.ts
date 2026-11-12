import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WorkOrdersService} from '../src/asset-work-orders/service';
import {createWorkOrderInput,workOrderListInput} from '../src/asset-work-orders/types';
import {canonicalHash} from '../src/customers/types';
import {workOrderFixture,seedWorkOrderSwap,woActor,woFinance,woNow,woCommand,woError,woInput} from './work-orders-fixture';
import {serviceSourceSnapshot} from '../src/asset-work-orders/facts';
import {readServiceSource} from '../src/asset-work-orders/service-source-options';
const setup=async(extra:any={})=>{const f=workOrderFixture(),service=new WorkOrdersService(()=>woNow),input=woInput(extra),row=await f.serial(tx=>service.create(tx,woActor,input));return{...f,service,input,row};};
const act=(f:any,id:string,action:string,body:any)=>f.serial((tx:any)=>f.service.action(tx,woActor,id,action,body));

test('service source accepts initial DELIVERY ended by SWAP_RETURN and incoming SWAP_DELIVERY ended by final RETURN',async()=>{
 const f=workOrderFixture(),{swapAt}=seedWorkOrderSwap(f),snapshot=(vehicle:string,at:Date)=>serviceSourceSnapshot(f.tx,'swap-source',vehicle,at);
 assert.equal((await snapshot('other',new Date('2026-09-15'))).returnHandoverId,'swap-return');
 assert.equal((await snapshot('vehicle',swapAt)).deliveryHandoverId,'swap-delivery');
 await assert.rejects(snapshot('other',swapAt),woError('SERVICE_SOURCE_UNVERIFIED'));
 const change=f.rows('orderChange')[0];change.status='SWAP_RETURNED';change.deliveryHandoverId=null;change.actualCompletedAt=null;
 assert.equal((await snapshot('other',new Date('2026-09-15'))).assignmentId,'outgoing');
 await assert.rejects(snapshot('vehicle',swapAt),woError('SERVICE_SOURCE_UNVERIFIED'));
 Object.assign(change,{status:'APPLIED',deliveryHandoverId:'swap-delivery',actualCompletedAt:swapAt});
 const end=new Date('2026-10-30T03:00:00Z'),incoming=f.rows('vehicleAssignment').find(row=>row.id==='incoming');
 Object.assign(incoming,{status:'CLOSED',endAt:end,endReadingKm:200,returnHandoverId:'final-return'});
 f.seed('handover',{id:'final-return',orderId:'swap-order',customerId:'customer',vehicleId:'vehicle',assignmentId:'incoming',changeId:null,type:'RETURN',status:'COMPLETED',actualAt:end,readingKm:200});
 assert.equal((await snapshot('vehicle',new Date('2026-10-30T02:00:00Z'))).returnHandoverId,'final-return');
 await assert.rejects(snapshot('vehicle',end),woError('SERVICE_SOURCE_UNVERIFIED'));
});

test('swap source rejects unrelated changes, stale pointers, uncompleted states and inconsistent physical facts',async()=>{
 const mutations:[string,(f:ReturnType<typeof workOrderFixture>)=>void][]=[
  ['change absent',f=>f.rows('orderChange').length=0],
  ...['kind','orderId','customerId','targetVehicleId','deliveryHandoverId','returnHandoverId'].map(field=>[field,(f:ReturnType<typeof workOrderFixture>)=>f.rows('orderChange')[0][field]='wrong'] as [string,(f:ReturnType<typeof workOrderFixture>)=>void]),
  ['not applied',f=>f.rows('orderChange')[0].status='AWAITING_FINANCE'],
  ['completion time',f=>f.rows('orderChange')[0].actualCompletedAt=new Date('2026-10-02')],
  ['assignment change',f=>f.rows('vehicleAssignment')[1].changeId='wrong'],
  ...['type','changeId','customerId','vehicleId','assignmentId','status'].map(field=>['delivery '+field,(f:ReturnType<typeof workOrderFixture>)=>f.rows('handover')[2][field]='wrong'] as [string,(f:ReturnType<typeof workOrderFixture>)=>void]),
  ['delivery reading',f=>f.rows('handover')[2].readingKm=101],
  ['delivery date',f=>f.rows('handover')[2].actualAt=new Date('2026-10-02')],
  ['return customer',f=>f.rows('handover')[1].customerId='wrong'],
  ['return reading',f=>f.rows('handover')[1].readingKm=61],
  ['old assignment active',f=>f.rows('vehicleAssignment')[0].status='ACTIVE'],
 ];
 for(const [label,mutate]of mutations){const f=workOrderFixture();seedWorkOrderSwap(f);mutate(f);await assert.rejects(serviceSourceSnapshot(f.tx,'swap-source','vehicle',new Date('2026-10-02')),woError('SERVICE_SOURCE_UNVERIFIED'),label);}
 for(const status of ['DRAFT','CANCELLED','AWAITING_FINANCE']){const f=workOrderFixture();seedWorkOrderSwap(f);f.rows('orderChange')[0].status=status;await assert.rejects(serviceSourceSnapshot(f.tx,'swap-source','other',new Date('2026-09-15')),woError('SERVICE_SOURCE_UNVERIFIED'));}
});
test('work-order DTO accepts explicit facts and rejects NUL, unknown values, impossible dates and unsafe offsets',()=>{
 assert.equal(createWorkOrderInput.safeParse(woInput()).success,true);
 for(const values of [{vehicleId:'x\0'},{idempotencyKey:'nul-key\0'},{title:'x\0'},{description:'x\0'},{occurredAt:'2026-02-30T00:00:00Z'},{occurredAt:'2026-10-30T10:00:00'},{status:'CLOSED'},{kind:'OTHER'},{costConfirmationRequired:false},{accident:{accidentAt:'2026-10-30T00:00:00Z',location:'x',description:'x'}}])assert.equal(createWorkOrderInput.safeParse(woInput(values)).success,false);
 assert.equal(workOrderListInput.safeParse({page:100000000,pageSize:100}).success,false);assert.equal(workOrderListInput.safeParse({page:100000,pageSize:100}).success,false);
});
test('creation uses current permission, vehicle CAS and one command/event/audit; old success replays before current row checks',async()=>{
 const f=await setup(),count=f.writes.length;assert.equal(f.row.status,'PENDING');assert.deepEqual(await f.serial(tx=>f.service.create(tx,woActor,f.input)),f.row);assert.equal(f.writes.length,count);
 await assert.rejects(f.serial(tx=>f.service.create(tx,woActor,{...f.input,title:'不同请求'})),woError('IDEMPOTENCY_CONFLICT'));
 await assert.rejects(f.serial(tx=>f.service.create(tx,woActor,woInput({vehicleRevision:2}))),woError('REVISION_CONFLICT'));
 f.rows('adminUser').find(row=>row.id===woActor.id).authVersion=2;await assert.rejects(f.serial(tx=>f.service.create(tx,woActor,f.input)),woError('STAFF_SESSION_CHANGED'));
 assert.equal(f.rows('assetWorkOrderEvent').length,1);assert.equal(f.rows('assetWorkOrderEvent')[0].sourceHash,canonicalHash(f.rows('assetWorkOrderEvent')[0].detailSnapshot));
});
test('FINANCE is read-only and SUPPORT/FIELD cannot read; assignment options never expose credentials',async()=>{
 const f=await setup();await assert.rejects(f.serial(tx=>f.service.create(tx,woFinance,woInput())),woError('FORBIDDEN'));assert.equal((await f.service.detail(f.tx,woFinance,f.row.id)).id,f.row.id);
 for(const role of ['SUPPORT','FIELD'])await assert.rejects(f.service.list(f.tx,{id:role.toLowerCase(),role,authVersion:1},{}),woError('FORBIDDEN'));
 const options=await f.service.assigneeOptions(f.tx,woActor,{});assert.equal(options.total,2);assert.deepEqual(Object.keys(options.items[0]).sort(),['id','name','role']);
 await assert.rejects(act(f,f.row.id,'assign',{...woCommand(f.row.revision),assigneeId:'finance',providerName:'维修商',contact:'电话',scheduledAt:null,reason:'指派'}),woError('ASSIGNEE_INVALID'));
});
test('service source uses physical assignment at event time, not initial order vehicle or guessed customer ownership',async()=>{
 const f=workOrderFixture(),service=new WorkOrdersService(()=>woNow),time=new Date('2026-10-30T02:00:00Z');
 f.seed('order',{id:'order',customerId:'customer',vehicleId:'other'});f.seed('serviceRequest',{id:'source',revision:0,status:'SUBMITTED',location:'合成位置',description:'合成客户来源',orderId:'order',customerId:'customer',type:'ACCIDENT',createdAt:time});
 f.seed('vehicleAssignment',{id:'assignment',orderId:'order',customerId:'customer',vehicleId:'vehicle',startAt:new Date('2026-10-01'),endAt:null,status:'ACTIVE',deliveryHandoverId:'delivery',returnHandoverId:null,startReadingKm:50});
 f.seed('handover',{id:'delivery',orderId:'order',customerId:'customer',vehicleId:'vehicle',assignmentId:'assignment',type:'DELIVERY',status:'COMPLETED',actualAt:new Date('2026-10-01'),readingKm:50});
 const checked=await readServiceSource(f.tx,'source','vehicle',time),binding={sourceServiceRequestId:'source',sourceServiceRequestRevision:checked.row.revision,sourceServiceRequestHash:checked.sourceHash};
 const made=await f.serial(tx=>service.create(tx,woActor,woInput(binding)));assert.equal(made.sourceServiceSnapshot.assignmentId,'assignment');
 f.rows('handover')[0].customerId='other-customer';await assert.rejects(f.serial(tx=>service.create(tx,woActor,woInput(binding))),woError('SERVICE_SOURCE_UNVERIFIED'));
 f.rows('handover')[0].customerId='customer';f.rows('vehicleAssignment')[0].endAt=time;f.rows('vehicleAssignment')[0].status='CLOSED';await assert.rejects(f.serial(tx=>service.create(tx,woActor,woInput(binding))),woError('SERVICE_SOURCE_UNVERIFIED'));
 assert.equal((await f.serial(tx=>service.create(tx,woActor,woInput()))).sourceServiceRequestId,null);
});
test('processing, evidence and acceptance are explicit; return preserves accepted event and financial facts stay out of DTO',async()=>{
 const f=await setup();let row=await act(f,f.row.id,'start',{...woCommand(f.row.revision),reason:'开始'});
 await assert.rejects(act(f,row.id,'accept',{...woCommand(row.revision),reason:'越级验收',fileIds:['missing']}),woError('WORK_ORDER_STATE'));
 const file=f.attach(row.id);row=await act(f,row.id,'submit-acceptance',{...woCommand(row.revision),solution:'已修复',fileIds:[file]});
 row=await act(f,row.id,'accept',{...woCommand(row.revision),reason:'已核实',fileIds:[file]});assert.equal(row.status,'PENDING_COST_CONFIRMATION');const accepted=row.acceptedEventId;
 const event=f.rows('assetWorkOrderEvent').find(item=>item.id===accepted);assert.equal(event.action,'ACCEPT');assert.equal(event.afterRevision,row.acceptedRevision);assert.equal(event.sourceHash,canonicalHash(event.detailSnapshot));
 f.seed('assetWorkOrderCost',{id:'financial',workOrderId:row.id,vehicleId:'vehicle',status:'FROZEN',amount:99999});f.seed('assetWorkOrderEvent',{id:'finance-event',workOrderId:row.id,sequence:99,action:'FINANCE_CLOSE',actorId:'finance',actorAt:woNow,beforeRevision:3,afterRevision:4,detailSnapshot:{amount:99999,bankAccount:'private'},sourceHash:'b'.repeat(64)});
 row=await act(f,row.id,'return-for-work',{...woCommand(row.revision),reason:'需补修'});assert.equal(row.acceptedEventId,accepted);assert.equal(row.status,'IN_PROGRESS');assert.equal(JSON.stringify(row).includes('99999'),false);assert.equal(JSON.stringify(row).includes('bankAccount'),false);
 await assert.rejects(act(f,row.id,'close',{...woCommand(row.revision),reason:'运营关单'}),woError('VALIDATION'));
});
test('free close requires explicit no-cost reason and no pending costs, terminal notes do not mutate accepted facts',async()=>{
 const f=await setup({costConfirmationRequired:false,noCostReason:'厂家保修'});let row=await act(f,f.row.id,'start',{...woCommand(f.row.revision),reason:'开始'}),file=f.attach(row.id);
 row=await act(f,row.id,'submit-acceptance',{...woCommand(row.revision),solution:'保修完成',fileIds:[file]});
 f.seed('assetWorkOrderCost',{id:'unresolved',workOrderId:row.id,vehicleId:'vehicle',status:'DRAFT'});await assert.rejects(act(f,row.id,'accept',{...woCommand(row.revision),reason:'未清费用',fileIds:[file]}),woError('WORK_ORDER_COST_PENDING'));f.rows('assetWorkOrderCost').length=0;
 row=await act(f,row.id,'accept',{...woCommand(row.revision),reason:'已验收',fileIds:[file]});assert.equal(row.status,'CLOSED');const accepted=row.acceptedEventId;
 row=await act(f,row.id,'notes',{...woCommand(row.revision),note:'追加原事实说明'});assert.equal(row.status,'CLOSED');assert.equal(row.acceptedEventId,accepted);
 await assert.rejects(f.serial(tx=>f.service.patch(tx,woActor,row.id,{...woCommand(row.revision),title:'改终态'})),woError('WORK_ORDER_STATE'));
});
test('restrictions and release CAS vehicle and parent versions, preserve original proof, never take an order lock or rewrite vehicle status',async()=>{
 const f=await setup(),file=f.attach(f.row.id),body={...woCommand(f.row.revision),vehicleRevision:3,scopes:['ALLOCATION','DELIVERY'],reason:'维修不能交付',fileIds:[file]};
 let row=await f.serial(tx=>f.service.restrict(tx,woActor,f.row.id,body));assert.equal(f.rows('vehicle')[0].revision,4);assert.equal(f.rows('vehicle')[0].status,'IN_USE');const restricted=f.rows('vehicleOperationalRestriction')[0];
 const count=f.writes.length;assert.deepEqual(await f.serial(tx=>f.service.restrict(tx,woActor,f.row.id,body)),row);assert.equal(f.writes.length,count);
 await assert.rejects(act(f,row.id,'cancel',{...woCommand(row.revision),reason:'仍限制'}),woError('WORK_ORDER_RESTRICTED'));
 await assert.rejects(f.serial(tx=>f.service.release(tx,woActor,row.id,restricted.id,{...woCommand(row.revision),restrictionRevision:0,vehicleRevision:3,reason:'过时',fileIds:[file]})),woError('REVISION_CONFLICT'));
 row=await f.serial(tx=>f.service.release(tx,woActor,row.id,restricted.id,{...woCommand(row.revision),restrictionRevision:0,vehicleRevision:4,reason:'已核实可恢复',fileIds:[file]}));assert.equal(f.rows('vehicle')[0].revision,5);assert.equal(f.rows('vehicleOperationalRestriction')[0].status,'RELEASED');assert.deepEqual(f.rows('vehicleOperationalRestriction')[0].evidenceFileIds,[file]);assert.equal(f.locks.some(sql=>sql.includes('FROM "Order"')),false);
});
test('submitted proof is frozen and cannot silently change before acceptance; cross-parent private files never qualify',async()=>{
 const f=await setup();let row=await act(f,f.row.id,'start',{...woCommand(f.row.revision),reason:'开始'});const file=f.attach(row.id),foreign=f.attach('another-work-order');
 await assert.rejects(act(f,row.id,'submit-acceptance',{...woCommand(row.revision),solution:'处理',fileIds:[foreign]}),woError('ASSET_FILE_INVALID'));
 row=await act(f,row.id,'submit-acceptance',{...woCommand(row.revision),solution:'已处理',fileIds:[file]});const count=f.writes.length;
 f.rows('storedFile').find(item=>item.id===file).sha256='b'.repeat(64);f.rows('assetPrivateFile').find(item=>item.fileId===file).sha256='b'.repeat(64);
 await assert.rejects(act(f,row.id,'accept',{...woCommand(row.revision),reason:'摘要变化',fileIds:[file]}),woError('WORK_ORDER_EVIDENCE_CHANGED'));assert.equal(f.writes.length,count);assert.equal(f.rows('assetWorkOrder').find(item=>item.id===row.id).status,'PENDING_ACCEPTANCE');
});
test('closed work orders retain active restrictions until explicit release, and attachment revision gaps do not create event sequence gaps',async()=>{
 const f=await setup({costConfirmationRequired:false,noCostReason:'免费维修'}),file=f.attach(f.row.id);let row=await f.serial(tx=>f.service.restrict(tx,woActor,f.row.id,{...woCommand(f.row.revision),vehicleRevision:3,scopes:['DELIVERY'],reason:'待核验',fileIds:[file]}));
 const restriction=f.rows('vehicleOperationalRestriction')[0];f.rows('assetWorkOrder').find(item=>item.id===row.id).revision+=2;row=await f.service.detail(f.tx,woActor,row.id);
 row=await act(f,row.id,'start',{...woCommand(row.revision),reason:'开始'});row=await act(f,row.id,'submit-acceptance',{...woCommand(row.revision),solution:'修复完成',fileIds:[file]});row=await act(f,row.id,'accept',{...woCommand(row.revision),reason:'验收',fileIds:[file]});assert.equal(row.status,'CLOSED');assert.equal(f.rows('vehicleOperationalRestriction')[0].status,'ACTIVE');
 row=await f.serial(tx=>f.service.release(tx,woActor,row.id,restriction.id,{...woCommand(row.revision),restrictionRevision:0,vehicleRevision:4,reason:'明确恢复交付',fileIds:[file]}));assert.equal(row.status,'CLOSED');assert.deepEqual(f.rows('assetWorkOrderEvent').map(item=>item.sequence),[1,2,3,4,5,6]);assert.equal(f.rows('assetWorkOrderEvent')[2].beforeRevision,3);
});
test('unreversed actual costs and scheduled plans block cancellation; claim conclusion never creates a cash or customer bill fact',async()=>{
 const f=await setup({kind:'ACCIDENT_REPAIR',accident:{accidentAt:'2026-10-30T01:00:00Z',location:'现场',description:'明确事故'}}),file=f.attach(f.row.id);let row=await act(f,f.row.id,'claim',{...woCommand(f.row.revision),reason:'登记处理结论',fileIds:[file],insurerName:'真实保险人',claimNumber:'CLAIM-1',claimStatus:'SETTLED'});assert.equal(row.claimStatus,'SETTLED');assert.equal(f.writes.some(write=>['payment','bill'].includes(write.table)),false);
 f.seed('assetWorkOrderCost',{id:'line',workOrderId:row.id,vehicleId:'vehicle',status:'FROZEN'});f.seed('assetCostPlan',{id:'plan',workOrderCostId:'line',vehicleId:'vehicle',sourceKind:'WORK_ORDER',status:'SCHEDULED'});
 await assert.rejects(act(f,row.id,'cancel',{...woCommand(row.revision),reason:'待费用'}),woError('WORK_ORDER_COST_PENDING'));f.rows('assetCostPlan')[0].status='CONFIRMED';f.seed('assetCostEntry',{id:'cost',planId:'plan',effect:'COST',reversalOfId:null});
 await assert.rejects(act(f,row.id,'cancel',{...woCommand(row.revision),reason:'仍有成本'}),woError('WORK_ORDER_COST_PENDING'));f.seed('assetCostEntry',{id:'reversal',planId:'plan',effect:'REVERSAL',reversalOfId:'cost'});row=await act(f,row.id,'cancel',{...woCommand(row.revision),reason:'已明确冲正后取消'});assert.equal(row.status,'CANCELLED');assert.equal(f.rows('assetCostEntry').length,2);
});
