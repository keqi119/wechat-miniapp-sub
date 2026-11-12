import {test} from 'node:test';
import assert from 'node:assert/strict';
import {allowed,permissions} from '../src/auth/role-policy';

test('overdue reads and explicit collection writes belong only to current finance/admin roles',()=>{
 for(const role of ['ADMIN','FINANCE','OPERATIONS','SUPPORT','FIELD','unknown']){
  const financial=['ADMIN','FINANCE'].includes(role);
  assert.equal(allowed(role,'overdue-bills',false),financial);
  assert.equal(allowed(role,'overdue-bills',true),false);
  assert.equal(allowed(role,'collection-cases',false),financial);
  assert.equal(allowed(role,'collection-cases',true),financial);
  assert.equal(permissions(role).includes('collection-cases.write'),financial);
 }
});
