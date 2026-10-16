import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amount, billSchedule } from '../src/billing/rules.ts';
test('integer fen forbids decimal, unsafe, negative money', () => {
  for (const value of [1.5, -1, NaN, Number.MAX_SAFE_INTEGER + 1, '100']) assert.throws(() => amount(value));
  assert.equal(amount(100), 100);
});
test('monthly schedules clamp month ends without drifting and cross years', () => {
  assert.deepEqual(billSchedule('2026-12-31', 4, 12345), [
    { dueDate: '2026-12-31', amount: 12345, sequence: 1 },
    { dueDate: '2027-01-31', amount: 12345, sequence: 2 },
    { dueDate: '2027-02-28', amount: 12345, sequence: 3 },
    { dueDate: '2027-03-31', amount: 12345, sequence: 4 },
  ]);
  assert.equal(billSchedule('2028-01-31', 2, 100)[1].dueDate, '2028-02-29');
  assert.throws(() => billSchedule('2026-02-31', 1, 100));
});
