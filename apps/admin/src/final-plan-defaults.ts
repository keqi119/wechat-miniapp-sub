import { commercialTermLabels } from './business-terms.ts';
import { creditPlanInitial, type CreditReview } from './credit.ts';
import type { Entity } from './core.ts';

export type FinalPlanDefaults = {
  applicationId: string;
  contractMode?: string;
  revision: number;
  source: { productId: string; productVersionId: string; version: number; name: string; hash: string };
  values: {
    monthlyFeeAmount: number; months: number; mileagePerMonthKm: number; excessMileagePriceAmount: number;
    energyDescription: string; benefits: string[]; conditions: string;
    commercialTerms: Record<string, string>; productSourceHash: string; agreedFeeComponents?: {baseFeeAmount:number;mileageMonthlyFeeAmount:number};
  };
  missingFields: string[];
};

const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};

export async function loadFinalPlanDefaults(request: (path: string, options?: { signal?: AbortSignal }) => Promise<unknown>, applicationId: string, signal?: AbortSignal): Promise<FinalPlanDefaults> {
  const result = object(await request(`/admin/applications/${encodeURIComponent(applicationId)}/final-plan-defaults`, { signal }));
  if (result.applicationId !== applicationId || !Number.isSafeInteger(result.revision) || result.revision < 0) throw new Error('默认方案与当前申请不一致，请重新读取');
  const source = object(result.source), values = object(result.values);
  if (!['productId', 'productVersionId', 'name', 'hash'].every(key => typeof source[key] === 'string' && source[key].trim()) || !Number.isSafeInteger(source.version) || source.version < 1 || !/^[a-f0-9]{64}$/i.test(source.hash) || values.productSourceHash !== source.hash) throw new Error('产品来源信息不完整，请重新读取');
  if (!['monthlyFeeAmount', 'months'].every(key => Number.isSafeInteger(values[key]) && values[key] > 0) || !['mileagePerMonthKm', 'excessMileagePriceAmount'].every(key => Number.isSafeInteger(values[key]) && values[key] >= 0) || !['energyDescription', 'conditions'].every(key => typeof values[key] === 'string' && values[key].trim()) || !Array.isArray(values.benefits) || values.benefits.some((value: unknown) => typeof value !== 'string')) throw new Error('产品报价信息不完整，请重新读取');
  if (!(result.contractMode==='ELECTRONIC'?['vehicleIdentification','customerAddress','handoverArrangement']:Object.keys(commercialTermLabels)).every(key => typeof object(values.commercialTerms)[key] === 'string') || !Array.isArray(result.missingFields) || result.missingFields.some((value: unknown) => typeof value !== 'string')) throw new Error('默认商业条款不完整，请重新读取');
  return result as FinalPlanDefaults;
}

export function finalPlanInitial(entity: Entity, review: CreditReview | undefined, defaults: FinalPlanDefaults): Record<string, unknown> {
  const previous = object(entity.finalPlan);
  const initial = creditPlanInitial(entity, review);
  const editedTerms = Object.fromEntries(Object.entries(object(previous.commercialTerms)).filter(([key, value]) => Object.hasOwn(commercialTermLabels, key) && typeof value === 'string' && value.trim()));
  const acceptance = initial.pricingMode === 'V1_ONE_FEN' || initial.pricingMode === 'V2_ONE_YUAN';
  const adjusted = typeof previous.priceAdjustmentReason === 'string' && previous.priceAdjustmentReason.trim();
  return {
    ...initial, ...defaults.values,
    ...(defaults.contractMode==='ELECTRONIC'?{...defaults.values.commercialTerms,...Object.fromEntries(Object.entries(object(previous.commercialTerms)).filter(([k])=>['vehicleIdentification','customerAddress','handoverArrangement'].includes(k))),agreedBaseFeeAmount:object(previous.agreedFeeComponents).baseFeeAmount??defaults.values.agreedFeeComponents?.baseFeeAmount,agreedMileageFeeAmount:object(previous.agreedFeeComponents).mileageMonthlyFeeAmount??defaults.values.agreedFeeComponents?.mileageMonthlyFeeAmount}:{}),
    ...(typeof previous.monthlyFeeAmount === 'number' && (adjusted || acceptance) ? { monthlyFeeAmount: previous.monthlyFeeAmount } : {}),
    ...(acceptance && typeof previous.months === 'number' ? { months: previous.months } : {}),
    commercialTerms: { ...defaults.values.commercialTerms, ...editedTerms },
    productSourceHash: defaults.source.hash,
  };
}

export function restoreCommercialTerm(value: string, key: string, defaults: Record<string, string>): string {
  if (!Object.hasOwn(commercialTermLabels, key) || typeof defaults[key] !== 'string') throw new Error('该条款没有可恢复的默认内容');
  return JSON.stringify({ ...object(JSON.parse(value || '{}')), [key]: defaults[key] });
}

export function finalPlanMissingFields(defaults: FinalPlanDefaults, terms: Record<string, string>): string[] {
  // Generic explanatory text is not evidence that missing vehicle or policy data exists.
  return defaults.missingFields.filter(key => key !== 'customerAddress' || !terms.customerAddress?.trim());
}

export function refreshPlanFormValues(current: Record<string, string>, previous: Record<string, string>, next: Record<string, string>): Record<string, string> {
  const result = { ...current };
  for (const [key, value] of Object.entries(next)) {
    if (key === 'commercialTerms') {
      const terms = object(JSON.parse(current[key] || '{}')), oldTerms = object(JSON.parse(previous[key] || '{}')), nextTerms = object(JSON.parse(value || '{}'));
      result[key] = JSON.stringify({ ...terms, ...Object.fromEntries(Object.entries(nextTerms).filter(([term]) => terms[term] === oldTerms[term] || terms[term] === undefined)) });
    } else if (current[key] === previous[key] || current[key] === undefined) result[key] = value;
  }
  return result;
}
