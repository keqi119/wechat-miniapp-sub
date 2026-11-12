import {test} from 'node:test';
import assert from 'node:assert/strict';
import {profilePatchInput} from '../src/vehicle-assets/types';
import {baasCreateInput,baasPatchInput,baasTransitionInput,baasPreviewInput,baasGenerateInput} from '../src/vehicle-baas/types';
import {confirmCostsInput,costCommandInput,manualPaymentInput,voidPaymentInput,reopenPlanInput,planListInput,costListInput} from '../src/asset-costs/types';

const command={revision:0,idempotencyKey:'synthetic-asset-command'},draft={provider:'合成电池服务商',contractNumber:'synthetic-contract',batteryPackage:'合成电池包',effectiveFrom:'2027-01-15',effectiveTo:'2027-12-31',billingCycle:'QUARTERLY',rentalAmount:300000,paymentDayOfMonth:31};
test('asset profile commands require both revisions and preserve omitted versus explicitly null fields',()=>{
 assert.deepEqual(profilePatchInput.parse({...command,vehicleRevision:3,batteryOwnership:'BAAS'}),{...command,vehicleRevision:3,batteryOwnership:'BAAS'});
 assert.equal(profilePatchInput.parse({...command,vehicleRevision:3,firstRegistrationDate:null}).firstRegistrationDate,null);
 assert.equal(profilePatchInput.parse({...command,vehicleRevision:3,firstRegistrationDate:'2024-02-29'}).firstRegistrationDate,'2024-02-29');
 for(const input of [{...command,notes:'no vehicle revision'},{...command,vehicleRevision:0},{...command,vehicleRevision:0,firstRegistrationDate:'2027-02-29'},{...command,vehicleRevision:0,batteryOwnership:'GUESSED'},{...command,vehicleRevision:0,notes:'x',year:2024}])assert.throws(()=>profilePatchInput.parse(input));
});

test('BAAS drafts use explicit integer cycle amounts and cannot patch identity, status or anchor',()=>{
 const made=baasCreateInput.parse({...draft,...command,vehicleId:'vehicle',vehicleRevision:2,assetRevision:1});
 assert.equal(made.rentalAmount,300000);assert.equal(made.currency,'CNY');assert.equal(made.taxIncluded,null);assert.equal(made.supplierContractNumber,'');
 const patch=baasPatchInput.parse({...command,notes:''});assert.deepEqual(patch,{...command,notes:''});
 assert.equal(baasPatchInput.parse({...command,taxIncluded:null}).taxIncluded,null);
 for(const edit of [{status:'ACTIVE'},{vehicleId:'other'},{firstCostPeriod:'2027-01'},{rentalAmount:0},{rentalAmount:0.5},{rentalAmount:2147483648},{paymentDayOfMonth:32},{effectiveFrom:'2027-02-29'},{currency:'USD'}])assert.throws(()=>baasPatchInput.parse({...command,...edit}));
 assert.throws(()=>baasPatchInput.parse(command));assert.throws(()=>baasCreateInput.parse({...draft,...command,revision:1,vehicleId:'vehicle',vehicleRevision:2,assetRevision:1}));
 assert.throws(()=>baasCreateInput.parse({...draft,...command,vehicleId:'vehicle',vehicleRevision:2,assetRevision:1,effectiveTo:'2027-01-01'}));
});

test('BAAS transitions and generation cannot inject client cost rows or omit preview evidence',()=>{
 assert.equal(baasTransitionInput.parse({...command,reason:'明确暂停依据'}).reason,'明确暂停依据');assert.throws(()=>baasTransitionInput.parse(command));
 assert.deepEqual(baasPreviewInput.parse({fromPeriod:'2027-01',toPeriod:'2027-03'}),{fromPeriod:'2027-01',toPeriod:'2027-03'});
 const input={...command,fromPeriod:'2027-01',toPeriod:'2027-03',previewHash:'a'.repeat(64),acknowledgedWarningIds:['2027-01:OUTSIDE_CONTRACT_START']};assert.deepEqual(baasGenerateInput.parse(input),input);
 for(const value of [{...input,previewHash:'bad'},{...input,amount:1},{...input,rows:[]},{...input,acknowledgedWarningIds:['same','same']},{...input,fromPeriod:'2027-1'}])assert.throws(()=>baasGenerateInput.parse(value));
});

test('cost confirmation accepts only explicit unique plan revisions with at most 120 rows',()=>{
 const plans=Array.from({length:120},(_,index)=>({id:'plan-'+index,revision:index}));assert.equal(confirmCostsInput.parse({plans,idempotencyKey:command.idempotencyKey}).plans.length,120);
 for(const list of [[],[...plans,{id:'plan-120',revision:0}],[plans[0],plans[0]],[{id:'plan',revision:-1}],[{id:'plan',revision:0,amount:1}]])assert.throws(()=>confirmCostsInput.parse({plans:list,idempotencyKey:command.idempotencyKey}));
 assert.throws(()=>confirmCostsInput.parse({plans:[plans[0]],idempotencyKey:command.idempotencyKey,amount:1}));
});

test('cost commands require reasons, source-bound evidence, actual dates and both payment record revisions',()=>{
 assert.equal(costCommandInput.parse({...command,reason:'更正依据'}).revision,0);assert.throws(()=>costCommandInput.parse(command));
 const paid={...command,reason:'合成付款凭据',paidAt:'2027-02-28',referenceNo:'synthetic-reference',fileIds:['file']};assert.deepEqual(manualPaymentInput.parse(paid),paid);
 for(const edit of [{fileIds:[]},{fileIds:['file','file']},{paidAt:'2027-02-29'},{referenceNo:''},{amount:1},{status:'PAID'}])assert.throws(()=>manualPaymentInput.parse({...paid,...edit}));
 assert.throws(()=>voidPaymentInput.parse({...command,reason:'撤销登记'}));assert.equal(voidPaymentInput.parse({...command,recordRevision:2,reason:'撤销登记'}).recordRevision,2);
 assert.throws(()=>reopenPlanInput.parse({...command,reason:'重新核对'}));assert.equal(reopenPlanInput.parse({...command,reason:'重新核对',sourceRevision:2,previewHash:'a'.repeat(64)}).sourceRevision,2);
});

test('asset read filters accept bounded pagination and declared sources without arbitrary query fields',()=>{
 assert.deepEqual(planListInput.parse({page:'2',pageSize:'100',sourceKind:'BAAS'}),{page:2,pageSize:100,sourceKind:'BAAS'});
 assert.equal(costListInput.parse({category:'BAAS_RENT',effect:'COST'}).category,'BAAS_RENT');
 for(const input of [{pageSize:101},{sourceKind:'CUSTOMER_BILL'},{costPeriod:'2027-13'},{customerId:'customer'}])assert.throws(()=>planListInput.parse(input));
});
