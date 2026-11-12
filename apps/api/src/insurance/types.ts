import {z} from 'zod';
import type {InsurancePolicy,InsurancePolicyVersion,InsurancePolicyFile,CoverageRequirementVersion,StoredFile,Prisma} from '@prisma/client';
import type {StaffActor} from '../auth/staff.types';
import type {GateResult} from '../mvp-domain-types';
import {key,money,text} from '../common/data';
export type InsuranceActor=StaffActor;
export type InsuranceTx=Prisma.TransactionClient;
const uniqueIds=z.array(text).max(1000).refine(ids=>new Set(ids).size===ids.length,'编号不可重复');
export const commandInput=z.object({revision:z.number().int().nonnegative(),idempotencyKey:key}).strict();
export const coverageItemInput=z.object({code:text,label:text,amount:money.nullable(),deductible:text,terms:z.string().trim().min(1).max(5000)}).strict();
export const requirementItemInput=z.object({code:text,label:text,description:z.string().trim().min(1).max(5000),minAmount:money.nullable().default(null),deductibleReview:z.string().trim().max(5000).default(''),exclusionReview:z.string().trim().max(5000).default('')}).strict();
export const reviewCheckInput=z.object({vehicleId:text,requirementVersionId:text,itemCode:text,fileId:text,confirmed:z.literal(true),note:z.string().trim().min(1).max(2000)}).strict();
// Keep the legacy shape first: successful historical command hashes must remain byte-for-byte compatible.
export const policyReviewCheckInput=z.union([reviewCheckInput,z.object({vehicleId:text,fileId:text,confirmed:z.literal(true),note:z.string().trim().min(1).max(2000)}).strict()]);
const timestamp=z.string().refine(value=>/^\d{4}-\d{2}-\d{2}$/.test(value)||z.iso.datetime({offset:true}).safeParse(value).success,'须明确北京时间日期或带时区的ISO时间');
export const policyDraftInput=commandInput.extend({insurer:text,policyNumber:text,policyholder:text,insuredParty:text,vehicleIds:uniqueIds.refine(ids=>ids.length>0,'至少一辆被保车辆'),coverageItems:z.array(coverageItemInput).min(1).max(100).refine(items=>new Set(items.map(i=>i.code)).size===items.length,'险种代码不可重复'),premiumAmount:money.nullable().default(null),terms:z.string().trim().min(1).max(10000),startAt:timestamp,endAt:timestamp,effectiveAt:timestamp,fileIds:uniqueIds.default([]),requirementVersionIds:uniqueIds.default([]),changeKind:z.enum(['ORIGINAL','ENDORSEMENT','CANCELLATION']).default('ORIGINAL')}).strict();
export const reviewInput=z.discriminatedUnion('decision',[
 commandInput.extend({decision:z.literal('APPROVED'),checks:z.array(policyReviewCheckInput).max(5000),reason:text}).strict(),
 commandInput.extend({decision:z.literal('REJECTED'),checks:z.array(policyReviewCheckInput).max(0).default([]),reason:text}).strict()
]);
export const requirementInput=commandInput.extend({scopeType:z.enum(['MODEL','PRODUCT']),scopeId:text,effectiveAt:timestamp,items:z.array(requirementItemInput).min(1).max(100).refine(items=>new Set(items.map(i=>i.code)).size===items.length,'要求代码不可重复')}).strict();
export const uploadInput=commandInput.extend({vehicleIds:uniqueIds.refine(ids=>ids.length>0)}).strict();
export type PolicyDraftInput=z.input<typeof policyDraftInput>;
export type ReviewInput=z.input<typeof reviewInput>;
export type CommandInput=z.infer<typeof commandInput>;
export type RequirementInput=z.input<typeof requirementInput>;
export type CoverageItem=z.infer<typeof coverageItemInput>;
export type RequirementItem=z.infer<typeof requirementItemInput>;
export type ReviewCheck=z.infer<typeof reviewCheckInput>;
export type InsurancePolicyView=InsurancePolicy&{versions:InsurancePolicyVersion[];files:InsurancePolicyFile[];accidentServices?:{id:string;orderId:string;status:string;createdAt:Date}[]};
export type CoverageResult=GateResult&{policyVersionIds:string[];requirementIds:string[]};
export type PolicyFileView=Pick<StoredFile,'id'|'name'|'mimeType'|'size'>&{policyId:string;vehicleIds:string[];revision:number};
export type CoverageRequirementView={id:string;scopeType:string;scopeId:string;revision:number;versions:CoverageRequirementVersion[]};
export type PolicyPage={items:InsurancePolicyView[];total:number;page:number;pageSize:number};
export type InsuranceFileFact=Pick<StoredFile,'id'|'adminId'|'customerId'|'purpose'|'mimeType'|'size'|'sha256'>;
export type InsuranceFileBinding=Pick<InsurancePolicyFile,'fileId'|'policyId'|'vehicleIds'|'uploadedBy'>;
export type ReminderCandidate={vehicleId:string;policyId:string;policyVersionId:string;thresholdDays:number;dueAt:Date};
export type PageQuery={page?:string;pageSize?:string;vehicleId?:string;status?:string;search?:string;policyType?:string;expiringWithinDays?:string};
