import {test} from 'node:test';
import assert from 'node:assert/strict';
import {day,periods} from '../src/usage/rules';

async function pricing(){
 const module:any=await import('../src/vehicle-changes/upgrade-pricing').catch(()=>({}));
 assert.equal(typeof module.calculateUpgradePricing,'function','upgrade pricing implementation is required');
 return module.calculateUpgradePricing as (input:any)=>any;
}
const input=(changes:Record<string,unknown>={})=>({startDate:'2026-01-31',months:3,currentMonthlyFeeAmount:10000,targetMonthlyFeeAmount:20000,deliveryAt:'2026-03-01T10:00:00+08:00',...changes});

test('31st-day contracts retain every original service-month boundary and charge only the remaining original term',async()=>{
 const calculate=await pricing(),result=calculate(input());
 assert.equal(result.ruleVersion,'SWAP_UPGRADE_ACTUAL_DAYS_V1');assert.equal(result.timeZone,'Asia/Shanghai');
 assert.equal(result.deliveryDate,'2026-03-01');assert.equal(result.startDate,'2026-01-31');assert.equal(result.endDate,'2026-04-30');assert.equal(result.monthlyDifferenceAmount,10000);
 assert.deepEqual(result.periods,[
  {sequence:1,startDate:'2026-01-31',endDate:'2026-02-28',totalDays:28,chargeDays:0,differenceAmount:0},
  {sequence:2,startDate:'2026-02-28',endDate:'2026-03-31',totalDays:31,chargeDays:30,differenceAmount:9677},
  {sequence:3,startDate:'2026-03-31',endDate:'2026-04-30',totalDays:30,chargeDays:30,differenceAmount:10000}
 ]);assert.equal(result.totalDifferenceAmount,19677);
});

test('leap February uses actual service-month days and preserves the original 31st anniversary',async()=>{
 const calculate=await pricing(),result=calculate(input({startDate:'2024-01-31',months:2,deliveryAt:'2024-02-28T23:59:59+08:00'}));
 assert.deepEqual(result.periods,[
  {sequence:1,startDate:'2024-01-31',endDate:'2024-02-29',totalDays:29,chargeDays:1,differenceAmount:345},
  {sequence:2,startDate:'2024-02-29',endDate:'2024-03-31',totalDays:31,chargeDays:31,differenceAmount:10000}
 ]);assert.equal(result.totalDifferenceAmount,10345);
 const leapStart=calculate(input({startDate:'2024-02-29',months:12,deliveryAt:'2025-02-27T23:59:59+08:00'}));
 assert.equal(leapStart.endDate,'2025-02-28');assert.equal(leapStart.periods.at(-1).totalDays,30);assert.equal(leapStart.periods.at(-1).chargeDays,1);assert.equal(leapStart.totalDifferenceAmount,333);
});

test('actual delivery date belongs to the new vehicle on both the first and last contract days',async()=>{
 const calculate=await pricing(),base=input({months:2,currentMonthlyFeeAmount:0,targetMonthlyFeeAmount:620});
 const first=calculate({...base,deliveryAt:'2026-01-31T23:59:59.999+08:00'});assert.deepEqual(first.periods.map((p:any)=>p.chargeDays),[28,31]);assert.equal(first.totalDifferenceAmount,1240);
 const last=calculate({...base,deliveryAt:'2026-03-30T00:00:00+08:00'});assert.deepEqual(last.periods.map((p:any)=>p.chargeDays),[0,1]);assert.equal(last.totalDifferenceAmount,20);assert.equal(last.endDate,first.endDate);
 for(const deliveryAt of ['2026-01-30T23:59:59.999+08:00','2026-03-31T00:00:00+08:00'])assert.throws(()=>calculate({...base,deliveryAt}),/OUTSIDE_TERM/);
});

test('Shanghai date boundaries govern UTC and other explicit offsets, without counting partial hours',async()=>{
 const calculate=await pricing(),base=input({months:2});
 const before=calculate({...base,deliveryAt:'2026-02-28T15:59:59.999Z'}),after=calculate({...base,deliveryAt:'2026-02-28T16:00:00Z'});
 assert.equal(before.deliveryDate,'2026-02-28');assert.equal(before.totalDifferenceAmount,10000);assert.equal(after.deliveryDate,'2026-03-01');assert.equal(after.totalDifferenceAmount,9677);
 assert.deepEqual(calculate({...base,deliveryAt:'2026-02-28T11:00:00-05:00'}),after);
 assert.deepEqual(calculate({...base,deliveryAt:'2026-03-01T23:59:59+08:00'}),after);
 assert.throws(()=>calculate({...base,deliveryAt:'2026-03-30T16:00:00Z'}),/OUTSIDE_TERM/);
});

test('each period rounds half a cent up using actual days and the total sums rounded integer cents',async()=>{
 const calculate=await pricing(),base=input({startDate:'2026-04-01',months:2,currentMonthlyFeeAmount:0,targetMonthlyFeeAmount:1});
 const half=calculate({...base,deliveryAt:'2026-04-16T00:00:00+08:00'});assert.deepEqual(half.periods.map((p:any)=>p.differenceAmount),[1,1]);assert.equal(half.totalDifferenceAmount,2);
 const below=calculate({...base,deliveryAt:'2026-04-17T00:00:00+08:00'});assert.deepEqual(below.periods.map((p:any)=>p.differenceAmount),[0,1]);assert.equal(below.totalDifferenceAmount,1);
 const above=calculate({...base,deliveryAt:'2026-04-15T00:00:00+08:00'});assert.deepEqual(above.periods.map((p:any)=>p.differenceAmount),[1,1]);
});

test('large amounts use exact intermediate arithmetic and reject an unsafe total',async()=>{
 const calculate=await pricing(),base=input({startDate:'2026-04-01',months:1,currentMonthlyFeeAmount:0,targetMonthlyFeeAmount:Number.MAX_SAFE_INTEGER});
 assert.equal(calculate({...base,deliveryAt:'2026-04-01T00:00:00+08:00'}).totalDifferenceAmount,Number.MAX_SAFE_INTEGER);
 assert.equal(calculate({...base,deliveryAt:'2026-04-16T00:00:00+08:00'}).totalDifferenceAmount,4503599627370496);
 assert.throws(()=>calculate({...base,months:2,deliveryAt:'2026-04-01T00:00:00+08:00'}),/AMOUNT_OVERFLOW/);
 // MAX_SAFE_INTEGER / 31 is 290554814669064 with remainder 7: round down.
 const late=calculate({...base,months:2,deliveryAt:'2026-05-31T23:59:59+08:00'});assert.equal(late.totalDifferenceAmount,290554814669064);
 assert.equal(calculate({...base,currentMonthlyFeeAmount:Number.MAX_SAFE_INTEGER-1,deliveryAt:'2026-04-16T00:00:00+08:00'}).totalDifferenceAmount,1);
});

test('equal monthly fees charge zero while lower fees are explicitly unsupported',async()=>{
 const calculate=await pricing(),result=calculate(input({targetMonthlyFeeAmount:10000}));
 assert.equal(result.monthlyDifferenceAmount,0);assert.equal(result.totalDifferenceAmount,0);assert.ok(result.periods.every((p:any)=>p.differenceAmount===0));assert.equal(result.periods[1].chargeDays,30);
 assert.throws(()=>calculate(input({targetMonthlyFeeAmount:9999})),/DOWNGRADE_NOT_SUPPORTED/);
});

test('money inputs must be nonnegative safe integer cents, without coercion',async()=>{
 const calculate=await pricing();
 for(const key of ['currentMonthlyFeeAmount','targetMonthlyFeeAmount'])for(const value of [-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'10000',null,undefined])assert.throws(()=>calculate(input({[key]:value})),new RegExp(key));
});

test('invalid dates, missing timezone and out-of-range original terms fail closed',async()=>{
 const calculate=await pricing();
 for(const startDate of ['2026-02-29','2026-04-31','2026-00-01','2026-1-01','2026-01-31T00:00:00Z','',null])assert.throws(()=>calculate(input({startDate})),/startDate/);
 for(const deliveryAt of ['2026-02-29T10:00:00+08:00','2026-03-01T24:00:00+08:00','2026-03-01T10:60:00+08:00','2026-03-01T10:00:00+24:00','2026-03-01T10:00:00','2026-03-01','not-a-date',null])assert.throws(()=>calculate(input({deliveryAt})),/deliveryAt/);
 for(const months of [0,-1,1.5,121,NaN,Infinity,'12',undefined])assert.throws(()=>calculate(input({months})),/months/);
});

test('pricing leaves its input and original periods unchanged and returns fresh independent records',async()=>{
 const calculate=await pricing(),request=Object.freeze(input()),before=structuredClone(request),original=periods(request.startDate,request.months),savedPeriods=structuredClone(original),result=calculate(request);
 assert.deepEqual(request,before);assert.deepEqual(original,savedPeriods);
 assert.deepEqual(result.periods.map(({sequence,startDate,endDate}:any)=>({sequence,startDate,endDate})),original.map(p=>({sequence:p.sequence,startDate:day(p.startDate),endDate:day(p.endDate)})));
 assert.equal(result.periods[0].chargeDays,0);assert.equal(result.periods[0].differenceAmount,0);
 result.periods[0].startDate='changed';assert.equal(calculate(request).periods[0].startDate,request.startDate);
});
