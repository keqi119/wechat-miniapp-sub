import test from 'node:test';
import assert from 'node:assert/strict';
import {monthlyReceiptBlocker,packApplicableToPeriod,packBalanceProjection} from '../src/usage/monthly-pack';
const p={ruleVersion:'MILEAGE_PACK_V2',applicablePeriodId:'jan',expiresAt:new Date('2026-02-14T16:00:00Z'),createdAt:new Date('2026-01-15T01:00:00Z'),remainingKm:1000,status:'ACTIVE'};
const period={id:'jan',status:'READY',startDate:new Date('2026-01-15'),endDate:new Date('2026-02-15'),effectiveEndDate:new Date('2026-02-15')};
test('month-inside channel success can arrive late while original month is unclosed',()=>{
 assert.equal(monthlyReceiptBlocker(p,period,{status:'ACTIVE'},{returnedOn:null,packStatus:'ACTIVE'},new Date('2026-02-14T15:59:59Z'),false),null);
 assert.equal(monthlyReceiptBlocker(p,period,{status:'ACTIVE'},{returnedOn:null,packStatus:'ACTIVE'},new Date('2026-02-14T16:00:00Z'),false),'MILEAGE_MONTH_CLOSED');
 assert.equal(monthlyReceiptBlocker(p,{...period,status:'SETTLED'},{status:'ACTIVE'},{returnedOn:null,packStatus:'ACTIVE'},new Date('2026-02-14T15:59:59Z'),false),'MILEAGE_PERIOD_SETTLED');
 assert.equal(monthlyReceiptBlocker(p,period,{status:'ACTIVE'},{returnedOn:new Date()},new Date('2026-02-14T15:59:59Z'),false),'MILEAGE_RETURNED');
});
test('V2 keeps prior month pending quota but never applies to a different month; V1 carries',()=>{
 assert.equal(packApplicableToPeriod(p,{id:'feb',sequence:2}),false);
 assert.equal(packApplicableToPeriod(p,{id:'jan',sequence:1}),true);
 assert.equal(packApplicableToPeriod({applicableFromSequence:1},{id:'feb',sequence:2}),true);
 assert.deepEqual(packBalanceProjection([p],'feb',new Date('2026-02-15T02:00:00Z')),{packBalanceKm:0,historicalPendingPackBalanceKm:1000});
});
