import {isPrivateField} from './core.ts';
export function visibleBusinessField(key:string,resource?:string){
 if(isPrivateField(key))return false;
 if(['technical-acceptances','esign-approvals'].includes(resource||''))return true;
 return !/hash$|^sha256$|^idempotencyKey$/i.test(key);
}
