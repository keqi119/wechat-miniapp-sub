import {ensure} from './errors';

type Environment=Record<string,string|undefined>;
const legacyDevelopmentEntity='上海晓浪网络科技有限公司';
export const NINDA_PLATFORM_LEGAL_ENTITY='上海宁达信息科技有限公司';
export function explicitPlatformLegalEntity(env:Environment=process.env){return env.NODE_ENV==='production'||env.PLATFORM_LEGAL_ENTITY_NAME!==undefined;}
export function platformLegalEntity(env:Environment=process.env){
 const name=env.PLATFORM_LEGAL_ENTITY_NAME??(env.NODE_ENV==='production'?'':NINDA_PLATFORM_LEGAL_ENTITY);
 ensure(name===name.trim()&&name.length>=2&&name.length<=100&&!/[\x00-\x1f\x7f{}]|待确认|待补齐|待填写/.test(name),503,'PLATFORM_LEGAL_ENTITY_INVALID','生产平台法定主体名称必须明确配置');
 return name;
}
export function assertPlatformDocumentEntity(content:string,env:Environment=process.env){
 const name=platformLegalEntity(env);
 // Published text is immutable: changing deployment identity must not silently
 // relabel a previously approved company's document or its signing history.
 if(explicitPlatformLegalEntity(env))ensure(typeof content==='string'&&content.includes(name)&&(name===legacyDevelopmentEntity||!content.includes(legacyDevelopmentEntity)),409,'LEGAL_ENTITY_MISMATCH','签署正文与当前平台法定主体不一致，请审定发布对应主体的正式文案');
 return name;
}
export function assertPlatformApprovalEntity(plan:any,env:Environment=process.env){
 if(explicitPlatformLegalEntity(env))ensure(plan?.platformLegalEntityName===platformLegalEntity(env),409,'LEGAL_ENTITY_MISMATCH','现有签署复核未绑定当前平台法定主体，不可复用原文档或授权');
}
