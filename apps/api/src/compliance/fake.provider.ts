import { createHash } from 'node:crypto';
import type {
  CancelResult,
  EwbRequest,
  EwbResult,
  GstComplianceProvider,
  GstSession,
  IrnRequest,
  IrnResult,
} from './gst.types';
import { GstProviderError } from './gst.types';

/**
 * A deterministic, offline provider that mimics the portal's shapes without any
 * network. It lets the full execution pipeline — build → validate → transmit →
 * persist → audit — be exercised end to end in tests and in a demo deployment
 * (`GST_PROVIDER=fake`) with no credentials. It NEVER contacts a government
 * portal, and it is never selected in production.
 *
 * Determinism: the IRN is a SHA-256 of `gstin|docNo` (64 hex chars, like a real
 * IRN); the e-way number is a 12-digit projection of the same hash. Construct
 * with `{ duplicate: true }` to exercise the idempotent duplicate-reconcile
 * branch (the portal returns the existing reference instead of a fresh one).
 */
export class FakeGstProvider implements GstComplianceProvider {
  readonly name = 'fake';
  readonly calls: Array<{ op: string; arg: unknown }> = [];

  constructor(private readonly opts: { duplicate?: boolean } = {}) {}

  isConfigured(): boolean {
    return true;
  }

  async authenticate(tenantId: string, gstin: string): Promise<GstSession> {
    this.calls.push({ op: 'authenticate', arg: { tenantId, gstin } });
    return { tenantId, gstin, authToken: 'fake-token', expiresAt: Number.MAX_SAFE_INTEGER };
  }

  async generateIrn(session: GstSession, request: IrnRequest): Promise<IrnResult> {
    this.calls.push({ op: 'generateIrn', arg: request });
    const docNo = docNoOf(request);
    const irn = hash64(`${session.gstin}|${docNo}`);
    const result: IrnResult = {
      irn,
      ackNo: digits(irn, 12),
      ackDate: today(),
      signedQrCode: `QR|${irn.slice(0, 24)}`,
    };
    // Path A: when EwbDtls is included, the portal returns the e-way bill too.
    const ewb = request.EwbDtls as { Distance?: unknown } | undefined;
    if (ewb) {
      const days = Math.max(1, Math.ceil(Number(ewb.Distance ?? 0) / 200));
      result.ewayBillNo = digits(hash64(`${session.gstin}|ewb|${docNo}`), 12);
      result.ewayBillDate = today();
      result.validUpto = new Date(Date.now() + days * 86_400_000).toISOString();
    }
    if (this.opts.duplicate) {
      throw new GstProviderError('DUPLICATE_IRN', `IRN already generated for ${docNo}`, { ...result });
    }
    return result;
  }

  async cancelIrn(session: GstSession, irn: string): Promise<CancelResult> {
    this.calls.push({ op: 'cancelIrn', arg: irn });
    return { reference: irn, cancelledAt: new Date().toISOString() };
  }

  async generateEwayBill(session: GstSession, request: EwbRequest): Promise<EwbResult> {
    this.calls.push({ op: 'generateEwayBill', arg: request });
    const docNo = docNoOf(request);
    const ewayBillNo = digits(hash64(`${session.gstin}|ewb|${docNo}`), 12);
    const base = new Date();
    const validUpto = new Date(base.getTime() + Math.max(1, request.validityDays) * 86_400_000);
    if (this.opts.duplicate) {
      throw new GstProviderError('DUPLICATE_EWB', `e-way bill already generated for ${docNo}`, {
        ewayBillNo, ewayBillDate: base.toISOString(), validUpto: validUpto.toISOString(),
      });
    }
    return { ewayBillNo, ewayBillDate: base.toISOString(), validUpto: validUpto.toISOString() };
  }
}

function hash64(input: string): string {
  return createHash('sha256').update(input).digest('hex'); // 64 hex chars
}

/** A stable N-digit numeric string projected from a hex hash. */
function digits(hex: string, n: number): string {
  let out = '';
  for (const ch of hex) {
    out += (parseInt(ch, 16) % 10).toString();
    if (out.length >= n) break;
  }
  return out.slice(0, n).padStart(n, '0');
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Pull the document number out of either request shape (INV-01 or EWB). */
function docNoOf(request: Record<string, unknown>): string {
  const doc = request.DocDtls as { No?: unknown } | undefined;
  if (doc && typeof doc.No === 'string') return doc.No;
  if (typeof request.docNo === 'string') return request.docNo;
  return 'UNKNOWN';
}
