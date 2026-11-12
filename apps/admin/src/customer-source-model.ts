export type CustomerSource={customerId:string;sourceChannel:string|null;sourceRevision:number};
export function customerSourceAccess(role:string|undefined,permissions:string[]){const read=['ADMIN','OPERATIONS'].includes(role||'')&&(permissions.includes('*')||permissions.includes('customers.read'));return{read,write:read&&(permissions.includes('*')||permissions.includes('customers.write'))};}
export function customerSourcePayload(values:Record<string,unknown>,sourceRevision:number){
 const sourceChannel=String(values.sourceChannel??'').trim(),reason=String(values.reason??'').trim();
 if(!Number.isInteger(sourceRevision)||sourceRevision<0||sourceRevision>2147483647)throw new Error('请先重新读取客户来源版本');
 if(values.clearSource!==true&&(!sourceChannel||sourceChannel.length>64||sourceChannel.includes('\0')))throw new Error('来源名称须为1至64字；清除时请明确勾选');
 if(!reason||reason.length>1000||reason.includes('\0'))throw new Error('请填写修改原因，最多1000字');
 return{sourceChannel:values.clearSource===true?null:sourceChannel,sourceRevision,reason};
}
