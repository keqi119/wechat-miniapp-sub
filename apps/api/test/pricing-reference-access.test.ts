import test from 'node:test';
import assert from 'node:assert/strict';
import {allowed, permissions} from '../src/auth/role-policy';
import {readAdminVehicles} from '../src/vehicles/admin-query';

test('pricing references are internal operational/finance data and do not grant product writes',()=>{
 for(const role of ['ADMIN','OPERATIONS','FINANCE']){
  assert.equal(allowed(role,'pricing-reference',false),true);
  assert.equal(allowed(role,'pricing-reference',true),true);
  assert(permissions(role).includes('pricing-reference.read'));
 }
 for(const role of ['SUPPORT','FIELD','unknown'])assert.equal(allowed(role,'pricing-reference',false),false);
 assert.equal(allowed('FINANCE','products',true),false);
});

test('finance gets narrowly projected pricing-selection metadata without broader ledger privileges',async()=>{
 const actor={id:'finance',role:'FINANCE',authVersion:1};
 const tx:any={adminUser:{findUnique:async()=>({...actor,active:true})},vehicle:{
  count:async()=>1,
  findMany:async()=>[{id:'v1',title:'合成车辆',modelDefinitionId:'m1',year:2024,mileageKm:2000,
   modelDefinition:{modelYear:2025},assetProfile:{firstRegistrationDate:new Date('2025-01-01'),registeredOwnerName:'合成登记人',batteryOwnership:'BAAS',batteryCapacityKwh:75}}],
 }};
 const value=await readAdminVehicles(tx,actor,{view:'pricing-selection',page:'1'},new Date('2026-01-01'));
 assert.equal(value.items[0].modelDefinitionId,'m1');
 assert.equal(value.items[0].modelYear,2025);
 assert.equal(value.items[0].batteryOwnership,'BAAS');
 assert.equal(value.items[0].ageMonths,12);
 assert.equal('assetProfile' in value.items[0],false);
 assert.equal('cooperationOwner' in value.items[0],false);
 await assert.rejects(()=>readAdminVehicles(tx,actor,{view:'product-selection'}),(error:any)=>error.response?.error?.code==='FORBIDDEN');
 await assert.rejects(()=>readAdminVehicles(tx,actor,{brand:'合成'}),(error:any)=>error.response?.error?.code==='FORBIDDEN');
});

test('support cannot opt into pricing-selection with a query parameter',async()=>{
 const actor={id:'support',role:'SUPPORT'};
 const tx:any={adminUser:{findUnique:async()=>({...actor,active:true})}};
 await assert.rejects(()=>readAdminVehicles(tx,actor,{view:'pricing-selection'}),(error:any)=>error.response?.error?.code==='FORBIDDEN');
});
