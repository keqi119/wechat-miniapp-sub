import {z} from 'zod';
import {ensure} from '../common/errors';
import {requireCurrentStaff} from '../auth/staff-session';
import {archiveCommand} from '../offline-documents/command';
import {requirePartnerCapability} from './capabilities';
import {assertOrdinaryReview,assertOrdinaryStaffReview} from '../auth/ordinary-review';
import {assertNotAssetFiles} from '../files/asset-files';
export type PartnerActor={id:string;role:string;authVersion?:number};
const fields={name:z.string().trim().min(2).max(200),address:z.string().trim().min(2).max(300),contactPhone:z.string().regex(/^[+\d ()-]{5,30}$/).optional().default('')};
export const partnerProfileInput=z.discriminatedUnion('subjectType',[
 z.object({...fields,subjectType:z.literal('ENTERPRISE'),creditCode:z.string().regex(/^[A-Z0-9]{18}$/)}).strict(),
 z.object({...fields,subjectType:z.literal('INDIVIDUAL'),creditCode:z.null().optional().transform(()=>null)}).strict()
]);
export const commandInput={revision:z.number().int().min(0),idempotencyKey:z.string().min(8).max(128)};
export async function requirePartnerOperator(tx:any,actor:PartnerActor,capability:'partner.cooperation.read'|'partner.cooperation.write'|'partner.cooperation.review'='partner.cooperation.write'){await requirePartnerCapability(tx,actor,capability);}
export async function lockPartner(tx:any,ownerId:string){await tx.$queryRaw`SELECT id FROM "VehicleOwner" WHERE id = ${ownerId} FOR UPDATE`;const owner=await tx.vehicleOwner.findUnique({where:{id:ownerId}});ensure(owner&&owner.status!=='SUSPENDED',404,'NOT_FOUND','合作商档案不可用');return owner;}
export async function partnerCommand(tx:any,actor:PartnerActor,ownerId:string,action:string,input:any,operation:()=>Promise<any>){await requirePartnerOperator(tx,actor,action.includes('REVIEW')?'partner.cooperation.review':'partner.cooperation.write');const lockKey=`partner-command:${actor.id}:${ownerId}:${action}:${input.idempotencyKey}`;await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;return archiveCommand(tx,actor,`partner:${ownerId}`,action,input,operation);}
export async function evidenceFiles(tx:any,ids:string[]){ensure(ids.length>0&&new Set(ids).size===ids.length,400,'PARTNER_MATERIALS_REQUIRED','请提供独立核验材料');const files=await tx.storedFile.findMany({where:{id:{in:ids}}});ensure(files.length===ids.length&&files.every((f:any)=>f.adminId&&!f.customerId&&['identity','evidence'].includes(f.purpose)&&['application/pdf','image/png','image/jpeg'].includes(f.mimeType)&&/^[a-f0-9]{64}$/.test(f.sha256)),409,'PARTNER_MATERIALS_REQUIRED','核验材料缺失或不符合要求');await assertNotAssetFiles(tx,ids);return files;}
export function assertIndependentReview(actorId:string,submittedBy:string,files:any[],role='OPERATIONS'){assertOrdinaryReview({id:actorId,role},[submittedBy,...files.map(f=>f.adminId)],'PARTNER_SELF_REVIEW');}
export async function independentPartnerReview(tx:any,actorId:string,submittedBy:string,files:any[]){const staff=await tx.adminUser.findUnique({where:{id:actorId}});ensure(staff?.active,403,'STAFF_SESSION_CHANGED','人员权限已变化，请重新登录');await assertOrdinaryStaffReview(tx,staff,[submittedBy,...files.map(f=>f.adminId).filter(Boolean)],'PARTNER_SELF_REVIEW');}
export function assertPartnerMaterials(owner:any,files:any[],binding:any){ensure(files.length>0&&(owner.subjectType==='INDIVIDUAL'?owner.creditCode==null&&binding.relationship==='SELF':/^[A-Z0-9]{18}$/.test(owner.creditCode||'')&&binding.relationship==='ENTERPRISE_REPRESENTATIVE'),409,'PARTNER_MATERIALS_REQUIRED','企业须有信用代码和经办关系，个人须有本人关系及身份权属材料');}
export async function approvedPartner(tx:any,owner:any){
 const verification=await tx.partnerCooperationSubmission.findFirst({where:{ownerId:owner.id},orderBy:{revision:'desc'}});
 const domains=verification?.domainVersions,completed=verification?.completedActions;
 ensure(owner.status!=='SUSPENDED'&&verification?.status==='APPROVED'&&verification.reviewedBy&&verification.reviewedAt&&verification.profileRevision===owner.revision&&Array.isArray(domains)&&Array.isArray(completed)&&['SUBJECT','VEHICLE','ARCHIVE','RULE'].every(domain=>domains.some((d:any)=>d.domain===domain))&&domains.every((d:any)=>completed.includes(`${d.domain}:${d.resourceId}`)),409,'OWNER_BUSINESS_UNVERIFIED','当前纸质合作资料须全部经独立复核');
 if(verification.reviewedBy===verification.submittedBy){const reviewer=await tx.adminUser.findUnique({where:{id:verification.reviewedBy}});ensure(reviewer?.role==='ADMIN',409,'OWNER_BUSINESS_UNVERIFIED','普通资料自审仅限管理员');}
 if(verification.legacyVerificationId){const legacy=await tx.partnerVerification.findUnique({where:{id:verification.legacyVerificationId}}),binding=await tx.partnerIdentityBinding.findUnique({where:{id:verification.legacyIdentityBindingId||''}});ensure(legacy?.ownerId===owner.id&&legacy.status==='APPROVED'&&legacy.profileRevision===owner.revision&&legacy.reviewedBy&&legacy.reviewedAt&&binding?.id===legacy.identityBindingId&&binding.ownerId===owner.id&&binding.status==='APPROVED'&&!binding.revokedAt&&binding.revision===legacy.identityBindingRevision&&binding.profileRevision===owner.revision&&binding.reviewedBy&&binding.reviewedAt,409,'OWNER_BUSINESS_UNVERIFIED','历史合作资料映射依据已变化');}
 return{verification,binding:null};
}
