import test from 'node:test';
import assert from 'node:assert/strict';
import {vehicleLedgerFilters,vehicleLedgerFilterQuery} from './vehicle-ledger-filters-model.ts';
import {listLocationState,updateListLocation,listLocation,recordLocation} from './process-navigation.ts';
test('vehicle combinations preserve zero as an explicit bound, omit blanks and keep native query units',()=>{
 assert.equal(vehicleLedgerFilterQuery(vehicleLedgerFilters({cooperationOwnerId:'owner',batteryOwnership:'BAAS',mileageKmMin:'0',mileageKmMax:'18000',ageMonthsMin:'0',ageMonthsMax:'24'})).toString(),'cooperationOwnerId=owner&batteryOwnership=BAAS&mileageKmMin=0&mileageKmMax=18000&ageMonthsMin=0&ageMonthsMax=24');
 assert.equal(vehicleLedgerFilterQuery(vehicleLedgerFilters({})).toString(),'');for(const value of ['-1','1.5','NaN','2147483648'])assert.throws(()=>vehicleLedgerFilters({mileageKmMin:value}));assert.throws(()=>vehicleLedgerFilters({mileageKmMin:'100',mileageKmMax:'99'}));assert.throws(()=>vehicleLedgerFilters({ageMonthsMin:'12',ageMonthsMax:'3'}));
 assert.throws(()=>vehicleLedgerFilters({ageMonthsMax:'120001'}));
});
test('vehicle combinations survive details and reset without leaking into model or customer lists',()=>{
 const state={keyword:'ET5',status:'PUBLISHED',page:2,vehicleFilters:{cooperationOwnerId:'owner',batteryOwnership:'BAAS' as const,mileageKmMin:'0',ageMonthsMax:'24'}};
 const hash=updateListLocation('#vehicles',state);assert.deepEqual(listLocationState(listLocation(recordLocation(hash,'car','overview'))),state);const reset=updateListLocation(hash,{keyword:'ET5',status:'PUBLISHED',page:1,vehicleFilters:{}});assert.equal(new URLSearchParams(reset.split('?')[1]).has('cooperationOwnerId'),false);assert.equal(new URLSearchParams(reset.split('?')[1]).get('keyword'),'ET5');assert.equal(listLocationState('#model-definitions?ageMonthsMax=24').vehicleFilters,undefined);
});
