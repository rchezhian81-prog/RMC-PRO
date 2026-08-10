/**
 * Unit test for the Customer-Service intent map (M3) — the fixed allow-list that
 * keeps a customer's request DATA, never an instruction: only known intents
 * resolve to a tool; anything else is null (rejected). No I/O.
 */
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csIntentTool } from '../../dist/agents/customer-service.agent.js';

test('csIntentTool maps only the fixed intent allow-list', () => {
  assert.equal(csIntentTool('account_summary'), 'cs.account_summary');
  assert.equal(csIntentTool('order_status'), 'cs.order_status');
  assert.equal(csIntentTool('delete_everything'), null);
  assert.equal(csIntentTool('cs.account_summary'), null); // a tool name is not an intent
  assert.equal(csIntentTool(''), null);
});
