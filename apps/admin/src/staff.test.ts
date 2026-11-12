import test from 'node:test';
import assert from 'node:assert/strict';
import { staffPayload, staffEditFields, staffCommandFields } from './staff.ts';
import { serializeForm } from './form.ts';
test('staff password reset accepts 8–256 characters and preserves password bytes', () => {
  const fields = staffCommandFields('reset-password');
  const values = { revision: '0', reason: '合成密码长度验收' };
  for (const length of [8, 256]) {
    const newPassword = ' ' + 'Q'.repeat(length - 2) + ' ';
    assert.equal(serializeForm(fields, { ...values, newPassword }).newPassword, newPassword);
  }
  for (const length of [7, 257]) assert.throws(() => serializeForm(fields, { ...values, newPassword: 'Q'.repeat(length) }), /新密码/);
});
test('staff edit only sends display name, revision and idempotency key', () => {
  assert.deepEqual(staffEditFields.map(field => field.key), ['name', 'revision']);
  assert.deepEqual(staffPayload('edit', { name: '新姓名', revision: 4, role: 'ADMIN', active: true, password: 'unwanted' }, 'command-key'), { name: '新姓名', revision: 4, idempotencyKey: 'command-key' });
});
test('staff commands use explicit reviewed DTOs and cannot reuse generic sensitive patch', () => {
  assert.deepEqual(staffPayload('role', { role: 'FIELD', revision: 2, reason: '岗位调整', active: false }, 'command-key'), { role: 'FIELD', revision: 2, reason: '岗位调整', idempotencyKey: 'command-key' });
  assert.deepEqual(staffCommandFields('reset-password').map(field => field.key), ['revision', 'reason', 'newPassword']);
  assert.throws(() => staffPayload('disable', { reason: '停用' }, 'command-key'), /版本/);
  assert.throws(() => staffPayload('role', { role: 'UNKNOWN', revision: 1, reason: '调整' }, 'command-key'), /角色/);
  assert.throws(() => staffPayload('edit', { name: '名字', revision: 1 }, ''), /请求编号/);
});
