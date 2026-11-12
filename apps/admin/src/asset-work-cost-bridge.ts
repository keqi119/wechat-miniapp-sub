import {assetAccess} from './asset-model.ts';

export function costSourceLabel(kind:string){return ({BAAS:'BAAS租金',DEPRECIATION:'折旧',WORK_ORDER:'工单费用'} as Record<string,string>)[kind]||'来源待核对';}
export function costPlanWritable(kind:string,role:string|undefined,permissions:string[]){
 if(!assetAccess('asset-cost-plans',role,permissions).write)return false;
 const source=({BAAS:{roles:['ADMIN','OPERATIONS'],permission:'baas-contracts.write'},DEPRECIATION:{roles:['ADMIN','FINANCE'],permission:'depreciation-policies.write'},WORK_ORDER:{roles:['ADMIN','FINANCE'],permission:'asset-work-order-cost-lines.write'}} as Record<string,{roles:string[];permission:string}>)[kind];
 return !!source&&source.roles.includes(role||'')&&(permissions.includes('*')||permissions.includes(source.permission));
}
