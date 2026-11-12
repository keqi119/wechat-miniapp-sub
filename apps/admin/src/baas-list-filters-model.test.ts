import test from 'node:test';
import assert from 'node:assert/strict';
import {baasFiltersFromDraft,baasFilterQuery} from './baas-list-filters-model.ts';
import {listLocationState,updateListLocation} from './process-navigation.ts';
test('typed BaaS partials use contains while a known directory value is exact and scope remains conjunctive',()=>{
 const options={providers:['真实出租方'],brands:['蔚来'],models:[{brand:'蔚来',model:'ET5'}],lessees:['真实承租企业']};
 assert.deepEqual(baasFiltersFromDraft({provider:'真实出租方',brand:'蔚来',model:'ET',lesseeName:'承租'},options),{providerExact:'真实出租方',brandExact:'蔚来',model:'ET',lesseeName:'承租'});
 assert.equal(baasFilterQuery({provider:'出租',lesseeNameExact:'真实承租企业'},'car').toString(),'vehicleId=car&provider=%E5%87%BA%E7%A7%9F&lesseeNameExact=%E7%9C%9F%E5%AE%9E%E6%89%BF%E7%A7%9F%E4%BC%81%E4%B8%9A');
 assert.throws(()=>baasFilterQuery({brand:'蔚',brandExact:'蔚来'}));assert.throws(()=>baasFilterQuery({provider:'x'.repeat(501)}));assert.equal(baasFilterQuery({providerExact:'x'.repeat(250)}).get('providerExact')?.length,250);assert.throws(()=>baasFilterQuery({lesseeName:'x'.repeat(201)}));
});
test('BaaS list filters and vehicle scope survive search, status, detail return and reset independently',()=>{
 const state={keyword:'VIN',status:'ACTIVE',page:2,vehicleId:'car',baasFilters:{providerExact:'真实出租方',brandExact:'蔚来'}};const hash=updateListLocation('#baas-contracts',state);assert.deepEqual(listLocationState(hash),state);const reset=updateListLocation(hash,{...state,baasFilters:{},page:1});assert.equal(new URLSearchParams(reset.split('?')[1]).get('vehicleId'),'car');assert.equal(new URLSearchParams(reset.split('?')[1]).has('providerExact'),false);assert.equal(listLocationState('#vehicles?providerExact=wrong').baasFilters,undefined);
});
