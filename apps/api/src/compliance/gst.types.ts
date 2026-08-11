/**
 * Provider-agnostic contract for India GST live transmission (IRP / e-way).
 *
 * The multi-agent M5 milestone PREPARES compliance payloads as approval requests;
 * this is the seam through which an *approved* request is transmitted. As with the
 * LLM layer, the provider is pluggable and *fail-safe off*: when none is
 * configured, `isConfigured()` is false and the execution service skips (the app
 * stays prepare-only, exactly as today). The live NIC/GSP protocol lives behind an
 * adapter, held for deployment — see docs/deployment/INTEGRATION-RUNBOOK-*.md.
 *
 * Nothing here performs I/O; the interface is small and dependency-free so the
 * builders, the execution service, and the fake provider all unit-test cleanly.
 */

/** DI token for the active provider (bound by ComplianceModule from GST_PROVIDER). */
export const GST_PROVIDER = 'GST_COMPLIANCE_PROVIDER';

/** The approval action kinds this pipeline can execute. */
export const GST_ACTION_KINDS = new Set(['einvoice_irn', 'eway_bill', 'einvoice_cancel', 'eway_cancel']);

/** The subset of {@link GST_ACTION_KINDS} that CANCEL an existing government reference. */
export const GST_CANCEL_KINDS = new Set(['einvoice_cancel', 'eway_cancel']);

/** An authenticated portal session (opaque to callers; provider-owned). */
export interface GstSession {
  /** The tenant this session belongs to — credentials are resolved per tenant. */
  tenantId: string;
  gstin: string;
  authToken: string;
  /** Epoch ms when the token expires (providers cache/refresh around this). */
  expiresAt: number;
}

/** Result of a successful IRN generation. */
export interface IrnResult {
  irn: string;
  ackNo: string;
  ackDate: string;
  signedQrCode: string;
  /** Present when the e-way bill was generated in the SAME call (Path A, EwbDtls). */
  ewayBillNo?: string;
  ewayBillDate?: string;
  validUpto?: string;
}

/** Result of a successful e-way bill generation. */
export interface EwbResult {
  ewayBillNo: string;
  ewayBillDate: string;
  /** ISO date/time the bill is valid until (base + validity days). */
  validUpto: string;
}

export interface CancelResult {
  reference: string;
  cancelledAt: string;
}

/**
 * A typed provider error. `code` lets the execution service branch — most
 * importantly `DUPLICATE_IRN`, which is not a failure: the portal is idempotent
 * and returns the existing IRN, which we reconcile onto the invoice.
 */
export type GstErrorCode =
  | 'PROVIDER_DISABLED'
  | 'NOT_IMPLEMENTED'
  | 'NO_CREDENTIALS'
  | 'AUTH_FAILED'
  | 'DUPLICATE_IRN'
  | 'DUPLICATE_EWB'
  | 'PORTAL_REJECTED'
  | 'PORTAL_UNAVAILABLE';

export class GstProviderError extends Error {
  constructor(
    readonly code: GstErrorCode,
    message: string,
    /** For DUPLICATE_*, carries the existing reference to reconcile. */
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'GstProviderError';
  }
}

/** The request shapes are produced by the pure builders in gst-payload.util. */
export type IrnRequest = Record<string, unknown>;
export interface EwbRequest extends Record<string, unknown> {
  validityDays: number;
}

/**
 * A pluggable GST compliance provider. A GSP adapter or the NIC-direct adapter
 * implements this; `isConfigured()` gates the whole feature.
 */
export interface GstComplianceProvider {
  readonly name: string;
  isConfigured(): boolean;
  /** Authenticate the seller GSTIN using the tenant's stored portal credentials. */
  authenticate(tenantId: string, gstin: string): Promise<GstSession>;
  generateIrn(session: GstSession, request: IrnRequest): Promise<IrnResult>;
  cancelIrn(session: GstSession, irn: string, reasonCode: string, remarks: string): Promise<CancelResult>;
  generateEwayBill(session: GstSession, request: EwbRequest): Promise<EwbResult>;
  cancelEwayBill(session: GstSession, ewayBillNo: string, reasonCode: string, remarks: string): Promise<CancelResult>;
}

/**
 * India cancellation reason codes (shared by IRN and e-way): 1=Duplicate,
 * 2=Data entry mistake, 3=Order cancelled, 4=Other. The portal is the authority
 * on the 24-hour window; we validate the code locally to fail fast.
 */
export const GST_CANCEL_REASON_CODES = new Set(['1', '2', '3', '4']);
