import test from 'node:test';import assert from 'node:assert/strict';
import {legalReturnReference,returnRefresh} from './legal-return.ts';
test('provider return reference only selects an authorized original task and never carries URL or success',()=>{
 assert.equal(legalReturnReference(null,['company'],'current'),null);assert.equal(legalReturnReference('{"ownerId":"foreign","taskId":"task"}',['company'],'current'),null);
 assert.deepEqual(legalReturnReference('{"sessionBinding":"current","ownerId":"company","taskId":"task","url":"https://ignored.invalid/","success":true}',['company'],'current'),{ownerId:'company',taskId:'task',sessionBinding:'current'});
 assert.equal(legalReturnReference('{"ownerId":"company","taskId":"../foreign"}',['company'],'current'),null);
});
test('a provider departure never consumes its own return reference or starts a refresh',()=>{
 const raw=JSON.stringify({ownerId:'company',sessionBinding:'current',taskId:'task',taskRevision:2});
 assert.equal(returnRefresh(raw,{ownerId:'company',sessionBinding:'current',taskId:'task',taskRevision:2,departing:true}),null);
});
test('return synchronization waits for the selected original task revision',()=>{
 const raw=JSON.stringify({ownerId:'company',sessionBinding:'current',taskId:'task',taskRevision:2});
 assert.equal(returnRefresh(raw,{ownerId:'company',sessionBinding:'current',taskId:'task'}),null);
});
