import {test} from 'node:test';
import assert from 'node:assert/strict';
import {previewBaasSchedule} from '../src/vehicle-baas/schedule';

const base={fromPeriod:'2027-02',toPeriod:'2027-02',billingCycle:'QUARTERLY' as const,rentalAmount:300000,paymentDayOfMonth:31,effectiveFrom:'2027-02-01',effectiveTo:'2028-12-31'};
test('quarterly BAAS keeps the original cycle amount and complete end even beyond the selected final start month',()=>{
 const result=previewBaasSchedule(base);
 assert.deepEqual(result,{algorithmVersion:'BAAS_FULL_PERIOD_V1',rows:[{costPeriod:'2027-02',periodStart:'2027-02-01',periodEnd:'2027-04-30',dueDate:'2027-02-28',amount:300000,warningIds:[]}],totalAmount:300000,warningIds:[]});
 const throughMarch=previewBaasSchedule({...base,toPeriod:'2027-03'});assert.deepEqual(throughMarch,result);
});

test('monthly, quarterly and yearly schedules advance by 1, 3 and 12 months without multiplying the rental',()=>{
 const monthly=previewBaasSchedule({...base,billingCycle:'MONTHLY',fromPeriod:'2024-02',toPeriod:'2024-03',effectiveFrom:'2024-01-01'});assert.deepEqual(monthly.rows.map(row=>[row.costPeriod,row.periodEnd,row.dueDate,row.amount]),[['2024-02','2024-02-29','2024-02-29',300000],['2024-03','2024-03-31','2024-03-31',300000]]);
 const quarterly=previewBaasSchedule({...base,toPeriod:'2027-08'});assert.deepEqual(quarterly.rows.map(row=>row.costPeriod),['2027-02','2027-05','2027-08']);assert.equal(quarterly.totalAmount,900000);
 const yearly=previewBaasSchedule({...base,billingCycle:'YEARLY',fromPeriod:'2026-11',toPeriod:'2027-12',effectiveFrom:'2026-01-01'});assert.deepEqual(yearly.rows.map(row=>[row.costPeriod,row.periodEnd,row.amount]),[['2026-11','2027-10-31',300000],['2027-11','2028-10-31',300000]]);assert.equal(yearly.totalAmount,600000);
});

test('contract warnings identify each complete period stably without clipping or prorating it',()=>{
 const input={...base,fromPeriod:'2027-01',toPeriod:'2027-04',effectiveFrom:'2027-01-15',effectiveTo:'2027-05-12'};
 const result=previewBaasSchedule(input);assert.deepEqual(result.warningIds,['2027-01:OUTSIDE_CONTRACT_START','2027-04:OUTSIDE_CONTRACT_END']);assert.deepEqual(result.rows.map(row=>row.warningIds),[['2027-01:OUTSIDE_CONTRACT_START'],['2027-04:OUTSIDE_CONTRACT_END']]);assert.equal(result.rows[0].periodStart,'2027-01-01');assert.equal(result.rows[1].periodEnd,'2027-06-30');assert.equal(result.totalAmount,600000);assert.deepEqual(previewBaasSchedule(input),result);
 const both=previewBaasSchedule({...base,effectiveFrom:'2027-02-20',effectiveTo:'2027-03-01'});assert.deepEqual(both.warningIds,['2027-02:OUTSIDE_CONTRACT_START','2027-02:OUTSIDE_CONTRACT_END']);assert.equal(both.totalAmount,300000);
 const equal=previewBaasSchedule({...base,effectiveTo:'2027-04-30'});assert.deepEqual(equal.warningIds,[]);
});

test('existing first cost period constrains phase in both directions and never silently shifts the anchor',()=>{
 assert.equal(previewBaasSchedule({...base,firstCostPeriod:'2026-11'}).rows[0].costPeriod,'2027-02');
 assert.equal(previewBaasSchedule({...base,firstCostPeriod:'2027-05'}).rows[0].costPeriod,'2027-02');
 assert.throws(()=>previewBaasSchedule({...base,firstCostPeriod:'2027-01'}));assert.throws(()=>previewBaasSchedule({...base,billingCycle:'YEARLY',firstCostPeriod:'2026-03'}));assert.throws(()=>previewBaasSchedule({...base,firstCostPeriod:'2027-2'}));
});

test('BAAS permits 120 complete periods and safe totals above Int, but refuses 121 instead of truncating',()=>{
 const input={...base,billingCycle:'MONTHLY' as const,fromPeriod:'2020-01',toPeriod:'2029-12',rentalAmount:2147483647,effectiveFrom:'2020-01-01',effectiveTo:'2029-12-31'};
 const result=previewBaasSchedule(input);assert.equal(result.rows.length,120);assert.equal(result.totalAmount,257698037640);assert.ok(Number.isSafeInteger(result.totalAmount));assert.ok(result.totalAmount>2147483647);assert.equal(result.rows.at(-1)!.periodEnd,'2029-12-31');assert.throws(()=>previewBaasSchedule({...input,toPeriod:'2030-01'}));
});

test('BAAS rejects unsupported cycles, invalid dates, reversed intervals and noninteger or overflowing amounts',()=>{
 for(const rentalAmount of [0,-1,0.5,NaN,Infinity,2147483648,Number.MAX_SAFE_INTEGER,'300000'])assert.throws(()=>previewBaasSchedule({...base,rentalAmount} as any));
 for(const change of [{billingCycle:'WEEKLY'},{paymentDayOfMonth:0},{paymentDayOfMonth:32},{paymentDayOfMonth:1.5},{fromPeriod:'2027-03',toPeriod:'2027-02'},{fromPeriod:'2027-2'},{effectiveFrom:'2027-02-29'},{effectiveTo:'2027-01-31'},{fromPeriod:'9999-12',toPeriod:'9999-12',effectiveTo:'9999-12-31'}])assert.throws(()=>previewBaasSchedule({...base,...change} as any));
 assert.equal(previewBaasSchedule({...base,billingCycle:'MONTHLY',fromPeriod:'9999-12',toPeriod:'9999-12',effectiveTo:'9999-12-31'}).rows[0].periodEnd,'9999-12-31');
});
