import {z} from 'zod';
import {dateInput,revision} from '../asset-costs/types';
export const collectionText=(max:number,min=1)=>z.string().trim().min(min).max(max).refine(value=>!value.includes('\0'),'文字不得含空字符');
export const collectionId=collectionText(128),collectionReason=collectionText(2000);
const command={revision,idempotencyKey:collectionText(128,8)},previewHash=z.string().regex(/^[a-f0-9]{64}$/);
export const collectionPreviewInput=z.object({orderId:collectionId}).strict();
export const collectionCreateInput=z.object({...command,revision:z.literal(0),orderId:collectionId,previewHash,reason:collectionReason}).strict();
export const collectionRefreshInput=z.object({...command,previewHash,reason:collectionReason}).strict();
export const collectionCloseInput=z.object({...command,previewHash,closeReason:collectionReason}).strict();
export const collectionContactInput=z.object({...command,method:z.enum(['PHONE','SMS','WECHAT','EMAIL','OFFLINE','OTHER']),actionType:z.enum(['REMINDER','FOLLOW_UP','PROMISE_TO_PAY','CUSTOMER_DISPUTE','ESCALATION']),result:z.enum(['SUCCESS','NO_ANSWER','CUSTOMER_PROMISED','CUSTOMER_REFUSED','DISPUTED','INVALID_CONTACT','OTHER']),content:collectionText(4000),promiseDate:dateInput.nullable(),promiseAmount:z.number().int().min(1).max(2147483647).nullable(),nextFollowUpDate:dateInput.nullable()}).strict().superRefine((value,context)=>{
 if((value.promiseDate===null)!==(value.promiseAmount===null))context.addIssue({code:'custom',path:['promiseAmount'],message:'承诺日期及金额须成对填写'});
 if((value.actionType==='PROMISE_TO_PAY'||value.result==='CUSTOMER_PROMISED')&&value.promiseDate===null)context.addIssue({code:'custom',path:['promiseDate'],message:'记录付款承诺须填写真实承诺日期及金额'});
});
const paging={page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20)},offset=(value:{page:number;pageSize:number})=>(value.page-1)*value.pageSize<=1000000;
const filters={orderId:collectionId.optional(),customerId:collectionId.optional(),keyword:collectionText(200,0).optional()};
export const collectionListInput=z.object({...paging,...filters,status:z.enum(['ACTIVE','CLOSED']).optional()}).strict().refine(offset,'分页偏移过大');
export const overdueListInput=z.object({...paging,...filters,level:z.enum(['D1','D2','D3','D4','D5']).optional()}).strict().refine(offset,'分页偏移过大');
