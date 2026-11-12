import {z} from 'zod';
const text=z.string().trim().min(1).max(1000),id=z.string().trim().min(1).max(128),digest=z.string().regex(/^[a-f0-9]{64}$/);
const evidence=z.array(id).min(1).max(30);
export const customerBaasInput=z.discriminatedUnion('disposition',[
 z.object({disposition:z.literal('INCLUDED')}).strict(),
 z.object({disposition:z.literal('NOT_APPLICABLE')}).strict(),
 z.object({disposition:z.literal('SEPARATE'),amount:z.number().int().positive().max(2147483647),period:z.enum(['MONTH','TERM']),recipient:text}).strict()
]);
export const enterpriseContractProfileInput=z.object({serviceContactName:text,serviceContactChannel:text,serviceContactEmail:z.email().optional(),signerAuthorityRole:z.enum(['LEGAL_REPRESENTATIVE','AUTHORIZED_REPRESENTATIVE']),authorityEvidenceFileIds:evidence.optional(),authorityScope:text.optional()}).strict().refine(v=>v.signerAuthorityRole!=='AUTHORIZED_REPRESENTATIVE'||!!v.authorityEvidenceFileIds?.length&&!!v.authorityScope,'授权代表须有真实权限范围及核验凭证');
export const cooperationSourcesInput=z.object({
 virtualAcceptanceScopeId:id.optional(),
 productDepositRules:z.array(z.object({productVersionId:id,rule:z.discriminatedUnion('kind',[z.object({kind:z.literal('CREDIT_POLICY'),policyVersion:z.literal('ZHIMA_MANUAL_V1')}).strict(),z.object({kind:z.literal('FIXED'),amount:z.number().int().min(0).max(2147483647)}).strict()])}).strict()).min(1).max(500).optional(),
 vehicleScopes:z.array(z.object({vehicleId:id,validFrom:z.iso.date(),validUntil:z.iso.date(),authorityEvidenceFileIds:z.array(id).max(30),rightsRestrictions:z.discriminatedUnion('status',[z.object({status:z.literal('NONE'),evidenceFileIds:evidence}).strict(),z.object({status:z.literal('DISCLOSED'),description:text,evidenceFileIds:evidence}).strict(),z.object({status:z.literal('UNKNOWN')}).strict(),z.object({status:z.literal('NOT_APPLICABLE')}).strict()]),insuranceArrangement:z.object({description:text,evidenceFileIds:evidence}).strict().optional()}).strict().refine(v=>v.validFrom<=v.validUntil,'车辆适用期间无效')).min(1).max(500).refine(v=>new Set(v.map(r=>r.vehicleId)).size===v.length,'车辆重复'),
 productVersionIds:z.array(id).min(1).max(500).refine(v=>new Set(v).size===v.length,'产品重复'),
 templateRefs:z.array(z.object({id,hash:digest}).strict()).min(1).max(30),
 exceptions:z.array(z.object({description:text,evidenceFileIds:evidence,confirmedBy:id}).strict()).min(1).max(30).optional()
}).strict().refine(v=>!v.productDepositRules||(v.productDepositRules.length===v.productVersionIds.length&&new Set(v.productDepositRules.map(r=>r.productVersionId)).size===v.productVersionIds.length&&v.productDepositRules.every(r=>v.productVersionIds.includes(r.productVersionId))),'押金规则须完整且唯一覆盖获准产品').refine(v=>v.virtualAcceptanceScopeId? v.vehicleScopes.length===1&&v.vehicleScopes[0].rightsRestrictions.status==='NOT_APPLICABLE'&&v.vehicleScopes[0].authorityEvidenceFileIds.length===0&&!v.vehicleScopes[0].insuranceArrangement : v.vehicleScopes.every(s=>s.authorityEvidenceFileIds.length>0&&s.rightsRestrictions.status!=='NOT_APPLICABLE'),'虚拟事实仅适用于明确绑定范围，真实车辆须保留权属证据');
export const V31_DEPOSIT_CREDIT_POLICY={version:'ZHIMA_MANUAL_V1',monthlyFeeMultipliers:{GE750:0,B700_749:1,B650_699:2},ineligibleBands:['LT650','UNVERIFIABLE']} as const;
export type V31Context={kind:import('../electronic-documents/types').ElectronicDocumentKind;resourceId:string;revision:number;businessHash:string};
export type V31SourceIds={ownerId:string;cooperationVersionId?:string;customerId?:string;vehicleId?:string;productVersionId?:string;platformSubjectId?:string};
export type MissingField={field:string;reason:string;maintenancePath:string;sourceResource:{type:string;id:string|null};maintenanceKey:string;route:string};
export const V31_COOPERATION_CALENDAR={version:'NINDA_V31_20261107',provenance:{source:'USER_CONFIRMED',confirmedDate:'2026-11-07',reference:'docs/superpowers/specs/2026-11-07-ninda-v31-contract-autofill-design.md'},period:'NATURAL_MONTH',statementNextMonthWorkday:5,objectionDaysAfterReceipt:5,paymentNextMonthWorkday:15,topupWorkdays:2,topupNoLaterThanCustomerRefundDeadline:true,distributedProfitRefundWorkdays:3,invoiceWorkdaysAfterCompleteInformation:10} as const;
