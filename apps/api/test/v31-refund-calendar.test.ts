import test from 'node:test';
import assert from 'node:assert/strict';
import {dueWorkingDay} from '../src/billing/working-days';
test('official adjusted weekends, holidays and Shanghai next-day end deadline',()=>{
 assert.equal(dueWorkingDay(new Date('2026-01-01T10:00:00+08:00'),3).dueAt,'2026-01-06T15:59:59.000Z');
 assert.equal(dueWorkingDay(new Date('2026-12-31T23:59:00+08:00'),3).dueAt,'2027-01-06T15:59:59.000Z');
 const missing=dueWorkingDay(new Date('2027-12-31T10:00:00+08:00'),3);assert.equal(missing.status,'CALENDAR_REQUIRED');assert.equal(missing.missingYear,2028);assert.equal(missing.dueAt,null);
 assert.equal(dueWorkingDay(new Date('2026-02-13T10:00:00+08:00'),1).dueAt,'2026-02-14T15:59:59.000Z');
 assert.equal(dueWorkingDay(new Date('2027-02-04T10:00:00+08:00'),1).dueAt,'2027-02-14T15:59:59.000Z');
});
