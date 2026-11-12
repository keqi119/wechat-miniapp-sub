import {ensure} from '../common/errors';
export function ownerAuthorizationMethod():'PROVIDER_AUTO_GRANT'|'UNILATERAL_LETTER'{
 const method=process.env.OWNER_AUTHORIZATION_METHOD??'PROVIDER_AUTO_GRANT';
 ensure(method==='PROVIDER_AUTO_GRANT'||method==='UNILATERAL_LETTER',503,'OWNER_AUTHORIZATION_METHOD_CONFIG','企业授权办理方式配置无效');
 return method;
}
