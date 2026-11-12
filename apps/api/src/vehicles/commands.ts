import {z} from 'zod';
import {ensure} from '../common/errors';
import {key} from '../common/data';
import {requireCurrentStaff} from '../auth/staff-session';
import {archiveCommand} from '../offline-documents/command';
import {newOrderContractMode} from '../offline-documents/mode';
export const guardedVehicles=()=>process.env.MVP_V2_ENABLED==='true'||newOrderContractMode()==='OFFLINE';
export function normalizeVin(value:string){const vin=value.trim().toUpperCase();ensure(/^[A-HJ-NPR-Z0-9]{17}$/.test(vin),400,'VIN_INVALID','请填写17位有效车辆识别代号（VIN）');return vin;}
/** The compatibility field is written only by the explicit plate binding ledger. */
export function validateOrdinaryVehiclePlate(previous:any|null,changes:Record<string,any>){
 if(!Object.hasOwn(changes,'plateNumber'))return;
 const next=typeof changes.plateNumber==='string'?changes.plateNumber.trim():changes.plateNumber??'';
 const prior=typeof previous?.plateNumber==='string'?previous.plateNumber.trim():previous?.plateNumber??'';
 ensure(previous?next===prior:next==='',409,'PLATE_BINDING_REQUIRED','请从牌照备案的车辆绑定入口办理车牌变更；新车可先不填车牌');
}
/** VIN identifies the vehicle; a number plate is a changeable attribute. */
export function validateVehicleIdentity(previous:any|null,changes:Record<string,any>){
 validateOrdinaryVehiclePlate(previous,changes);
 if(!previous)normalizeVin(changes.vin||'');
 else if(Object.prototype.hasOwnProperty.call(changes,'vin')){
  const next=normalizeVin(changes.vin||'');
  ensure(!previous.vin||normalizeVin(previous.vin)===next,409,'VIN_IMMUTABLE','VIN是车辆唯一标识，不能通过普通编辑更换；请核对原车辆档案');
 }
 if(previous&&(previous.reservedOrderId||previous.holdId)){
  const plateOnly=Object.entries(changes).every(([key,value])=>key==='plateNumber'||value===undefined||JSON.stringify(value)===JSON.stringify(previous[key]));
  ensure(plateOnly,409,'VEHICLE_RESERVED','订单占用中的车辆仅可更新车牌号，不可修改商业资料');
 }
}
export async function vehicleCommand(tx:any,actor:any,id:string|undefined,action:string,raw:any,operation:()=>Promise<any>){
 await requireCurrentStaff(tx,actor,'vehicles');if(id)await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${id} FOR UPDATE`;
 if(!guardedVehicles()&&!raw?.idempotencyKey){if(action==='CREATE'||action==='UPDATE')validateOrdinaryVehiclePlate(id?await tx.vehicle.findUnique({where:{id}}):null,raw||{});return operation();}
 const command=z.object({revision:z.number().int().nonnegative(),idempotencyKey:key}).passthrough().parse(raw);
 return archiveCommand(tx,actor,id||'NEW_VEHICLE',`VEHICLE_${action}`,command,async()=>{const current=id?await tx.vehicle.findUnique({where:{id}}):null;ensure(!id||current,404,'NOT_FOUND','车辆不存在');ensure(command.revision===(current?.revision||0),409,'REVISION_CONFLICT','车辆资料已变化，请刷新后核对');if(action==='CREATE'||action==='UPDATE')validateOrdinaryVehiclePlate(current,raw||{});return operation();});
}
