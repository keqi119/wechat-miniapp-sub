import test from 'node:test';
import assert from 'node:assert/strict';
import { commercialTermLabels } from './business-terms.ts';
import { creditPlanInitial } from './credit.ts';
import { finalPlanInitial, finalPlanMissingFields, loadFinalPlanDefaults, restoreCommercialTerm, refreshPlanFormValues, type FinalPlanDefaults } from './final-plan-defaults.ts';

const terms = Object.fromEntries(Object.keys(commercialTermLabels).map(key => [key, `默认${key}`]));
const source = { productId: 'product-1', productVersionId: 'version-3', version: 3, name: '测试产品', hash: 'a'.repeat(64) };
const defaults: FinalPlanDefaults = { applicationId: 'application-1', revision: 2, source, values: { monthlyFeeAmount: 489900, months: 24, mileagePerMonthKm: 2300, excessMileagePriceAmount: 175, energyDescription: '接口能源说明', conditions: '接口使用条件', benefits: ['接口服务'], commercialTerms: terms, productSourceHash: source.hash }, missingFields: [] };

test('zero included mileage and zero excess price are valid product values; negative mileage is rejected', async () => {
  const zero = { ...defaults, values: { ...defaults.values, mileagePerMonthKm: 0, excessMileagePriceAmount: 0 } };
  assert.deepEqual(await loadFinalPlanDefaults(async () => zero, 'application-1'), zero);
  await assert.rejects(loadFinalPlanDefaults(async () => ({ ...zero, values: { ...zero.values, mileagePerMonthKm: -1 } }), 'application-1'), /产品报价/);
});

test('product quote values come from defaults API rather than stale application plan or frontend constants', () => {
  const entity = { id: 'application-1', revision: 2, subscriptionPlan: { monthlyFeeAmount: 999, months: 12, mileagePerMonthKm: 1500, excessMileagePriceAmount: 150, energyDescription: '旧说明' }, finalPlan: { months: 12, mileagePerMonthKm: 9000, excessMileagePriceAmount: 999 } };
  const initial = finalPlanInitial(entity, undefined, defaults);
  assert.equal(initial.monthlyFeeAmount, 489900);
  assert.equal(initial.months, 24);
  assert.equal(initial.mileagePerMonthKm, 2300);
  assert.equal(initial.excessMileagePriceAmount, 175);
  assert.equal(initial.energyDescription, '接口能源说明');
  assert.deepEqual(initial.benefits, ['接口服务']);
  assert.equal(Object.keys(initial.commercialTerms as object).length, 14);
  assert.equal(creditPlanInitial({ id: 'empty' }).mileagePerMonthKm, undefined);
});

test('previous manual clauses and justified quote adjustments survive applying current product defaults', () => {
  const entity = { id: 'application-1', revision: 2, finalPlan: { monthlyFeeAmount: 459900, priceAdjustmentReason: '本单优惠', months: 12, startDate: '2026-11-01', firstDueDate: '2026-10-31', commercialTerms: { usageCosts: '人工约定充电责任', insuranceDetails: '', conditionDisclosure: '已保存的交接证据约定' } } };
  const initial = finalPlanInitial(entity, undefined, defaults);
  assert.equal(initial.monthlyFeeAmount, 459900);
  assert.equal(initial.months, 24);
  assert.equal(initial.startDate, '2026-11-01');
  assert.equal((initial.commercialTerms as any).usageCosts, '人工约定充电责任');
  assert.equal((initial.commercialTerms as any).insuranceDetails, '默认insuranceDetails');
  assert.equal((initial.commercialTerms as any).conditionDisclosure, '已保存的交接证据约定');
  assert.equal(initial.productSourceHash, source.hash);
});

test('restoring one clause leaves all other manually edited clauses unchanged', () => {
  const edited = JSON.stringify({ ...terms, usageCosts: '人工费用', otherFees: '人工附加费' });
  const result = JSON.parse(restoreCommercialTerm(edited, 'usageCosts', terms));
  assert.equal(result.usageCosts, '默认usageCosts');
  assert.equal(result.otherFees, '人工附加费');
  assert.throws(() => restoreCommercialTerm(edited, 'not-a-clause', terms));
});

test('generic vehicle clauses do not hide missing VIN while an explicit saved customer address resolves its own reminder', () => {
  const missing = { ...defaults, missingFields: ['vehicleIdentification', 'customerAddress', 'insuranceDetails'] };
  assert.deepEqual(finalPlanMissingFields(missing, { vehicleIdentification: '以VIN识别车辆，以现场证件核对为准', customerAddress: '', insuranceDetails: '保险以实际有效保单为准' }), ['vehicleIdentification', 'customerAddress', 'insuranceDetails']);
  assert.deepEqual(finalPlanMissingFields(missing, { vehicleIdentification: '以VIN识别车辆，以现场证件核对为准', customerAddress: '上海市测试区测试路10号', insuranceDetails: '保险以实际有效保单为准' }), ['vehicleIdentification', 'insuranceDetails']);
});

test('explicit product reload updates untouched defaults while preserving manual edits and dates', () => {
  const old = { monthlyFeeAmount: '4899.00', months: '24', commercialTerms: JSON.stringify(terms) };
  const current = { ...old, startDate: '2026-11-01', monthlyFeeAmount: '4599.00', commercialTerms: JSON.stringify({ ...terms, usageCosts: '人工费用' }) };
  const next = { monthlyFeeAmount: '4999.00', months: '36', commercialTerms: JSON.stringify({ ...terms, usageCosts: '新版费用', serviceCoverage: '新版服务' }) };
  const refreshed = refreshPlanFormValues(current, old, next);
  assert.equal(refreshed.monthlyFeeAmount, '4599.00');
  assert.equal(refreshed.months, '36');
  assert.equal(refreshed.startDate, '2026-11-01');
  assert.equal(JSON.parse(refreshed.commercialTerms).usageCosts, '人工费用');
  assert.equal(JSON.parse(refreshed.commercialTerms).serviceCoverage, '新版服务');
});

test('loader scopes to the application, validates source and never replaces a request error with sample data', async () => {
  const calls: string[] = [];
  const request = async (path: string) => { calls.push(path); return defaults; };
  assert.deepEqual(await loadFinalPlanDefaults(request, 'application-1'), defaults);
  assert.deepEqual(calls, ['/admin/applications/application-1/final-plan-defaults']);
  await assert.rejects(loadFinalPlanDefaults(async () => ({ ...defaults, applicationId: 'other' }), 'application-1'), /申请/);
  await assert.rejects(loadFinalPlanDefaults(async () => ({ ...defaults, values: { ...defaults.values, productSourceHash: 'wrong' } }), 'application-1'), /产品/);
  await assert.rejects(loadFinalPlanDefaults(async () => ({ ...defaults, values: { ...defaults.values, commercialTerms: {} } }), 'application-1'), /条款/);
  const offline = new Error('产品接口离线');
  await assert.rejects(loadFinalPlanDefaults(async () => { throw offline; }, 'application-1'), error => error === offline);
});
