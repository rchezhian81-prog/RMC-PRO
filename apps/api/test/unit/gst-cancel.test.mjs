/**
 * Cancel-path tests: the provider contract for cancelling an already-generated
 * IRN / e-way bill, exercised against the deterministic fake (no live portal).
 * The execution-service guardrails (idempotency, reason-code validation, status
 * gating) are covered end to end in test/agents-gst-execution.test.mjs.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeGstProvider } from '../../dist/compliance/fake.provider.js';

const seller = { gstin: '33ABCDE1234F1Z5' };

test('fake provider cancels an IRN and echoes the reference', async () => {
  const p = new FakeGstProvider();
  const s = await p.authenticate('tenant-1', seller.gstin);
  const irn = 'a'.repeat(64);
  const res = await p.cancelIrn(s, irn, '3', 'order cancelled');
  assert.equal(res.reference, irn);
  assert.ok(res.cancelledAt, 'carries a cancellation timestamp');
  // The reason + remarks are recorded on the call log (audited upstream).
  const call = p.calls.find((c) => c.op === 'cancelIrn');
  assert.equal(call.arg.reasonCode, '3');
  assert.equal(call.arg.remarks, 'order cancelled');
});

test('fake provider cancels an e-way bill and echoes the reference', async () => {
  const p = new FakeGstProvider();
  const s = await p.authenticate('tenant-1', seller.gstin);
  const ewbNo = '123456789012';
  const res = await p.cancelEwayBill(s, ewbNo, '2', 'duplicate');
  assert.equal(res.reference, ewbNo);
  assert.ok(res.cancelledAt);
  const call = p.calls.find((c) => c.op === 'cancelEwayBill');
  assert.equal(call.arg.reasonCode, '2');
});
