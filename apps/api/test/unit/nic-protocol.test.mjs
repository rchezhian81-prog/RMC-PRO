/**
 * Unit tests for the pure NIC protocol layer (nic-protocol.util) — the runbook
 * §7 error table, duplicate-reference extraction, response mapping, and the retry
 * policy. This is the interpretation the live adapter delegates to; testing it
 * here proves the behaviour deterministically WITHOUT a live portal.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NIC_CODES,
  classify,
  errorCodes,
  errorMessages,
  extractDuplicateIrn,
  extractDuplicateEwb,
  mapIrnData,
  mapEwbData,
  parseNicExpiry,
  runResilientCall,
} from '../../dist/compliance/nic-protocol.util.js';

const IRN = 'a1b2'.repeat(16); // a 64-char hex IRN
const err = (code, message = 'x') => ({ ErrorDetails: [{ ErrorCode: code, ErrorMessage: message }] });

// ── classify (runbook §7) ────────────────────────────────────────────────────

test('classify treats Status 1 / "1" / Success:true as success', () => {
  assert.equal(classify({ Status: '1' }, 'IRN').type, 'success');
  assert.equal(classify({ Status: 1 }, 'IRN').type, 'success');
  assert.equal(classify({ Success: true }, 'EWB').type, 'success');
});

test('classify maps 2150 to a duplicate IRN, 4002 to a duplicate EWB', () => {
  assert.equal(classify(err(NIC_CODES.DUPLICATE_IRN), 'IRN').type, 'duplicate');
  assert.equal(classify(err(NIC_CODES.DUPLICATE_EWB), 'EWB').type, 'duplicate');
});

test('classify does NOT treat the IRN duplicate code as a duplicate on an EWB call', () => {
  // 2150 is IRN-specific; on an EWB call it is just a rejection, not a reconcile.
  assert.equal(classify(err(NIC_CODES.DUPLICATE_IRN), 'EWB').type, 'rejected');
});

test('classify maps 1005/1006/1007 to auth_expired', () => {
  for (const code of NIC_CODES.AUTH) {
    assert.equal(classify(err(code), 'IRN').type, 'auth_expired');
  }
});

test('classify maps 2172 to cancelled for an IRN call', () => {
  assert.equal(classify(err(NIC_CODES.IRN_CANCELLED), 'IRN').type, 'cancelled');
});

test('classify returns rejected with messages for an unknown error', () => {
  const c = classify(err('9999', 'HSN is invalid'), 'IRN');
  assert.equal(c.type, 'rejected');
  assert.deepEqual(c.errors, ['HSN is invalid']);
});

test('errorCodes and errorMessages read ErrorDetails (and a top-level code)', () => {
  const resp = { ErrorDetails: [{ ErrorCode: '2150', ErrorMessage: 'dup' }], ErrorCode: '9' };
  assert.deepEqual(errorCodes(resp), ['2150', '9']);
  assert.deepEqual(errorMessages(resp), ['dup']);
});

// ── duplicate reference extraction (fixes the reconcile bug) ──────────────────

test('extractDuplicateIrn pulls a top-level IRN + ack fields', () => {
  const r = extractDuplicateIrn({ Irn: IRN, AckNo: 112420036, AckDt: '2026-08-01 10:00:00', SignedQRCode: 'QR==' });
  assert.equal(r.irn, IRN);
  assert.equal(r.ackNo, '112420036');
  assert.equal(r.ackDate, '2026-08-01 10:00:00');
  assert.equal(r.signedQrCode, 'QR==');
});

test('extractDuplicateIrn recovers the IRN embedded in an error message', () => {
  const r = extractDuplicateIrn(err(NIC_CODES.DUPLICATE_IRN, `Duplicate IRN for the document: ${IRN}`));
  assert.equal(r.irn, IRN);
});

test('extractDuplicateIrn recovers the IRN from a nested InfoDtls entry', () => {
  const r = extractDuplicateIrn({ InfoDtls: [{ InfCd: 'DUPIRN', Desc: IRN }] });
  assert.equal(r.irn, IRN);
});

test('extractDuplicateIrn returns null when no IRN can be recovered', () => {
  assert.equal(extractDuplicateIrn(err(NIC_CODES.DUPLICATE_IRN, 'duplicate, no ref given')), null);
});

test('extractDuplicateEwb recovers a 12-digit e-way bill number', () => {
  assert.equal(extractDuplicateEwb({ EwbNo: '123456789012' }).ewayBillNo, '123456789012');
  assert.equal(extractDuplicateEwb({ ErrorDetails: [{ Desc: 'exists as 991234567890' }] }).ewayBillNo, '991234567890');
  assert.equal(extractDuplicateEwb({ Status: '0' }), null);
});

// ── response mapping ─────────────────────────────────────────────────────────

test('mapIrnData / mapEwbData map the portal fields to the provider result', () => {
  assert.deepEqual(
    mapIrnData({ Irn: IRN, AckNo: 42, AckDt: '2026-08-01', SignedQRCode: 'QR' }),
    { irn: IRN, ackNo: '42', ackDate: '2026-08-01', signedQrCode: 'QR' },
  );
  assert.deepEqual(
    mapEwbData({ EwbNo: 123456789012, EwbDt: '2026-08-01', EwbValidTill: '2026-08-03' }),
    { ewayBillNo: '123456789012', ewayBillDate: '2026-08-01', validUpto: '2026-08-03' },
  );
});

test('parseNicExpiry parses NIC datetime, else falls back to now + 6h', () => {
  const now = 1_000_000_000_000;
  assert.equal(parseNicExpiry('2026-08-01 10:00:00', now), Date.parse('2026-08-01T10:00:00'));
  assert.equal(parseNicExpiry(undefined, now), now + 6 * 3_600_000);
  assert.equal(parseNicExpiry('not-a-date', now), now + 6 * 3_600_000);
});

// ── retry policy (runResilientCall) ──────────────────────────────────────────

function scripted(steps) {
  const state = { calls: 0 };
  const attempt = async () => {
    state.calls += 1;
    return steps[Math.min(state.calls - 1, steps.length - 1)];
  };
  return { attempt, state };
}

test('runResilientCall returns the value on immediate success (one attempt)', async () => {
  const { attempt, state } = scripted([{ ok: true, value: 7 }]);
  let reauths = 0;
  const v = await runResilientCall({ attempt, reauth: async () => { reauths++; }, onExhausted: () => new Error('x') });
  assert.equal(v, 7);
  assert.equal(state.calls, 1);
  assert.equal(reauths, 0);
});

test('runResilientCall re-authenticates ONCE on auth_expired then retries', async () => {
  const { attempt, state } = scripted([{ retry: 'auth' }, { ok: true, value: 'done' }]);
  let reauths = 0;
  const v = await runResilientCall({ attempt, reauth: async () => { reauths++; }, onExhausted: () => new Error('x') });
  assert.equal(v, 'done');
  assert.equal(reauths, 1);
  assert.equal(state.calls, 2);
});

test('runResilientCall gives up if auth is still expired after the single re-auth', async () => {
  const { attempt, state } = scripted([{ retry: 'auth' }]); // always auth_expired
  let reauths = 0;
  await assert.rejects(
    runResilientCall({ attempt, reauth: async () => { reauths++; }, onExhausted: () => new Error('exhausted') }),
    /exhausted/,
  );
  assert.equal(reauths, 1); // never re-auths more than once
  assert.equal(state.calls, 2);
});

test('runResilientCall backs off and retries a transient unavailable, then succeeds', async () => {
  const { attempt, state } = scripted([{ retry: 'unavailable' }, { ok: true, value: 'ok' }]);
  const delays = [];
  const v = await runResilientCall({
    attempt,
    reauth: async () => {},
    sleep: async (ms) => { delays.push(ms); },
    onExhausted: () => new Error('x'),
  });
  assert.equal(v, 'ok');
  assert.equal(state.calls, 2);
  assert.deepEqual(delays, [250]); // default backoff for the first retry
});

test('runResilientCall exhausts unavailable retries with exponential backoff', async () => {
  const { attempt, state } = scripted([{ retry: 'unavailable' }]); // never recovers
  const delays = [];
  await assert.rejects(
    runResilientCall({
      attempt,
      reauth: async () => {},
      retries: 2,
      sleep: async (ms) => { delays.push(ms); },
      onExhausted: () => new Error('unavailable after retries'),
    }),
    /unavailable after retries/,
  );
  assert.equal(state.calls, 3); // initial + 2 retries
  assert.deepEqual(delays, [250, 500]); // 250·2^0, 250·2^1
});

test('runResilientCall throws a terminal failure immediately (no retry)', async () => {
  const boom = new Error('duplicate / rejected');
  const { attempt, state } = scripted([{ fail: boom }]);
  await assert.rejects(
    runResilientCall({ attempt, reauth: async () => {}, onExhausted: () => new Error('x') }),
    (e) => e === boom,
  );
  assert.equal(state.calls, 1);
});
