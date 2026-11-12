import test from 'node:test';
import assert from 'node:assert/strict';
import {assetAccess,costReopenPayload,type CostPlan,type CostReopenPreview} from './asset-model.ts';
import {depreciationInitial,depreciationDraftPayload,depreciationRequest,depreciationGeneratePayload,depreciationActivatePayload,type DepreciationPolicy,type DepreciationPreview} from './asset-depreciation-model.ts';
const old={id:'old',vehicleId:'vehicle',vehicle:{id:'vehicle',title:'合成车辆'},revision:7,status:'ACTIVE',method:'STRAIGHT_LINE',basisAmount:1000000,residualAmount:200000,usefulLifeMonths:60,basisSource:'原依据',basisEvidence:'原材料',startDate:'2025-01-01',currency:'CNY',notes:'原备注',previousPolicyId:null,files:[{id:'file'}],totals:{confirmedAmount:200000,reversalAmount:1000,netAmount:199000,lockedAmount:10000}} as DepreciationPolicy;
const values={method:'STRAIGHT_LINE',basisYuan:'1000.01',residualYuan:'100',basisSource:'核对后的剩余账面基数',basisEvidence:'实际材料依据',startDate:'2026-01-15',usefulLifeMonths:'12',notes:''};
const current={...old,id:'current',revision:2,previousPolicyId:null} as DepreciationPolicy;
const preview={policyId:'current',sourceId:'current',revision:2,assetRevision:1,algorithmVersion:'DEP_V1',request:{sourceKind:'DEPRECIATION'},rows:[{costPeriod:'2026-01',periodStart:'2026-01-15',periodEnd:'2026-01-31',amount:7500,warningIds:[],existingPlan:null}],totalAmount:7500,createCount:1,existingCount:0,totalCreatedAmount:7500,warningIds:[],previewHash:'a'.repeat(64),budget:{depreciableAmount:90001,committedAmount:0,remainingAmount:90001}} as DepreciationPreview;
test('depreciation never grants OPERATIONS strategy access, including wildcard permissions',()=>{
 assert.deepEqual(assetAccess('depreciation-policies','OPERATIONS',['*']),{read:false,write:false});assert.deepEqual(assetAccess('depreciation-policies','FINANCE',['depreciation-policies.read']),{read:true,write:false});assert.equal(assetAccess('depreciation-policies','ADMIN',['*']).write,true);
});
test('a successor starts with explicit blank remaining amounts and months, never guessed from old basis or valuation',()=>{
 const initial=depreciationInitial(undefined,old);assert.equal(initial.basisYuan,'');assert.equal(initial.residualYuan,'');assert.equal(initial.usefulLifeMonths,'');assert.equal(initial.startDate,'');assert.equal(initial.basisSource,'');assert.equal(initial.basisEvidence,'');assert.equal(depreciationInitial({...old,status:'DRAFT'}).basisYuan,'10000.00');
});
test('draft uses integer cents, correct method formula and fixed successor parent/vehicle',()=>{
 const body=depreciationDraftPayload({...values,previousPolicyId:'attacker',vehicleId:'wrong'},undefined,{id:'vehicle',revision:4},old);assert.equal(body.vehicleId,'vehicle');assert.equal(body.vehicleRevision,4);assert.equal(body.previousPolicyId,'old');assert.equal(body.revision,0);assert.equal(body.basisAmount,100001);assert.equal(body.residualAmount,10000);assert.equal(body.usefulLifeMonths,12);assert.equal('status'in body,false);assert.equal('amount'in body,false);
 assert.throws(()=>depreciationDraftPayload({...values,basisYuan:'1.001'},undefined,{id:'vehicle',revision:4}));assert.throws(()=>depreciationDraftPayload({...values,residualYuan:'1001'},undefined,{id:'vehicle',revision:4}));assert.throws(()=>depreciationDraftPayload({...values,usefulLifeMonths:'0'},undefined,{id:'vehicle',revision:4}));assert.throws(()=>depreciationDraftPayload(values,current));
 assert.equal(depreciationDraftPayload({...values,method:'NONE',usefulLifeMonths:'99'},undefined,{id:'vehicle',revision:4}).usefulLifeMonths,null);assert.throws(()=>depreciationDraftPayload(values,undefined,{id:'other',revision:4},old));
});
test('manual preview records explicit monthly yuan inputs and reasons, no generated cost override',()=>{
 const body=depreciationRequest({...current,method:'MANUAL'},[{costPeriod:'2026-02',amountYuan:'12.34',reason:'合成逐期依据'}]);assert.deepEqual(body,{manualPeriods:[{costPeriod:'2026-02',amount:1234,reason:'合成逐期依据'}]});assert.deepEqual(depreciationRequest({...current,method:'NONE'},[]),{});assert.throws(()=>depreciationRequest({...current,method:'MANUAL'},[{costPeriod:'2026-02',amountYuan:'1',reason:''}]));assert.throws(()=>depreciationRequest({...current,method:'MANUAL'},Array(2).fill({costPeriod:'2026-02',amountYuan:'1',reason:'依据'})));
});
test('generation is bound to policy revision, exact preview request and budget; NONE cannot fake a cost',()=>{
 assert.deepEqual(depreciationGeneratePayload(current,preview,[]),{revision:2,previewHash:'a'.repeat(64),acknowledgedWarningIds:[]});assert.throws(()=>depreciationGeneratePayload({...current,revision:3},preview,[]));assert.throws(()=>depreciationGeneratePayload(current,{...preview,policyId:'other'},[]));assert.throws(()=>depreciationGeneratePayload(current,{...preview,budget:{...preview.budget,remainingAmount:1}},[]));assert.throws(()=>depreciationGeneratePayload({...current,method:'NONE'},preview,[]));
 const manual={...current,method:'MANUAL'} as DepreciationPolicy;assert.throws(()=>depreciationGeneratePayload(manual,{...preview,request:{sourceKind:'DEPRECIATION',manualPeriods:[{costPeriod:'2026-01',amount:100,reason:'原理由'}]}},[{costPeriod:'2026-01',amountYuan:'1',reason:'已修改理由'}]));
});
test('activation requires this policy evidence and explicitly reviewed current predecessor revision',()=>{
 const draft={...current,status:'DRAFT',previousPolicyId:'old',previousPolicy:old} as DepreciationPolicy;assert.deepEqual(depreciationActivatePayload(draft,'已核对承接事实',true),{revision:2,reason:'已核对承接事实',previousRevision:7});assert.throws(()=>depreciationActivatePayload(draft,'核对',false));assert.throws(()=>depreciationActivatePayload({...draft,previousPolicy:{...old,status:'SUPERSEDED'}},'核对',true));assert.throws(()=>depreciationActivatePayload({...draft,files:[]},'核对',true));
});

test('reopen body is bound to current plan and server frozen preview without mutable amounts or manual request',()=>{
 const plan={id:'plan',revision:3,status:'VOIDED',sourceKind:'DEPRECIATION',costPeriod:'2027-02',amount:1234} as CostPlan;
 const preview={planId:'plan',planRevision:3,sourceRevision:8,sourceKind:'DEPRECIATION',costPeriod:'2027-02',amount:1234,previewHash:'b'.repeat(64),warningIds:[],rows:[]} as CostReopenPreview;
 assert.deepEqual(costReopenPayload(plan,preview,'明确核对后恢复'),{revision:3,sourceRevision:8,previewHash:'b'.repeat(64),reason:'明确核对后恢复'});
 for(const patch of [{planId:'other'},{planRevision:4},{sourceKind:'BAAS'},{costPeriod:'2027-03'},{amount:1},{previewHash:'bad'}])assert.throws(()=>costReopenPayload(plan,{...preview,...patch} as CostReopenPreview,'恢复'));
 assert.throws(()=>costReopenPayload({...plan,status:'CONFIRMED'},preview,'恢复'));
});
