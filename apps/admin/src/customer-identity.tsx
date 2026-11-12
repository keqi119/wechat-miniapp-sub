import {date} from './core';
import {customerIdentityColumnVisible,customerIdentityDisplay} from './customer-identity-model';
export {customerIdentityColumnVisible} from './customer-identity-model';

export function CustomerIdentityCell({identity,column,role}:{identity:unknown;column:string;role?:string}){
 if(!customerIdentityColumnVisible(column,role))return null;
 const value=customerIdentityDisplay(identity);
 return column==='identity.status'?<span className={'status '+(value.verified?'green':'neutral')}><i/>{value.status}</span>:<>{value.name||'—'}</>;
}
export function CustomerIdentityPanel({identity,role}:{identity:unknown;role?:string}){
 if(!customerIdentityColumnVisible('identity.status',role))return null;
 const value=customerIdentityDisplay(identity);
 return <section className="domain-section" aria-label="客户实名认证"><h3>实名认证</h3><dl className="domain-facts"><div><dt>认证状态</dt><dd><CustomerIdentityCell identity={identity} column="identity.status" role={role}/></dd></div><div><dt>认证姓名</dt><dd>{value.name||'—'}</dd></div><div><dt>身份证号</dt><dd>{value.maskedIdCardNo||'—'}</dd></div><div><dt>认证时间</dt><dd>{date(value.verifiedAt)}</dd></div></dl><p>实名认证与身份、驾驶资格审核分别办理。</p></section>;
}
