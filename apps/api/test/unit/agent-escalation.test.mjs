/**
 * Unit test for the pure escalation-scope check (M2): an agent may escalate only
 * to an agent in its own allow-list; omitted/empty means no escalation at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escalationAllowed } from '../../dist/agents/agent.types.js';

test('escalationAllowed honours the allow-list', () => {
  assert.equal(escalationAllowed(['specialist'], 'specialist'), true);
  assert.equal(escalationAllowed(['specialist'], 'automation'), false);
  assert.equal(escalationAllowed([], 'specialist'), false);
  assert.equal(escalationAllowed(undefined, 'specialist'), false);
});
