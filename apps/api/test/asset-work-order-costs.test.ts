import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {canonicalHash} from '../src/customers/types';
import {WorkOrderCostsService} from '../src/asset-work-order-costs/service';
import {workCostCreateInput,workCostPatchInput,workCostListInput} from '../src/asset-work-order-costs/types';
import {AssetCostsService} from '../src/asset-costs/service';
import {AssetCostPlansService} from '../src/asset-costs/plans';
import {sourceRef,validateCostPlan} from '../src/asset-costs/source';
import {assetActor,financeActor,assetNow,assetCommand,assetError,workCostFixture,seedAcceptedWork,reacceptWork,attachFinancialProof} from './asset-work-order-costs-fixture';

const facts=(workOrderRevision=5,amount=12345)=>({...assetCommand(),workOrderRevision,amount,category:'REPAIR',occurredOn:'2027-02-14',supplierName:'合成修理厂',referenceNo:randomUUID(),reason:'实际维修费用依据',replacesCostId:null});
async function setup(){const f=workCostFixture(),work=seedAcceptedWork(f),service=new WorkOrderCostsService(()=>assetNow),costs=new AssetCostsService(()=>assetNow),plans=new AssetCostPlansService(()=>assetNow);return{...f,work,service,costs,plans};}
async function prepared(){const f=await setup(),created=await f.serial(tx=>f.service.create(tx,financeActor,'work',facts())),fileId=attachFinancialProof(f,'WORK_ORDER_COST',created.id),preview=await f.service.preview(f.tx,financeActor,created.id,{}),input={...assetCommand(created.revision),workOrderRevision:f.work.revision,previewHash:preview.previewHash},result=await f.serial(tx=>f.service.prepare(tx,financeActor,created.id,input));return{...f,line:result.line,plan:result.plan,prepareInput:input,fileId};}

test('financial work-order DTO keeps integer fen, explicit source, safe text and bounded offsets',()=>{
 assert.equal(workCostCreateInput.safeParse(facts()).success,true);for(const change of [{amount:0},{amount:2147483648},{amount:1.5},{supplierName:'bad\0supplier'},{reason:'bad\0reason'},{sourceHash:'a'.repeat(64)},{category:'BAAS_RENT'},{occurredOn:'2027-02-30'}])assert.equal(workCostCreateInput.safeParse({...facts(),...change}).success,false);
 assert.equal(workCostPatchInput.safeParse({...assetCommand(),workOrderId:'other'}).success,false);assert.equal(workCostPatchInput.safeParse(assetCommand()).success,false);assert.equal(workCostListInput.safeParse({page:21474838,pageSize:100}).success,false);
 assert.equal(workCostPatchInput.safeParse({...assetCommand(),category:'TOWING'}).success,false);
});

test('actual source dates cannot be later than Shanghai today',async()=>{
 const f=await setup();await assert.rejects(f.serial(tx=>f.service.create(tx,financeActor,'work',{...facts(),occurredOn:'2027-02-16'})),assetError('WORK_COST_DATE_FUTURE'));assert.equal(f.rows('assetWorkOrderCost').length,0);
 const line=await f.serial(tx=>f.service.create(tx,financeActor,'work',facts()));await assert.rejects(f.serial(tx=>f.service.update(tx,financeActor,line.id,{...assetCommand(),occurredOn:'2027-02-16'})),assetError('WORK_COST_DATE_FUTURE'));
});

test('line preview is read-only and requires current financial role, real current ACCEPT and same-parent evidence',async()=>{
 const f=await setup();await assert.rejects(f.service.create(f.tx,assetActor,'work',facts()),assetError('FORBIDDEN'));const line=await f.serial(tx=>f.service.create(tx,financeActor,'work',facts()));await assert.rejects(f.service.preview(f.tx,financeActor,line.id,{}),assetError('ASSET_FILES_REQUIRED'));
 attachFinancialProof(f,'WORK_ORDER_COST',line.id);const before=f.writes.length,locks=f.locks.length,preview=await f.service.preview(f.tx,financeActor,line.id,{});assert.equal(preview.amount,12345);assert.equal(preview.costPeriod,'2027-02');assert.equal(preview.periodStart,preview.periodEnd);assert.equal(f.writes.length,before);assert.equal(f.locks.length,locks);
 f.rows('assetWorkOrderEvent')[0].sourceHash='f'.repeat(64);await assert.rejects(f.service.preview(f.tx,financeActor,line.id,{}),assetError('WORK_ORDER_ACCEPTANCE_INVALID'));
});

test('prepare freezes line revision, true ACCEPT, files and exact same plan hash; DRAFT-only edits and old-key replay remain strict',async()=>{
 const f=await prepared(),line=f.rows('assetWorkOrderCost')[0],plan=f.rows('assetCostPlan')[0];assert.equal(line.status,'FROZEN');assert.equal(line.sourceHash,canonicalHash(line.sourceSnapshot));assert.equal(plan.sourceHash,line.sourceHash);assert.deepEqual(plan.sourceSnapshot,line.sourceSnapshot);assert.equal(plan.workOrderCostId,line.id);assert.equal(plan.sourceRevision,line.revision);assert.equal(line.sourceSnapshot.acceptedEventId,'accept-work');assert.equal(line.sourceSnapshot.acceptedRevision,5);assert.equal(line.sourceSnapshot.evidence[0].id,f.fileId);
 await assert.rejects(f.serial(tx=>f.service.update(tx,financeActor,line.id,{...assetCommand(line.revision),amount:999})),assetError('WORK_COST_STATE'));
 f.rows('assetWorkOrder')[0].status='IN_PROGRESS';const count=f.writes.length;assert.deepEqual(await f.serial(tx=>f.service.prepare(tx,financeActor,line.id,f.prepareInput)),{line:f.line,plan:f.plan});assert.equal(f.writes.length,count);
 f.revoke(financeActor.id);await assert.rejects(f.serial(tx=>f.service.prepare(tx,financeActor,line.id,f.prepareInput)),assetError('STAFF_SESSION_CHANGED'));
});

test('two real work sources in one vehicle month both confirm while one source only produces one original cost',async()=>{
 const f=await prepared(),second=await f.serial(tx=>f.service.create(tx,financeActor,'work',facts(f.work.revision,20000)));attachFinancialProof(f,'WORK_ORDER_COST',second.id);const preview=await f.service.preview(f.tx,financeActor,second.id,{}),prepared2=await f.serial(tx=>f.service.prepare(tx,financeActor,second.id,{...assetCommand(second.revision),workOrderRevision:f.work.revision,previewHash:preview.previewHash}));
 const command={plans:[{id:f.plan.id,revision:f.plan.revision},{id:prepared2.plan.id,revision:prepared2.plan.revision}],idempotencyKey:randomUUID()},result=await f.serial(tx=>f.costs.confirm(tx,financeActor,command));assert.equal(result.entries.length,2);assert.equal(result.totalAmount,32345);assert.ok(result.entries.every((entry:any)=>entry.category==='REPAIR'));assert.deepEqual(await f.serial(tx=>f.costs.confirm(tx,financeActor,command)),result);assert.equal(f.rows('assetCostEntry').length,2);
 await assert.rejects(f.plans.list(f.tx,assetActor,{sourceKind:'WORK_ORDER'}),assetError('FORBIDDEN'));assert.equal((await f.plans.list(f.tx,assetActor,{})).items.length,0);await assert.rejects(f.plans.detail(f.tx,assetActor,f.plan.id),assetError('FORBIDDEN'));
});

test('return then reaccept invalidates first confirmation and reopen of the old frozen source without invalidating history',async()=>{
 const f=await prepared();reacceptWork(f);await assert.rejects(f.serial(tx=>f.costs.confirm(tx,financeActor,{plans:[{id:f.plan.id,revision:0}],idempotencyKey:randomUUID()})),assetError('WORK_ORDER_ACCEPTANCE_CHANGED'));assert.equal(f.rows('assetCostEntry').length,0);
 const old=structuredClone(f.rows('assetCostPlan')[0].sourceSnapshot),voided=await f.serial(tx=>f.plans.void(tx,financeActor,f.plan.id,{...assetCommand(),reason:'旧验收未入账来源作废'}));await assert.rejects(f.plans.reopenPreview(f.tx,financeActor,f.plan.id),assetError('WORK_ORDER_ACCEPTANCE_CHANGED'));assert.deepEqual(f.rows('assetCostPlan')[0].sourceSnapshot,old);assert.equal(voided.status,'VOIDED');await validateCostPlan(f.tx,f.rows('assetCostPlan')[0]);
 const replacement=await f.serial(tx=>f.service.create(tx,financeActor,'work',{...facts(f.work.revision),replacesCostId:f.line.id}));attachFinancialProof(f,'WORK_ORDER_COST',replacement.id);const preview=await f.service.preview(f.tx,financeActor,replacement.id,{}),fresh=await f.serial(tx=>f.service.prepare(tx,financeActor,replacement.id,{...assetCommand(replacement.revision),workOrderRevision:f.work.revision,previewHash:preview.previewHash}));assert.equal(fresh.line.sourceSnapshot.acceptedEventId,'accept-again-work');await f.serial(tx=>f.costs.confirm(tx,financeActor,{plans:[{id:fresh.plan.id,revision:0}],idempotencyKey:randomUUID()}));
});

test('unknown or mixed cost sources and modified original ACCEPT facts cannot enter the ledger',async()=>{
 for(const plan of [{sourceKind:'UNKNOWN',depreciationPolicyId:'fake'},{sourceKind:'BAAS',baasContractId:'baas',workOrderCostId:'line'},{sourceKind:'WORK_ORDER',workOrderCostId:'line',depreciationPolicyId:'depr'}])assert.throws(()=>sourceRef(plan),assetError('COST_SOURCE_MISMATCH'));
 const f=await prepared();f.rows('assetWorkOrderEvent')[0].detailSnapshot.vehicleId='other';await assert.rejects(validateCostPlan(f.tx,f.rows('assetCostPlan')[0]),assetError('WORK_ORDER_ACCEPTANCE_INVALID'));
});

test('cost category follows actual work kind and stale evidence preview cannot freeze a changed line',async()=>{
 const f=await setup();f.work.kind='MAINTENANCE';await assert.rejects(f.serial(tx=>f.service.create(tx,financeActor,'work',facts())),assetError('WORK_COST_CATEGORY'));const line=await f.serial(tx=>f.service.create(tx,financeActor,'work',{...facts(),category:'MAINTENANCE'}));attachFinancialProof(f,'WORK_ORDER_COST',line.id);const preview=await f.service.preview(f.tx,financeActor,line.id,{}),changed=await f.serial(tx=>f.service.update(tx,financeActor,line.id,{...assetCommand(),reason:'更正凭证说明'}));await assert.rejects(f.serial(tx=>f.service.prepare(tx,financeActor,line.id,{...assetCommand(changed.revision),workOrderRevision:f.work.revision,previewHash:preview.previewHash})),assetError('PREVIEW_CHANGED'));assert.equal(f.rows('assetCostPlan').length,0);
});
