import type { EwbResult, IrnResult } from './gst.types';

/**
 * Pure interpretation of the NIC/GSP envelope + the runbook §7 error table, and a
 * small resilience runner — the parts of the live adapter that DON'T touch the
 * network or crypto, so they unit-test deterministically without a live portal.
 *
 * `nic.provider.ts` owns the encrypted transport; it hands the decoded response
 * envelope to `classify()` here to decide success / duplicate / re-auth / reject,
 * and drives retries through `runResilientCall()`.
 *
 * The exact codes/field names are the documented NIC ones (runbook 01 §7); a GSP
 * wrapper may rename them — the extractors are deliberately defensive and the
 * seams are small, so a deploy-time confirmation is a localised change.
 */

/** Error codes that carry a specific meaning (runbook 01 §7). */
export const NIC_CODES = {
  /** Duplicate IRN — already generated for this DocNo. Treat as success. */
  DUPLICATE_IRN: '2150',
  /** Duplicate e-way bill for this document. */
  DUPLICATE_EWB: '4002',
  /** IRN already cancelled. */
  IRN_CANCELLED: '2172',
  /** Invalid / expired auth token or login — re-authenticate and retry once. */
  AUTH: ['1005', '1006', '1007'] as readonly string[],
} as const;

export type NicKind = 'IRN' | 'EWB';

export type Classification =
  | { type: 'success' }
  | { type: 'auth_expired' }
  | { type: 'duplicate' }
  | { type: 'cancelled' }
  | { type: 'rejected'; errors: string[] };

/** NIC signals success with Status '1' (some GSPs use a boolean `Success`). */
export function envelopeIsSuccess(resp: Record<string, unknown>): boolean {
  return resp.Status === '1' || resp.Status === 1 || resp.Success === true;
}

/** Pull the error codes out of the envelope's `ErrorDetails` (+ a top-level one). */
export function errorCodes(resp: Record<string, unknown>): string[] {
  const codes: string[] = [];
  const list = Array.isArray(resp.ErrorDetails) ? (resp.ErrorDetails as Array<Record<string, unknown>>) : [];
  for (const e of list) {
    const c = e.ErrorCode ?? e.errorCode ?? e.Code;
    if (c != null) codes.push(String(c));
  }
  if (resp.ErrorCode != null) codes.push(String(resp.ErrorCode));
  return codes;
}

/** Human-readable messages from the envelope, for a rejection surfaced to the operator. */
export function errorMessages(resp: Record<string, unknown>): string[] {
  const list = Array.isArray(resp.ErrorDetails) ? (resp.ErrorDetails as Array<Record<string, unknown>>) : [];
  const msgs = list
    .map((e) => e.ErrorMessage ?? e.errorMessage ?? e.ErrorMsg ?? e.Desc ?? e.message)
    .filter((m): m is string => typeof m === 'string' && m.trim() !== '');
  if (msgs.length) return msgs;
  const top = resp.ErrorMessage ?? resp.error ?? resp.Status;
  return [typeof top === 'string' ? top : JSON.stringify(top ?? 'unknown portal error')];
}

/** Decide what a (non-transport-error) response means for the given call kind. */
export function classify(resp: Record<string, unknown>, kind: NicKind): Classification {
  if (envelopeIsSuccess(resp)) return { type: 'success' };
  const codes = errorCodes(resp);
  if (codes.some((c) => NIC_CODES.AUTH.includes(c))) return { type: 'auth_expired' };
  const dupCode = kind === 'IRN' ? NIC_CODES.DUPLICATE_IRN : NIC_CODES.DUPLICATE_EWB;
  if (codes.includes(dupCode)) return { type: 'duplicate' };
  if (kind === 'IRN' && codes.includes(NIC_CODES.IRN_CANCELLED)) return { type: 'cancelled' };
  return { type: 'rejected', errors: errorMessages(resp) };
}

const IRN_RE = /\b[0-9a-fA-F]{64}\b/; // an IRN is a 64-char SHA-256 hex
const EWB_RE = /\b\d{12}\b/; //          an e-way bill number is 12 digits

/** Every string value reachable in the envelope (shallow + one nested level). */
function stringValues(resp: Record<string, unknown>): string[] {
  const out: string[] = [];
  const visit = (v: unknown, depth: number): void => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v) && depth < 3) v.forEach((x) => visit(x, depth + 1));
    else if (v && typeof v === 'object' && depth < 3) Object.values(v).forEach((x) => visit(x, depth + 1));
  };
  visit(resp, 0);
  return out;
}

/**
 * On a duplicate IRN (2150) the portal returns the EXISTING IRN so it can be
 * reconciled onto the invoice — never filed twice. GSPs place it differently
 * (a top-level `Irn`, an `InfoDtls`/`Info` entry, or embedded in the error text),
 * so we take the first 64-hex token we can find and carry any ack fields present.
 * Returns null if no IRN can be recovered (caller then treats it as a rejection).
 */
export function extractDuplicateIrn(resp: Record<string, unknown>): IrnResult | null {
  const direct = resp.Irn;
  const irn =
    (typeof direct === 'string' && IRN_RE.test(direct) ? direct : undefined) ??
    stringValues(resp).map((s) => IRN_RE.exec(s)?.[0]).find(Boolean);
  if (!irn) return null;
  return {
    irn,
    ackNo: resp.AckNo != null ? String(resp.AckNo) : '',
    ackDate: resp.AckDt != null ? String(resp.AckDt) : '',
    signedQrCode: resp.SignedQRCode != null ? String(resp.SignedQRCode) : '',
  };
}

/** Duplicate e-way bill (4002) → recover the existing 12-digit EWB number. */
export function extractDuplicateEwb(resp: Record<string, unknown>): EwbResult | null {
  const direct = resp.EwbNo ?? resp.ewayBillNo;
  const ewb =
    (typeof direct !== 'undefined' && EWB_RE.test(String(direct)) ? String(direct) : undefined) ??
    stringValues(resp).map((s) => EWB_RE.exec(s)?.[0]).find(Boolean);
  if (!ewb) return null;
  return {
    ewayBillNo: ewb,
    ewayBillDate: resp.EwbDt != null ? String(resp.EwbDt) : '',
    validUpto: resp.EwbValidTill != null ? String(resp.EwbValidTill) : '',
  };
}

/** Map a decrypted IRN success payload to the provider result. */
export function mapIrnData(d: Record<string, unknown>): IrnResult {
  const result: IrnResult = {
    irn: String(d.Irn),
    ackNo: String(d.AckNo),
    ackDate: String(d.AckDt),
    signedQrCode: String(d.SignedQRCode),
  };
  // Path A: the IRP returns the e-way bill in the same response when EwbDtls was
  // sent. Carry it so the execution service can persist both from one call.
  if (d.EwbNo != null && String(d.EwbNo) !== '') {
    result.ewayBillNo = String(d.EwbNo);
    result.ewayBillDate = d.EwbDt != null ? String(d.EwbDt) : '';
    result.validUpto = d.EwbValidTill != null ? String(d.EwbValidTill) : '';
  }
  return result;
}

/** Map a decrypted e-way success payload to the provider result. */
export function mapEwbData(d: Record<string, unknown>): EwbResult {
  return {
    ewayBillNo: String(d.EwbNo ?? d.ewayBillNo),
    ewayBillDate: String(d.EwbDt ?? d.ewayBillDate),
    validUpto: String(d.EwbValidTill ?? d.validUpto),
  };
}

/** NIC returns 'yyyy-MM-dd HH:mm:ss'; → epoch ms. Falls back to `now + 6h`. */
export function parseNicExpiry(raw: string | undefined, now: number): number {
  const t = raw ? Date.parse(raw.replace(' ', 'T')) : NaN;
  return Number.isFinite(t) ? t : now + 6 * 3_600_000;
}

// ---- resilience runner ------------------------------------------------------

/** One attempt's outcome, as VALUES (not exceptions) so the runner can branch. */
export type CallStep<T> =
  | { ok: true; value: T }
  | { retry: 'auth' | 'unavailable' }
  | { fail: Error };

export interface ResilienceOptions<T> {
  /** Perform one encrypted round-trip and classify it into a CallStep. */
  attempt: () => Promise<CallStep<T>>;
  /** Re-authenticate (drops the stale session). Invoked at most once. */
  reauth: () => Promise<void>;
  /** Max retries for transient 'unavailable' outcomes (default 2). */
  retries?: number;
  /** Backoff before the i-th unavailable retry (default 250ms·2^i, capped 2s). */
  backoffMs?: (i: number) => number;
  /** Sleep hook (injected in tests so no real delay). */
  sleep?: (ms: number) => Promise<void>;
  /** Error thrown when retries are exhausted. */
  onExhausted: () => Error;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const defaultBackoff = (i: number): number => Math.min(2000, 250 * 2 ** i);

/**
 * Drive `attempt()` with the runbook §7 retry policy: an auth-expired outcome
 * re-authenticates and retries ONCE (no backoff); a transient 'unavailable'
 * outcome retries up to `retries` times with exponential backoff; success and
 * terminal failures return/throw immediately. Deterministic and pure given the
 * injected `attempt`/`reauth`/`sleep`.
 */
export async function runResilientCall<T>(opts: ResilienceOptions<T>): Promise<T> {
  const { attempt, reauth, retries = 2, backoffMs = defaultBackoff, sleep = defaultSleep, onExhausted } = opts;
  let reauthed = false;
  let unavailable = 0;
  // Bounded overall loop: at most one auth retry + `retries` unavailable retries.
  for (let guard = 0; guard <= retries + 2; guard++) {
    const step = await attempt();
    if ('ok' in step) return step.value;
    if ('fail' in step) throw step.fail;
    if (step.retry === 'auth') {
      if (reauthed) throw onExhausted();
      reauthed = true;
      await reauth();
      continue;
    }
    // 'unavailable'
    if (unavailable >= retries) throw onExhausted();
    await sleep(backoffMs(unavailable));
    unavailable += 1;
  }
  throw onExhausted();
}
