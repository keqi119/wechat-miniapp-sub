import {z} from 'zod';
import {money} from '../common/data';
import {revision} from '../asset-costs/types';
import {residualCommandFields,residualId,residualReason} from '../residual-market/forecast-types';
import {residualPaging,validResidualOffset} from '../residual-market/observation-types';

export const valuationCreateInput=z.object({...residualCommandFields,revision:z.literal(0),vehicleId:residualId,vehicleRevision:revision,source:z.enum(['FORECAST','MANUAL']),forecastPointId:residualId.nullable(),forecastRevision:revision.nullable(),requestedAmount:money.min(1),reason:residualReason}).strict().refine(input=>input.source==='MANUAL'?input.forecastPointId===null&&input.forecastRevision===null:input.forecastPointId!==null&&input.forecastRevision!==null,'预测来源须有明确点和版本；人工来源不能冒用预测关联');
export const valuationApproveInput=z.object({...residualCommandFields,vehicleRevision:revision,approvedAmount:money.min(1),reason:residualReason,fileIds:z.array(residualId).min(1).max(20).refine(ids=>new Set(ids).size===ids.length,'证据不得重复')}).strict();
export const valuationDecisionInput=z.object({...residualCommandFields,reason:residualReason}).strict();
export const valuationListInput=z.object({...residualPaging,vehicleId:residualId.optional(),status:z.enum(['PENDING','APPROVED','REJECTED','CANCELLED']).optional()}).strict().refine(validResidualOffset,'分页范围过大');
