import type { Decimal, PricingReferenceInput, PricingReferenceResult, PricingVehicleInput, PricingVehicleResult, PricingGroupResult, PricingReview } from './engine-types';
export type * from './engine-types';

/** Exact fractions keep cents intact through interpolation, annualization and solving. */
export class Q {
  readonly n: bigint;
  readonly d: bigint;
  constructor(n: bigint, d = 1n) {
    if (!d) throw new Error('ZERO_DENOMINATOR');
    if (d < 0n) { n = -n; d = -d; }
    let a = n < 0n ? -n : n, b = d;
    while (b) { const r = a % b; a = b; b = r; }
    this.n = n / a; this.d = d / a;
  }
  static of(value: Decimal): Q {
    const s = String(value);
    const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(s);
    if (!match || !(match[2] || match[3])) throw new Error('INVALID_DECIMAL');
    const exponent = Number(match[4] ?? 0) - (match[3]?.length ?? 0);
    if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100 || s.length > 200) throw new Error('DECIMAL_OUT_OF_RANGE');
    const n = BigInt((match[2] || '0') + (match[3] || '')) * (match[1] === '-' ? -1n : 1n);
    return exponent >= 0 ? new Q(n * 10n ** BigInt(exponent)) : new Q(n, 10n ** BigInt(-exponent));
  }
  add(b: Q): Q { return new Q(this.n * b.d + b.n * this.d, this.d * b.d); }
  sub(b: Q): Q { return new Q(this.n * b.d - b.n * this.d, this.d * b.d); }
  mul(b: Q): Q { return new Q(this.n * b.n, this.d * b.d); }
  div(b: Q): Q { return new Q(this.n * b.d, this.d * b.n); }
  cmp(b: Q): number { const d = this.n * b.d - b.n * this.d; return d < 0n ? -1 : d > 0n ? 1 : 0; }
  integer(mode: 'nearest' | 'floor' | 'ceil' = 'nearest'): number {
    let value = this.n / this.d;
    const remainder = this.n % this.d;
    if (mode === 'floor' && remainder < 0n) value--;
    if (mode === 'ceil' && remainder > 0n) value++;
    if (mode === 'nearest' && (remainder < 0n ? -remainder : remainder) * 2n >= this.d) value += this.n < 0n ? -1n : 1n;
    const result = Number(value);
    if (!Number.isSafeInteger(result)) throw new Error('UNSAFE_OUTPUT_CENTS');
    return result;
  }
  number(): number {
    // Convert only the quotient/remainder: sums across many relatively-prime
    // denominators can exceed Number's exponent range while their ratio is small.
    const precision = 10n ** 15n;
    const result = Number(this.n / this.d) + Number((this.n % this.d) * precision / this.d) / 1e15;
    if (!Number.isFinite(result)) throw new Error('UNSAFE_OUTPUT_RATIO');
    return result;
  }
}
const zero = Q.of(0), twelve = Q.of(12);
const sum = (values: Q[]) => values.reduce((a, b) => a.add(b), zero);
const cents = (v: number): Q => {
  if (!Number.isSafeInteger(v) || v < 0) throw new Error('INVALID_INTEGER_CENTS');
  return Q.of(v);
};
const timestamp = (value: string): number => {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw new Error('INVALID_DATE');
  return result;
};
interface ExactCar { result: PricingVehicleResult; assets: Q | null; annualProfit: Q | null; target: Q | null; }

export function selectReview(reviews: PricingReview[], pricing: number, cutoff: number): PricingReview | null | 'AMBIGUOUS' {
  const visible = reviews.filter(r => timestamp(r.observedAt) <= pricing && timestamp(r.recordedAt) <= cutoff && timestamp(r.effectiveAt) <= cutoff);
  const superseded = new Set(visible.map(r => r.supersedesId).filter(Boolean));
  const candidates = visible.filter(r => !superseded.has(r.id) && !r.withdrawn);
  candidates.sort((a, b) => timestamp(b.observedAt) - timestamp(a.observedAt));
  if (candidates.length > 1 && timestamp(candidates[0].observedAt) === timestamp(candidates[1].observedAt)) return 'AMBIGUOUS';
  return candidates[0] ?? null;
}

function calculateCar(v: PricingVehicleInput, input: PricingReferenceInput, management: Q, occupancy: Q, collectibleRate: Q, targetRate: Q | null): ExactCar {
  const missing = [...(v.valuationMissing ?? [])];
  const addMissing = (s: string) => { if (!missing.includes(s)) missing.push(s); };
  const exact = (value: {numerator:string;denominator:string}) => new Q(BigInt(value.numerator),BigInt(value.denominator));
  const h = v.holdingMonthsExact ? exact(v.holdingMonthsExact) : Q.of(v.holdingMonths);
  if (h.cmp(zero) <= 0) addMissing('HOLDING_MONTHS_NOT_POSITIVE');
  const base = cents(v.baseFeeCents);
  const amounts = [v.purchaseAmountCents, v.nonBaseMonthlyRevenueCents, v.variableCostPerOccupiedMonthCents, v.holdingBaasCostCents, v.holdingOtherFixedCostCents, v.disposalCostCents, v.oneTimeCostCents];
  amounts.forEach(a => { if (a !== null) cents(a); });
  const result: PricingVehicleResult = {
    vehicleId: v.vehicleId, groupKey: v.groupKey, complete: false, missing,
    anchor: null, curveId: v.curve?.id ?? null, currentValueCents: null, exitValueCents: null,
    exitNetValueCents: null, baseFeeCapCents: null, baseFeeOverCapCents: null,
    monthlyManagementCostCents: v.exactCosts?.enterpriseMonthly ? exact(v.exactCosts.enterpriseMonthly).integer() : management.integer(), holdingMonths: v.holdingMonths,
    averageAssetsCents: null, periodProfitCents: null, annualizedProfitCents: null,
    annualRoa: null, breakEvenBaseFeeCents: null, targetBaseFeeCents: null, priceSolveReason: null,
    expectedGrossRevenueCents:null,badDebtLossCents:null,collectibleRevenueCents:null,
  };
  const review = selectReview(v.reviews ?? [], timestamp(input.pricingDate), timestamp(input.knowledgeCutoff));
  if (review === 'AMBIGUOUS') addMissing('REVIEW_AMBIGUOUS');
  else if (review) result.anchor = { kind: 'REVIEW', reviewId: review.id, ageMonths: review.ageMonths, valueCents: cents(review.valueCents).integer() };
  else if (v.purchaseAmountCents !== null && v.purchaseAgeMonths !== null) result.anchor = { kind: 'PURCHASE', reviewId: null, ageMonths: v.purchaseAgeMonths, valueCents: v.purchaseAmountCents };
  else addMissing('PURCHASE_ANCHOR_MISSING');

  const points = v.curve?.points.map(p => ({ age: Q.of(p.ageMonths), value: Q.of(p.coefficient) })).sort((a, b) => a.age.cmp(b.age)) ?? [];
  points.forEach((p, i) => {
    if (p.age.cmp(zero) < 0 || p.value.cmp(zero) <= 0 || (i > 0 && p.age.cmp(points[i - 1].age) === 0)) throw new Error('INVALID_CURVE_POINTS');
  });
  const interpolate = (age: Decimal): Q | null => {
    const x = Q.of(age);
    if (!points.length || x.cmp(points[0].age) < 0 || x.cmp(points[points.length - 1].age) > 0) return null;
    const exact = points.find(p => p.age.cmp(x) === 0);
    if (exact) return exact.value;
    const i = points.findIndex(p => p.age.cmp(x) > 0);
    const left = points[i - 1], right = points[i];
    return left.value.add(right.value.sub(left.value).mul(x.sub(left.age)).div(right.age.sub(left.age)));
  };
  if (!points.length) addMissing('CURVE_MISSING');
  const anchorCoefficient = result.anchor ? interpolate(result.anchor.ageMonths) : null;
  if (result.anchor && points.length && !anchorCoefficient) addMissing('ANCHOR_CURVE_OUT_OF_RANGE');
  const currentCoefficient = interpolate(v.currentAgeMonths), exitCoefficient = interpolate(v.exitAgeMonths);
  if (points.length && !currentCoefficient) addMissing('CURRENT_CURVE_OUT_OF_RANGE');
  if (points.length && !exitCoefficient) addMissing('EXIT_CURVE_OUT_OF_RANGE');
  const current = result.anchor && anchorCoefficient && currentCoefficient ? cents(result.anchor.valueCents).mul(currentCoefficient).div(anchorCoefficient) : null;
  const exit = result.anchor && anchorCoefficient && exitCoefficient ? cents(result.anchor.valueCents).mul(exitCoefficient).div(anchorCoefficient) : null;
  if (current) {
    result.currentValueCents = current.integer();
    result.baseFeeCapCents = current.mul(Q.of('.035')).integer('floor');
    result.baseFeeOverCapCents = Math.max(0, v.baseFeeCents - result.baseFeeCapCents);
  }
  if (exit) result.exitValueCents = exit.integer();
  const costFields = [
    ['nonBaseMonthlyRevenueCents', 'NON_BASE_REVENUE_MISSING'], ['variableCostPerOccupiedMonthCents', 'VARIABLE_COST_MISSING'],
    ['holdingBaasCostCents', 'HOLDING_BAAS_COST_MISSING'], ['holdingOtherFixedCostCents', 'HOLDING_FIXED_COST_MISSING'],
    ['disposalCostCents', 'DISPOSAL_COST_MISSING'], ['oneTimeCostCents', 'ONE_TIME_COST_MISSING'],
  ] as const;
  costFields.forEach(([key, code]) => { if (v[key] === null) addMissing(code); });
  const disposal = v.exactCosts ? (v.exactCosts.disposal ? exact(v.exactCosts.disposal) : null) : (v.disposalCostCents===null ? null : cents(v.disposalCostCents));
  const net = exit !== null && disposal !== null ? exit.sub(disposal) : null;
  if (net) result.exitNetValueCents = net.integer();
  const assets = current && net ? current.add(net).div(Q.of(2)) : null;
  if (assets && assets.cmp(zero) <= 0) addMissing('AVERAGE_ASSETS_NOT_POSITIVE');
  if (assets) result.averageAssetsCents = assets.integer();
  if (missing.length || !current || !net || !assets) return { result, assets: null, annualProfit: null, target: null };
  const additional = v.additionalOccupiedRevenue;
  if (additional && (!Number.isSafeInteger(additional.periodMonths) || additional.periodMonths <= 0)) throw new Error('INVALID_REVENUE_PERIOD');
  const nonBase = cents(v.nonBaseMonthlyRevenueCents!).add(additional ? cents(additional.amountCents).div(Q.of(additional.periodMonths)) : zero), variable = cents(v.variableCostPerOccupiedMonthCents!);
  const holding = v.exactCosts ? exact(v.exactCosts.holding!).add(exact(v.exactCosts.setup!)) : cents(v.holdingBaasCostCents!).add(cents(v.holdingOtherFixedCostCents!)).add(management.mul(h)).add(cents(v.oneTimeCostCents!));
  const depreciation = current.sub(net);
  const gross = h.mul(occupancy).mul(base.add(nonBase)), collected = gross.mul(collectibleRate);
  result.expectedGrossRevenueCents=gross.integer();result.badDebtLossCents=gross.sub(collected).integer();result.collectibleRevenueCents=collected.integer();
  const periodProfit = collected.sub(h.mul(occupancy).mul(variable)).sub(holding).sub(depreciation);
  const annualProfit = periodProfit.mul(twelve).div(h);
  result.periodProfitCents = periodProfit.integer();
  result.annualizedProfitCents = annualProfit.integer();
  result.annualRoa = annualProfit.div(assets).number();
  result.complete = true;
  const solve = (rate: Q): Q => variable.add(holding.add(depreciation).div(h).add(rate.mul(assets).div(twelve)).div(occupancy)).div(collectibleRate).sub(nonBase);
  let target: Q | null = null;
  if (occupancy.cmp(zero) === 0) result.priceSolveReason = 'ZERO_OCCUPANCY';
  else if (collectibleRate.cmp(zero) === 0) result.priceSolveReason = 'FULL_BAD_DEBT';
  else {
    result.breakEvenBaseFeeCents = solve(zero).integer('ceil');
    if (targetRate) { target = solve(targetRate); result.targetBaseFeeCents = target.integer('ceil'); }
  }
  return { result, assets, annualProfit, target };
}

/** Pure calculation only. The caller freezes source versions, dimensions and calendar costs. */
export function calculatePricingReference(input: PricingReferenceInput): PricingReferenceResult {
  timestamp(input.pricingDate); timestamp(input.knowledgeCutoff);
  const scenario = input.scenario;
  if (!Number.isSafeInteger(scenario.managementVehicleCount) || scenario.managementVehicleCount <= 0) throw new Error('INVALID_MANAGEMENT_VEHICLE_COUNT');
  const management = scenario.costModelVersion===2 ? zero : cents(scenario.monthlyManagementBudgetCents!).div(Q.of(scenario.managementVehicleCount));
  const occupancy = Q.of(scenario.occupancyRate);
  if (occupancy.cmp(zero) < 0 || occupancy.cmp(Q.of(1)) > 0) throw new Error('INVALID_OCCUPANCY');
  const badDebt=Q.of(scenario.badDebtRate??0);
  if(badDebt.cmp(zero)<0||badDebt.cmp(Q.of(1))>0)throw new Error('INVALID_BAD_DEBT');
  const collectibleRate=Q.of(1).sub(badDebt);
  const target = scenario.targetAnnualRoa == null ? null : Q.of(scenario.targetAnnualRoa);
  const ids = new Set<string>();
  const groups = new Map<string, { inputs: PricingVehicleInput[]; exact: ExactCar[] }>();
  const exact = input.vehicles.map(v => {
    if (ids.has(v.vehicleId)) throw new Error('DUPLICATE_VEHICLE');
    ids.add(v.vehicleId);
    const calculated = calculateCar(v, input, management, occupancy, collectibleRate, target);
    const group = groups.get(v.groupKey) ?? { inputs: [], exact: [] };
    if (group.inputs.some(other => other.baseFeeCents !== v.baseFeeCents || other.nonBaseMonthlyRevenueCents !== v.nonBaseMonthlyRevenueCents)) throw new Error('INCONSISTENT_GROUP_PRICE');
    group.inputs.push(v); group.exact.push(calculated); groups.set(v.groupKey, group);
    return calculated;
  });
  const groupResults: PricingGroupResult[] = [...groups].map(([groupKey, group]) => {
    const all = group.exact.map(c => c.result), complete = group.exact.filter(c => c.result.complete);
    const assets = sum(complete.map(c => c.assets!)), annual = sum(complete.map(c => c.annualProfit!));
    const roas = complete.map(c => c.result.annualRoa!).sort((a, b) => a - b);
    const caps = all.map(c => c.baseFeeCapCents).filter((c): c is number => c !== null);
    const full = complete.length === all.length;
    const allCaps = caps.length === all.length ? Math.min(...caps) : null;
    let groupTarget: number | null = null, everyTarget: number | null = null;
    let weakest: string[] = [];
    if (full && target && occupancy.cmp(zero) > 0 && collectibleRate.cmp(zero)>0) {
      const needed = target.mul(assets).sub(annual).div(twelve.mul(occupancy).mul(collectibleRate).mul(Q.of(all.length))).add(cents(group.inputs[0].baseFeeCents));
      groupTarget = needed.integer('ceil');
      const highest = group.exact.reduce((a, b) => a.target!.cmp(b.target!) >= 0 ? a : b).target!;
      everyTarget = highest.integer('ceil');
      weakest = group.exact.filter(c => c.target!.cmp(highest) === 0).map(c => c.result.vehicleId);
    }
    return {
      groupKey, vehicleIds: all.map(c => c.vehicleId), selectedCount: all.length, calculableCount: complete.length,
      coverage: full ? 'COMPLETE' : complete.length ? 'PARTIAL' : 'NONE',
      annualizedProfitCents: complete.length ? annual.integer() : null, averageAssetsCents: complete.length ? assets.integer() : null,
      annualRoa: complete.length ? annual.div(assets).number() : null,
      minAnnualRoa: roas[0] ?? null, maxAnnualRoa: roas.at(-1) ?? null,
      medianAnnualRoa: roas.length ? (roas[Math.floor((roas.length - 1) / 2)] + roas[Math.floor(roas.length / 2)]) / 2 : null,
      baseFeeCapCents: allCaps, knownBaseFeeCapMinCents: caps.length ? Math.min(...caps) : null,
      knownBaseFeeCapMaxCents: caps.length ? Math.max(...caps) : null,
      groupTargetBaseFeeCents: groupTarget, allVehiclesTargetBaseFeeCents: everyTarget, weakestVehicleIds: weakest,
      targetCapConflict: everyTarget !== null && allCaps !== null ? everyTarget > allCaps : null,
      overCapVehicles: all.filter(c => c.baseFeeOverCapCents !== null && c.baseFeeOverCapCents > 0).map(c => ({ vehicleId: c.vehicleId, excessCents: c.baseFeeOverCapCents! })),
    };
  });
  return { algorithmVersion: scenario.costModelVersion===2?'pricing-reference-v2':'pricing-reference-v1', vehicles: exact.map(c => c.result), groups: groupResults, selectedCount: exact.length, calculableCount: exact.filter(c => c.result.complete).length };
}
