import {ensure} from '../common/errors';
import {canonicalHash} from '../customers/types';
import {newOrderContractMode} from '../offline-documents/mode';
export const VIRTUAL_NOTICE='仅用于实名、电子签、支付与归档验证，不形成真实车辆租赁或交付义务';
export const VIRTUAL_NOTICE_HASH=canonicalHash(VIRTUAL_NOTICE);
export async function readVirtualScope(tx:any,vehicleId:string){
 const vehicle=await tx.vehicle.findUnique({where:{id:vehicleId},include:{virtualAcceptanceScope:true}});
 if(!vehicle?.virtualAcceptanceScopeId)return null;
 ensure(vehicle.virtualAcceptanceScope,409,'VIRTUAL_SCOPE_REQUIRED','虚拟验收范围缺失，禁止进入普通业务');
 return{...vehicle.virtualAcceptanceScope,vehicleId:vehicle.id};
}
export async function requireCurrentVirtualScope(tx:any,input:{vehicleId:string;customerId?:string;applicationId?:string;orderId?:string;action:string},now=new Date()){
 const scope=await readVirtualScope(tx,input.vehicleId);if(!scope)return null;
 ensure(scope.status==='READY'&&scope.expiresAt>now,409,'VIRTUAL_SCOPE_INACTIVE','虚拟验收范围未启用、已到期或已撤销');
 ensure(!input.customerId||input.customerId===scope.customerId,403,'VIRTUAL_CUSTOMER_REQUIRED','此验收入口仅向指定账户开放');
 ensure(!input.applicationId||input.applicationId===scope.applicationId,409,'VIRTUAL_APPLICATION_MISMATCH','申请不在冻结验收范围内');
 ensure(!input.orderId||input.orderId===scope.orderId,409,'VIRTUAL_ORDER_MISMATCH','订单不在冻结验收范围内');
 await (await import('./configuration')).validateVirtualConfiguration(tx,scope);
 return scope;
}
export async function isVirtualVehicle(tx:any,vehicleId:string){return !!(await tx.vehicle.findUnique({where:{id:vehicleId},select:{virtualAcceptanceScopeId:true}}))?.virtualAcceptanceScopeId;}
export async function assertRealVehicle(tx:any,vehicleId:string){ensure(!await isVirtualVehicle(tx,vehicleId),409,'VIRTUAL_DELIVERY_FORBIDDEN',VIRTUAL_NOTICE+'；本验收止于身份、签署、支付与归档。');}
export async function effectiveNewOrderMode(tx:any,input:{vehicleId:string;customerId:string}){return await requireCurrentVirtualScope(tx,{...input,action:'APPLICATION'})?'ELECTRONIC':newOrderContractMode();}
