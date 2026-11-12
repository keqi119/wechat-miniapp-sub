import {ensure} from '../common/errors';

export type VehicleRestrictionScope='ALLOCATION'|'DELIVERY';
/** Read-only gate. Mutation callers hold the actual Vehicle row lock first. */
export async function hasVehicleRestriction(db:any,vehicleId:string,scope:VehicleRestrictionScope):Promise<boolean>{
 return await db.vehicleOperationalRestriction.count({where:{vehicleId,status:'ACTIVE',scopes:{has:scope}}})>0;
}
/** Public callers receive no work-order, accident, supplier or financial facts. */
export async function requireVehicleUnrestricted(db:any,vehicleId:string,scope:VehicleRestrictionScope){
 ensure(!await hasVehicleRestriction(db,vehicleId,scope),409,scope==='ALLOCATION'?'VEHICLE_ALLOCATION_RESTRICTED':'VEHICLE_DELIVERY_RESTRICTED',scope==='ALLOCATION'?'车辆暂不可申请或预留，请重新选择车辆':'车辆暂不可交付，请先由运营核对车辆状态');
}
