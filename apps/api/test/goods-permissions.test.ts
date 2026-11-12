import {test} from 'node:test';
import assert from 'node:assert/strict';
import {allowed,permissions} from '../src/auth/role-policy';

test('goods publication is limited to current administration and operations roles',()=>{
 for(const role of ['ADMIN','OPERATIONS']){
  assert.equal(allowed(role,'goods',false),true);
  assert.equal(allowed(role,'goods',true),true);
  assert.ok(permissions(role).includes('goods.write'));
 }
 for(const role of ['FINANCE','SUPPORT','FIELD','UNKNOWN']){
  assert.equal(allowed(role,'goods',false),false);
  assert.equal(allowed(role,'goods',true),false);
  assert.ok(!permissions(role).some(value=>value.startsWith('goods.')));
 }
});
