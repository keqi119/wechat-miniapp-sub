import test from 'node:test';
import assert from 'node:assert/strict';
import {productInitial,productV2Payload,productMonthlyPreview,productVersionKind,productWarehouseSummary,productV2Fields,productModelLabel} from './product-model.ts';
import {readFields} from './domain-commands.ts';
import {routeAllowed,moduleForRoute} from './modules/navigation.ts';

const input={minimumTermMonths:3,name:'按产品配置',months:24,baseFeeAmount:'1000.10',mileageMonthlyFeeAmount:'250.15',mileagePerMonthKm:2300,excessMileagePriceAmount:'1.25',includedCount:0,extraFeeAmount:'620.50',conditions:'按具体产品约定',vehicleIds:['car'],modelDefinitionIds:[],benefitVersionIds:[]};
test('modular v2 converts yuan once, uses configured mileage and never submits total or arbitrary energy',()=>{
 const payload=productV2Payload(readFields(productV2Fields,input));
 assert.equal(payload.configurationVersion,2);assert.equal(payload.baseFeeAmount,100010);assert.equal(payload.mileageMonthlyFeeAmount,25015);assert.equal(payload.excessMileagePriceAmount,125);assert.equal(payload.mileagePerMonthKm,2300);
 assert.deepEqual(payload.swapPolicy,{version:2,period:'TERM',includedCount:0,extraFeeAmount:62050});
 assert.equal('monthlyFeeAmount' in payload,false);assert.equal('energyDescription' in payload,false);assert.deepEqual(payload.items,[{kind:'BASE_SUBSCRIPTION'}]);
 assert.equal(productMonthlyPreview(input),125025);
});
test('zero allowance and unit price are explicit; totals, fees, months and integers retain boundaries',()=>{
 const payload=productV2Payload(readFields(productV2Fields,{...input,baseFeeAmount:'0',mileagePerMonthKm:0,excessMileagePriceAmount:'0'}));assert.equal(payload.mileagePerMonthKm,0);assert.equal(payload.excessMileagePriceAmount,0);
 for(const patch of [{months:2},{months:121},{includedCount:-1},{mileagePerMonthKm:0.5},{extraFeeAmount:'0'},{baseFeeAmount:'0',mileageMonthlyFeeAmount:'0'},{baseFeeAmount:'21474836.47',mileageMonthlyFeeAmount:'0.01'},{extraFeeAmount:''}])assert.throws(()=>productV2Payload(readFields(productV2Fields,{...input,...patch})));
});
test('v1 historical values never become invented module costs or 800-yuan swap fees',()=>{
 const old={name:'历史',months:18,monthlyFeeAmount:399900,mileagePerMonthKm:987,excessMileagePriceAmount:81,energyDescription:'包含电池租金',vehicleIds:['car'],modelDefinitionIds:[],conditions:'旧约定'};
 const original=JSON.stringify(old),values=productInitial(old);assert.equal(productVersionKind(old),'v1');assert.equal(values.baseFeeAmount,'');assert.equal(values.mileageMonthlyFeeAmount,'');assert.equal(values.extraFeeAmount,'');assert.equal(values.includedCount,0);assert.equal(values.mileagePerMonthKm,987);assert.equal(values.excessMileagePriceAmount,'0.81');assert.equal(JSON.stringify(old),original);
 const fresh=productInitial({});assert.equal(fresh.includedCount,0);assert.equal(fresh.extraFeeAmount,'');assert.equal(fresh.mileagePerMonthKm,'');
 assert.equal(productVersionKind({configurationVersion:3}),'unknown');
});
test('v2 preserves exact module amounts and zero counts when preparing a new version',()=>{
 const values=productInitial({configurationVersion:2,baseFeeAmount:100010,mileageMonthlyFeeAmount:0,mileagePerMonthKm:0,excessMileagePriceAmount:0,swapPolicy:{version:2,period:'TERM',includedCount:0,extraFeeAmount:12345}});
 assert.equal(values.baseFeeAmount,'1000.10');assert.equal(values.mileageMonthlyFeeAmount,'0.00');assert.equal(values.extraFeeAmount,'123.45');assert.equal(values.mileagePerMonthKm,0);
});
test('warehouse summarizes active and suspended versions independently of a newer draft',()=>{
 assert.equal(productWarehouseSummary([{version:3,status:'DRAFT'},{version:2,status:'SUSPENDED'},{version:1,status:'PUBLISHED'}]),'已发布：第 1 版；已暂停：第 2 版；草稿：第 3 版');
 assert.equal(moduleForRoute('product-warehouse')?.key,'products');assert.equal(routeAllowed('product-warehouse','OPERATIONS',['products.read']),true);assert.equal(routeAllowed('product-warehouse','SUPPORT',['*']),false);
});
test('model year labels use only explicit model master data, never vehicle registration year',()=>{
 assert.equal(productModelLabel({name:'合成车型',modelYear:2026,year:2024}),'合成车型 · 2026款');
 assert.equal(productModelLabel({name:'合成车型',year:2024}),'合成车型 · 年款未登记');
});
