/** Decimal ratios/month counts are parsed exactly; currency inputs are integer cents. */
export type Decimal = number | string;
export interface PricingCurve {
  id: string;
  points: { ageMonths: Decimal; coefficient: Decimal }[];
}
export interface PricingReview {
  id: string;
  observedAt: string;
  recordedAt: string;
  effectiveAt: string;
  ageMonths: Decimal;
  valueCents: number;
  supersedesId?: string | null;
  withdrawn?: boolean;
}
export interface PricingScenario {
  managementVehicleCount: number;
  monthlyManagementBudgetCents: number;
  occupancyRate: Decimal;
  targetAnnualRoa?: Decimal | null;
}
export interface PricingVehicleInput {
  vehicleId: string;
  groupKey: string;
  currentAgeMonths: Decimal;
  exitAgeMonths: Decimal;
  holdingMonths: Decimal;
  purchaseAmountCents: number | null;
  purchaseAgeMonths: Decimal | null;
  curve: PricingCurve | null;
  reviews?: PricingReview[];
  baseFeeCents: number;
  nonBaseMonthlyRevenueCents: number | null;
  /** Occupied revenue normalized exactly over the customer product term. */
  additionalOccupiedRevenue?: { amountCents: number; periodMonths: number };
  variableCostPerOccupiedMonthCents: number | null;
  /** Entire evaluation-period costs, calendar/contract prorated by the domain adapter. */
  holdingBaasCostCents: number | null;
  holdingOtherFixedCostCents: number | null;
  disposalCostCents: number | null;
  oneTimeCostCents: number | null;
  valuationMissing?: string[];
}
export interface PricingReferenceInput {
  pricingDate: string;
  knowledgeCutoff: string;
  scenario: PricingScenario;
  vehicles: PricingVehicleInput[];
}
export interface PricingVehicleResult {
  vehicleId: string;
  groupKey: string;
  complete: boolean;
  missing: string[];
  anchor: { kind: 'PURCHASE' | 'REVIEW'; reviewId: string | null; ageMonths: Decimal; valueCents: number } | null;
  curveId: string | null;
  currentValueCents: number | null;
  exitValueCents: number | null;
  exitNetValueCents: number | null;
  baseFeeCapCents: number | null;
  baseFeeOverCapCents: number | null;
  monthlyManagementCostCents: number;
  holdingMonths: Decimal;
  averageAssetsCents: number | null;
  periodProfitCents: number | null;
  annualizedProfitCents: number | null;
  annualRoa: number | null;
  breakEvenBaseFeeCents: number | null;
  targetBaseFeeCents: number | null;
  priceSolveReason: string | null;
}
export interface PricingGroupResult {
  groupKey: string;
  vehicleIds: string[];
  selectedCount: number;
  calculableCount: number;
  coverage: 'COMPLETE' | 'PARTIAL' | 'NONE';
  annualizedProfitCents: number | null;
  averageAssetsCents: number | null;
  annualRoa: number | null;
  minAnnualRoa: number | null;
  medianAnnualRoa: number | null;
  maxAnnualRoa: number | null;
  /** Null unless all selected vehicles have a known cap. */
  baseFeeCapCents: number | null;
  knownBaseFeeCapMinCents: number | null;
  knownBaseFeeCapMaxCents: number | null;
  groupTargetBaseFeeCents: number | null;
  allVehiclesTargetBaseFeeCents: number | null;
  weakestVehicleIds: string[];
  targetCapConflict: boolean | null;
  overCapVehicles: { vehicleId: string; excessCents: number }[];
}
export interface PricingReferenceResult {
  algorithmVersion: string;
  vehicles: PricingVehicleResult[];
  groups: PricingGroupResult[];
  selectedCount: number;
  calculableCount: number;
}
