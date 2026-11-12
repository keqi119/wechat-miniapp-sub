import {z} from 'zod';
import {canonicalHash as hash} from '../customers/types';
import {ensure} from '../common/errors';

export const PLATFORM_SIGNING_GRANTEE={id:'XIAOLANG_NETWORK_TECHNOLOGY',name:'上海晓浪网络科技有限公司'} as const;
// A new business kind needs an explicit policy revision and its own approved workflow/template.
export const platformAutoDocumentKinds=['SUBSCRIPTION','DELIVERY_DELAY','VEHICLE_SWAP','RENEWAL','PRE_DELIVERY_CANCELLATION','EARLY_TERMINATION','RETURN_SETTLEMENT','RENEWAL_CANCELLATION','COOPERATION','COOPERATION_AMENDMENT','COOPERATION_TERMINATION'] as const;
const id=z.string().trim().min(1).max(200),digest=z.string().regex(/^[a-f0-9]{64}$/);
export const platformOwnerScope=z.object({version:z.literal(3),purpose:z.literal('PLATFORM_CONTRACT_SIGNING'),platformSubjectId:id,grantorSubjectId:id,granteeSubjectId:z.literal(PLATFORM_SIGNING_GRANTEE.id),granteeName:z.literal(PLATFORM_SIGNING_GRANTEE.name),applicationBinding:digest}).strict();
export type PlatformOwnerScope=z.infer<typeof platformOwnerScope>;
export function platformApplicationBinding(env:NodeJS.ProcessEnv=process.env){
 ensure(env.FADADA_APP_ID?.trim()&&env.FADADA_BASE_URL?.trim(),503,'PLATFORM_AUTH_APPLICATION','企业授权渠道尚未配置');
 return hash({provider:'FADADA_API2',appId:env.FADADA_APP_ID!.trim(),baseUrl:env.FADADA_BASE_URL!.trim().replace(/\/+$/,'')});
}
export function platformScope(platformSubjectId:string,grantorSubjectId:string,applicationBinding=platformApplicationBinding()):PlatformOwnerScope{
 return platformOwnerScope.parse({version:3,purpose:'PLATFORM_CONTRACT_SIGNING',platformSubjectId,grantorSubjectId,granteeSubjectId:PLATFORM_SIGNING_GRANTEE.id,granteeName:PLATFORM_SIGNING_GRANTEE.name,applicationBinding});
}
