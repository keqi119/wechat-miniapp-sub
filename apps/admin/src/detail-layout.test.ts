import test from 'node:test';
import assert from 'node:assert/strict';
import { detailSections, detailSummary } from './detail-layout.ts';

test('detail grouping retains every readable field without mutating the source', () => {
  const original = { id: 'a', status: 'IN_REVIEW', finalPlan: { monthlyFeeAmount: 1, months: 12, commercialTerms: { fees: '完整费用条件' } }, consents: [{ id: 'c', version: 2 }], history: [{ id: 'h' }], extraFutureField: 'preserved' };
  const copy = structuredClone(original);
  const sections = detailSections(original);
  assert.deepEqual({ ...sections.details, ...sections.history }, original);
  assert.deepEqual(original, copy);
  assert.deepEqual(Object.keys(sections.history), ['consents', 'history']);
  assert.equal(sections.details.extraFutureField, 'preserved');
});

test('summary highlights current commercial amounts including zero without inventing values or leaking nested profile fields', () => {
  const summary = detailSummary({ id: 'a', status: 'IN_REVIEW', vehicle: { title: 'ET5T', providerSecret: 'hidden' }, profile: { idCardNo: 'hidden' }, finalPlan: { monthlyFeeAmount: 1, depositAmount: 0, months: 12, startDate: '2026-11-01', commercialTerms: { fees: 'long text' } } });
  assert.deepEqual(summary, { vehicleTitle: 'ET5T', monthlyFeeAmount: 1, depositAmount: 0, months: 12, startDate: '2026-11-01' });
  assert.deepEqual(detailSummary({ id: 'b', status: 'PENDING' }), {});
});

test('summary uses top-level values before the confirmed plan and preserves server values in full detail', () => {
  const source = { id: 'order', monthlyFeeAmount: 200, finalPlanSnapshot: { monthlyFeeAmount: 100, months: 12 }, sourceFileId: 'source', signedFileId: 'signed' };
  assert.equal(detailSummary(source).monthlyFeeAmount, 200);
  assert.equal(detailSummary(source).months, 12);
  assert.equal(detailSummary(source).sourceFileId, 'source');
  assert.equal(detailSummary(source).signedFileId, 'signed');
  assert.equal(detailSections(source).details.signedFileId, 'signed');
});
