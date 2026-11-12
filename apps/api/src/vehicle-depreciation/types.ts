import {z} from 'zod';
import {money,text} from '../common/data';
import {commandFields,dateInput,pagingFields,periodInput,previewHashInput,reasonInput,revision} from '../asset-costs/types';
import {previewDepreciationSchedule} from './schedule';

const fields={method:z.enum(['STRAIGHT_LINE','MANUAL','NONE']),basisAmount:money,basisSource:text,basisEvidence:z.string().trim().min(1).max(5000),residualAmount:money,startDate:dateInput,usefulLifeMonths:z.number().int().min(1).max(120).nullable(),currency:z.literal('CNY'),notes:z.string().max(5000),previousPolicyId:text.nullable()};
function formula(value:any,ctx:z.RefinementCtx){
 if(value.method==='STRAIGHT_LINE'&&value.usefulLifeMonths===null||value.method!=='STRAIGHT_LINE'&&value.usefulLifeMonths!==null){ctx.addIssue({code:'custom',path:['usefulLifeMonths'],message:'直线法须明确月数；其他方法不填使用月数'});return;}
 try{const common={basisAmount:value.basisAmount,residualAmount:value.residualAmount,startDate:value.startDate};previewDepreciationSchedule(value.method==='STRAIGHT_LINE'?{...common,method:'STRAIGHT_LINE',usefulLifeMonths:value.usefulLifeMonths}:value.method==='MANUAL'?{...common,method:'MANUAL',manualPeriods:[]}:{...common,method:'NONE'});}catch{ctx.addIssue({code:'custom',message:'折旧日期、基数、残值或期限无效'});}
}
export const depreciationDraftInput=z.object(fields).strict().superRefine(formula);
export const depreciationCreateInput=z.object({...fields,usefulLifeMonths:fields.usefulLifeMonths.default(null),currency:z.literal('CNY').default('CNY'),notes:fields.notes.default(''),previousPolicyId:fields.previousPolicyId.default(null),...commandFields,revision:z.literal(0),vehicleId:text,vehicleRevision:revision}).strict().superRefine(formula);
export const depreciationPatchInput=z.object(fields).partial().extend(commandFields).strict().refine(value=>Object.keys(fields).some(field=>Object.hasOwn(value,field)),'请提供需要修改的草稿字段');
export const depreciationActivateInput=z.object({...commandFields,reason:reasonInput,previousRevision:revision.optional()}).strict();
export const depreciationArchiveInput=z.object({...commandFields,reason:reasonInput}).strict();
const manualPeriod=z.object({costPeriod:periodInput,amount:money,reason:z.string().trim().min(1).max(5000)}).strict();
const manualPeriods=z.array(manualPeriod).max(120).refine(rows=>new Set(rows.map(row=>row.costPeriod)).size===rows.length,'手工月份不得重复');
export const depreciationPreviewInput=z.object({manualPeriods:manualPeriods.optional()}).strict();
export const depreciationGenerateInput=z.object({...commandFields,manualPeriods:manualPeriods.optional(),previewHash:previewHashInput,acknowledgedWarningIds:z.array(z.string()).max(0)}).strict();
export const depreciationListInput=z.object({...pagingFields,vehicleId:text.optional(),status:z.enum(['DRAFT','ACTIVE','SUPERSEDED','ARCHIVED']).optional()}).strict();
