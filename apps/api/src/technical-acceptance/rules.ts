import {z} from 'zod';
import {key,hash} from '../common/data';
import {ensure} from '../common/errors';
export const TECHNICAL_KIND='TECHNICAL_ACCEPTANCE' as const;
export const TECHNICAL_LEGAL='technical-signing-verification';
export const technicalEnabled=()=>process.env.TECHNICAL_ACCEPTANCE_SIGNING_ENABLED==='true';
export const mutation=z.object({revision:z.number().int().positive(),idempotencyKey:key}).strict();
export const createInput=z.object({customerId:z.string().min(1),documentId:z.string().min(1),idempotencyKey:key}).strict();
export const confirmInput=mutation.extend({documentHash:z.string().length(64),bodyHash:z.string().length(64),templateHash:z.string().length(64),consent:z.object({accepted:z.literal(true),disclosureVersion:z.literal('1'),privacyDocumentId:z.string().min(1),privacyVersion:z.number().int().positive()}).strict()});
export const DISCLOSURE='本次仅验证电子签署，不产生租赁、费用或押金。为签署本份文件，将已实名姓名、已绑定手机号、法大大客户关联标识、本文件及必要签署凭据提供给深圳法大大网络科技有限公司，用于确定本人、电子签署、核验结果和归档。正文仅展示姓名和脱敏手机，不列完整证件或手机。本验证独立资料在完成或终止后保留180天，经人工复核删除或匿名化；争议或法定必要留存除外。共享实名账号、证书不因此删除。拒绝只阻止此次签署，不影响其他浏览和已存记录查询。';
export function technicalBody(template:string,id:string,name:string,mobile:string,createdAt:Date){
 const values:Record<string,string>={verificationNo:id,participantName:name,maskedMobile:mobile.replace(/^(\d{3})\d+(\d{4})$/,'$1****$2'),generatedAt:createdAt.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}),platformSignatureSlot:'甲方企业签章见本文件末尾独立签署区',participantSignatureSlot:'乙方本人签署见本文件末尾独立签署区'};
 ensure(name.trim()&&/^1\d{10}$/.test(mobile),409,'IDENTITY_REQUIRED','既有实名及绑定手机资料不完整');
 const body=template.replace(/\{\{([A-Za-z0-9_]+)\}\}/g,(_,key)=>{ensure(values[key],409,'TEMPLATE_SLOT','验收文案变量不受支持');return values[key];});
 ensure(!/\{\{|\}\}|待填写|待补齐/.test(body),409,'TEMPLATE_SLOT','验收文案未填写完整');return body;
}
export const technicalHash=(id:string,customerId:string,templateHash:string,bodyHash:string)=>hash({kind:TECHNICAL_KIND,id,customerId,templateHash,bodyHash});
export const retentionDue=(date:Date)=>new Date(date.getTime()+180*86400000);
export async function retryableLock(operation:()=>Promise<unknown>){try{await operation();}catch(e:any){if(e.code==='P2010'&&['40001','40P01'].includes(e.meta?.code))throw Object.assign(new Error('Serializable lock conflict'),{code:'P2034'});throw e;}}
export async function lockTechnical(tx:any,id:string){await retryableLock(()=>tx.$queryRaw`SELECT id FROM "TechnicalAcceptance" WHERE id=${id} FOR UPDATE`);return tx.technicalAcceptance.findUnique({where:{id}});}
export async function assertTechnicalIdentity(db:any,record:any){
 const [account,customer]=await Promise.all([db.eSignAccount.findUnique({where:{customerId:record.customerId}}),db.customer.findUnique({where:{id:record.customerId}})]);
 const binding=record.consentSnapshot?.identityBinding;
 ensure(binding&&account&&customer&&binding.verifiedIdentityHash===account.verifiedIdentityHash&&binding.providerCustomerId===account.providerCustomerId&&binding.mobileHash===hash(customer.mobile),409,'ACCEPTANCE_IDENTITY_CHANGED','本人身份或绑定手机已变化，请停止本份验证并重新生成文件');
}
