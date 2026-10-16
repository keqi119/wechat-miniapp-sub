import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommercialTerms, normaliseHandoverChecklist } from './business-terms.ts';

test('all approved commercial fields are explicit and placeholder text is rejected', () => {
  const complete: Record<string, string> = { vehicleIdentification: 'QA VIN TEST00001', permittedUse: '不适用', conditionDisclosure: '不适用', customerAddress: '不适用', mileageCarryRule: '不适用', excessMileageCalculation: '不适用', usageCosts: '不适用', insuranceDetails: '不适用', maintenanceRule: '不适用', serviceCoverage: '不适用', handoverArrangement: '不适用', earlyTerminationRule: '不适用', depositRefundRule: '不适用', otherFees: '不适用' };
  assert.deepEqual(parseCommercialTerms(JSON.stringify(complete)), complete);
  assert.throws(() => parseCommercialTerms('{}'));
  for (const key of Object.keys(complete)) { const partial = { ...complete }; delete partial[key]; assert.throws(() => parseCommercialTerms(JSON.stringify(partial))); }
  for (const invalid of ['', '   ', '待确认', '另行通知', '{{customerAddress}}']) assert.throws(() => parseCommercialTerms(JSON.stringify({ ...complete, customerAddress: invalid })));
});
test('handover adds missing fact fields without inventing values and preserves entered evidence', () => {
  const rows = normaliseHandoverChecklist([{ label: 'batteryLevel', value: '73%' }, { label: '外观补充', value: 'QA 原有记录' }]);
  assert.equal(rows.length, 8);
  assert.deepEqual(rows.find(row => row.label === 'batteryLevel'), { label: 'batteryLevel', value: '73%' });
  assert.deepEqual(rows.find(row => row.label === 'actualTimeAndPlace'), { label: 'actualTimeAndPlace', value: '' });
  assert.deepEqual(rows.at(-1), { label: '外观补充', value: 'QA 原有记录' });
});
