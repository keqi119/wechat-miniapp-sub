import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizePlateNumber,plateCreateInput,platePatchInput,plateOwnershipInput,plateBindInput,plateUnbindInput,plateListInput} from '../src/license-plates/types';
const command={revision:0,idempotencyKey:'plate-input-key'};
test('plate normalization is explicit NFKC uppercase whitespace-free identity without guessing plate type',()=>{
 assert.equal(normalizePlateNumber(' 沪 ａ１２３４５ '),'沪A12345');assert.equal(normalizePlateNumber('temporary abc'),'TEMPORARYABC');
 for(const value of ['', '  ', '沪A\n12345','沪A\u000012345','A'.repeat(51)])assert.throws(()=>normalizePlateNumber(value));
 const input=plateCreateInput.parse({...command,plateNumber:' 沪 ａ１２３４５ ',plateType:'企业自有牌照'});assert.equal(input.plateNumber,'沪 ａ１２３４５');assert.equal(input.plateType,'企业自有牌照');assert.equal(input.region,'');assert.equal(input.notes,'');
 assert.throws(()=>plateCreateInput.parse({...command,plateNumber:'沪A12345'}));assert.throws(()=>plateCreateInput.parse({...command,plateNumber:'沪A12345',plateType:'type',ownerId:'guessed'}));
 assert.equal(normalizePlateNumber('A'.repeat(32)),'A'.repeat(32));assert.throws(()=>normalizePlateNumber('A'.repeat(33)));
});
test('plate edits cannot change identity, source evidence must be explicit and ownership/current binding versions pair',()=>{
 assert.throws(()=>platePatchInput.parse({...command,plateNumber:'沪A99999'}));assert.throws(()=>platePatchInput.parse(command));assert.equal(platePatchInput.parse({...command,notes:''}).notes,'');
 const ownership={...command,ownerId:'owner',ownerRevision:2,currentOwnershipPeriodId:null,currentOwnershipRevision:null,reason:'实际备案',fileIds:['proof']};assert.equal(plateOwnershipInput.parse(ownership).currentOwnershipPeriodId,null);
 assert.throws(()=>plateOwnershipInput.parse({...ownership,currentOwnershipPeriodId:'period'}));assert.throws(()=>plateOwnershipInput.parse({...ownership,fileIds:[]}));assert.throws(()=>plateOwnershipInput.parse({...ownership,fileIds:['proof','proof']}));assert.throws(()=>plateOwnershipInput.parse({...ownership,validFrom:'2020-01-01'}));
 const bind={...command,vehicleId:'target',vehicleRevision:1,currentBindingId:null,currentBindingRevision:null,oldVehicleId:null,oldVehicleRevision:null,reason:'实际换牌',fileIds:['proof']};assert.equal(plateBindInput.parse(bind).oldVehicleId,null);assert.throws(()=>plateBindInput.parse({...bind,currentBindingId:'binding',currentBindingRevision:0}));
 assert.equal(plateBindInput.parse({...bind,currentBindingId:'binding',currentBindingRevision:0,oldVehicleId:'old',oldVehicleRevision:3}).oldVehicleRevision,3);
 assert.throws(()=>plateUnbindInput.parse({...command,bindingId:'binding',vehicleRevision:2,reason:'解除'}));assert.throws(()=>plateListInput.parse({pageSize:101}));
});
