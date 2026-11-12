import test from 'node:test';
import assert from 'node:assert/strict';
import {moduleForRoute,routeAllowed} from './modules/navigation.ts';
import {processHref} from './process-navigation.ts';
import {vehicleFormFields} from './vehicle-fields.ts';
import {serializeForm} from './form.ts';
test('plate route belongs to vehicles, needs current explicit permission and excludes other roles',()=>{
 assert.equal(moduleForRoute('license-plates')?.key,'vehicles');for(const role of ['ADMIN','OPERATIONS']){assert.equal(routeAllowed('license-plates',role,['license-plates.read']),true);assert.equal(routeAllowed('license-plates',role,[]),false);}for(const role of ['FINANCE','SUPPORT','FIELD'])assert.equal(routeAllowed('license-plates',role,['*']),false);assert.match(processHref('#license-plates?record=p','#vehicles?record=v&page=2'),/returnTo=/);
});
test('ordinary vehicle forms keep VIN identity and cannot write a plate through create or edit',()=>{
 const fields=[{key:'vin',label:'VIN'},{key:'plateNumber',label:'车牌'}];const create=vehicleFormFields('create',fields),edit=vehicleFormFields('edit',fields);assert.equal(create.some(f=>f.key==='plateNumber'),false);assert.equal(edit.find(f=>f.key==='plateNumber')?.readOnly,true);assert.equal(edit.find(f=>f.key==='plateNumber')?.submit,false);assert.equal(edit.find(f=>f.key==='vin')?.readOnly,true);assert.deepEqual(serializeForm(edit,{vin:'malicious',plateNumber:'沪B12345'}),{});assert.match(edit.find(f=>f.key==='plateNumber')?.hint||'',/牌照/);
});

