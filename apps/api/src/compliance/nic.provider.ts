import { Logger } from '@nestjs/common';
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
import { aesDecrypt, aesDecryptToBuffer, aesEncryptBase64, genAppKey, rsaEncryptBase64 } from './nic-crypto.util';

/**
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │  SKELETON — NOT VERIFIED AGAINST A LIVE PORTAL.                            │
 * │  The crypto (nic-crypto.util) and the encrypted transport are implemented,│
 * │  but every `TODO(deploy)` below is a GSP-specific decision — endpoint      │
 * │  paths, exact request/response field names, error/duplicate codes, and the │
 * │  per-tenant credential store — that MUST be confirmed against YOUR GSP's    │
 * │  current spec and exercised in sandbox before go-live. See                 │
 * │  docs/deployment/INTEGRATION-RUNBOOK-00/01/02.                             │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * The live NIC/GSP adapter. Selected by `GST_PROVIDER=nic`. It fills the one seam
 * the scaffold left open: authenticating to the portal and transmitting the
 * already-built INV-01 / EWB requests (built by gst-payload.util, passed in by
 * GstExecutionService). The guardrails around it — approval gate, pre-flight,
 * idempotency, persistence, audit — are unchanged and live in the execution
 * service; this class only speaks to the portal.
 */
export class NicGstProvider implements GstComplianceProvider {
  readonly name = 'nic';
  private readonly log = new Logger(NicGstProvider.name);

  /** Session material per seller GSTIN. The `sek` (session key) never leaves here. */
  private readonly sessions = new Map<string, { authToken: string; sek: Buffer; expiresAt: number }>();

  // ---- endpoint paths (TODO(deploy): confirm exact paths/versions with your GSP) ----
  private static readonly PATHS = {
    auth: '/eivital/v1.04/auth',
    irnGenerate: '/eicore/v1.03/Invoice',
    irnCancel: '/eicore/v1.03/Invoice/Cancel',
    ewbGenerate: '/ewaybillapi/v1.03/ewayapi',
  };

  isConfigured(): boolean {
    return !!(
      process.env.GST_IRP_BASE_URL?.trim() &&
      process.env.GST_GSP_CLIENT_ID?.trim() &&
      process.env.GST_GSP_CLIENT_SECRET?.trim() &&
      process.env.GST_RSA_PUBLIC_KEY_PEM?.trim()
    );
  }

  // ---- auth ----

  async authenticate(gstin: string): Promise<GstSession> {
    // Reuse a cached, unexpired session.
    const cached = this.sessions.get(gstin);
    if (cached && cached.expiresAt > Date.now() + 5 * 60_000) {
      return { gstin, authToken: cached.authToken, expiresAt: cached.expiresAt };
    }

    // TODO(deploy): the portal user_name/password are PER TENANT and live in the
    // encrypted per-tenant credential store (runbook 00 §7), NOT in env. Wire this
    // to that store; it is the one piece the scaffold cannot supply.
    const creds = await this.resolveTenantCreds(gstin);

    const appKey = genAppKey();
    // TODO(deploy): confirm the auth payload field names/casing with your GSP.
    const authPayload = JSON.stringify({
      UserName: creds.username,
      Password: creds.password,
      AppKey: appKey.toString('base64'),
      ForceRefreshAccessToken: false,
    });

    const body = { Data: rsaEncryptBase64(this.env('GST_RSA_PUBLIC_KEY_PEM'), authPayload) };
    const resp = await this.post(this.irpBase(), NicGstProvider.PATHS.auth, gstin, body, /* authToken */ undefined);
    if (!this.isSuccess(resp)) {
      throw new GstProviderError('AUTH_FAILED', `authentication failed: ${this.errText(resp)}`);
    }

    // The auth response `Data` is AES-encrypted with the AppKey; inside it, `Sek`
    // is the session key (itself AES(AppKey, sessionKey)). Decrypt both.
    // TODO(deploy): confirm response field names (AuthToken/Sek/TokenExpiry).
    const authData = JSON.parse(aesDecrypt(appKey, String(resp.Data))) as {
      AuthToken?: string; Sek?: string; TokenExpiry?: string;
    };
    if (!authData.AuthToken || !authData.Sek) {
      throw new GstProviderError('AUTH_FAILED', 'auth response missing AuthToken/Sek');
    }
    const sek = aesDecryptToBuffer(appKey, authData.Sek);
    const expiresAt = this.parseExpiry(authData.TokenExpiry);

    this.sessions.set(gstin, { authToken: authData.AuthToken, sek, expiresAt });
    return { gstin, authToken: authData.AuthToken, expiresAt };
  }

  // ---- business calls (thin: wrap → POST → unwrap → map) ----

  async generateIrn(session: GstSession, request: IrnRequest): Promise<IrnResult> {
    const d = await this.call(session, this.irpBase(), NicGstProvider.PATHS.irnGenerate, request, 'IRN');
    // TODO(deploy): confirm response field names with your GSP.
    return {
      irn: String(d.Irn),
      ackNo: String(d.AckNo),
      ackDate: String(d.AckDt),
      signedQrCode: String(d.SignedQRCode),
    };
  }

  async generateEwayBill(session: GstSession, request: EwbRequest): Promise<EwbResult> {
    const d = await this.call(session, this.ewbBase(), NicGstProvider.PATHS.ewbGenerate, request, 'EWB');
    // TODO(deploy): confirm response field names with your GSP.
    return {
      ewayBillNo: String(d.EwbNo ?? d.ewayBillNo),
      ewayBillDate: String(d.EwbDt ?? d.ewayBillDate),
      validUpto: String(d.EwbValidTill ?? d.validUpto),
    };
  }

  async cancelIrn(session: GstSession, irn: string, reasonCode: string, remarks: string): Promise<CancelResult> {
    // TODO(deploy): confirm the cancel request field names (CnlRsn/CnlRem).
    const d = await this.call(session, this.irpBase(), NicGstProvider.PATHS.irnCancel, { Irn: irn, CnlRsn: reasonCode, CnlRem: remarks }, 'IRN');
    return { reference: String(d.Irn ?? irn), cancelledAt: String(d.CancelDate ?? new Date().toISOString()) };
  }

  // ---- encrypted transport ----

  /** Wrap a business payload in the session envelope, POST it, and unwrap the reply. */
  private async call(
    session: GstSession,
    base: string,
    path: string,
    payload: Record<string, unknown>,
    kind: 'IRN' | 'EWB',
  ): Promise<Record<string, unknown>> {
    const s = this.sessions.get(session.gstin);
    if (!s) throw new GstProviderError('AUTH_FAILED', 'no active session; call authenticate() first');

    const body = { Data: aesEncryptBase64(s.sek, JSON.stringify(payload)) };
    const resp = await this.post(base, path, session.gstin, body, s.authToken);

    if (this.isSuccess(resp)) {
      // Success payload is AES-encrypted with the Sek.
      return JSON.parse(aesDecrypt(s.sek, String(resp.Data))) as Record<string, unknown>;
    }

    // A duplicate is the portal's idempotency, not a failure — surface the
    // existing reference so the execution service can reconcile it.
    const dup = this.parseDuplicate(resp, kind);
    if (dup) throw dup;

    throw new GstProviderError('PORTAL_REJECTED', `${kind} rejected: ${this.errText(resp)}`, { raw: this.safeErr(resp) });
  }

  /** The raw HTTPS POST of the `{ Data }` envelope. */
  private async post(
    base: string,
    path: string,
    gstin: string,
    body: Record<string, unknown>,
    authToken: string | undefined,
  ): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // TODO(deploy): confirm the exact header names your GSP expects.
          'client-id': this.env('GST_GSP_CLIENT_ID'),
          'client-secret': this.env('GST_GSP_CLIENT_SECRET'),
          Gstin: gstin,
          ...(authToken ? { AuthToken: authToken } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new GstProviderError('PORTAL_UNAVAILABLE', `portal unreachable: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (res.status >= 500) throw new GstProviderError('PORTAL_UNAVAILABLE', `portal ${res.status}`);
    return (await res.json().catch(() => ({}))) as Record<string, unknown>;
  }

  // ---- helpers (TODO(deploy): confirm the envelope's success/error shape) ----

  private isSuccess(resp: Record<string, unknown>): boolean {
    // NIC returns Status '1' on success; some GSPs use a boolean/`Success`.
    return resp.Status === '1' || resp.Status === 1 || resp.Success === true;
  }

  /**
   * Detect the duplicate case and extract the existing reference. TODO(deploy):
   * NIC signals a duplicate IRN with error code 2150 and returns the existing IRN
   * in the error info; map your GSP's exact shape here.
   */
  private parseDuplicate(resp: Record<string, unknown>, kind: 'IRN' | 'EWB'): GstProviderError | null {
    const errs = Array.isArray(resp.ErrorDetails) ? (resp.ErrorDetails as Array<Record<string, unknown>>) : [];
    const dupCode = kind === 'IRN' ? '2150' : '4002'; // TODO(deploy): confirm codes
    const hit = errs.find((e) => String(e.ErrorCode ?? e.errorCode) === dupCode);
    if (!hit) return null;
    // TODO(deploy): extract the existing IRN/EWB from the info payload your GSP returns.
    return new GstProviderError(kind === 'IRN' ? 'DUPLICATE_IRN' : 'DUPLICATE_EWB', `duplicate ${kind}`, {
      note: 'reconcile the existing reference — fill in the extraction from your GSP error payload',
    });
  }

  private async resolveTenantCreds(gstin: string): Promise<{ username: string; password: string }> {
    // TODO(deploy): read the tenant's portal API username/password from the
    // encrypted per-tenant store (runbook 00 §7). Held — never from env/repo.
    throw new GstProviderError(
      'NOT_IMPLEMENTED',
      `per-tenant portal credentials for GSTIN ${gstin} are not wired — see INTEGRATION-RUNBOOK-00 §7`,
    );
  }

  private irpBase(): string {
    return this.env('GST_IRP_BASE_URL').replace(/\/$/, '');
  }
  private ewbBase(): string {
    return (process.env.GST_EWB_BASE_URL?.trim() || this.irpBase()).replace(/\/$/, '');
  }

  private env(name: string): string {
    const v = process.env[name]?.trim();
    if (!v) throw new GstProviderError('NOT_IMPLEMENTED', `missing required env ${name}`);
    return v;
  }

  private parseExpiry(raw: string | undefined): number {
    // TODO(deploy): NIC returns 'yyyy-MM-dd HH:mm:ss'; parse to epoch ms. Default 6h.
    const t = raw ? Date.parse(raw.replace(' ', 'T')) : NaN;
    return Number.isFinite(t) ? t : Date.now() + 6 * 3_600_000;
  }

  private errText(resp: Record<string, unknown>): string {
    return JSON.stringify(this.safeErr(resp));
  }
  private safeErr(resp: Record<string, unknown>): unknown {
    return resp.ErrorDetails ?? resp.error ?? resp.Status ?? 'unknown';
  }
}
