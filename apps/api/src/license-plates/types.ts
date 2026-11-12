import {z} from 'zod';
import {ensure} from '../common/errors';
import {key} from '../common/data';
const id=z.string().trim().min(1).max(128),revision=z.number().int().min(0).max(2147483647);
const safeText=(max:number)=>z.string().refine(value=>!/[\p{Cc}\p{Cf}]/u.test(value),'不可包含控制字符').transform(value=>value.trim()).pipe(z.string().max(max));
const plateText=safeText(32).pipe(z.string().min(1)).refine(value=>value.normalize('NFKC').toUpperCase().replace(/\s/gu,'').length<=32,'牌照号码过长');
export function normalizePlateNumber(value:string){
 ensure(typeof value==='string'&&!/[\p{Cc}\p{Cf}]/u.test(value),400,'PLATE_NUMBER_INVALID','牌照号码不可包含控制字符');
 const parsed=plateText.safeParse(value);ensure(parsed.success,400,'PLATE_NUMBER_INVALID','请填写不超过32字的真实牌照号码');
 const normalized=parsed.data.normalize('NFKC').toUpperCase().replace(/\s/gu,'');ensure(normalized.length>0&&normalized.length<=32,400,'PLATE_NUMBER_INVALID','牌照号码无效');return normalized;
}
const editable={plateType:safeText(100).pipe(z.string().min(1)),region:safeText(100),notes:z.string().max(5000)};
const command={revision,idempotencyKey:key},reason=z.string().trim().min(1).max(1000),fileIds=z.array(id).min(1).max(20).refine(ids=>new Set(ids).size===ids.length,'凭据不可重复');
export const plateCreateInput=z.object({plateNumber:plateText,...editable,region:editable.region.default(''),notes:editable.notes.default(''),...command,revision:z.literal(0)}).strict();
export const platePatchInput=z.object(editable).partial().extend(command).strict().refine(value=>Object.keys(editable).some(field=>Object.hasOwn(value,field)),'请提供需要修改的备案字段');
export const plateOwnershipInput=z.object({...command,ownerId:id,ownerRevision:revision,currentOwnershipPeriodId:id.nullable(),currentOwnershipRevision:revision.nullable(),reason,fileIds}).strict().refine(value=>(value.currentOwnershipPeriodId===null)===(value.currentOwnershipRevision===null),'请同时提供当前归属编号与版本；无当前归属时均为null');
export const plateBindInput=z.object({...command,vehicleId:id,vehicleRevision:revision,currentBindingId:id.nullable(),currentBindingRevision:revision.nullable(),oldVehicleId:id.nullable(),oldVehicleRevision:revision.nullable(),reason,fileIds}).strict().refine(value=>[value.currentBindingId,value.currentBindingRevision,value.oldVehicleId,value.oldVehicleRevision].every(part=>part===null)||[value.currentBindingId,value.currentBindingRevision,value.oldVehicleId,value.oldVehicleRevision].every(part=>part!==null),'有旧绑定时须显式提供旧绑定及旧车辆的编号和版本');
export const plateUnbindInput=z.object({...command,bindingId:id,bindingRevision:revision,vehicleRevision:revision,reason}).strict();
export const plateArchiveInput=z.object({...command,reason}).strict();
/** Exact legacy display text is compared before clearing; do not trim this field. */
export const plateClearLegacyInput=z.object({...command,vehicleId:id,vehicleRevision:revision,plateNumber:z.string().min(1).max(500),reason,fileIds}).strict();
const paging={page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20)};
export const plateListInput=z.object({...paging,keyword:safeText(100).optional(),status:z.enum(['ACTIVE','ARCHIVED']).optional()}).strict();
export const plateCandidatesInput=z.object({...paging,keyword:safeText(100).optional()}).strict();
export const plateOwnerOptionsInput=z.object({...paging,page:z.coerce.number().int().min(1).max(2147483647).default(1),keyword:safeText(100).optional()}).strict().refine(value=>(value.page-1)*value.pageSize<=2147483647,'分页范围过大');
export const plateOwnerOptionIdInput=id;
