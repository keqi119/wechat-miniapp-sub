import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionCheckSequence } from './session-check.ts';
test('overlapping and unmounted session checks cannot replace the current result with stale errors', () => {
  const checks = new SessionCheckSequence();
  const first = checks.begin(); checks.invalidate(); const current = checks.begin();
  assert.equal(checks.current(first), false); assert.equal(checks.current(current), true);
  checks.invalidate(); assert.equal(checks.current(current), false);
});
