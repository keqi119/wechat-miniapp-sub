import {z} from 'zod';
import {previewHashInput} from '../asset-costs/types';
import {RESIDUAL_PRICE_SOURCES} from './dimensions';
import {residualPaging,validResidualOffset,residualCommandFields} from './observation-types';

export const residualImportPreviewInput=z.object({source:z.enum(RESIDUAL_PRICE_SOURCES),fileName:z.string().trim().min(1).max(255).refine(value=>!/[\p{Cc}\p{Cf}]/u.test(value),'文件名不可含控制字符'),csvText:z.string().min(1)}).strict();
export const residualImportCommitInput=residualImportPreviewInput.extend({...residualCommandFields,revision:z.literal(0),previewHash:previewHashInput}).strict();
export const residualImportListInput=z.object({...residualPaging,source:z.enum(RESIDUAL_PRICE_SOURCES).optional(),status:z.enum(['COMPLETED','PARTIAL_FAILED','FAILED']).optional()}).strict().refine(validResidualOffset,'分页范围过大');
/** V1 explicitly maps these headings; synonyms in one file are an error. */
export const RESIDUAL_CSV_COLUMNS=Object.freeze({
 modelDefinitionId:['modelDefinitionId','车型ID'],modelRevision:['modelRevision','车型版本'],observedOn:['observedOn','observedAt','观察日期'],priceType:['priceType','价格类型'],priceYuan:['priceYuan','priceAmount','价格(元)'],sourceNote:['sourceNote','remark','来源说明'],
 sourceListingId:['sourceListingId','来源条目ID'],batteryOwnership:['batteryOwnership','batteryUsageType'],batteryCapacityKwh:['batteryCapacityKwh'],mileageKm:['mileageKm'],registrationDate:['registrationDate'],vehicleAgeMonths:['vehicleAgeMonths'],province:['province'],city:['city'],trim:['trim'],conditionGrade:['conditionGrade'],batteryHealthPercent:['batteryHealthPercent'],accidentFlag:['accidentFlag'],sourceUrl:['sourceUrl'],
});
export const RESIDUAL_CSV_REQUIRED=['modelDefinitionId','modelRevision','observedOn','priceType','priceYuan','sourceNote'] as const;
export const RESIDUAL_CSV_CONTRACT=Object.freeze({version:1,priceUnit:'CNY_YUAN',required:[...RESIDUAL_CSV_REQUIRED],columns:RESIDUAL_CSV_COLUMNS});
