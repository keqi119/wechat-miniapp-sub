import test from 'node:test';
import assert from 'node:assert/strict';
import {providerReturnReference,returnRefresh} from './legal-return.ts';
test('fix1 full-navigation technical revoke returns to the exact original authority in the same current session',()=>{
 const departed=providerReturnReference('/owners/company/authorities/original/revoke',{url:'https://not-persisted.invalid/'},{ownerId:'company',sessionBinding:'session'});
 assert.deepEqual(departed,{ownerId:'company',sessionBinding:'session',authorityId:'original'});
 const persisted=JSON.stringify(departed);
 assert.ok(!persisted.includes('url'));
 assert.deepEqual(returnRefresh(persisted,{ownerId:'company',sessionBinding:'session'}),{path:'/owners/company/authorities/original/refresh',body:{}});
 assert.equal(returnRefresh(persisted,{ownerId:'company',sessionBinding:'different-session'}),null);
 assert.equal(returnRefresh(persisted,{ownerId:'other',sessionBinding:'session'}),null);
});
