import test from 'node:test';
import assert from 'node:assert/strict';
import {readAdminVehicles,readVehicleFilterOptions,vehicleAgeMonths} from '../src/vehicles/admin-query';
const actor={id:'operator',role:'OPERATIONS',authVersion:1};
function fixture(){const calls:any[]=[];const tx:any={adminUser:{findUnique:async()=>({...actor,active:true})},vehicle:{findMany:async(q:any)=>{calls.push(q);return[];},count:async(q:any)=>{calls.push(q);return 0;}},partnerAgreementVehicle:{findMany:async()=>[]},ownerVehicle:{findMany:async()=>[]}};return{tx,calls};}
test('ledger battery, age, mileage and status compose in one server where used for page and total',async()=>{
 const f=fixture();await readAdminVehicles(f.tx,actor,{batteryOwnership:'BAAS',ageMonthsMin:'0',ageMonthsMax:'12',mileageKmMin:'0',mileageKmMax:'10000',status:'IN_USE',page:'2',pageSize:'1'},new Date('2026-11-04T16:30:00Z'));
 assert.deepEqual(f.calls[0].where,f.calls[1].where);assert.equal(f.calls[0].skip,1);assert.equal(f.calls[0].take,1);assert.equal(f.calls[0].where.status,'IN_USE');assert.deepEqual(f.calls[0].where.mileageKm,{gte:0,lte:10000});assert(f.calls[0].where.AND.some((w:any)=>w.assetProfile?.is?.batteryOwnership==='BAAS'));
});
test('ledger ranges reject negative, fractional, inverted or unrecognized values',async()=>{
 for(const q of [{mileageKmMin:'-1'},{mileageKmMax:'0.1'},{mileageKmMin:'10',mileageKmMax:'9'},{ageMonthsMin:'13',ageMonthsMax:'12'},{ageMonthsMin:'-1'},{batteryOwnership:'UNKNOWN'},{batteryOwnership:'LEASED'}])await assert.rejects(readAdminVehicles(fixture().tx,actor,q));
});
test('product selection combines exact battery capacity with ownership before pagination and count',async()=>{
 const f=fixture();await readAdminVehicles(f.tx,actor,{view:'product-selection',batteryOwnership:'OWNED',batteryCapacityKwh:'75.500',brand:'蔚来',mileageKmMax:'15000',page:'2',pageSize:'20'});
 assert.deepEqual(f.calls[0].where,f.calls[1].where);assert.equal(f.calls[0].skip,20);assert.equal(f.calls[0].where.brand.contains,'蔚来');
 assert(f.calls[0].where.AND.some((w:any)=>w.assetProfile?.is?.batteryOwnership==='OWNED'));
 assert(f.calls[0].where.AND.some((w:any)=>Number(w.assetProfile?.is?.batteryCapacityKwh)===75.5));
 const all=fixture();await readAdminVehicles(all.tx,actor,{view:'product-selection'});assert.equal(all.calls[0].where.AND,undefined);
 for(const value of ['0','-75','NaN','75kWh','75.1234','100000','7.5e1'])await assert.rejects(readAdminVehicles(fixture().tx,actor,{batteryCapacityKwh:value}));
 const denied=fixture();denied.tx.adminUser.findUnique=async()=>({...actor,role:'FINANCE',active:true});await assert.rejects(readAdminVehicles(denied.tx,{...actor,role:'FINANCE'},{batteryCapacityKwh:'75'}),(e:any)=>e.getResponse().error.code==='FORBIDDEN');
});
test('completed-month age uses first registration, month edges and no guessed age for unknown or future dates',()=>{
 assert.equal(vehicleAgeMonths(null,'2026-11-05'),null);assert.equal(vehicleAgeMonths('2026-11-06','2026-11-05'),null);assert.equal(vehicleAgeMonths('2026-10-05','2026-11-05'),1);assert.equal(vehicleAgeMonths('2026-10-06','2026-11-05'),0);assert.equal(vehicleAgeMonths('2026-01-31','2026-02-28'),0);assert.equal(vehicleAgeMonths('2026-01-31','2026-03-31'),2);
});
test('filter option directory is private to current full ledger operators and does not use registrations as ownership',async()=>{
 const f=fixture();assert.deepEqual(await readVehicleFilterOptions(f.tx,actor,{page:'1',pageSize:'100'},new Date('2026-11-04T16:30:00Z')),{items:[],total:0,page:1,pageSize:100,ageAsOf:'2026-11-05'});
 for(const role of ['FINANCE','SUPPORT']){const tx=fixture().tx;tx.adminUser.findUnique=async()=>({...actor,role,active:true});await assert.rejects(readVehicleFilterOptions(tx,{...actor,role},{}),(e:any)=>e.getResponse().error.code==='FORBIDDEN');await assert.rejects(readAdminVehicles(tx,{...actor,role},{batteryOwnership:'OWNED'}),(e:any)=>e.getResponse().error.code==='FORBIDDEN');}
});
