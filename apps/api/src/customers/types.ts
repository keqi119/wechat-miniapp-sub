import {z} from 'zod';
import {hash,key,text} from '../common/data';
import {ensure} from '../common/errors';
import {requireCurrentStaff} from '../auth/staff-session';
import {qualificationValidityIssues} from './qualification-validity';
export type ReviewActor={id:string;role:string;authVersion?:number};
export const reviewDecision=z.enum(['APPROVED','REJECTED','NEEDS_INFO']);
export const reasonCode=z.enum(['IDENTITY_UNVERIFIED','IDENTITY_EXPIRED','DRIVING_QUALIFICATION_UNVERIFIED','DRIVING_LICENSE_EXPIRED','MATERIALS_INCOMPLETE','MATERIALS_INCONSISTENT','CREDIT_CONSENT_REQUIRED','CREDIT_MANUAL_REVIEW','PLAN_INPUT_CHANGED','OUTSIDE_SERVICE_SCOPE']);
const reasons={decision:reviewDecision,reasonCodes:z.array(reasonCode).max(10).default([]),supplementaryInstructions:z.string().trim().max(500).default('')};
const command={revision:z.number().int().nonnegative(),idempotencyKey:key};
const ids=z.array(text).min(1).max(10).refine(v=>new Set(v).size===v.length,'材料编号不可重复');
const qualificationDocuments=z.object({identityFrontFileId:text,identityBackFileId:text,drivingLicenseFileId:text}).strict();
export const qualificationSubmitInput=z.object({...command,profileHash:z.string().regex(/^[a-f0-9]{64}$/),verificationSource:z.literal('MANUAL'),identityFileIds:ids,drivingLicenseFileIds:ids,identityExpiresAt:z.string().nullable().optional(),drivingLicenseExpiresAt:z.string().nullable().optional(),identityLongTerm:z.boolean().optional(),drivingLicenseLongTerm:z.boolean().optional(),documents:qualificationDocuments.optional()}).strict().superRefine((input,ctx)=>{
 for(const issue of qualificationValidityIssues(input))ctx.addIssue({code:'custom',path:[issue.path],message:issue.message});
 if(input.documents){const d=input.documents,slots=[d.identityFrontFileId,d.identityBackFileId,d.drivingLicenseFileId];if(new Set(slots).size!==3||input.identityFileIds.length!==2||input.identityFileIds[0]!==d.identityFrontFileId||input.identityFileIds[1]!==d.identityBackFileId||input.drivingLicenseFileIds.length!==1||input.drivingLicenseFileIds[0]!==d.drivingLicenseFileId)ctx.addIssue({code:'custom',path:['documents'],message:'请分别选择身份证人像面、国徽面和驾驶证，且与提交材料一致'});}
});
function validateReasons(input:{decision:string;reasonCodes:string[];supplementaryInstructions:string},ctx:z.RefinementCtx){
 if(input.decision==='APPROVED'&&(input.reasonCodes.length||input.supplementaryInstructions))ctx.addIssue({code:'custom',message:'通过结论不填写拒绝原因或补件说明'});
 if(input.decision!=='APPROVED'&&!input.reasonCodes.length)ctx.addIssue({code:'custom',message:'退回或拒绝须选择结构化原因'});
 if(input.decision==='NEEDS_INFO'&&!input.supplementaryInstructions)ctx.addIssue({code:'custom',message:'请填写需要补充的身份或驾驶资格材料'});
 if(input.decision!=='NEEDS_INFO'&&input.supplementaryInstructions)ctx.addIssue({code:'custom',message:'补件说明仅用于需补充材料结论'});
 if(/(?:芝麻|征信|信用分|信用截图|分数|评分|\b\d{3}\s*分)/.test(input.supplementaryInstructions))ctx.addIssue({code:'custom',message:'补件说明不得收集信用分数或信用截图'});
}
export const qualificationReviewInput=z.object({...command,...reasons,qualificationId:text}).strict().superRefine(validateReasons);
export const riskReviewInput=z.object({...command,...reasons,planRevision:z.number().int().positive(),commercialHash:z.string().regex(/^[a-f0-9]{64}$/),qualificationId:text,creditVerificationId:text,identityChecked:z.boolean(),drivingQualificationChecked:z.boolean()}).strict().superRefine(validateReasons);
export type CustomerQualificationView={id:string;customerId:string;revision:number;profileHash:string;status:string;verificationSource:string;identityFileIds:string[];drivingLicenseFileIds:string[];identityExpiresAt:Date|null;drivingLicenseExpiresAt:Date|null;identityLongTerm:boolean;drivingLicenseLongTerm:boolean;submittedBy:string;reviewedBy:string|null;reviewedAt:Date|null;reasonCodes:string[];supplementaryInstructions:string};
export type RiskReviewView={id:string;applicationId:string;revision:number;decision:string;planRevision:number;commercialHash:string;qualificationId:string;reasonCodes:string[];supplementaryInstructions:string;reviewedBy:string;reviewedAt:Date};
export type RiskSnapshot={reviewId:string;applicationId:string;customerId:string;qualificationId:string;qualificationRevision:number;planId:string;planRevision:number;commercialHash:string;creditConsentId:string;creditVerificationId:string;reviewedAt:Date};
export function safeReviewProjection(value:any){return{status:value?.decision||value?.status||'PENDING',supplementaryInstructions:value?.decision==='NEEDS_INFO'||value?.status==='NEEDS_INFO'?value.supplementaryInstructions||'':''};}
export function canonicalHash(value:any):string{
 const normalize=(v:any):any=>v instanceof Date?v.toISOString():Array.isArray(v)?v.map(normalize):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,normalize(v[k])])):v;
 return hash(normalize(value));
}
export async function requireRiskOperator(tx:any,actor:ReviewActor,resource='customers'){
 await requireCurrentStaff(tx,actor,resource);ensure(['ADMIN','OPERATIONS'].includes(actor.role),403,'FORBIDDEN','仅管理员或运营可读取及审核资格与风险资料');
}
