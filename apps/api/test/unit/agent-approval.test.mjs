/**
 * Unit tests for the approval substrate's pure helpers (M4): the decide-once
 * status rule and the secret scrub applied to a prepared payload. No I/O.
 */
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canDecide, scrubPayload } from '../../dist/agents/approval.service.js';

test('canDecide allows only a pending request to be decided', () => {
  assert.equal(canDecide('pending'), true);
  assert.equal(canDecide('approved'), false);
  assert.equal(canDecide('rejected'), false);
  assert.equal(canDecide('cancelled'), false);
});

test('scrubPayload redacts secret-like keys and keeps the rest', () => {
  const out = scrubPayload({ amount: 100, apiKey: 'x', nested: { token: 't', note: 'ok' }, list: [{ password: 'p', id: 1 }] });
  assert.equal(out.amount, 100);
  assert.equal(out.apiKey, '[redacted]');
  assert.equal(out.nested.token, '[redacted]');
  assert.equal(out.nested.note, 'ok');
  assert.equal(out.list[0].password, '[redacted]');
  assert.equal(out.list[0].id, 1);
});
