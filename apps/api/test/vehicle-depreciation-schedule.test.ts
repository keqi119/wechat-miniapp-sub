import {test} from 'node:test';
import assert from 'node:assert/strict';
import {previewDepreciationSchedule} from '../src/vehicle-depreciation/schedule';

const base={method:'STRAIGHT_LINE' as const,basisAmount:10001,residualAmount:1000,startDate:'2027-01-20',usefulLifeMonths:3};
test('straight-line depreciation uses the full first month amount and places every integer remainder in the final period',()=>{
 assert.deepEqual(previewDepreciationSchedule(base),{algorithmVersion:'DEPRECIATION_STRAIGHT_LINE_V1',depreciableAmount:9001,totalAmount:9001,rows:[{costPeriod:'2027-01',periodStart:'2027-01-20',periodEnd:'2027-01-31',amount:3000},{costPeriod:'2027-02',periodStart:'2027-02-01',periodEnd:'2027-02-28',amount:3000},{costPeriod:'2027-03',periodStart:'2027-03-01',periodEnd:'2027-03-31',amount:3001}]});
 const leap=previewDepreciationSchedule({...base,startDate:'2024-02-29'});assert.equal(leap.rows[0].periodStart,'2024-02-29');assert.equal(leap.rows[0].periodEnd,'2024-02-29');assert.equal(leap.rows[0].amount,3000);
});

test('zero depreciable value preserves the selected count while NONE explicitly produces no plan',()=>{
 const zero=previewDepreciationSchedule({...base,basisAmount:1000,residualAmount:1000,usefulLifeMonths:120});assert.equal(zero.rows.length,120);assert.equal(zero.totalAmount,0);assert.ok(zero.rows.every(row=>row.amount===0));
 const none=previewDepreciationSchedule({method:'NONE',basisAmount:10001,residualAmount:1000,startDate:'2027-01-20'});assert.deepEqual(none,{algorithmVersion:'DEPRECIATION_NONE_V1',depreciableAmount:9001,totalAmount:0,rows:[]});
 assert.throws(()=>previewDepreciationSchedule({method:'NONE',basisAmount:10001,residualAmount:1000,startDate:'2027-01-20',manualPeriods:[{costPeriod:'2027-01',amount:1,reason:'不应夹带'}]} as any));
});

test('straight-line one and 120 month boundaries retain the exact Int maximum without floating point loss',()=>{
 for(const usefulLifeMonths of [1,3,120]){const result=previewDepreciationSchedule({...base,basisAmount:2147483647,residualAmount:0,usefulLifeMonths});assert.equal(result.rows.length,usefulLifeMonths);assert.equal(result.totalAmount,2147483647);assert.equal(result.rows.reduce((sum,row)=>sum+BigInt(row.amount),0n),2147483647n);assert.ok(result.rows.every(row=>Number.isInteger(row.amount)&&row.amount>=0&&row.amount<=2147483647));}
 const pennies=previewDepreciationSchedule({...base,basisAmount:2,residualAmount:0});assert.deepEqual(pennies.rows.map(row=>row.amount),[0,0,2]);
});

test('manual depreciation uses only explicit months, amounts and reasons, sorts them, and leaves skipped months absent',()=>{
 const input={method:'MANUAL' as const,basisAmount:10001,residualAmount:1000,startDate:'2027-01-20',manualPeriods:[{costPeriod:'2027-03',amount:2001,reason:'三月依据'},{costPeriod:'2027-01',amount:3000,reason:'首月依据'}]};
 const original=JSON.stringify(input);assert.deepEqual(previewDepreciationSchedule(input),{algorithmVersion:'DEPRECIATION_MANUAL_V1',depreciableAmount:9001,totalAmount:5001,rows:[{costPeriod:'2027-01',periodStart:'2027-01-20',periodEnd:'2027-01-31',amount:3000,reason:'首月依据'},{costPeriod:'2027-03',periodStart:'2027-03-01',periodEnd:'2027-03-31',amount:2001,reason:'三月依据'}]});assert.equal(JSON.stringify(input),original);
 const later=previewDepreciationSchedule({...input,manualPeriods:[{costPeriod:'2027-03',amount:0,reason:'明确零额'}]});assert.equal(later.rows.length,1);assert.equal(later.rows[0].periodStart,'2027-03-01');assert.equal(later.totalAmount,0);
 assert.equal(previewDepreciationSchedule({...input,manualPeriods:[]}).rows.length,0);
});

test('manual depreciation refuses duplicate/earlier months, missing evidence and cumulative excess instead of guessing',()=>{
 const input={method:'MANUAL' as const,basisAmount:10001,residualAmount:1000,startDate:'2027-01-20'};
 assert.throws(()=>previewDepreciationSchedule(input as any));
 for(const manualPeriods of [[{costPeriod:'2027-01',amount:1,reason:'依据'},{costPeriod:'2027-01',amount:2,reason:'重复'}],[{costPeriod:'2026-12',amount:1,reason:'起算前'}],[{costPeriod:'2027-01',amount:9002,reason:'超额'}],[{costPeriod:'2027-01',amount:1,reason:''}],[{costPeriod:'2027-01',amount:1,reason:'   '}],[{costPeriod:'2027-1',amount:1,reason:'格式错'}],[{costPeriod:'2027-01',amount:1.5,reason:'小数'}]])assert.throws(()=>previewDepreciationSchedule({...input,manualPeriods}));
 assert.throws(()=>previewDepreciationSchedule({...input,basisAmount:2147483647,residualAmount:0,manualPeriods:[{costPeriod:'2027-01',amount:2147483647,reason:'最大'},{costPeriod:'2027-02',amount:2147483647,reason:'累计超限'}]}));
});

test('manual depreciation accepts exactly 120 explicit periods but refuses 121 even when every amount is zero',()=>{
 const manualPeriods=Array.from({length:121},(_,index)=>({costPeriod:`${2027+Math.floor(index/12)}-${String(index%12+1).padStart(2,'0')}`,amount:0,reason:'明确零额依据'}));
 const input={method:'MANUAL' as const,basisAmount:0,residualAmount:0,startDate:'2027-01-20'};
 const accepted=previewDepreciationSchedule({...input,manualPeriods:manualPeriods.slice(0,120)});
 assert.equal(accepted.rows.length,120);assert.equal(accepted.totalAmount,0);assert.equal(accepted.rows.at(-1)!.costPeriod,'2036-12');
 assert.throws(()=>previewDepreciationSchedule({...input,manualPeriods}),(error:any)=>error.name==='ZodError'&&error.issues.some((issue:any)=>issue.path[0]==='manualPeriods'&&issue.code==='too_big'&&issue.maximum===120));
});

test('all depreciation methods reject invalid money/date/method and straight-line life outside 1–120',()=>{
 for(const change of [{basisAmount:-1},{basisAmount:0.1},{basisAmount:2147483648},{basisAmount:Infinity},{basisAmount:NaN},{residualAmount:-1},{residualAmount:10002},{residualAmount:0.5},{residualAmount:'1000'},{startDate:'2027-02-29'},{method:'UNKNOWN'},{usefulLifeMonths:0},{usefulLifeMonths:121},{usefulLifeMonths:1.5},{usefulLifeMonths:undefined},{startDate:'9999-12-01',usefulLifeMonths:2}])assert.throws(()=>previewDepreciationSchedule({...base,...change} as any));
 for(const method of ['MANUAL','NONE'])assert.throws(()=>previewDepreciationSchedule({method,basisAmount:1,residualAmount:2,startDate:'2027-01-01',...(method==='MANUAL'?{manualPeriods:[]}: {})} as any));
 assert.equal(previewDepreciationSchedule({...base,startDate:'9999-12-31',usefulLifeMonths:1}).rows[0].periodEnd,'9999-12-31');
});
