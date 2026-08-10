/**
 * Unit tests for the agent policy engine — the pure funnel that encodes the
 * blueprint hard rule: reads execute, reversible writes are bounded (L3), and
 * every non-reversible write is blocked for human approval (L2). No I/O.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidePolicy } from '../../dist/agents/policy-engine.service.js';

test('a read always executes, whatever its reversibility label', () => {
  assert.equal(decidePolicy({ kind: 'read', reversibility: 'reversible' }).verdict, 'execute');
  assert.equal(decidePolicy({ kind: 'read', reversibility: 'financial' }).verdict, 'execute');
});

test('a reversible write is bounded (L3), not free', () => {
  const d = decidePolicy({ kind: 'write', reversibility: 'reversible' });
  assert.equal(d.verdict, 'bounded');
  assert.match(d.reason, /L3/);
});

test('every non-reversible write is blocked for human approval (L2)', () => {
  for (const r of ['irreversible', 'financial', 'legal', 'safety']) {
    const d = decidePolicy({ kind: 'write', reversibility: r });
    assert.equal(d.verdict, 'block', `${r} must block`);
    assert.match(d.reason, /approval/i);
  }
});
