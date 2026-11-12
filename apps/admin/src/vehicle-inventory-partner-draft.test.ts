import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from './partner-simple-model.ts';
test('pending UI projection consumes only owner scoped pending entries and excludes current duplicates',()=>{
 const active={id:'active'},pending={id:'pending',plateNumber:'沪合成待补'},owner={id:'p',vehicles:[{ownerId:'p',vehicleId:'active',active:true,vehicle:active}],pendingVehicles:[{ownerId:'p',vehicleId:'pending',active:false,status:'DRAFT',vehicle:pending,agreements:[{id:'a',title:'合成草稿'}]},{ownerId:'p',vehicleId:'pending',active:false,status:'DRAFT',vehicle:pending},{ownerId:'p',vehicleId:'active',active:false,status:'DRAFT',vehicle:active},{ownerId:'q',vehicleId:'other',active:false,status:'DRAFT',vehicle:{id:'other'}},{ownerId:'p',vehicleId:'stopped',active:false,status:'STOPPED',vehicle:{id:'stopped'}}]};
 const read=(model as any).pendingPartnerVehicles;assert.equal(typeof read,'function');const result=read(owner);assert.equal(result.length,1);assert.equal(result[0].vehicle.id,'pending');assert.equal(result[0].agreements[0].id,'a');
 assert.deepEqual(read({...owner,pendingVehicles:undefined}),[]);assert.deepEqual(read({...owner,pendingVehicles:[],vehicleAssignments:[{vehicleId:'other'}],agreements:[{latestVersion:{vehicleIds:['other']}}]}),[]);
});
