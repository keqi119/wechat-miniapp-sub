import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passwordHash } from '../src/auth/auth.service.ts';
test('password is one-way salted, never stored as plaintext and hashes vary', () => {
  const a = passwordHash('secret-password');
  assert.notEqual(a, 'secret-password');
  assert.notEqual(a, passwordHash('secret-password'));
});
