import {z} from 'zod';
import {key} from '../common/data';

export const advertisingCopyIds=['just-right','beyond-daydreams','find-yourself','leave-some-space','find-your-joy','stay-curious','live-the-story','share-the-view','your-next-stop','room-for-distance','everyday-wilderness','follow-the-spark'] as const;
const plainText=(max:number)=>z.string()
 .refine(value=>!/[\u0000-\u001f\u007f-\u009f\u2028\u2029<>]/u.test(value),'须为单行纯文本')
 .transform(value=>value.trim())
 .refine(value=>Array.from(value).length>0&&Array.from(value).length<=max,`须为1至${max}个字符`);
// Zod constructs this exact property order, including when the source JSONB
// object has a different key order. Hash only the parsed array.
export const advertisingItems=z.array(z.object({
 id:z.string(),title:plainText(9),lines:z.tuple([plainText(32),plainText(32)]),catalogDescription:plainText(40)
}).strict()).length(12).refine(items=>items.every((item,index)=>item.id===advertisingCopyIds[index]),'固定位置及编号不可修改');
export const advertisingDraftInput=z.object({revision:z.number().int().positive(),items:advertisingItems,idempotencyKey:key}).strict();
export const advertisingPublishInput=z.object({revision:z.number().int().positive(),draftHash:z.string().regex(/^[a-f0-9]{64}$/),idempotencyKey:key}).strict();
export const advertisingReceiptInput=z.object({action:z.enum(['SAVE_DRAFT','PUBLISH']),key}).strict();
export type AdvertisingItems=z.infer<typeof advertisingItems>;
