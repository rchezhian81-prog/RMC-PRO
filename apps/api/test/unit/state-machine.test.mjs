/**
 * Unit tests for leavesTerminal (Tier-A gap A6).
 *
 * The manual setStatus setters (weighbridge / production-plan / batch-queue)
 * must not let a terminal record be re-opened; leavesTerminal is the guard.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leavesTerminal } from '../../dist/common/state-machine.util.js';

const TERMINAL = ['completed', 'cancelled'];

test('blocks moving OUT of a terminal state', () => {
  assert.equal(leavesTerminal('completed', 'batching', TERMINAL), true);
  assert.equal(leavesTerminal('cancelled', 'waiting', TERMINAL), true);
});

test('allows moves between non-terminal states', () => {
  assert.equal(leavesTerminal('waiting', 'batching', TERMINAL), false);
  assert.equal(leavesTerminal('held', 'waiting', TERMINAL), false);
  assert.equal(leavesTerminal('draft', 'completed', TERMINAL), false); // entering terminal is fine
});

test('is idempotent — setting the same terminal status is not "leaving" it', () => {
  assert.equal(leavesTerminal('completed', 'completed', TERMINAL), false);
  assert.equal(leavesTerminal('cancelled', 'cancelled', TERMINAL), false);
});

test('honours the per-entity terminal set (weighbridge: matched is terminal)', () => {
  const WB = ['matched', 'cancelled'];
  assert.equal(leavesTerminal('matched', 'completed', WB), true);
  assert.equal(leavesTerminal('completed', 'matched', WB), false); // completed is not terminal here
});
