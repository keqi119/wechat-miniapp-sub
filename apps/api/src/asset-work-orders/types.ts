import {z} from 'zod';
import {dateInput,revision} from '../asset-costs/types';
const clean=(max:number,min=0)=>z.string().trim().min(min).max(max).refine(value=>!value.includes('\0'),'文字不得含空字符');
export const workId=clean(128,1),workReason=clean(1000,1);
export const workText=clean(5000,1);
export const workCommand={revision,idempotencyKey:clean(128,8)};
export const workEvidence=z.array(workId).min(1).max(20).refine(ids=>new Set(ids).size===ids.length,'证据不得重复');
export const workTimestamp=z.iso.datetime({offset:true}).refine(value=>{const time=new Date(value);return /^\d{4}-/.test(value)&&Number.isFinite(time.getTime())&&time.getUTCFullYear()>=1&&time.getUTCFullYear()<=9999;},'须为真实带时区时间');
export const workKind=z.enum(['ACCIDENT_REPAIR','REPAIR','MAINTENANCE']);
export const workStatus=z.enum(['PENDING','IN_PROGRESS','WAITING_EXTERNAL','PENDING_ACCEPTANCE','PENDING_COST_CONFIRMATION','CLOSED','CANCELLED']);
export const workPriority=z.enum(['LOW','NORMAL','HIGH','URGENT']);
const pageFields={page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20)};
const offset=(value:{page:number;pageSize:number})=>(value.page-1)*value.pageSize<=1000000;
export const workOrderListInput=z.object({...pageFields,keyword:clean(200).optional(),vehicleId:workId.optional(),kind:workKind.optional(),status:workStatus.optional(),assigneeId:workId.optional(),priority:workPriority.optional()}).strict().refine(offset,'分页偏移过大');
export const assigneeListInput=z.object({...pageFields,keyword:clean(200).optional()}).strict().refine(offset,'分页偏移过大');
const draftFields={title:clean(200,1),description:workText,priority:workPriority,costConfirmationRequired:z.boolean(),noCostReason:workReason.nullable()};
const accident=z.object({accidentAt:workTimestamp,location:clean(500,1),description:workText}).strict();
// Preserve the old parsed command shape and field order for ArchiveCommand replay.
// New source proof is mandatory only when applying a command for the first time.
export const createWorkOrderCommandInput=z.object({...workCommand,revision:z.literal(0),vehicleId:workId,vehicleRevision:revision,kind:workKind,occurredAt:workTimestamp,sourceServiceRequestId:workId.nullable(),sourceServiceRequestRevision:revision.nullable().optional(),sourceServiceRequestHash:z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),relatedWorkOrderId:workId.nullable(),...draftFields,accident:accident.nullable()}).strict().superRefine((value,ctx)=>{
 if((value.kind==='ACCIDENT_REPAIR')!==(value.accident!==null))ctx.addIssue({code:'custom',path:['accident'],message:'事故工单须明确事故事实，其他类型不得填写'});
 if(value.costConfirmationRequired?value.noCostReason!==null:value.noCostReason===null)ctx.addIssue({code:'custom',path:['noCostReason'],message:'无需成本确认必须有明确无成本原因'});
});
export const createWorkOrderInput=createWorkOrderCommandInput.superRefine((value,ctx)=>{
 if(value.sourceServiceRequestId!==null?(value.sourceServiceRequestRevision==null||!value.sourceServiceRequestHash):(value.sourceServiceRequestRevision!=null||value.sourceServiceRequestHash!=null))ctx.addIssue({code:'custom',path:['sourceServiceRequestId'],message:'客户服务来源须绑定已核对版本与摘要；独立工单不得携带来源凭据'});
});
export const patchWorkOrderInput=z.object(draftFields).partial().extend(workCommand).strict().refine(value=>Object.keys(draftFields).some(field=>Object.hasOwn(value,field)),'请提供需要更正的草稿字段');
export const reasonWorkOrderInput=z.object({...workCommand,reason:workReason}).strict();
export const assignWorkOrderInput=reasonWorkOrderInput.extend({assigneeId:workId,providerName:clean(200,1),contact:clean(200,1),scheduledAt:workTimestamp.nullable()}).strict();
export const maintenanceCompletionInput=z.object({completedOn:dateInput,mileageKm:revision,nextDueDate:dateInput.nullable(),nextDueMileageKm:revision.nullable(),scheduleRevision:revision,reason:workReason}).strict().refine(value=>(value.nextDueDate===null||value.nextDueDate>value.completedOn)&&(value.nextDueMileageKm===null||value.nextDueMileageKm>value.mileageKm),'下次阈值须晚于本次保养');
export const submitAcceptanceInput=z.object({...workCommand,solution:workText,fileIds:workEvidence,maintenance:maintenanceCompletionInput.optional()}).strict();
export const acceptWorkOrderInput=reasonWorkOrderInput.extend({fileIds:workEvidence}).strict();
export const noteWorkOrderInput=z.object({...workCommand,note:workText}).strict();
export const claimWorkOrderInput=acceptWorkOrderInput.extend({insurerName:clean(200),claimNumber:clean(200),claimStatus:z.enum(['NOT_REPORTED','REPORTED','PROCESSING','SETTLED','REJECTED','WITHDRAWN'])}).strict();
export const restrictWorkOrderInput=acceptWorkOrderInput.extend({vehicleRevision:revision,scopes:z.array(z.enum(['ALLOCATION','DELIVERY'])).min(1).max(2).refine(values=>new Set(values).size===values.length,'限制范围不得重复')}).strict();
export const releaseWorkOrderInput=acceptWorkOrderInput.extend({restrictionRevision:revision,vehicleRevision:revision}).strict();
export const maintenancePatchInput=reasonWorkOrderInput.extend({vehicleRevision:revision,nextDueDate:dateInput.nullable(),nextDueMileageKm:revision.nullable()}).strict();
