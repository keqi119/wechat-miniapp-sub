import {z} from 'zod';
import {hash,money} from '../common/data';
import {ensure} from '../common/errors';
import {platformLegalEntity} from '../common/platform-legal-entity';
import {platformOwnerScope} from './platform-scope';
import {canonicalHash} from '../customers/types';
// Keep the v1 field order and validation unchanged: existing JSONB grants use this digest.
export const ownerScopeV1=z.object({version:z.literal(1),vehicleIds:z.array(z.string().min(1).max(100)).min(1).max(100),templateId:z.string().min(1).max(100),templateVersion:z.number().int().positive(),templateHash:z.string().regex(/^[a-f0-9]{64}$/),validFrom:z.string().datetime(),validUntil:z.string().datetime(),minMonthlyFeeAmount:money,maxMonthlyFeeAmount:money,minDepositAmount:money,maxDepositAmount:money,minMonths:z.number().int().min(1).max(60),maxMonths:z.number().int().min(1).max(60)}).strict().refine(s=>new Set(s.vehicleIds).size===s.vehicleIds.length&&Date.parse(s.validFrom)<Date.parse(s.validUntil)&&s.minMonthlyFeeAmount<=s.maxMonthlyFeeAmount&&s.minDepositAmount<=s.maxDepositAmount&&s.minMonths<=s.maxMonths,'授权范围无效');
const delegateSchema=z.object({id:z.literal('PLATFORM_OPERATOR'),name:z.string().min(2).max(100)}).strict();
export const ownerScopeV2=z.object({version:z.literal(2),validFrom:z.string().datetime(),validUntil:z.string().datetime(),delegates:z.array(delegateSchema).length(1),documentKinds:z.array(z.literal('SUBSCRIPTION_WITH_FEES')).length(1)}).strict().refine(s=>Date.parse(s.validFrom)<Date.parse(s.validUntil),'授权期间无效');
export const ownerScope=z.union([ownerScopeV1,ownerScopeV2]);
export type OwnerScope=z.infer<typeof ownerScope>;
export function ownerAuthorizationScopeVersion():1|2|3{const version=process.env.OWNER_AUTHORIZATION_SCOPE_VERSION??'1';ensure(['1','2','3'].includes(version),503,'OWNER_SCOPE_VERSION_CONFIG','用印授权版本配置无效');return Number(version) as 1|2|3;}
export function ownerAuthorizationDelegate(){return{id:'PLATFORM_OPERATOR' as const,name:platformLegalEntity()};}
export function currentOwnerDelegate(value:unknown){const parsed=delegateSchema.safeParse(value);return parsed.success&&parsed.data.name===platformLegalEntity();}
export function canonicalOwnerScope(value:unknown){const scope=ownerScope.parse(value);if(scope.version===1)scope.vehicleIds.sort();return scope;}
// PostgreSQL JSONB reorders object keys; hash the validated canonical field order.
export function ownerScopeHash(value:unknown){return (value as any)?.version===3?canonicalHash(platformOwnerScope.parse(value)):hash(canonicalOwnerScope(value));}
export interface SigningFacts {ownerId:string;sealId:string;certificateSerialNo:string;ownerVerified:boolean;memberVerified:boolean;certificateValid:boolean;sealCurrent:boolean;identityCheckedAt:Date|null;kind:string;vehicleId:string;templateId:string;templateVersion:number;templateHash:string;monthlyFeeAmount:number;depositAmount:number;months:number;customerSigned:boolean;reviewed:boolean;delegate?:unknown;documentKind?:string;templateType?:string;templateVerified?:boolean;vehicleOwnershipApproved?:boolean;authority:{method?:string;ownerId:string;sealId:string;certificateSerialNo:string;enabled:boolean;status:string;providerAuthorized:boolean;providerCheckedAt:Date|null;scope:unknown}|null;}
export function evaluateOwnerSigning(f:SigningFacts,now=new Date()):{decision:'BLOCKED'|'MANUAL_REQUIRED'|'AUTO_ALLOWED';reason:string}{
 const recent=(date:Date|null,ms:number)=>!!date&&date.getTime()<=now.getTime()&&now.getTime()-date.getTime()<ms;
 if(!f.ownerVerified||!f.memberVerified||!f.certificateValid||!f.sealCurrent||!recent(f.identityCheckedAt,86400000))return{decision:'BLOCKED',reason:'OWNER_IDENTITY_NOT_READY'};
 const manual=(reason:string)=>({decision:'MANUAL_REQUIRED' as const,reason}),a=f.authority;
 if(a?.method==='UNILATERAL_LETTER')return manual('CHANNEL_AUTHORIZATION_REQUIRED');
 if(!a?.enabled||a.status!=='AUTHORIZED')return manual('MANUAL_DEFAULT');
 if(a.ownerId!==f.ownerId||a.sealId!==f.sealId||a.certificateSerialNo!==f.certificateSerialNo)return manual('AUTHORITY_IDENTITY_CHANGED');
 if(!a.providerAuthorized||!recent(a.providerCheckedAt,60000))return manual('PROVIDER_AUTHORITY_NOT_CURRENT');
 if(f.kind!=='SUBSCRIPTION')return manual('MAIN_CONTRACT_ONLY');
 if(!f.customerSigned||!f.reviewed)return manual('CUSTOMER_SIGNATURE_OR_REVIEW_PENDING');
 const parsed=ownerScope.safeParse(a.scope);if(!parsed.success)return manual('INVALID_SCOPE');const s=parsed.data;
 if(Date.parse(s.validFrom)>now.getTime()||Date.parse(s.validUntil)<=now.getTime())return manual('SCOPE_EXPIRED');
 if(s.version===2){
  if(!currentOwnerDelegate(f.delegate)||!s.delegates.every(currentOwnerDelegate))return manual('DELEGATE_OUTSIDE_SCOPE');
  if(f.documentKind!=='SUBSCRIPTION_WITH_FEES'||!s.documentKinds.includes(f.documentKind)||f.templateType!=='owner-rental-contract')return manual('DOCUMENT_KIND_OUTSIDE_SCOPE');
  if(!f.vehicleOwnershipApproved||!f.templateVerified)return manual('ORDER_EVIDENCE_NOT_CURRENT');
  if(![f.monthlyFeeAmount,f.depositAmount,f.months].every(Number.isSafeInteger)||f.monthlyFeeAmount<0||f.depositAmount<0||f.months<1)return manual('ORDER_TERMS_INVALID');
  return{decision:'AUTO_ALLOWED',reason:'WITHIN_VERIFIED_SCOPE'};
 }
 if(!s.vehicleIds.includes(f.vehicleId)||s.templateId!==f.templateId||s.templateVersion!==f.templateVersion||s.templateHash!==f.templateHash)return manual('VEHICLE_OR_TEMPLATE_OUTSIDE_SCOPE');
 if(![f.monthlyFeeAmount,f.depositAmount,f.months].every(Number.isSafeInteger)||f.monthlyFeeAmount<s.minMonthlyFeeAmount||f.monthlyFeeAmount>s.maxMonthlyFeeAmount||f.depositAmount<s.minDepositAmount||f.depositAmount>s.maxDepositAmount||f.months<s.minMonths||f.months>s.maxMonths)return manual('PRICE_OR_TERM_OUTSIDE_SCOPE');
 return{decision:'AUTO_ALLOWED',reason:'WITHIN_VERIFIED_SCOPE'};
}
