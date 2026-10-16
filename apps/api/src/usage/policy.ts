import { Prisma } from '@prisma/client';
import { hash } from '../common/data';
import { ensure } from '../common/errors';
export const usageRules={policyVersion:'USAGE_V1',timezone:'Asia/Shanghai',monthBoundary:'ORIGINAL_DAY_CLAMPED_END_EXCLUSIVE',baseAllowanceKm:1500,baseCarry:false,baseFirst:true,excessPriceAmount:150,packCarry:'SUBSCRIPTION',packRetroactive:'CURRENT_UNSETTLED_ONLY',returnFullBase:true,returnUnusedPack:'EXPIRE_NONREFUNDABLE_WITH_LEGAL_EXCEPTIONS',minimumMonths:12} as const;
export async function snapshotUsagePolicy(tx:Prisma.TransactionClient){
 const doc=await tx.legalDocument.findFirst({where:{type:'usage-policy',status:'PUBLISHED',confirmedAt:{not:null},confirmedBy:{not:null}},orderBy:{version:'desc'}});
 ensure(doc&&doc.content?.trim(),409,'USAGE_POLICY_UNPUBLISHED','订阅里程与退订规则须先批准发布，才能出具正式方案');
 return {...usageRules,documentId:doc.id,documentVersion:doc.version,hash:hash(doc.content),content:doc.content};
}
export function usagePolicyAppendix(policy:any){
 ensure(policy&&Object.entries(usageRules).every(([k,v])=>policy[k]===v)&&typeof policy.documentId==='string'&&Number.isInteger(policy.documentVersion)&&typeof policy.content==='string'&&policy.content.trim()&&policy.hash===hash(policy.content),409,'USAGE_POLICY','已确认的里程规则附件不完整或已变化');
 return `\n\n订阅里程与退订规则附件（版本 ${policy.documentVersion}；文档 ${policy.documentId}；SHA-256 ${policy.hash}）\n\n${policy.content}`;
}
