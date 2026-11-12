import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculatePricingReference } from '../src/pricing-reference/engine';
import type { PricingReferenceInput, PricingVehicleInput } from '../src/pricing-reference/engine-types';

const car = (overrides: Partial<PricingVehicleInput> = {}): PricingVehicleInput => ({
  vehicleId: 'a', groupKey: 'g', currentAgeMonths: 24, exitAgeMonths: 36, holdingMonths: 12,
  purchaseAmountCents: 8_000_000, purchaseAgeMonths: 24,
  curve: { id: 'curve-1', points: [{ ageMonths: 0, coefficient: 1 }, { ageMonths: 24, coefficient: '.8' }, { ageMonths: 36, coefficient: '.6' }] },
  baseFeeCents: 300_000, nonBaseMonthlyRevenueCents: 0, variableCostPerOccupiedMonthCents: 0,
  holdingBaasCostCents: 0, holdingOtherFixedCostCents: 0, disposalCostCents: 0, oneTimeCostCents: 0, ...overrides,
});
const input = (vehicles = [car()], overrides: Partial<PricingReferenceInput['scenario']> = {}): PricingReferenceInput => ({
  pricingDate: '2026-11-01T00:00:00Z', knowledgeCutoff: '2026-11-13T00:00:00Z',
  scenario: { managementVehicleCount: 100, monthlyManagementBudgetCents: 1_000_000, occupancyRate: 1, ...overrides }, vehicles,
});

test('second-hand purchase normalizes curve at purchase age and charges only remaining depreciation', () => {
  const result = calculatePricingReference(input()).vehicles[0];
  assert.equal(result.currentValueCents, 8_000_000);
  assert.equal(result.exitNetValueCents, 6_000_000);
  assert.equal(result.baseFeeCapCents, 280_000);
  assert.equal(result.periodProfitCents, 1_480_000);
  assert.equal(result.averageAssetsCents, 7_000_000);
  assert.ok(Math.abs(result.annualRoa! - 1_480_000 / 7_000_000) < 1e-12);
});

test('interpolates inside bounds without extrapolation, retaining current value and cap if only exit missing', () => {
  const r = calculatePricingReference(input([car({ currentAgeMonths: 30, exitAgeMonths: 48 })])).vehicles[0];
  assert.equal(r.currentValueCents, 7_000_000);
  assert.equal(r.baseFeeCapCents, 245_000);
  assert.equal(r.annualRoa, null);
  assert.ok(r.missing.includes('EXIT_CURVE_OUT_OF_RANGE'));
  assert.equal(calculatePricingReference(input([car({ purchaseAgeMonths: -1 })])).vehicles[0].baseFeeCapCents, null);
});

test('review anchors ignore future observations, late knowledge and not-effective records', () => {
  const review = { id: 'r', observedAt: '2026-10-01T00:00:00Z', recordedAt: '2026-10-02T00:00:00Z', effectiveAt: '2026-10-03T00:00:00Z', ageMonths: 24, valueCents: 4_000_000 };
  const reviews = [review,
    { ...review, id: 'future', observedAt: '2026-12-01T00:00:00Z', valueCents: 9_000_000 },
    { ...review, id: 'late', recordedAt: '2026-12-01T00:00:00Z', supersedesId: 'r' },
    { ...review, id: 'ineffective', effectiveAt: '2026-12-01T00:00:00Z', supersedesId: 'r' }];
  const r = calculatePricingReference(input([car({ reviews, purchaseAgeMonths: null, purchaseAmountCents: null })])).vehicles[0];
  assert.equal(r.anchor?.reviewId, 'r');
  assert.equal(r.currentValueCents, 4_000_000);
  assert.equal(r.exitValueCents, 3_000_000);
});

test('visible correction supersedes prior review and withdrawal restores purchase anchor', () => {
  const r = { id: 'r', observedAt: '2026-10-01', recordedAt: '2026-10-02', effectiveAt: '2026-10-03', ageMonths: 24, valueCents: 4_000_000 };
  const correction = { ...r, id: 'r2', supersedesId: 'r', valueCents: 6_000_000 };
  assert.equal(calculatePricingReference(input([car({ reviews: [r, correction] })])).vehicles[0].currentValueCents, 6_000_000);
  assert.equal(calculatePricingReference(input([car({ reviews: [r, correction, { ...correction, id: 'r3', supersedesId: 'r2', withdrawn: true }] })])).vehicles[0].currentValueCents, 8_000_000);
});

test('BaaS and management cost are holding costs independent of occupancy and selection count', () => {
  const a = car({ holdingBaasCostCents: 120_000 });
  const r = calculatePricingReference(input([a], { occupancyRate: 0 })).vehicles[0];
  assert.equal(r.periodProfitCents, -2_240_000);
  assert.equal(r.breakEvenBaseFeeCents, null);
  assert.equal(r.priceSolveReason, 'ZERO_OCCUPANCY');
  const multiple = calculatePricingReference(input([a, car({ vehicleId: 'b' })], { occupancyRate: 0 }));
  assert.equal(multiple.vehicles[0].monthlyManagementCostCents, 10_000);
  assert.equal(multiple.vehicles[0].periodProfitCents, r.periodProfitCents);
});

test('cap floors exact fractional cents while break-even and target prices ceil', () => {
  const r = calculatePricingReference(input([car({ purchaseAmountCents: 101, holdingMonths: 3, holdingBaasCostCents: 1 })], { monthlyManagementBudgetCents: 0, targetAnnualRoa: '.1' })).vehicles[0];
  assert.equal(r.baseFeeCapCents, 3);
  // R=75.75, A=88.375, depreciation=25.25, H=3; 26.25/3=8.75.
  assert.equal(r.breakEvenBaseFeeCents, 9);
  assert.equal(r.targetBaseFeeCents, 10);
});

test('missing costs remain unknown, explicit zero remains calculable; no hidden opening value fallback', () => {
  const result = calculatePricingReference(input([car(), car({ vehicleId: 'b', holdingBaasCostCents: null }), car({ vehicleId: 'c', curve: null })]));
  assert.equal(result.calculableCount, 1);
  assert.equal(result.vehicles[1].annualRoa, null);
  assert.ok(result.vehicles[1].missing.includes('HOLDING_BAAS_COST_MISSING'));
  assert.equal(result.vehicles[2].currentValueCents, null);
  assert.equal(result.groups[0].coverage, 'PARTIAL');
  assert.equal(result.groups[0].baseFeeCapCents, null);
  assert.equal(result.groups[0].allVehiclesTargetBaseFeeCents, null);
});

test('group ROA weights annualized profits by assets across distinct holding periods', () => {
  const r = calculatePricingReference(input([car(), car({ vehicleId: 'b', purchaseAmountCents: 16_000_000, holdingMonths: 24 })]));
  // a: annual profit 1.48m, assets 7m; b: period 2.96m, annual 1.48m, assets 14m.
  assert.equal(r.groups[0].annualizedProfitCents, 2_960_000);
  assert.equal(r.groups[0].averageAssetsCents, 21_000_000);
  assert.ok(Math.abs(r.groups[0].annualRoa! - 2_960_000 / 21_000_000) < 1e-12);
});

test('group target differs from every-car target, minimum cap and conflicts stay explicit', () => {
  const r = calculatePricingReference(input([car(), car({ vehicleId: 'b', purchaseAmountCents: 16_000_000 })], { targetAnnualRoa: '.1' })).groups[0];
  assert.equal(r.baseFeeCapCents, 280_000);
  assert.equal(r.groupTargetBaseFeeCents, 347_500);
  assert.equal(r.allVehiclesTargetBaseFeeCents, 460_000);
  assert.deepEqual(r.weakestVehicleIds, ['b']);
  assert.equal(r.targetCapConflict, true);
  assert.deepEqual(r.overCapVehicles, [{ vehicleId: 'a', excessCents: 20_000 }]);
});

test('rejects duplicate scope, invalid N and unsafe or fractional money without leaking bigint into JSON', () => {
  assert.throws(() => calculatePricingReference(input([car(), car()])), /DUPLICATE_VEHICLE/);
  assert.throws(() => calculatePricingReference(input([car()], { managementVehicleCount: 0 })), /MANAGEMENT_VEHICLE_COUNT/);
  assert.throws(() => calculatePricingReference(input([car({ baseFeeCents: 1.5 })])), /INTEGER_CENTS/);
  assert.doesNotThrow(() => JSON.stringify(calculatePricingReference(input())));
});

test('occupied revenue and variable cost, prepaid holding costs, disposal and one-time costs use distinct bases', () => {
  const r = calculatePricingReference(input([car({ nonBaseMonthlyRevenueCents: 50_000, variableCostPerOccupiedMonthCents: 20_000,
    holdingBaasCostCents: 120_000, holdingOtherFixedCostCents: 240_000, oneTimeCostCents: 60_000, disposalCostCents: 100_000,
  })], { occupancyRate: '.5', targetAnnualRoa: '.1' })).vehicles[0];
  assert.equal(r.exitNetValueCents, 5_900_000);
  assert.equal(r.averageAssetsCents, 6_950_000);
  assert.equal(r.periodProfitCents, -660_000);
  assert.equal(r.breakEvenBaseFeeCents, 410_000);
  assert.equal(r.targetBaseFeeCents, 525_834);
  assert.equal(r.baseFeeOverCapCents, 20_000);
});

test('partial coverage computes known cars only and never promises an all-car target', () => {
  const g = calculatePricingReference(input([car(), car({ vehicleId: 'b', holdingBaasCostCents: null })], { targetAnnualRoa: '.1' })).groups[0];
  assert.equal(g.selectedCount, 2);
  assert.equal(g.calculableCount, 1);
  assert.equal(g.annualizedProfitCents, 1_480_000);
  assert.equal(g.averageAssetsCents, 7_000_000);
  assert.equal(g.baseFeeCapCents, 280_000);
  assert.equal(g.groupTargetBaseFeeCents, null);
  assert.equal(g.allVehiclesTargetBaseFeeCents, null);
  assert.equal(g.targetCapConflict, null);
});

test('nonpositive holding periods and average assets explain inapplicability', () => {
  assert.ok(calculatePricingReference(input([car({ holdingMonths: 0 })])).vehicles[0].missing.includes('HOLDING_MONTHS_NOT_POSITIVE'));
  assert.ok(calculatePricingReference(input([car({ disposalCostCents: 22_000_000 })])).vehicles[0].missing.includes('AVERAGE_ASSETS_NOT_POSITIVE'));
});

test('no target is invented and input snapshots are never mutated', () => {
  const source = input();
  const before = JSON.stringify(source);
  const r = calculatePricingReference(source);
  assert.equal(r.vehicles[0].targetBaseFeeCents, null);
  assert.equal(r.groups[0].groupTargetBaseFeeCents, null);
  assert.equal(r.groups[0].targetCapConflict, null);
  assert.equal(JSON.stringify(source), before);
});

test('large groups with distinct rational asset bases still produce finite weighted ROA', () => {
  const vehicles = Array.from({ length: 200 }, (_, i) => car({ vehicleId: `v-${i}`,
    curve: { id: `c-${i}`, points: [{ ageMonths: 24, coefficient: `.${800001 + i * 2}` }, { ageMonths: 36, coefficient: '.6' }] },
  }));
  const result = calculatePricingReference(input(vehicles));
  assert.equal(result.calculableCount, 200);
  assert.ok(result.groups[0].annualRoa! > .20 && result.groups[0].annualRoa! < .22);
});


test('term occupied revenue keeps exact cents through profit and inverse pricing',()=>{
 const baseline=calculatePricingReference(input([car({holdingMonths:3})],{occupancyRate:1})).vehicles[0];
 const r=calculatePricingReference(input([car({holdingMonths:3,...{additionalOccupiedRevenue:{amountCents:100,periodMonths:3}}})],{occupancyRate:1})).vehicles[0];
 assert.equal(r.periodProfitCents!-baseline.periodProfitCents!,100);
 assert.equal(r.breakEvenBaseFeeCents!,baseline.breakEvenBaseFeeCents!-33);
});
