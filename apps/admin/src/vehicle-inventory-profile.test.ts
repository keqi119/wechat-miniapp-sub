import test from 'node:test';
import assert from 'node:assert/strict';
import {assetProfilePayload,type AssetProfile} from './asset-model.ts';

const profile:AssetProfile={vehicleId:'inventory-synthetic',vehicle:{id:'inventory-synthetic',title:'合成验收车辆'},vehicleRevision:8,registered:true,revision:3,batteryOwnership:'OWNED',firstRegistrationDate:null};
const base={batteryOwnership:'OWNED',firstRegistrationDate:'',notes:''};
const build=(values:Record<string,unknown>)=>assetProfilePayload({...base,...values},profile) as Record<string,unknown>;
const inputs=['engineNumber','bodyColor','initialMileageKm','purchaseYuan','purchaserName','purchaseDate','nextInspectionDate'];
const outputs=['engineNumber','bodyColor','initialMileageKm','purchaseAmount','purchaserName','purchaseDate','nextInspectionDate'];

test('inventory payload retains dual versions, normalizes seven facts, and never changes current mileage or depreciation',()=>{
 assert.deepEqual(build({engineNumber:' SYNTHETIC-ENGINE ',bodyColor:' 合成蓝 ',initialMileageKm:'001234',purchaseYuan:'123456.78',purchaserName:' 合成购车主体 ',purchaseDate:'2024-02-29',nextInspectionDate:'2027-10-01',mileageKm:99999,basisAmount:999}),{
  revision:3,vehicleRevision:8,batteryOwnership:'OWNED',firstRegistrationDate:null,notes:'',engineNumber:'SYNTHETIC-ENGINE',bodyColor:'合成蓝',initialMileageKm:1234,purchaseAmount:12345678,purchaserName:'合成购车主体',purchaseDate:'2024-02-29',nextInspectionDate:'2027-10-01',
 });
});
test('omitted and explicitly undefined inventory values preserve facts while blank and null clear them',()=>{
 for(let i=0;i<inputs.length;i++){
  assert.equal(Object.hasOwn(build({}),outputs[i]),false);
  assert.equal(Object.hasOwn(build({[inputs[i]]:undefined}),outputs[i]),false);
  for(const value of ['', '   ', null])assert.equal(build({[inputs[i]]:value})[outputs[i]],null,inputs[i]);
 }
});
test('zero and Int upper limits remain exact; fractional, negative, overflowing or coerced inputs cannot be saved',()=>{
 assert.equal(build({initialMileageKm:'0'}).initialMileageKm,0);
 assert.equal(build({purchaseYuan:'0.00'}).purchaseAmount,0);
 assert.equal(build({initialMileageKm:'2147483647'}).initialMileageKm,2147483647);
 assert.equal(build({purchaseYuan:'21474836.47'}).purchaseAmount,2147483647);
 for(const value of ['-1','1.1','2147483648','1e2','NaN',true,{}])assert.throws(()=>build({initialMileageKm:value}),String(value));
 for(const value of ['-1','0.001','21474836.48','1e2','NaN',123.45,true,{}])assert.throws(()=>build({purchaseYuan:value}),String(value));
});
test('inventory text rejects NUL, overlength and nontext without losing valid max-length values',()=>{
 for(const [field,max] of [['engineNumber',200],['bodyColor',100],['purchaserName',200]] as const){
  assert.equal(build({[field]:'字'.repeat(max)})[field],'字'.repeat(max));
  for(const value of ['字'.repeat(max+1),'invalid\0text',0,true,{}])assert.throws(()=>build({[field]:value}),field);
 }
});
test('procurement and inspection dates reject impossible dates and timestamps',()=>{
 for(const field of ['purchaseDate','nextInspectionDate']){
  assert.equal(build({[field]:'2024-02-29'})[field],'2024-02-29');
  for(const value of ['2025-02-29','2026-04-31','2026-13-01','2026-1-01','2026-01-01T00:00:00Z',true,20260101])assert.throws(()=>build({[field]:value}),field);
 }
});
