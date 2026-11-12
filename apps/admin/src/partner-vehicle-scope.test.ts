import test from 'node:test';
import assert from 'node:assert/strict';
import {currentPartnerVehicles,simpleAgreementBody} from './partner-simple-model.ts';
test('current cooperation uses only effective same-owner bindings, not global assignments or historic version membership',()=>{
 const inventory=[{id:'own',plateNumber:'沪自有'},{id:'other',plateNumber:'沪其他'}];
 const owner={id:'p',vehicles:[{ownerId:'p',vehicleId:'own',active:true},{ownerId:'other',vehicleId:'other',active:true},{ownerId:'p',vehicleId:'expired',active:false},{ownerId:'p',vehicleId:'unknown',active:'true'}],vehicleAssignments:[{vehicleId:'other',active:true}],agreements:[{status:'ACTIVE',currentVersion:{vehicleIds:['other']}}]};
 assert.deepEqual(currentPartnerVehicles(owner,inventory),[inventory[0]]);assert.deepEqual(currentPartnerVehicles({...owner,vehicles:[]},inventory),[]);assert.deepEqual(currentPartnerVehicles({...owner,vehicles:undefined},inventory),[]);
});
test('owner-scoped returned vehicle facts do not depend on global inventory loading and replacement proof still uses global conflicts',()=>{
 const vehicle={id:'own',plateNumber:'沪已核验'},owner={id:'p',vehicles:[{ownerId:'p',vehicleId:'own',active:true,vehicle},{ownerId:'p',vehicleId:'own',active:true,vehicle}]};assert.deepEqual(currentPartnerVehicles(owner,[]),[vehicle]);
 const assignments=[{vehicleId:'other',agreementId:'a-other',revision:7,active:true}],values={percentage:'20',fileIds:['f'],vehicleIds:['other']};
 assert.throws(()=>simpleAgreementBody(values,'ACTIVE',null,assignments,[]),/逐车确认/);assert.deepEqual(simpleAgreementBody(values,'ACTIVE',null,assignments,['other']).replacements,[{vehicleId:'other',agreementId:'a-other',revision:7}]);
});
