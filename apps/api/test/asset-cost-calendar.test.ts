import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {addMonths,dateAtDay,monthsBetween,parseDate,parsePeriod,periodEnd,periodOf,periodStart} from '../src/asset-costs/calendar';

test('strict calendar accepts real Gregorian dates and never rolls an invalid date into another month',()=>{
 assert.deepEqual(parsePeriod('2027-02'),{year:2027,month:2});
 assert.deepEqual(parseDate('2024-02-29'),{year:2024,month:2,day:29});
 for(const value of ['2027-2','2027-00','2027-13',' 2027-02','2027-02-01','0000-01','10000-01',null,202702])assert.throws(()=>parsePeriod(value as string));
 for(const value of ['2027-02-29','1900-02-29','2024-04-31','2024-02-00','2024-2-01','2024-02-1','2024-02-01T00:00:00Z','2024-02-01\n',undefined])assert.throws(()=>parseDate(value as string));
 assert.equal(periodOf('2000-02-29'),'2000-02');
 assert.equal(periodStart('0001-01'),'0001-01-01');
 assert.equal(periodEnd('9999-12'),'9999-12-31');
});

test('month operations preserve strict strings across leap years, year boundaries and negative offsets',()=>{
 assert.equal(periodEnd('2027-02'),'2027-02-28');assert.equal(periodEnd('2024-02'),'2024-02-29');assert.equal(periodEnd('1900-02'),'1900-02-28');assert.equal(periodEnd('2000-02'),'2000-02-29');
 assert.equal(addMonths('2026-11',3),'2027-02');assert.equal(addMonths('2027-01',-2),'2026-11');assert.equal(addMonths('2027-01',0),'2027-01');
 assert.equal(monthsBetween('2026-11','2027-02'),3);assert.equal(monthsBetween('2027-02','2026-11'),-3);
 assert.equal(dateAtDay('2027-02',31),'2027-02-28');assert.equal(dateAtDay('2024-02',31),'2024-02-29');assert.equal(dateAtDay('2026-04',31),'2026-04-30');assert.equal(dateAtDay('2026-12',1),'2026-12-01');
 for(const value of [0,32,1.5,NaN,Infinity,'31'])assert.throws(()=>dateAtDay('2027-02',value as number));
 for(const value of [0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER,'1'])assert.throws(()=>addMonths('2027-02',value as number));
 assert.throws(()=>addMonths('0001-01',-1));assert.throws(()=>addMonths('9999-12',1));
});

test('calendar results are identical in UTC+14, UTC-8 and Shanghai runtime time zones',()=>{
 const script=`const c=require(${JSON.stringify(require.resolve('../src/asset-costs/calendar'))}); process.stdout.write(JSON.stringify([c.periodStart('2024-03'),c.periodEnd('2024-02'),c.dateAtDay('2027-02',31),c.addMonths('2026-12',2),c.monthsBetween('2024-02','2025-03')]));`;
 const outputs=['Pacific/Kiritimati','America/Los_Angeles','Asia/Shanghai'].map(TZ=>{
  const child=spawnSync(process.execPath,['--import','tsx','-e',script],{env:{...process.env,TZ},encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);return child.stdout;
 });
 assert.equal(new Set(outputs).size,1);assert.deepEqual(JSON.parse(outputs[0]),['2024-03-01','2024-02-29','2027-02-28','2027-02',13]);
});
