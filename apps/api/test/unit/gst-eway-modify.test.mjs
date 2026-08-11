/**
 * e-way in-place modify tests: the provider contract for a Part-B vehicle update
 * and a validity extension, exercised against the deterministic fake (no live
 * portal). The execution-service guardrails (status gating, reason-code
 * validation, persistence) are covered end to end in
 * test/agents-gst-execution.test.mjs.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeGstProvider } from '../../dist/compliance/fake.provider.js';

const seller = { gstin: '33ABCDE1234F1Z5' };
const ewbNo = '123456789012';

test('fake provider updates the Part-B vehicle and echoes the reference', async () => {
  const p = new FakeGstProvider();
  const s = await p.authenticate('tenant-1', seller.gstin);
  const res = await p.updateEwayVehicle(s, ewbNo, { vehicleNo: 'TN09XY9999', reasonCode: '1', remarks: 'breakdown' });
  assert.equal(res.ewayBillNo, ewbNo);
  assert.ok(res.validUpto, 'echoes a validity');
  assert.ok(res.updatedAt);
  const call = p.calls.find((c) => c.op === 'updateEwayVehicle');
  assert.equal(call.arg.vehicleNo, 'TN09XY9999');
  assert.equal(call.arg.reasonCode, '1');
});

test('fake provider extends validity and returns a new validUpto', async () => {
  const p = new FakeGstProvider();
  const s = await p.authenticate('tenant-1', seller.gstin);
  const res = await p.extendEwayValidity(s, ewbNo, { remainingDistanceKm: 400, reasonCode: '4', remarks: 'accident' });
  assert.equal(res.ewayBillNo, ewbNo);
  assert.ok(res.validUpto, 'returns an extended validity');
  const call = p.calls.find((c) => c.op === 'extendEwayValidity');
  assert.equal(call.arg.remainingDistanceKm, 400);
  assert.equal(call.arg.reasonCode, '4');
});
