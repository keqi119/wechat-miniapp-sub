import test from 'node:test';
import assert from 'node:assert/strict';
import {productInitial,productV2Payload} from './product-model.ts';
import {loadFinalPlanDefaults,finalPlanInitial} from './final-plan-defaults.ts';
import {electronicPlanFields,electronicPlanBody,profileBody,profileInitial,cooperationSourcesBody} from './electronic-source-model.ts';
const base={name:'产品',months:6,minimumTermMonths:3,baseFeeAmount:100,mileageMonthlyFeeAmount:200,mileagePerMonthKm:0,excessMileagePriceAmount:0,includedCount:0,extraFeeAmount:1,conditions:'实际约定',vehicleIds:['v'],modelDefinitionIds:[]};
test('minimum needs no extra confirmation, actual months follow it; absent history remains absent',()=>{
 assert.equal(productInitial({}).minimumTermMonths,''); assert.equal(productV2Payload(base).minimumTermMonths,3);
 for(const patch of [{minimumTermMonths:2},{minimumTermMonths:undefined},{minimumTermMonths:7},{months:2}])assert.throws(()=>productV2Payload({...base,...patch}),/期限|月|租期/);
 assert.deepEqual(productV2Payload({...base,baasDisposition:'SEPARATE',baasAmount:200,baasPeriod:'MONTH',baasRecipient:'真实收款方'}).customerBaas,{disposition:'SEPARATE',amount:200,period:'MONTH',recipient:'真实收款方'});
});
test('electronic defaults accept exactly factual terms and genuine fee components',async()=>{
 const defaults=await loadFinalPlanDefaults(async()=>({applicationId:'a',revision:1,contractMode:'ELECTRONIC',source:{productId:'p',productVersionId:'pv',version:1,name:'产品',hash:'a'.repeat(64)},values:{monthlyFeeAmount:300,months:6,mileagePerMonthKm:0,excessMileagePriceAmount:0,energyDescription:'自付',conditions:'实际',benefits:[],productSourceHash:'a'.repeat(64),commercialTerms:{vehicleIdentification:'VIN',customerAddress:'地址',handoverArrangement:'地点及联系人'},agreedFeeComponents:{baseFeeAmount:100,mileageMonthlyFeeAmount:200}},missingFields:[]}),'a');
 const initial=finalPlanInitial({id:'a'},undefined,defaults);assert.equal(initial.agreedBaseFeeAmount,100);
 const fields=electronicPlanFields([{key:'firstDueDate',label:'旧'},{key:'commercialTerms',label:'旧'},{key:'months',label:'月数'},{key:'energyDescription',label:'能源'},{key:'benefits',label:'权益'},{key:'conditions',label:'条件'}]);assert.ok(!fields.some(f=>['firstDueDate','commercialTerms'].includes(f.key)));for(const k of ['months','energyDescription','benefits','conditions'])assert.equal(fields.find(f=>f.key===k)?.readOnly,true);
 assert.deepEqual(electronicPlanBody({vehicleIdentification:'VIN',customerAddress:'地址',handoverArrangement:'安排',agreedBaseFeeAmount:100,agreedMileageFeeAmount:200,monthlyFeeAmount:300}).commercialTerms,{vehicleIdentification:'VIN',customerAddress:'地址',handoverArrangement:'安排'});
});
test('profile nesting omits absent values and preserves explicit authority evidence',()=>{
 const row={name:'企业',subjectType:'ENTERPRISE',contractProfile:{serviceContactName:'联系人',serviceContactChannel:'电话',signerAuthorityRole:'AUTHORIZED_REPRESENTATIVE',authorityScope:'范围',authorityEvidenceFileIds:['f']}};
 assert.deepEqual(profileBody(profileInitial(row)).profile.contractProfile,row.contractProfile);
 assert.equal(profileBody({name:'个人',subjectType:'INDIVIDUAL'}).profile.contractProfile,undefined);
});
test('cooperation structured scope keeps UNKNOWN distinct and money in cents',()=>{
 const result=cooperationSourcesBody({vehicleScopes:[{vehicleId:'v',validFrom:'2026-11-01',validUntil:'2027-11-01',authorityEvidenceFileIds:['f'],restrictionStatus:'UNKNOWN'}],productVersionIds:['p'],templateRefs:[{id:'t',hash:'a'.repeat(64)}],productDepositRules:[{productVersionId:'p',kind:'FIXED',amount:100}]});
 assert.deepEqual(result.vehicleScopes[0].rightsRestrictions,{status:'UNKNOWN'});assert.deepEqual(result.productDepositRules[0].rule,{kind:'FIXED',amount:100});
});
