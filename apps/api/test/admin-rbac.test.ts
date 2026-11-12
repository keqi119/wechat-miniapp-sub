import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowed } from '../src/auth/access';

test('unknown roles and resources are denied including administrators', () => {
  assert.equal(allowed('ADMIN', 'not-a-resource', false), false);
  assert.equal(allowed('ADMIN', 'not-a-resource', true), false);
  assert.equal(allowed('UNKNOWN', 'vehicles', false), false);
});

test('fixed roles separate customer risk, finance, archive and field operations', () => {
  assert.equal(allowed('SUPPORT', 'applications', false), false);
  assert.equal(allowed('FINANCE', 'applications', false), false);
  assert.equal(allowed('OPERATIONS', 'applications', true), true);
  assert.equal(allowed('FINANCE', 'refunds', true), true);
  assert.equal(allowed('SUPPORT', 'refunds', true), false);
  assert.equal(allowed('FIELD', 'orders', false), false);
  assert.equal(allowed('FIELD', 'field-tasks', true), true);
  assert.equal(allowed('OPERATIONS', 'users', false), false);
  assert.equal(allowed('ADMIN', 'audit-logs', true), false);
});
