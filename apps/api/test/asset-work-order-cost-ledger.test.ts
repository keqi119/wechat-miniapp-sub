import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {WorkOrderCostsService} from '../src/asset-work-order-costs/service';
import {WorkOrderFinanceService} from '../src/asset-work-order-costs/workflow';
import {AssetCostsService} from '../src/asset-costs/service';
import {AssetCostPlansService} from '../src/asset-costs/plans';
import {assetActor,financeActor,assetNow,assetCommand,assetError,workCostFixture,seedAcceptedWork,reacceptWork,attachFinancialProof} from './asset-work-order-costs-fixture';

async function setup(){const f=workCostFixture(),work=seedAcceptedWork(f),service=new WorkOrderCostsService(()=>assetNow),finance=new WorkOrderFinanceService(()=>assetNow),costs=new AssetCostsService(()=>assetNow),plans=new AssetCostPlansService(()=>assetNow),create={...assetCommand(),workOrderRevision:5,category:'REPAIR',amount:10000,occurredOn:'2027-02-14',supplierName:'合成厂',referenceNo:'合成维修单',reason:'实付维修来源',replacesCostId:null},line=await f.serial(tx=>service.create(tx,financeActor,'work',create));attachFinancialProof(f,'WORK_ORDER_COST',line.id);const preview=await service.preview(f.tx,financeActor,line.id,{}),prepared=await f.serial(tx=>service.prepare(tx,financeActor,line.id,{...assetCommand(line.revision),workOrderRevision:work.revision,previewHash:preview.previewHash})),confirm={plans:[{id:prepared.plan.id,revision:0}],idempotencyKey:randomUUID()},confirmed=await f.serial(tx=>costs.confirm(tx,financeActor,confirm));return{...f,work,service,finance,costs,plans,line:prepared.line,plan:prepared.plan,entry:confirmed.entries[0],confirm,confirmed};}

test('financial close requires no unsettled drafts/plans and a true effective cost; reopening preserves acceptance and appends events',async()=>{
 const f=await setup(),accept=f.work.acceptedEventId;await assert.rejects(f.finance.close(f.tx,assetActor,'work',{...assetCommand(f.work.revision),reason:'运营不能财务关闭'}),assetError('FORBIDDEN'));
 const closed=await f.serial(tx=>f.finance.close(tx,financeActor,'work',{...assetCommand(f.work.revision),reason:'费用全部确认'}));assert.equal(closed.workOrder.status,'CLOSED');assert.equal(f.rows('assetWorkOrder').find(row=>row.id==='work').acceptedEventId,accept);assert.equal(f.rows('assetWorkOrderEvent').at(-1).action,'FINANCE_CLOSE');
 await assert.rejects(f.serial(tx=>f.costs.reverse(tx,financeActor,f.entry.id,{...assetCommand(),reason:'最后一笔必须重开'})),assetError('WORK_ORDER_REOPEN_REQUIRED'));
 const revision=closed.workOrder.revision,reopened=await f.serial(tx=>f.finance.reopen(tx,financeActor,'work',{...assetCommand(revision),entryId:f.entry.id,entryRevision:0,reason:'错误成本重新核实'}));assert.equal(reopened.workOrder.status,'PENDING_COST_CONFIRMATION');assert.equal(f.rows('assetWorkOrderEvent').at(-1).action,'REOPEN_COST_REVIEW');assert.equal(f.rows('assetWorkOrder').find(row=>row.id==='work').acceptedEventId,accept);
 await f.serial(tx=>f.costs.reverse(tx,financeActor,f.entry.id,{...assetCommand(),reason:'整笔冲正保留原额'}));await assert.rejects(f.serial(tx=>f.finance.close(tx,financeActor,'work',{...assetCommand(reopened.workOrder.revision),reason:'已经没有有效成本'})),assetError('WORK_ORDER_COSTS_INCOMPLETE'));
});

test('closed and reaccepted work keep original cost readable and successful confirm replay, while permission loss still rejects',async()=>{
 const f=await setup(),original=f.rows('assetCostEntry')[0].sourceHash;await f.serial(tx=>f.finance.close(tx,financeActor,'work',{...assetCommand(f.work.revision),reason:'财务已结清'}));reacceptWork(f);const detail=await f.costs.detail(f.tx,financeActor,f.entry.id);assert.equal(detail.sourceHash,original);assert.ok(detail.source.sourceKind==='WORK_ORDER');assert.equal(detail.source.workOrderCostId,f.line.id);assert.deepEqual(await f.serial(tx=>f.costs.confirm(tx,financeActor,f.confirm)),f.confirmed);f.revoke(financeActor.id);await assert.rejects(f.serial(tx=>f.costs.confirm(tx,financeActor,f.confirm)),assetError('STAFF_SESSION_CHANGED'));
});

test('repair manual payment copies the full original amount and must be voided before reversal',async()=>{
 const f=await setup(),fileId=attachFinancialProof(f,'COST',f.entry.id),input={...assetCommand(),paidAt:'2027-02-14',referenceNo:'真实银行流水',reason:'整笔付款登记',fileIds:[fileId]},paid=await f.serial(tx=>f.costs.manualPayment(tx,financeActor,f.entry.id,input));assert.equal(paid.payments[0].amount,10000);assert.equal(f.rows('assetCostEntry')[0].amount,10000);assert.deepEqual(await f.serial(tx=>f.costs.manualPayment(tx,financeActor,f.entry.id,input)),paid);
 await assert.rejects(f.serial(tx=>f.costs.reverse(tx,financeActor,f.entry.id,{...assetCommand(1),reason:'先撤销付款登记'})),assetError('COST_HAS_PAYMENT'));const record=paid.payments[0];await f.serial(tx=>f.costs.voidPayment(tx,financeActor,f.entry.id,record.id,{...assetCommand(1),recordRevision:0,reason:'凭证登记更正'}));await f.serial(tx=>f.costs.reverse(tx,financeActor,f.entry.id,{...assetCommand(2),reason:'整笔原额冲正'}));assert.deepEqual(f.rows('assetCostEntry').map(row=>[row.effect,row.amount]),[['COST',10000],['REVERSAL',10000]]);
});

test('insurance receipts stay separate, require same original cost evidence and block reversal until explicit void',async()=>{
 const f=await setup(),fileId=attachFinancialProof(f,'COST',f.entry.id),input={...assetCommand(),workOrderRevision:f.work.revision,costEntryId:f.entry.id,entryRevision:0,amount:7000,receivedOn:'2027-02-14',referenceNo:'保险人工实收流水',reason:'真实到账登记',fileIds:[fileId]};await assert.rejects(f.finance.recovery(f.tx,assetActor,'work',input),assetError('FORBIDDEN'));const record=await f.serial(tx=>f.finance.recovery(tx,financeActor,'work',input));assert.equal(record.amount,7000);assert.equal(f.rows('assetCostEntry')[0].amount,10000);assert.equal(f.rows('assetCostEntry')[0].revision,1);assert.deepEqual(await f.serial(tx=>f.finance.recovery(tx,financeActor,'work',input)),record);
 await assert.rejects(f.serial(tx=>f.costs.reverse(tx,financeActor,f.entry.id,{...assetCommand(1),reason:'仍有保险登记'})),assetError('COST_HAS_RECOVERY'));const workspace=await f.service.detail(f.tx,financeActor,'work');assert.equal(workspace.totals.netCostAmount,10000);assert.equal(workspace.totals.manualRecoveryAmount,7000);
 await f.serial(tx=>f.finance.voidRecovery(tx,financeActor,'work',record.id,{...assetCommand(f.work.revision),recordRevision:0,entryRevision:1,reason:'保险凭据更正'}));await f.serial(tx=>f.costs.reverse(tx,financeActor,f.entry.id,{...assetCommand(2),reason:'保险登记撤销后冲正'}));assert.equal(f.rows('assetRecoveryRecord')[0].status,'VOIDED');
});

test('posted plans cannot be reopened to erase history and replacement requires the original full reversal',async()=>{
 const f=await setup(),replacement={...assetCommand(),workOrderRevision:f.work.revision,category:'REPAIR',amount:9000,occurredOn:'2027-02-14',supplierName:'合成厂',referenceNo:'更正单',reason:'明确替代错误原金额',replacesCostId:f.line.id};await assert.rejects(f.serial(tx=>f.service.create(tx,financeActor,'work',replacement)),assetError('WORK_COST_REPLACEMENT_REQUIRED'));
 await assert.rejects(f.serial(tx=>f.plans.void(tx,financeActor,f.plan.id,{...assetCommand(1),reason:'不能取消已经入账'})),assetError('COST_PLAN_STATE'));await f.serial(tx=>f.costs.reverse(tx,financeActor,f.entry.id,{...assetCommand(),reason:'错误原金额先冲正'}));const next=await f.serial(tx=>f.service.create(tx,financeActor,'work',replacement));assert.equal(next.replacesCostId,f.line.id);await assert.rejects(f.serial(tx=>f.service.create(tx,financeActor,'work',{...replacement,idempotencyKey:randomUUID()})),assetError('WORK_COST_REPLACEMENT_EXISTS'));
 f.rows('assetCostPlan')[0].status='VOIDED';await assert.rejects(f.plans.reopenPreview(f.tx,financeActor,f.plan.id),assetError('COST_PLAN_STATE'));
});
