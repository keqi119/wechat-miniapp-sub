import test from 'node:test';
import assert from 'node:assert/strict';
import {readAdminVehicles,readAdminVehicle} from '../src/vehicles/admin-query';

function fixture(profile:any,role='OPERATIONS'){
 const actor={id:'ledger-battery-local',role,authVersion:2};
 const row:any={id:'local-vehicle',title:'不能从75kWh车型名称推断容量',status:'RESERVED',vin:'LOCALVIN000000001',plateNumber:null,revision:4,year:2024,modelDefinition:{modelYear:2025},assetProfile:profile};
 const tx:any={adminUser:{findUnique:async()=>({...actor,active:true})},
 vehicle:{findMany:async()=>[row],count:async()=>1,findUnique:async()=>row},
 partnerAgreement:{findMany:async()=>[]},partnerAgreementVehicle:{findUnique:async()=>null},ownerVehicle:{findUnique:async()=>null}};
 return{actor,row,tx};
}
test('ledger exposes registered battery precision and actual lifecycle without inference',async()=>{
 const f=fixture({batteryCapacityKwh:{toString:()=> '75.125'},batteryOwnership:'BAAS',registeredOwnerName:null,firstRegistrationDate:null});
 const value=(await readAdminVehicles(f.tx,f.actor,{})).items[0];
 assert.equal(value.batteryCapacityKwh,'75.125');assert.equal(value.batteryOwnership,'BAAS');assert.equal(value.status,'RESERVED');
 const detail=await readAdminVehicle(f.tx,f.actor,f.row.id);assert.equal(detail.batteryCapacityKwh,'75.125');
});
test('no profile and incomplete profile remain explicitly unknown',async()=>{
 for(const profile of [null,{batteryCapacityKwh:null,batteryOwnership:'UNKNOWN'}]){
  const f=fixture(profile);const value=(await readAdminVehicles(f.tx,f.actor,{})).items[0];
  assert.equal(value.batteryCapacityKwh,null);assert.equal(value.batteryOwnership,'UNKNOWN');
 }
});
test('battery asset facts remain outside limited-role vehicle projection',async()=>{
 const f=fixture({batteryCapacityKwh:'100.000',batteryOwnership:'OWNED'},'SUPPORT');
 // Production query does not include this relation for a limited role; emulate that shape.
 delete f.row.assetProfile;delete f.row.modelDefinition;
 const value=(await readAdminVehicles(f.tx,f.actor,{})).items[0];
 assert.equal(Object.hasOwn(value,'batteryCapacityKwh'),false);assert.equal(Object.hasOwn(value,'batteryOwnership'),false);
});
