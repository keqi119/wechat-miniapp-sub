import {z} from 'zod';
import {key,money} from '../common/data';
import {dateInput,previewHashInput,revision} from '../asset-costs/types';
import {residualTextSafe,residualPaging,validResidualOffset} from './observation-types';
import {DEFAULT_RESIDUAL_HORIZONS} from './calculations';

export const residualId=z.string().trim().min(1).max(500).refine(residualTextSafe,'编号不能含空字符');
export const residualReason=z.string().trim().min(1).max(1000).refine(residualTextSafe,'理由不能含空字符');
export const residualCommandFields={revision,idempotencyKey:key.refine(residualTextSafe,'幂等键不能含空字符')};
const fields={vehicleId:residualId,curveId:residualId,asOfDate:dateInput,horizonMonths:z.array(z.number().int().min(0).max(120)).min(1).max(10).refine(value=>new Set(value).size===value.length,'预测月份不得重复').default([...DEFAULT_RESIDUAL_HORIZONS])};
export const forecastPreviewInput=z.object(fields).strict();
export const forecastCreateInput=z.object({...fields,...residualCommandFields,assetRevision:revision,curveRevision:revision,previewHash:previewHashInput}).strict();
export const forecastAdoptInput=z.object({...residualCommandFields,amount:money.min(1),reason:residualReason}).strict();
export const forecastStateInput=z.object({...residualCommandFields,reason:residualReason}).strict();
export const forecastListInput=z.object({...residualPaging,vehicleId:residualId.optional(),status:z.enum(['GENERATED','ADOPTED','ARCHIVED','VOIDED']).optional()}).strict().refine(validResidualOffset,'分页范围过大');
export type ForecastPreviewInput=z.output<typeof forecastPreviewInput>;
