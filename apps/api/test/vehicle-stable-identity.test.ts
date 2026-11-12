import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as commands from '../src/vehicles/commands';
const vin='LNDTEST0000000001';
const errorCode=(code:string)=>(e:any)=>e.getResponse?.().error?.code===code;
test('vehicle creation requires VIN and later edits cannot replace or clear that identity',()=>{
 const validate=(commands as any).validateVehicleIdentity;assert.equal(typeof validate,'function');
 assert.throws(()=>validate(null,{title:'Vehicle'}),errorCode('VIN_INVALID'));
 assert.doesNotThrow(()=>validate(null,{vin}));
 const vehicle={id:'stable-car',vin,plateNumber:'沪A00001',reservedOrderId:null,holdId:null};
 assert.throws(()=>validate(vehicle,{vin:'LNDTEST0000000002'}),errorCode('VIN_IMMUTABLE'));
 assert.throws(()=>validate(vehicle,{vin:null}),errorCode('VIN_INVALID'));
 assert.doesNotThrow(()=>validate(vehicle,{vin:' '+vin.toLowerCase()+' '}));
 assert.throws(()=>validate(vehicle,{plateNumber:'沪B00002'}),errorCode('PLATE_BINDING_REQUIRED'));assert.doesNotThrow(()=>validate(vehicle,{plateNumber:'沪A00001'}));assert.equal(vehicle.id,'stable-car');assert.equal(vehicle.vin,vin);
});
test('a reserved vehicle requires the dedicated plate workflow and retains its commercial metadata lock',()=>{
 const validate=(commands as any).validateVehicleIdentity;assert.equal(typeof validate,'function');
 const vehicle={id:'stable-car',vin,plateNumber:'沪A00001',reservedOrderId:'order-1',title:'蔚来 ET5',mileageKm:1000,mediaFileIds:[]};
 assert.throws(()=>validate(vehicle,{plateNumber:'沪B00002',title:'蔚来 ET5',mileageKm:1000,mediaFileIds:[]}),errorCode('PLATE_BINDING_REQUIRED'));
 assert.doesNotThrow(()=>validate(vehicle,{plateNumber:'沪A00001',title:'蔚来 ET5',mileageKm:1000,mediaFileIds:[]}));
 assert.throws(()=>validate(vehicle,{plateNumber:'沪A00001',mileageKm:0}),errorCode('VEHICLE_RESERVED'));
 assert.throws(()=>validate(vehicle,{title:'另一辆车'}),errorCode('VEHICLE_RESERVED'));
});
