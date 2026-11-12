import {ensure} from '../common/errors';
export function newOrderChangesEnabled(order:{contractMode?:string},env:NodeJS.ProcessEnv=process.env){return env.MVP_V2_ENABLED!=='true'&&order.contractMode!=='OFFLINE';}
export function requireNewOrderChanges(order:{contractMode?:string}){ensure(newOrderChangesEnabled(order),409,'OFFLINE_CHANGE_UNAVAILABLE','本版订单变更请联系平台人工核对并另行签署线下材料');}
export type ImplementedOrderChange='DELIVERY_DELAY'|'VEHICLE_CHANGE';
/** This permits only the implemented draft entry points; domain guards still apply.
 * The unscoped legacy gate (including new paid-credit payments) stays unchanged. */
export function orderChangeScopeEnabled(order:{contractMode?:string},scope:ImplementedOrderChange,env:NodeJS.ProcessEnv=process.env){
 if(!['DELIVERY_DELAY','VEHICLE_CHANGE'].includes(scope))return false;
 if(order.contractMode==='OFFLINE')return true;
 if(order.contractMode==='ELECTRONIC')return scope==='VEHICLE_CHANGE';
 return (order.contractMode===undefined||order.contractMode==='ESIGN')&&newOrderChangesEnabled(order,env);
}
export function requireOrderChangeScope(order:{contractMode?:string},scope:ImplementedOrderChange){ensure(orderChangeScopeEnabled(order,scope),409,'OFFLINE_CHANGE_UNAVAILABLE','当前订单不支持此变更入口，请核对合同办理方式');}
