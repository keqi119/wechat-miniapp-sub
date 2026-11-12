import { test } from 'node:test';
import assert from 'node:assert/strict';
import { staffCreateInput, staffRenameInput, staffActionInput,staffCapabilitiesInput,staffPersonInput } from '../src/auth/staff.types';
import { staffDigest } from '../src/auth/staff-command';

test('personnel forms require explicit roles and reject generic privilege edits', () => {
  assert.equal(staffCreateInput.safeParse({username:'operator',name:'员工',password:'synthetic-password-123',idempotencyKey:'create-0001'}).success,false);
  assert.equal(staffRenameInput.safeParse({name:'新姓名',revision:0,idempotencyKey:'rename-001',role:'ADMIN'}).success,false);
  assert.equal(staffActionInput.safeParse({revision:0,idempotencyKey:'action-001',reason:'   '}).success,false);
});
test('capability grants accept only exact nonduplicate sets and verified staff ownership is explicit',()=>{
 const input={revision:0,idempotencyKey:'staff-grants-001',reason:'管理员核实职责'};
 assert.equal(staffCapabilitiesInput.safeParse({...input,capabilities:[]}).success,true);
 assert.equal(staffCapabilitiesInput.safeParse({...input,capabilities:['partner.rules.write','partner.rules.review']}).success,true);
 for(const capabilities of [['partner.rules.*'],['partner.rules.read','partner.rules.read'],['FINANCE']])assert.equal(staffCapabilitiesInput.safeParse({...input,capabilities}).success,false);
 assert.equal(staffPersonInput.safeParse({...input,staffPersonId:'person-confirmed-001'}).success,true);
 assert.equal(staffPersonInput.safeParse({...input,staffPersonId:null}).success,false);
});

test('staff idempotency uses a dedicated versioned keyed digest without storing credentials', () => {
  const previous = process.env.STAFF_COMMAND_DIGEST_KEY;
  const version = process.env.STAFF_COMMAND_DIGEST_KEY_VERSION;
  try {
    delete process.env.STAFF_COMMAND_DIGEST_KEY;
    assert.throws(() => staffDigest({password:'private'}), (error:any) => error.getResponse?.().error?.code==='STAFF_COMMAND_NOT_READY');
    process.env.STAFF_COMMAND_DIGEST_KEY='synthetic-staff-digest-key-32-bytes-only';
    process.env.STAFF_COMMAND_DIGEST_KEY_VERSION='test-v1';
    const one=staffDigest({password:'private',name:'员工'});
    assert.equal(one.digest,staffDigest({name:'员工',password:'private'}).digest);
    assert.notEqual(one.digest,staffDigest({password:'different',name:'员工'}).digest);
    assert.equal(one.keyVersion,'test-v1');
    assert.equal(JSON.stringify(one).includes('private'),false);
  } finally {
    if(previous===undefined)delete process.env.STAFF_COMMAND_DIGEST_KEY;else process.env.STAFF_COMMAND_DIGEST_KEY=previous;
    if(version===undefined)delete process.env.STAFF_COMMAND_DIGEST_KEY_VERSION;else process.env.STAFF_COMMAND_DIGEST_KEY_VERSION=version;
  }
});
