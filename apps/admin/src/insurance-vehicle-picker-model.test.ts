import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedInsuranceVehiclePage,insuranceVehicleLabel} from './insurance-vehicle-picker-model.ts';

test('insurance vehicle pages preserve the server fleet total beyond the first page',()=>{
 const page={items:[{id:'101'},{id:'102'}],total:102,page:2,pageSize:100};
 assert.equal(checkedInsuranceVehiclePage(page,2),page);
 assert.equal(insuranceVehicleLabel({id:'1',plateNumber:' 沪A00001 ',title:' 蔚来 ES6 ',vin:' VIN001 '}),'沪A00001 · 蔚来 ES6 · VIN001');
});

test('truncated, duplicated and stale page responses cannot masquerade as complete search results',()=>{
 const valid={items:[{id:'101'},{id:'102'}],total:102,page:2,pageSize:100};
 for(const malformed of [{...valid,items:[{id:'101'}]},{...valid,items:[{id:'101'},{id:'101'}]},{...valid,page:1},{...valid,total:-1},{...valid,pageSize:50}])assert.throws(()=>checkedInsuranceVehiclePage(malformed,2),/分页不完整/);
});
