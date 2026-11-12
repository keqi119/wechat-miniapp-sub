import test from 'node:test';
import assert from 'node:assert/strict';
import {assetProfilePayload,type AssetProfile} from './asset-model.ts';

const profile:AssetProfile={vehicleId:'v',vehicle:{id:'v',title:'合成车辆'},vehicleRevision:8,registered:true,revision:3,batteryOwnership:'OWNED',firstRegistrationDate:null};
const input={batteryOwnership:'OWNED',firstRegistrationDate:'',notes:''};
const capacity=(value:unknown)=>(assetProfilePayload({...input,batteryCapacityKwh:value},profile) as Record<string,unknown>).batteryCapacityKwh;
test('capacity is an explicit canonical decimal string, never a rounded number',()=>{
 for(const [value,expected] of [['075.500','75.5'],[' 0.000 ','0'],['0.001','0.001'],['99999.999','99999.999'],['00099','99']])assert.equal(capacity(value),expected);
 for(const value of [-1,75.5,undefined,{},'100000','99999.9999','1e2','-0','+75','.5','75.','1,000','Infinity','0'.repeat(101)])assert.throws(()=>capacity(value));
});
test('capacity omission preserves server facts; blank or null explicitly clears without changing revision semantics',()=>{
 const unchanged=assetProfilePayload(input,profile);assert.equal(Object.hasOwn(unchanged,'batteryCapacityKwh'),false);
 assert.equal(capacity(''),null);assert.equal(capacity('   '),null);assert.equal(capacity(null),null);
 assert.deepEqual(assetProfilePayload({...input,batteryCapacityKwh:'75.500'},profile),{...unchanged,batteryCapacityKwh:'75.5'});assert.equal(unchanged.revision,3);assert.equal(unchanged.vehicleRevision,8);
});
