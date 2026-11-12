import {ensure} from '../common/errors';

export type CustomerIdentityPolicy='MANUAL_REVIEW'|'PROVIDER_REQUIRED'|'SIGNING_REQUIRED';
/** An absent setting preserves the historical provider gate; typos never relax it. */
export function customerIdentityPolicy(env:NodeJS.ProcessEnv=process.env):CustomerIdentityPolicy{
 const value=env.CUSTOMER_IDENTITY_POLICY;
 if(value===undefined)return 'PROVIDER_REQUIRED';
 if(value==='MANUAL_REVIEW'||value==='PROVIDER_REQUIRED'||value==='SIGNING_REQUIRED')return value;
 throw new Error('CUSTOMER_IDENTITY_POLICY配置无效');
}
export function requireProviderIdentity(){
 ensure(customerIdentityPolicy()!=='MANUAL_REVIEW',503,'CUSTOMER_IDENTITY_UNAVAILABLE','线上实名认证已暂停，请上传资料后等待运营审核');
}
