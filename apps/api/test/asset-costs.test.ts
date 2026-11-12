import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BaasService} from '../src/vehicle-baas/service';
import {AssetCostsService} from '../src/asset-costs/service';
import {AssetCostPlansService} from '../src/asset-costs/plans';
import {depreciationTerms,generateCostPlans,loadCostSource,previewCostPlans} from '../src/asset-costs/source';
import {canonicalHash} from '../src/customers/types';
import {assetActor,assetCommand,assetError,assetFixture,assetNow,financeActor} from './asset-ledger-fixture';

async function planned(){
 const f=assetFixture(),baas=new BaasService(()=>assetNow),costs=new AssetCostsService(()=>assetNow);f.seed('vehicleAssetProfile',{vehicleId:'vehicle',revision:1,batteryOwnership:'BAAS'});
 const draft=await f.serial(tx=>baas.create(tx,assetActor,{...assetCommand(),vehicleId:'vehicle',vehicleRevision:3,assetRevision:1,provider:'合成服务商',contractNumber:'synthetic-cost',batteryPackage:'合成电池包',effectiveFrom:'2027-01-01',effectiveTo:'2027-12-31',billingCycle:'QUARTERLY',rentalAmount:300000,paymentDayOfMonth:31}));f.attach('BAAS',draft.id,'contract-file');
 const active=await f.serial(tx=>baas.transition(tx,assetActor,draft.id,'activate',{...assetCommand(draft.revision),reason:'真实合同已核对'})),query={fromPeriod:'2027-01',toPeriod:'2027-04'},preview=await baas.preview(f.tx,assetActor,draft.id,query);
 const made=await f.serial(tx=>baas.generate(tx,assetActor,draft.id,{...assetCommand(active.revision),...query,previewHash:preview.previewHash,acknowledgedWarningIds:preview.warningIds}));return{...f,baas,costs,contractId:draft.id,plans:made.created};
}
const confirmation=(plans:any[])=>({plans:plans.map(plan=>({id:plan.id,revision:plan.revision})),idempotencyKey:assetCommand().idempotencyKey});
async function confirmed(){const f=await planned(),result=await f.serial(tx=>f.costs.confirm(tx,financeActor,confirmation(f.plans)));return{...f,entry:result.entries[0]};}

test('financial confirmation freezes unique COST facts atomically and same-key replay does not advance revisions',async()=>{
 const f=await planned(),body=confirmation(f.plans);assert.equal(f.rows('assetCostEntry').length,0);
 await assert.rejects(f.serial(tx=>f.costs.confirm(tx,assetActor,body)),assetError('FORBIDDEN'));
 const result=await f.serial(tx=>f.costs.confirm(tx,financeActor,body));assert.equal(result.totalAmount,600000);assert.equal(result.entries.length,2);assert.ok(f.rows('assetCostPlan').every(row=>row.status==='CONFIRMED'&&row.revision===1));assert.ok(f.rows('assetCostEntry').every(row=>row.effect==='COST'&&row.amount===300000));
 const writes=f.writes.length;assert.deepEqual(await f.serial(tx=>f.costs.confirm(tx,financeActor,body)),result);assert.equal(f.writes.length,writes);
 await assert.rejects(f.serial(tx=>f.costs.confirm(tx,financeActor,{...body,plans:[body.plans[0]]})),assetError('IDEMPOTENCY_CONFLICT'));
 await assert.rejects(f.serial(tx=>f.costs.confirm(tx,financeActor,confirmation(f.plans))),assetError('REVISION_CONFLICT'));
 f.revoke(financeActor.id);await assert.rejects(f.serial(tx=>f.costs.confirm(tx,financeActor,body)),assetError('STAFF_SESSION_CHANGED'));
});

test('a forged later row rolls back the complete batch instead of confirming the first valid plan',async()=>{
 const f=await planned();f.rows('assetCostPlan')[1].amount=1;const before=f.writes.length;
 await assert.rejects(f.serial(tx=>f.costs.confirm(tx,financeActor,confirmation(f.plans))),assetError('COST_SOURCE_MISMATCH'));assert.equal(f.rows('assetCostEntry').length,0);assert.ok(f.rows('assetCostPlan').every(row=>row.status==='SCHEDULED'));assert.equal(f.writes.length,before);
 f.rows('assetCostPlan')[1].amount=300000;f.rows('assetCostPlan')[1].vehicleId='other-vehicle';await assert.rejects(f.serial(tx=>f.costs.confirm(tx,financeActor,confirmation(f.plans))),assetError('COST_SOURCE_MISMATCH'));assert.equal(f.rows('assetCostEntry').length,0);
});

test('historical plans may be confirmed after termination but a never-activated draft cannot impersonate the source',async()=>{
 const f=await planned(),row=f.rows('vehicleBaasContract')[0];await f.serial(tx=>f.baas.transition(tx,assetActor,row.id,'terminate',{...assetCommand(row.revision),reason:'到期终止'}));assert.equal((await f.serial(tx=>f.costs.confirm(tx,financeActor,confirmation([f.plans[0]])))).entries.length,1);
 f.rows('vehicleBaasContract')[0].status='DRAFT';f.rows('vehicleBaasContract')[0].activatedAt=null;await assert.rejects(f.serial(tx=>f.costs.confirm(tx,financeActor,confirmation([f.plans[1]]))),assetError('COST_SOURCE_MISMATCH'));
});

test('manual payment copies the full cost, checks actual date and private parent evidence, and cannot be recorded twice',async()=>{
 const f=await confirmed(),fileId=f.attach('COST',f.entry.id,'cost-evidence'),body={...assetCommand(f.entry.revision),paidAt:'2027-02-15',referenceNo:'synthetic-transfer',reason:'核对实际付款凭证',fileIds:[fileId]};
 await assert.rejects(f.serial(tx=>f.costs.manualPayment(tx,financeActor,f.entry.id,{...body,paidAt:'2027-02-16'})),assetError('PAYMENT_DATE_FUTURE'));
 await assert.rejects(f.serial(tx=>f.costs.manualPayment(tx,financeActor,f.entry.id,{...body,fileIds:['contract-file']})),assetError('ASSET_FILE_INVALID'));
 const paid=await f.serial(tx=>f.costs.manualPayment(tx,financeActor,f.entry.id,body));assert.equal(paid.payments.length,1);assert.equal(paid.payments[0].amount,300000);assert.equal(paid.payments[0].status,'RECORDED');assert.equal(paid.amount,300000);const writes=f.writes.length;assert.deepEqual(await f.serial(tx=>f.costs.manualPayment(tx,financeActor,f.entry.id,body)),paid);assert.equal(f.writes.length,writes);
 await assert.rejects(f.serial(tx=>f.costs.manualPayment(tx,financeActor,f.entry.id,{...body,...assetCommand(paid.revision)})),assetError('PAYMENT_ALREADY_RECORDED'));
 await assert.rejects(f.serial(tx=>f.costs.reverse(tx,financeActor,f.entry.id,{...assetCommand(paid.revision),reason:'仍有付款不能冲正'})),assetError('COST_HAS_PAYMENT'));
});

test('voiding a payment checks both parent and record, retains its fact, and then reversal adds one opposite immutable entry',async()=>{
 const f=await confirmed(),fileId=f.attach('COST',f.entry.id,'cost-evidence'),paid=await f.serial(tx=>f.costs.manualPayment(tx,financeActor,f.entry.id,{...assetCommand(f.entry.revision),paidAt:'2027-02-14',referenceNo:'synthetic-transfer',reason:'原登记',fileIds:[fileId]})),record=paid.payments[0];
 await assert.rejects(f.serial(tx=>f.costs.voidPayment(tx,financeActor,f.rows('assetCostEntry')[1].id,record.id,{...assetCommand(),recordRevision:record.revision,reason:'跨成本'})),assetError('PAYMENT_PARENT_MISMATCH'));
 const cleared=await f.serial(tx=>f.costs.voidPayment(tx,financeActor,f.entry.id,record.id,{...assetCommand(paid.revision),recordRevision:record.revision,reason:'核实原登记有误'}));assert.equal(cleared.payments[0].status,'VOIDED');assert.equal(cleared.payments[0].amount,300000);
 const body={...assetCommand(cleared.revision),reason:'按真实依据冲正'},reversed=await f.serial(tx=>f.costs.reverse(tx,financeActor,f.entry.id,body));assert.equal(reversed.reversal.amount,300000);assert.equal(reversed.reversal.effect,'REVERSAL');assert.equal(reversed.amount,300000);assert.deepEqual(await f.serial(tx=>f.costs.reverse(tx,financeActor,f.entry.id,body)),reversed);assert.equal(f.rows('assetCostEntry').filter(row=>row.effect==='REVERSAL').length,1);
 await assert.rejects(f.serial(tx=>f.costs.reverse(tx,financeActor,f.entry.id,{...assetCommand(reversed.revision),reason:'重复冲正'})),assetError('COST_ALREADY_REVERSED'));
 await assert.rejects(f.serial(tx=>f.costs.manualPayment(tx,financeActor,f.entry.id,{...assetCommand(reversed.revision),paidAt:'2027-02-15',referenceNo:'later',reason:'已冲正',fileIds:[fileId]})),assetError('COST_ALREADY_REVERSED'));
});

test('cost locking is irreversible and confirmed plans cannot be voided or reopened',async()=>{
 const f=await confirmed(),body={...assetCommand(f.entry.revision),reason:'已核对锁定'},locked=await f.serial(tx=>f.costs.lock(tx,financeActor,f.entry.id,body));assert.ok(locked.lockedAt);assert.deepEqual(await f.serial(tx=>f.costs.lock(tx,financeActor,f.entry.id,body)),locked);
 await assert.rejects(f.serial(tx=>f.costs.reverse(tx,financeActor,f.entry.id,{...assetCommand(locked.revision),reason:'已锁定'})),assetError('COST_LOCKED'));
 const plans=new AssetCostPlansService();await assert.rejects(f.serial(tx=>plans.void(tx,assetActor,f.plans[0].id,{...assetCommand(1),reason:'已确认'})),assetError('COST_PLAN_STATE'));
});

test('source-specific plan reads filter both rows and count in SQL and cost facts remain finance-only',async()=>{
 const f=await confirmed(),plans=new AssetCostPlansService();f.seed('assetCostPlan',{...f.rows('assetCostPlan')[0],id:'private-depreciation',sourceKind:'DEPRECIATION',baasContractId:null,depreciationPolicyId:'private-policy'});
 const result=await plans.list(f.tx,assetActor,{});assert.equal(result.total,2);assert.ok(result.items.every((row:any)=>row.sourceKind==='BAAS'));
 await assert.rejects(plans.detail(f.tx,assetActor,'private-depreciation'),assetError('FORBIDDEN'));await assert.rejects(f.costs.list(f.tx,assetActor,{}),assetError('FORBIDDEN'));
 const costs=await f.costs.list(f.tx,financeActor,{});assert.equal(costs.total,2);assert.equal(costs.totals.costAmount,600000);assert.equal(costs.totals.reversalAmount,0);assert.equal(costs.totals.netAmount,600000);assert.ok(costs.items.every((row:any)=>!('sourceSnapshot'in row)&&!('customerId'in row)));
});

async function manualPolicy(){
 const f=assetFixture(),costs=new AssetCostsService(()=>assetNow),plans=new AssetCostPlansService(()=>assetNow),policy={id:'manual-policy',vehicleId:'vehicle',revision:1,method:'MANUAL',basisAmount:10000,basisSource:'已核对采购依据',basisEvidence:'合成原始依据',residualAmount:0,startDate:new Date('2027-01-01'),usefulLifeMonths:null,currency:'CNY',notes:'',previousPolicyId:null,status:'ACTIVE',activatedAt:assetNow};f.seed('vehicleDepreciationPolicy',{...policy,termsHash:canonicalHash(depreciationTerms(policy))});
 const source=()=>loadCostSource(f.tx,{sourceKind:'DEPRECIATION',depreciationPolicyId:policy.id});
 const request=(costPeriod:string)=>({sourceKind:'DEPRECIATION' as const,manualPeriods:[{costPeriod,amount:6000,reason:'按本期真实依据'}]});
 const generate=async(costPeriod:string)=>{const selected=await source(),input=request(costPeriod),preview=await previewCostPlans(f.tx,selected,input);return f.serial(tx=>generateCostPlans(tx,selected,input,preview.previewHash,[],financeActor.id));};
 return{...f,costs,plans,source,request,generate};
}

test('manual depreciation generation cannot exceed its basis across separate nonoverlapping 60 percent batches',async()=>{
 const f=await manualPolicy();await f.generate('2027-01');await assert.rejects(f.generate('2027-02'),assetError('DEPRECIATION_LIMIT'));assert.equal(f.rows('assetCostPlan').length,1);
});

test('reopening a manual plan recomputes the policy-wide budget including a later scheduled batch',async()=>{
 const f=await manualPolicy(),first=(await f.generate('2027-01')).created[0],voided=await f.serial(tx=>f.plans.void(tx,financeActor,first.id,{...assetCommand(first.revision),reason:'暂时作废'}));await f.generate('2027-02');
 const source=await f.source(),preview=await previewCostPlans(f.tx,source,f.request('2027-01'));
 await assert.rejects(f.serial(tx=>f.plans.reopen(tx,financeActor,first.id,{...assetCommand(voided.revision),sourceRevision:source.revision,previewHash:preview.previewHash,reason:'重开会超额'})),assetError('DEPRECIATION_LIMIT'));assert.equal(f.rows('assetCostPlan').find(row=>row.id===first.id).status,'VOIDED');
});

test('confirmation refuses a preexisting overbudget manual policy before any cost fact is posted',async()=>{
 const f=await manualPolicy(),first=(await f.generate('2027-01')).created[0],original=f.rows('assetCostPlan')[0],snapshot=structuredClone(original.sourceSnapshot);snapshot.request=f.request('2027-02');snapshot.row={...snapshot.row,costPeriod:'2027-02',periodStart:'2027-02-01',periodEnd:'2027-02-28'};
 f.seed('assetCostPlan',{...original,id:'preexisting-extra-plan',costPeriod:'2027-02',periodStart:new Date('2027-02-01'),periodEnd:new Date('2027-02-28'),sourceSnapshot:snapshot,sourceHash:canonicalHash(snapshot)});
 await assert.rejects(f.serial(tx=>f.costs.confirm(tx,financeActor,confirmation([first]))),assetError('DEPRECIATION_LIMIT'));assert.equal(f.rows('assetCostEntry').length,0);assert.ok(f.rows('assetCostPlan').every(row=>row.status==='SCHEDULED'));
});
