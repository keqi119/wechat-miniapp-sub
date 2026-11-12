import test from 'node:test';
import assert from 'node:assert/strict';
import {vehicleFilterQuery,mergeVehicleSelection,loadMatchingVehicleIds} from './product-vehicle-selection.ts';

test('vehicle filters use independent model year and inclusive ranges, rejecting partial invalid ranges',()=>{
 const query=vehicleFilterQuery({registeredOwnerName:' 张三 ',brand:'蔚来',model:'ET5',modelYear:'2024',ageMonthsMin:'12',ageMonthsMax:'36',mileageKmMin:'0',mileageKmMax:'60000',plateNumber:'沪A',vin:'abc'});
 assert.equal(query.get('registeredOwnerName'),'张三');assert.equal(query.get('modelYear'),'2024');assert.equal(query.get('mileageKmMin'),'0');assert.equal(query.get('vin'),'abc');
 assert.throws(()=>vehicleFilterQuery({ageMonthsMin:'24',ageMonthsMax:'12'}),/最小/);
 assert.throws(()=>vehicleFilterQuery({mileageKmMin:'1.5'}),/整数/);
 assert.throws(()=>vehicleFilterQuery({modelYear:'2024x'}),/整数/);
 assert.equal(vehicleFilterQuery({brand:'  '}).toString(),'');
});
test('selecting and removing matching vehicles preserves selections outside the filter',()=>{
 assert.deepEqual(mergeVehicleSelection(['outside','a'],['a','b'],'add'),['outside','a','b']);
 assert.deepEqual(mergeVehicleSelection(['outside','a','b'],['a','b'],'remove'),['outside']);
 const old=Array.from({length:1000},(_,i)=>'v'+i);
 assert.throws(()=>mergeVehicleSelection(old,['new'],'add'),/1000/);assert.equal(old.length,1000);
});
test('battery filters distinguish ownership and exact kWh, and omit empty constraints',()=>{
 const q=vehicleFilterQuery({batteryOwnership:'BAAS',batteryCapacityKwh:' 75.500 ',brand:'蔚来'});
 assert.equal(q.get('batteryOwnership'),'BAAS');assert.equal(q.get('batteryCapacityKwh'),'75.5');assert.equal(q.get('brand'),'蔚来');
 assert.equal(vehicleFilterQuery({batteryOwnership:'',batteryCapacityKwh:' '}).toString(),'');
 for(const batteryCapacityKwh of ['0','-1','75kWh','NaN','75.1234','100000','7.5e1'])assert.throws(()=>vehicleFilterQuery({batteryCapacityKwh}),/电池规格/);
 assert.throws(()=>vehicleFilterQuery({batteryOwnership:'UNKNOWN'}),/电池方式/);
});
test('select all traverses every matching page and never returns a partial result after failure',async()=>{
 const calls:number[]=[];
 const ids=await loadMatchingVehicleIds(async page=>{calls.push(page);return {items:page===1?[{id:'a'},{id:'b'}]:[{id:'c'}],total:3};},new AbortController().signal);
 assert.deepEqual(ids,['a','b','c']);assert.deepEqual(calls,[1,2]);
 await assert.rejects(loadMatchingVehicleIds(async page=>{if(page===2)throw new Error('network');return {items:[{id:'a'}],total:2};},new AbortController().signal),/network/);
 await assert.rejects(loadMatchingVehicleIds(async()=>({items:[],total:1001}),new AbortController().signal),/1000/);
});
test('changed, overlapping or cancelled results cannot become an incomplete bulk selection',async()=>{
 await assert.rejects(loadMatchingVehicleIds(async page=>({items:[{id:'a'+page}],total:page===1?2:3}),new AbortController().signal),/变化/);
 await assert.rejects(loadMatchingVehicleIds(async()=>({items:[{id:'a'}],total:2}),new AbortController().signal),/重复/);
 const controller=new AbortController();controller.abort();let called=false;
 await assert.rejects(loadMatchingVehicleIds(async()=>{called=true;return {items:[],total:0};},controller.signal));assert.equal(called,false);
});

