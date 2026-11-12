import {z} from 'zod';
import {commandFields,dateInput,revision} from '../asset-costs/types';
import {normalizeBatteryCapacity} from '../residual-market/dimensions';

const inventoryText=(max:number)=>z.string().trim().min(1).max(max).refine(value=>!value.includes('\u0000'),'文字不可含空字符').nullable().optional();
const inventoryInteger=z.number().int().min(0).max(2147483647).nullable().optional();
const correctionText=(max:number)=>z.string().refine(value=>!/[\u0000-\u001f\u007f]/.test(value),'文字不可含控制字符').pipe(z.string().trim().min(1).max(max));
const odometer=z.number().int().min(0).max(2147483647);
export const mileageCorrectionInput=z.object({
 vehicleRevision:revision,previousMileageKm:odometer,mileageKm:odometer,reason:correctionText(1000),idempotencyKey:commandFields.idempotencyKey,
 sourceReference:z.object({fileSha256:z.string().regex(/^[a-f0-9]{64}$/),sheetName:correctionText(200),cellReference:correctionText(20).refine(value=>/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(value),'单元格须为A1格式')} ).strict(),
 expectedReservedOrderId:correctionText(500).nullable(),expectedOrderStatus:z.literal('AWAITING_PAYMENT').nullable(),
}).strict().refine(value=>value.mileageKm>=value.previousMileageKm,'更正里程不可低于原读数').refine(value=>(value.expectedReservedOrderId===null)===(value.expectedOrderStatus===null),'订单标识和状态须同时提供或同时为空');

export const profilePatchInput=z.object({
 ...commandFields,vehicleRevision:revision,batteryOwnership:z.enum(['UNKNOWN','OWNED','BAAS']).optional(),
 registeredOwnerName:z.string().trim().min(1).max(200).refine(value=>!value.includes('\u0000'),'登记人不可含空字符').nullable().optional(),
 firstRegistrationDate:dateInput.nullable().optional(),notes:z.string().max(5000).optional(),
 batteryCapacityKwh:z.string().trim().max(100).regex(/^\d+(?:\.\d{1,3})?$/).refine(value=>value.split('.')[0].replace(/^0+/,'').length<=5,'电池容量超出范围').transform(normalizeBatteryCapacity).nullable().optional(),
 engineNumber:inventoryText(200),bodyColor:inventoryText(100),purchaserName:inventoryText(200),
 initialMileageKm:inventoryInteger,purchaseAmount:inventoryInteger,
 purchaseDate:dateInput.nullable().optional(),nextInspectionDate:dateInput.nullable().optional(),
}).strict().refine(value=>['batteryOwnership','firstRegistrationDate','batteryCapacityKwh','registeredOwnerName','notes','engineNumber','bodyColor','initialMileageKm','purchaseAmount','purchaserName','purchaseDate','nextInspectionDate'].some(field=>Object.hasOwn(value,field)),'请提供需要修改的资产资料');
