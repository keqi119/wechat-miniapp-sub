import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cooperationBusinessHash} from '../src/offline-documents/snapshot';
test('cooperation scope survives JSONB key ordering and rejects changed vehicle or dates',()=>{
 const scope={vehicleIds:['b','a'],validFrom:'2026-01-01',validUntil:'2028-01-01'};
 const roundTrip={validUntil:scope.validUntil,validFrom:scope.validFrom,vehicleIds:['b','a']};
 assert.equal(cooperationBusinessHash('o',2,scope),cooperationBusinessHash('o',2,roundTrip));
 assert.notEqual(cooperationBusinessHash('o',2,scope),cooperationBusinessHash('o',2,{...scope,validUntil:'2027-01-01'}));
 assert.notEqual(cooperationBusinessHash('o',2,scope),cooperationBusinessHash('o',3,scope));
});
