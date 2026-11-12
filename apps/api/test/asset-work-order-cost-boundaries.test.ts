import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {WorkOrderCostsService} from '../src/asset-work-order-costs/service';
import {WorkOrderFinanceService} from '../src/asset-work-order-costs/workflow';
import {WorkOrderCostsController,WorkOrderCostLinesController} from '../src/asset-work-order-costs/controller';
import {workCostTransaction} from '../src/asset-work-order-costs/command';
import {safeWorkTotal} from '../src/asset-work-order-costs/ledger';
import {AssetCostsService} from '../src/asset-costs/service';
import {AssetCostPlansService} from '../src/asset-costs/plans';
import {financeActor,assetNow,assetCommand,assetError,workCostFixture,seedAcceptedWork,attachFinancialProof} from './asset-work-order-costs-fixture';

async function fixture(){const f=workCostFixture(),work=seedAcceptedWork(f),service=new WorkOrderCostsService(()=>assetNow),costs=new AssetCostsService(()=>assetNow),plans=new AssetCostPlansService(()=>assetNow),finance=new WorkOrderFinanceService(()=>assetNow),input={...assetCommand(),workOrderRevision:5,category:'REPAIR',amount:100,occurredOn:'2027-02-14',supplierName:'真实合成厂',referenceNo:'原票据',reason:'费用真实依据',replacesCostId:null},line=await f.serial(tx=>service.create(tx,financeActor,work.id,input));return{...f,service,costs,plans,finance,line,input};}
async function prepare(f:Awaited<ReturnType<typeof fixture>>){attachFinancialProof(f,'WORK_ORDER_COST',f.line.id);const preview=await f.service.preview(f.tx,financeActor,f.line.id,{});return f.serial(tx=>f.service.prepare(tx,financeActor,f.line.id,{...assetCommand(),workOrderRevision:5,previewHash:preview.previewHash}));}

test('financial routes expose exactly the dedicated resources and read-only preview',()=>{
 assert.equal(Reflect.getMetadata('path',WorkOrderCostsController),'admin/asset-work-order-costs');assert.equal(Reflect.getMetadata('path',WorkOrderCostLinesController),'admin/asset-work-order-cost-lines');assert.equal(Reflect.getMetadata('path',WorkOrderCostLinesController.prototype.preview),':id/preview');assert.equal(Reflect.getMetadata('method',WorkOrderCostLinesController.prototype.preview),1);
});
test('only exact known work-source replacement and command races restart the entire transaction',async()=>{
 for(const meta of [{modelName:'AssetWorkOrderCost',target:['replacesCostId']},{modelName:'ArchiveCommand',target:['actorId','resourceId','action','key']}]){let count=0;const db:any={serial:async(operation:any)=>{if(++count===1)throw{code:'P2002',meta};return operation('new-snapshot');}};assert.equal(await workCostTransaction(db,async tx=>tx),'new-snapshot');assert.equal(count,2);}
 for(const error of [{code:'P2002',meta:{modelName:'Other',target:['replacesCostId']}},{code:'P2002',meta:{modelName:'AssetWorkOrderCost',target:['vehicleId']}},{code:'P2010'},new Error('offline')]){let count=0;await assert.rejects(workCostTransaction({serial:async()=>{count++;throw error;}} as any,async()=>null),(actual:any)=>actual===error);assert.equal(count,1);}
});
test('financial replay never bypasses different-body conflict; every mutation locks vehicle then actual work then source',async()=>{
 const f=await fixture();await assert.rejects(f.serial(tx=>f.service.create(tx,financeActor,'work',{...f.input,amount:101})),assetError('IDEMPOTENCY_CONFLICT'));const start=f.locks.length;await prepare(f);const locks=f.locks.slice(start).filter(value=>value.includes('FOR UPDATE'));assert.ok(locks[0].includes('"Vehicle"'));assert.ok(locks[1].includes('"AssetWorkOrder"'));assert.ok(locks[2].includes('"AssetWorkOrderCost"'));
});
test('a voided source with a declared replacement cannot reopen even if the old ACCEPT is still current',async()=>{
 const f=await fixture(),made=await prepare(f);await f.serial(tx=>f.plans.void(tx,financeActor,made.plan.id,{...assetCommand(),reason:'明确替代错误原费'}));await f.serial(tx=>f.service.create(tx,financeActor,'work',{...f.input,idempotencyKey:randomUUID(),replacesCostId:made.line.id}));await assert.rejects(f.plans.reopenPreview(f.tx,financeActor,made.plan.id),assetError('WORK_COST_REPLACEMENT_EXISTS'));
});
test('foreign financial evidence and tampered frozen amount/date/parent/hash/ACCEPT are all rejected',async()=>{
 const foreign=await fixture();attachFinancialProof(foreign,'WORK_ORDER_COST',foreign.line.id);foreign.rows('assetPrivateFile')[0].workOrderId='work';await assert.rejects(foreign.service.preview(foreign.tx,financeActor,foreign.line.id,{}),assetError('ASSET_FILE_INVALID'));
 for(const field of ['amount','occurredOn','vehicleId','sourceHash','acceptedEventId']){const f=await fixture(),made=await prepare(f);if(field==='acceptedEventId')f.rows('assetWorkOrderEvent')[0].action='ASSIGN';else if(field==='amount')f.rows('assetWorkOrderCost')[0].amount=999;else if(field==='occurredOn')f.rows('assetWorkOrderCost')[0].occurredOn=new Date('2027-02-13');else f.rows('assetCostPlan')[0][field]='foreign';await assert.rejects(f.serial(tx=>f.costs.confirm(tx,financeActor,{plans:[{id:made.plan.id,revision:0}],idempotencyKey:randomUUID()})));assert.equal(f.rows('assetCostEntry').length,0);}
});
test('financial close blocks both unresolved draft and scheduled facts; sums reject unsafe integer output',async()=>{
 const f=await fixture();await assert.rejects(f.serial(tx=>f.finance.close(tx,financeActor,'work',{...assetCommand(5),reason:'不能越过草稿'})),assetError('WORK_ORDER_COSTS_INCOMPLETE'));await prepare(f);await assert.rejects(f.serial(tx=>f.finance.close(tx,financeActor,'work',{...assetCommand(5),reason:'不能越过待确认计划'})),assetError('WORK_ORDER_COSTS_INCOMPLETE'));assert.throws(()=>safeWorkTotal(BigInt(Number.MAX_SAFE_INTEGER)+1n),assetError('AMOUNT_OVERFLOW'));
});
test('NUL path ids fail validation before any shared ledger query',async()=>{
 const db:any={adminUser:{findUnique:async()=>({...financeActor,active:true})},assetCostEntry:{findUnique:async()=>{throw Error('unexpected database read');}},assetCostPlan:{findUnique:async()=>{throw Error('unexpected database read');}}};
 for(const service of [new AssetCostsService(),new AssetCostPlansService()])await assert.rejects(service.detail(db,financeActor,'bad\0id'),(error:any)=>error.name==='ZodError');
});
test('financial history lists and plan detail verify frozen sources without requiring the latest acceptance',async()=>{
 const f=await fixture(),made=await prepare(f);await f.serial(tx=>f.costs.confirm(tx,financeActor,{plans:[{id:made.plan.id,revision:0}],idempotencyKey:randomUUID()}));f.rows('assetWorkOrder')[0].status='IN_PROGRESS';
 assert.equal((await f.service.listLines(f.tx,financeActor,{})).items.length,1);assert.equal((await f.costs.list(f.tx,financeActor,{})).items.length,1);assert.equal((await f.plans.detail(f.tx,financeActor,made.plan.id)).id,made.plan.id);
 f.rows('assetWorkOrderEvent')[0].sourceHash='f'.repeat(64);
 for(const operation of [()=>f.service.listLines(f.tx,financeActor,{}),()=>f.costs.list(f.tx,financeActor,{}),()=>f.plans.detail(f.tx,financeActor,made.plan.id),()=>f.plans.list(f.tx,financeActor,{sourceKind:'WORK_ORDER'})])await assert.rejects(operation(),assetError('WORK_ORDER_ACCEPTANCE_INVALID'));
});
