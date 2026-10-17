import {test} from 'node:test';
import assert from 'node:assert/strict';
import {allowed,permissions,resources} from '../src/auth/access';
test('FIELD has no ordinary admin reads or writes, including arbitrary resource names',()=>{
 for(const r of [...resources,'dashboard','unknown']) if(r!=='field-tasks') {
  assert.equal(allowed('FIELD',r,false),false,r+' read');
  assert.equal(allowed('FIELD',r,true),false,r+' write');
 }
 assert.equal(allowed('FIELD','field-tasks',true),true);
 assert.deepEqual(permissions('FIELD').sort(),['field-tasks.read','field-tasks.write']);
});
test('assignment is only available to operations/admin, field work requires field identity',()=>{
 for(const role of ['ADMIN','OPERATIONS']) assert.equal(allowed(role,'handover-tasks',true),true);
 for(const role of ['FIELD','FINANCE','SUPPORT']) assert.equal(allowed(role,'handover-tasks',false),false);
 for(const role of ['ADMIN','OPERATIONS','FINANCE','SUPPORT']) assert.equal(allowed(role,'field-tasks',true),false);
});
