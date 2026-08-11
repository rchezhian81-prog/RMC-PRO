import { Logger } from '@nestjs/common';
import type {
  CancelResult,
  EwbExtendInput,
  EwbModifyResult,
  EwbRequest,
  EwbResult,
  EwbUpdateVehicleInput,
  GstComplianceProvider,
  GstSession,
  IrnRequest,
  IrnResult,
} from './gst.types';
import { GstProviderError } from './gst.types';
import type { GstCredentialStore } from './gst-credential-store.service';
import { aesDecrypt, aesDecryptToBuffer, aesEncryptBase64, genAppKey, rsaEncryptBase64 } from './nic-crypto.util';
import {
  NIC_CODES,
  classify,
  errorMessages,
  extractDuplicateEwb,
  extractDuplicateIrn,
  mapEwbData,
  mapIrnData,
  parseNicExpiry,
  runResilientCall,
  type CallStep,
  type NicKind,
} from './nic-protocol.util';

/**
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │  SKELETON — NOT VERIFIED AGAINST A LIVE PORTAL.                            │
 * │  The crypto (nic-crypto.util), the encrypted transport, the §7 error       │
 * │  handling and retry policy (nic-protocol.util) are implemented and tested. │
 * │  Every `TODO(deploy)` below is a GSP-specific decision — endpoint paths,    │
 * │  exact request/response field names, and the per-tenant credential store — │
 * │  that MUST be confirmed against YOUR GSP's spec and exercised in sandbox    │
 * │  before go-live. See docs/deployment/INTEGRATION-RUNBOOK-00/01/02.         │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * The live NIC/GSP adapter (`GST_PROVIDER=nic`). It authenticates to the portal
 * and transmits the already-built INV-01 / EWB requests; the guardrails around it
 * (approval gate, pre-flight, idempotency, persistence, audit) live in the
 * execution service. Response interpretation and the retry policy are delegated
 * to the pure, unit-tested `nic-protocol.util`.
 */
export class NicGstProvider implements GstComplianceProvider {
  readonly name = 'nic';
  private readonly log = new Logger(NicGstProvider.name);

  /** The tenant's portal credentials come from the encrypted store (runbook 00 §7). */
  constructor(private readonly credStore: GstCredentialStore) {}

  /** Session material per tenant+GSTIN. The `sek` (session key) never leaves here. */
  private readonly sessions = new Map<string, { authToken: string; sek: Buffer; expiresAt: number }>();

  private sessionKey(tenantId: string, gstin: string): string {
    return `${tenantId}:${gstin}`;
  }

  // ---- endpoint paths (TODO(deploy): confirm exact paths/versions with your GSP) ----
  private static readonly PATHS = {
    auth: '/eivital/v1.04/auth',
    irnGenerate: '/eicore/v1.03/Invoice',
    irnCancel: '/eicore/v1.03/Invoice/Cancel',
    ewbGenerate: '/ewaybillapi/v1.03/ewayapi',
    ewbCancel: '/ewaybillapi/v1.03/ewayapi/canewb',
    ewbVehicle: '/ewaybillapi/v1.03/ewayapi/vehewb',
    ewbExtend: '/ewaybillapi/v1.03/ewayapi/extendvalidity',
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

  async authenticate(tenantId: string, gstin: string): Promise<GstSession> {
    const k = this.sessionKey(tenantId, gstin);
    // Reuse a cached, unexpired session (5-min skew guard).
    const cached = this.sessions.get(k);
    if (cached && cached.expiresAt > Date.now() + 5 * 60_000) {
      return { tenantId, gstin, authToken: cached.authToken, expiresAt: cached.expiresAt };
    }

    // The portal user_name/password are PER TENANT — resolved (decrypted) from the
    // encrypted credential store, never from env/repo (runbook 00 §7).
    const creds = await this.resolveTenantCreds(tenantId, gstin);

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
    if (classify(resp, 'IRN').type !== 'success') {
      throw new GstProviderError('AUTH_FAILED', `authentication failed: ${errorMessages(resp).join('; ')}`);
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
    const expiresAt = parseNicExpiry(authData.TokenExpiry, Date.now());

    this.sessions.set(k, { authToken: authData.AuthToken, sek, expiresAt });
    return { tenantId, gstin, authToken: authData.AuthToken, expiresAt };
  }

  // ---- business calls (thin: wrap → POST → classify → unwrap → map) ----

  async generateIrn(session: GstSession, request: IrnRequest): Promise<IrnResult> {
    const d = await this.call(session, this.irpBase(), NicGstProvider.PATHS.irnGenerate, request, 'IRN');
    return mapIrnData(d);
  }

  async generateEwayBill(session: GstSession, request: EwbRequest): Promise<EwbResult> {
    const d = await this.call(session, this.ewbBase(), NicGstProvider.PATHS.ewbGenerate, request, 'EWB');
    return mapEwbData(d);
  }

  async cancelIrn(session: GstSession, irn: string, reasonCode: string, remarks: string): Promise<CancelResult> {
    // TODO(deploy): confirm the cancel request field names (CnlRsn/CnlRem).
    const d = await this.call(session, this.irpBase(), NicGstProvider.PATHS.irnCancel, { Irn: irn, CnlRsn: reasonCode, CnlRem: remarks }, 'IRN');
    return { reference: String(d.Irn ?? irn), cancelledAt: String(d.CancelDate ?? new Date().toISOString()) };
  }

  async cancelEwayBill(session: GstSession, ewayBillNo: string, reasonCode: string, remarks: string): Promise<CancelResult> {
    // TODO(deploy): confirm the e-way cancel field names (ewbNo/cancelRsnCode/cancelRmrk)
    // and path — some GSPs fold cancel into the ewayapi endpoint via an action code.
    const d = await this.call(
      session,
      this.ewbBase(),
      NicGstProvider.PATHS.ewbCancel,
      { ewbNo: Number(ewayBillNo) || ewayBillNo, cancelRsnCode: Number(reasonCode) || reasonCode, cancelRmrk: remarks },
      'EWB',
    );
    return { reference: String(d.ewayBillNo ?? d.ewbNo ?? ewayBillNo), cancelledAt: String(d.cancelDate ?? new Date().toISOString()) };
  }

  async updateEwayVehicle(session: GstSession, ewayBillNo: string, input: EwbUpdateVehicleInput): Promise<EwbModifyResult> {
    // TODO(deploy): confirm the VEHEWB field names + path with your GSP.
    const d = await this.call(session, this.ewbBase(), NicGstProvider.PATHS.ewbVehicle, {
      ewbNo: Number(ewayBillNo) || ewayBillNo,
      vehicleNo: input.vehicleNo,
      fromPlace: input.fromPlace ?? '',
      fromState: Number(input.fromStateCode) || input.fromStateCode || '',
      reasonCode: Number(input.reasonCode) || input.reasonCode,
      reasonRem: input.remarks ?? '',
      transMode: input.transMode ?? '1',
      transDocNo: input.transDocNo ?? '',
      transDocDate: input.transDocDate ?? '',
    }, 'EWB');
    return {
      ewayBillNo: String(d.ewayBillNo ?? d.ewbNo ?? ewayBillNo),
      validUpto: String(d.validUpto ?? ''),
      updatedAt: String(d.vehUpdDate ?? new Date().toISOString()),
    };
  }

  async extendEwayValidity(session: GstSession, ewayBillNo: string, input: EwbExtendInput): Promise<EwbModifyResult> {
    // TODO(deploy): confirm the EXTENDVALIDITY field names + path with your GSP.
    const d = await this.call(session, this.ewbBase(), NicGstProvider.PATHS.ewbExtend, {
      ewbNo: Number(ewayBillNo) || ewayBillNo,
      vehicleNo: input.vehicleNo ?? '',
      fromPlace: input.fromPlace ?? '',
      fromState: Number(input.fromStateCode) || input.fromStateCode || '',
      remainingDistance: input.remainingDistanceKm,
      transMode: input.transMode ?? '1',
      extnRsnCode: Number(input.reasonCode) || input.reasonCode,
      extnRemarks: input.remarks ?? '',
      consignmentStatus: input.consignmentStatus ?? 'M',
      transitType: input.transitType ?? '',
    }, 'EWB');
    return {
      ewayBillNo: String(d.ewayBillNo ?? d.ewbNo ?? ewayBillNo),
      validUpto: String(d.validUpto ?? ''),
      updatedAt: String(d.updatedDate ?? new Date().toISOString()),
    };
  }

  // ---- encrypted transport + §7 retry policy ----

  /**
   * Encrypt the payload with the session key, POST it, and interpret the reply
   * (nic-protocol.classify). Runs under the runbook §7 retry policy: an expired
   * auth token re-authenticates once; a transient portal failure (429/5xx/network)
   * backs off and retries; a duplicate raises a typed error carrying the EXISTING
   * reference so the execution service reconciles rather than double-files.
   */
  private call(
    session: GstSession,
    base: string,
    path: string,
    payload: Record<string, unknown>,
    kind: NicKind,
  ): Promise<Record<string, unknown>> {
    const attempt = async (): Promise<CallStep<Record<string, unknown>>> => {
      const s = this.sessions.get(this.sessionKey(session.tenantId, session.gstin));
      if (!s) return { fail: new GstProviderError('AUTH_FAILED', 'no active session; call authenticate() first') };

      let resp: Record<string, unknown>;
      try {
        const body = { Data: aesEncryptBase64(s.sek, JSON.stringify(payload)) };
        resp = await this.post(base, path, session.gstin, body, s.authToken);
      } catch (e) {
        // Transport-level transient (429/5xx/network) → retry with backoff.
        if (e instanceof GstProviderError && e.code === 'PORTAL_UNAVAILABLE') return { retry: 'unavailable' };
        return { fail: e instanceof Error ? e : new Error(String(e)) };
      }

      const c = classify(resp, kind);
      switch (c.type) {
        case 'success':
          return { ok: true, value: JSON.parse(aesDecrypt(s.sek, String(resp.Data))) as Record<string, unknown> };
        case 'auth_expired':
          return { retry: 'auth' };
        case 'duplicate':
          return { fail: kind === 'IRN' ? this.duplicateIrn(resp) : this.duplicateEwb(resp) };
        case 'cancelled':
          return { fail: new GstProviderError('PORTAL_REJECTED', 'IRN already cancelled', { code: NIC_CODES.IRN_CANCELLED }) };
        case 'rejected':
          return { fail: new GstProviderError('PORTAL_REJECTED', `${kind} rejected: ${c.errors.join('; ')}`, { errors: c.errors }) };
      }
    };

    return runResilientCall({
      attempt,
      reauth: async () => {
        this.sessions.delete(this.sessionKey(session.tenantId, session.gstin));
        await this.authenticate(session.tenantId, session.gstin);
      },
      retries: this.maxRetries(),
      onExhausted: () => new GstProviderError('PORTAL_UNAVAILABLE', `${kind}: portal unavailable after retries`),
    });
  }

  /** Build the DUPLICATE_IRN error carrying the existing IRN for reconciliation. */
  private duplicateIrn(resp: Record<string, unknown>): GstProviderError {
    const existing = extractDuplicateIrn(resp);
    if (existing) {
      return new GstProviderError('DUPLICATE_IRN', 'duplicate IRN', existing as unknown as Record<string, unknown>);
    }
    // Duplicate signalled but no reference to reconcile — surface as a rejection.
    return new GstProviderError('PORTAL_REJECTED', 'duplicate IRN but existing reference not found', {
      errors: errorMessages(resp),
    });
  }

  private duplicateEwb(resp: Record<string, unknown>): GstProviderError {
    const existing = extractDuplicateEwb(resp);
    if (existing) {
      return new GstProviderError('DUPLICATE_EWB', 'duplicate e-way bill', existing as unknown as Record<string, unknown>);
    }
    return new GstProviderError('PORTAL_REJECTED', 'duplicate e-way bill but existing reference not found', {
      errors: errorMessages(resp),
    });
  }

  /** The raw HTTPS POST of the `{ Data }` envelope. 429/5xx/network → transient. */
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
    if (res.status >= 500 || res.status === 429) {
      throw new GstProviderError('PORTAL_UNAVAILABLE', `portal ${res.status}`);
    }
    return (await res.json().catch(() => ({}))) as Record<string, unknown>;
  }

  // ---- config helpers ----

  private maxRetries(): number {
    const n = Number(process.env.GST_IRP_MAX_RETRIES ?? 2);
    return Number.isFinite(n) && n >= 0 ? n : 2;
  }

  private resolveTenantCreds(tenantId: string, gstin: string): Promise<{ username: string; password: string }> {
    // Decrypt the tenant's portal username/password from the encrypted store.
    // Fail-closed: throws NO_CREDENTIALS when unconfigured (runbook 00 §7).
    return this.credStore.resolve(tenantId, gstin);
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
}
