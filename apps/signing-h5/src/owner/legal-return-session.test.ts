import test from 'node:test';import assert from 'node:assert/strict';
import {legalReturnReference} from './legal-return.ts';
test('old-session return intent cannot trigger synchronization after a new legal login',()=>{
 const old=JSON.stringify({ownerId:'company',taskId:'task',sessionBinding:'old-session'});
 assert.equal(legalReturnReference(old,['company'],'new-session'),null);
 assert.equal(legalReturnReference(JSON.stringify({ownerId:'company',taskId:'task'}),['company'],'current-session'),null);
});
