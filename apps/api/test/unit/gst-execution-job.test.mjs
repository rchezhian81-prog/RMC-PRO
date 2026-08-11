/**
 * Unit tests for the pure decision helpers of the durable GST execution queue
 * (GW-1): the outcome→job-status mapping and the retry backoff. The DB-backed
 * enqueue/claim/drain/reconcile paths are covered end to end in
 * test/agents-gst-execution.test.mjs.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jobStatusForOutcome, backoffMs } from '../../dist/compliance/gst-execution-job.service.js';

test('terminal-success outcomes mark the job done (incl. idempotent + reconciled)', () => {
  for (const s of ['generated', 'cancelled', 'updated', 'extended', 'reconciled', 'already_generated', 'already_cancelled']) {
    assert.equal(jobStatusForOutcome(s), 'done', s);
  }
});

test('a real failure marks the job failed; a skip leaves it queued', () => {
  assert.equal(jobStatusForOutcome('failed'), 'failed');
  assert.equal(jobStatusForOutcome('skipped'), 'queued'); // provider off → run later
  assert.equal(jobStatusForOutcome('anything_else'), 'queued');
});

test('backoff is exponential from a 30s base, capped at 1 hour', () => {
  assert.equal(backoffMs(0), 30_000);
  assert.equal(backoffMs(1), 60_000);
  assert.equal(backoffMs(2), 120_000);
  assert.equal(backoffMs(3), 240_000);
  assert.equal(backoffMs(20), 3_600_000); // capped
  assert.equal(backoffMs(-5), 30_000); // floored at attempt 0
});
