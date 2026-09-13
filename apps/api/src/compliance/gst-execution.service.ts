import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import { AuditService } from '../audit/audit.service';
import { MetricsService } from '../common/metrics.service';
import { ErrorAlertService } from '../common/error-alert.service';
import { hasEwayBill } from '../common/eway-status.util';
import { AgentApprovalRequest } from '../core/database/entities';
import {
  EWB_EXTEND_REASON_CODES,
  EWB_UPDATE_REASON_CODES,
  GST_ACTION_KINDS,
  GST_CANCEL_KINDS,
  GST_CANCEL_REASON_CODES,
  GST_EWAY_MODIFY_KINDS,
  GST_PROVIDER,
  GstProviderError,
  type EwbResult,
  type GstComplianceProvider,
  type IrnResult,
} from './gst.types';
import {
  buildEwbRequest,
  buildIrnRequest,
  gstStateCode,
  stateCodeOf,
  validateEwbPreflight,
  validateIrnPreflight,
  type BuyerParty,
  type InvoiceHeader,
  type InvoiceLine,
  type SellerParty,
} from './gst-payload.util';

/**
 * Rows affected by an UPDATE ... RETURNING through EntityManager.query. The
 * postgres driver hands UPDATE/DELETE results back as [rows, rowCount]; be
 * tolerant of the plain-rows shape too.
 */
function affectedRows(result: unknown): number {
  if (!Array.isArray(result)) return 0;
  if (result.length === 2 && Array.isArray(result[0]) && typeof result[1] === 'number') return result[1];
  return result.length;
}

export type GstExecutionOutcome =
  | { status: 'skipped'; reason: string }
  | { status: 'already_generated'; reference: string }
  | { status: 'already_cancelled'; reference: string }
  | { status: 'generated'; reference: string; detail: Record<string, unknown> }
  | { status: 'cancelled'; reference: string }
  | { status: 'updated'; reference: string; detail: Record<string, unknown> }
  | { status: 'extended'; reference: string; detail: Record<string, unknown> }
  | { status: 'reconciled'; reference: string }
  | { status: 'failed'; errors: string[] }
  /** Non-retryable: the invoice is no longer in a state that may be filed (dead-letter, not backoff). */
  | { status: 'refused'; errors: string[] };

interface LoadedContext {
  invoiceId: string;
  invoiceStatus: string;
  isEinvoice: boolean;
  header: InvoiceHeader;
  lines: InvoiceLine[];
  seller: SellerParty;
  buyer: BuyerParty;
}

/** The lighter context a CANCEL needs: the existing reference + seller GSTIN + status. */
interface CancelContext {
  invoiceId: string;
  invoiceNo: string;
  isEinvoice: boolean;
  sellerGstin: string;
  irn: string | null;
  ewayBillNo: string | null;
  einvoiceStatus: string;
  ewayStatus: string;
}

/** The context an in-place e-way MODIFY (vehicle update / extend) needs. */
interface EwayModifyContext {
  invoiceId: string;
  invoiceNo: string;
  invoiceStatus: string;
  sellerGstin: string;
  sellerStateCode: string;
  sellerLocation: string;
  ewayBillNo: string | null;
  ewayStatus: string;
  transportMode: string | null;
  vehicleNo: string | null;
}

/**
 * Executes an APPROVED GST action against the configured provider and persists
 * the government response onto the invoice. The scaffold's counterpart to the
 * live NIC/GSP adapter — everything around the network call (resolve → validate →
 * build → transmit → persist → audit) is real, deterministic, tenant-scoped, and
 * idempotent; the transmission itself is the pluggable provider.
 *
 * Safety: a human `approved` decision is the gate (this service refuses anything
 * not `approved`); with no provider configured it skips (prepare-only preserved);
 * the portal is idempotent, so a duplicate is reconciled, never double-filed. The
 * network call is made OUTSIDE the DB transaction — load and persist are separate
 * tenant transactions — so a slow portal never holds a row lock (the shape a real
 * queue-backed worker will keep; see the integration runbooks).
 */
@Injectable()
export class GstExecutionService {
  private readonly log = new Logger(GstExecutionService.name);

  constructor(
    @Inject(GST_PROVIDER) private readonly provider: GstComplianceProvider,
    private readonly db: TenantDbService,
    private readonly audit: AuditService,
    private readonly metrics: MetricsService,
    private readonly alerter: ErrorAlertService,
  ) {}

  isConfigured(): boolean {
    return this.provider.isConfigured();
  }
  providerName(): string {
    return this.provider.name;
  }

  /**
   * Execute an approved GST action, recording the transmission metrics around the
   * inner run (`gst_transmissions_total{action,result,provider}` +
   * `gst_execution_seconds`). A resolve/validation error (404/409) throws out
   * before any transmission and is not counted.
   */
  async execute(tenantId: string, approvalId: string, actorUserId: string | null): Promise<GstExecutionOutcome> {
    const started = Date.now();
    const ref = { actionKind: 'unknown' };
    const outcome = await this.executeInner(tenantId, approvalId, actorUserId, ref);
    this.metrics.incCounter(
      'gst_transmissions_total',
      'GST portal transmissions by action, result and provider.',
      { action: ref.actionKind, result: outcome.status, provider: this.provider.name },
    );
    this.metrics.observeSeconds(
      'gst_execution_seconds',
      'GST execute() duration in seconds by action and provider.',
      (Date.now() - started) / 1000,
      { action: ref.actionKind, provider: this.provider.name },
    );
    return outcome;
  }

  /** Raise an ops alert (deduped) when the portal rejects our credentials. */
  private alertOnAuthFailure(tenantId: string, e: unknown): void {
    if (e instanceof GstProviderError && e.code === 'AUTH_FAILED') {
      void this.alerter.captureOps({
        key: 'gst_auth_failed',
        message: `GST portal authentication failed (provider ${this.provider.name})`,
        tenantId,
      });
    }
  }

  private async executeInner(
    tenantId: string,
    approvalId: string,
    actorUserId: string | null,
    ref: { actionKind: string },
  ): Promise<GstExecutionOutcome> {
    // Phase 1 — resolve + validate inside a tenant transaction (no network here).
    const loaded = await this.db.runInTenant(tenantId, async (m) => {
      const appr = await m.getRepository(AgentApprovalRequest).findOne({ where: { id: approvalId, tenantId } });
      if (!appr) throw new NotFoundException({ code: 'NOT_FOUND', message: 'approval request not found' });
      if (!GST_ACTION_KINDS.has(appr.actionKind)) {
        throw new BadRequestException({ code: 'NOT_GST_ACTION', message: `action '${appr.actionKind}' is not a GST action` });
      }
      if (appr.status !== 'approved') {
        throw new ConflictException({ code: 'NOT_APPROVED', message: `approval is '${appr.status}', not approved` });
      }
      if (!appr.entityId) {
        throw new BadRequestException({ code: 'NO_ENTITY', message: 'approval has no invoice reference' });
      }
      if (GST_CANCEL_KINDS.has(appr.actionKind)) {
        return { appr, kind: 'cancel' as const, cancel: await this.loadCancelContext(m, appr.entityId, appr.actionKind) };
      }
      if (GST_EWAY_MODIFY_KINDS.has(appr.actionKind)) {
        return { appr, kind: 'modify' as const, modify: await this.loadEwayModifyContext(m, appr.entityId) };
      }
      return { appr, kind: 'generate' as const, ctx: await this.loadContext(m, appr.entityId, appr.actionKind) };
    });

    const { appr } = loaded;
    ref.actionKind = appr.actionKind;
    const invoiceId =
      loaded.kind === 'cancel' ? loaded.cancel.invoiceId
      : loaded.kind === 'modify' ? loaded.modify.invoiceId
      : loaded.ctx.invoiceId;

    // Provider off → skip. Prepare-only behaviour is preserved; nothing mutates.
    if (!this.provider.isConfigured()) {
      await this.record(tenantId, actorUserId, 'gst.execute.skipped', invoiceId, appr, { reason: 'provider_disabled' });
      return { status: 'skipped', reason: 'provider_disabled' };
    }

    // Cancellation is its own path: no build/pre-flight, just authenticate → cancel
    // the EXISTING reference → flip status to 'cancelled' → audit. (24h window is
    // portal-enforced; we validate the reason code and the current status locally.)
    if (loaded.kind === 'cancel') {
      return this.executeCancel(tenantId, appr, loaded.cancel, actorUserId);
    }

    // Only an ISSUED invoice may be filed or modified on the portal. A cancelled
    // (or draft) invoice with a queued/retrying job used to reach the IRP anyway
    // and come back with a live IRN stamped on a cancelled row — two IRNs for one
    // supply once the challans were re-billed. Refuse here, non-retryably: the
    // invoice will not become issued again, so the job dead-letters instead of
    // backing off. (Cancel kinds are exempt: cancelling an IRN on the portal is
    // exactly what a locally-cancelled invoice with a live IRN needs.)
    const invoiceStatus = loaded.kind === 'modify' ? loaded.modify.invoiceStatus : loaded.kind === 'generate' ? loaded.ctx.invoiceStatus : 'issued';
    if (invoiceStatus !== 'issued') {
      const errors = [`invoice is '${invoiceStatus}', not issued — nothing was filed`];
      await this.record(tenantId, actorUserId, 'gst.execute.refused', invoiceId, appr, { stage: 'invoice_status', invoiceStatus, errors });
      return { status: 'refused', errors };
    }

    // In-place e-way modification (Part-B vehicle change / validity extension).
    if (loaded.kind === 'modify') {
      return this.executeEwayModify(tenantId, appr, loaded.modify, actorUserId);
    }

    const { ctx } = loaded;

    // Idempotency — already generated for this action? Nothing to do.
    // 'recorded' counts: the plant generated that e-way bill by hand on the
    // portal, so one already exists for this consignment. Generating another
    // would put two live e-way bills against the same supply.
    const now = await this.currentStatus(tenantId, ctx.invoiceId);
    if (ctx.isEinvoice && now.einvoice === 'generated') return { status: 'already_generated', reference: now.irn ?? '' };
    if (!ctx.isEinvoice && hasEwayBill(now.eway)) return { status: 'already_generated', reference: now.ewayBillNo ?? '' };

    // Pre-flight (pure) — reject master-data problems before any portal call.
    const pf = ctx.isEinvoice
      ? validateIrnPreflight(ctx.header, ctx.lines, ctx.seller, ctx.buyer)
      : validateEwbPreflight(ctx.header, ctx.lines, ctx.seller, ctx.buyer);
    if (!pf.ok) {
      await this.setStatus(tenantId, ctx.invoiceId, ctx.isEinvoice, 'failed');
      await this.record(tenantId, actorUserId, 'gst.execute.failed', ctx.invoiceId, appr, { stage: 'preflight', errors: pf.errors });
      return { status: 'failed', errors: pf.errors };
    }

    // Phase 2 — transmit OUTSIDE any transaction. `committed` records a reference
    // that has already been persisted, so a later (audit) failure can never
    // downgrade a committed 'generated' back to 'failed'.
    let committed: GstExecutionOutcome | null = null;
    try {
      const session = await this.provider.authenticate(tenantId, ctx.seller.gstin);
      if (ctx.isEinvoice) {
        // Path A (runbook 02 §4): generate the e-way in the SAME call as the IRN
        // by including EwbDtls — one call, no second auth. This is OPT-IN via the
        // approval payload (`includeEway: true`), because the e-way is a separate
        // legal document: filing it silently under an IRN approval would bypass
        // its own `eway_bill` approval. It's included only when explicitly
        // requested AND the e-way isn't done yet AND the transport details are
        // complete (an incomplete EwbDtls would make the portal reject the IRN).
        const wantsEway = appr.payload?.includeEway === true;
        const includeEwb =
          wantsEway && !hasEwayBill(now.eway) && validateEwbPreflight(ctx.header, ctx.lines, ctx.seller, ctx.buyer).ok;
        const res = await this.provider.generateIrn(
          session,
          buildIrnRequest(ctx.header, ctx.lines, ctx.seller, ctx.buyer, { includeEwb }),
        );
        // The IRN and the e-way the IRP returned in the SAME response are persisted
        // in ONE transaction, so a failure between them can no longer lose the
        // e-way (which then blocked recovery via the already_generated short-cut).
        const ewb = res.ewayBillNo
          ? { res: { ewayBillNo: res.ewayBillNo, ewayBillDate: res.ewayBillDate ?? '', validUpto: res.validUpto ?? '' }, header: ctx.header }
          : undefined;
        if (!(await this.persistIrn(tenantId, ctx.invoiceId, res, ewb))) {
          return this.unpersisted(tenantId, actorUserId, ctx.invoiceId, appr, 'IRN', res.irn);
        }
        committed = { status: 'generated', reference: res.irn, detail: { ackNo: res.ackNo, ackDate: res.ackDate, ewayBillNo: res.ewayBillNo } };
        await this.record(tenantId, actorUserId, 'gst.irn.generated', ctx.invoiceId, appr, { irn: res.irn, ackNo: res.ackNo });
        if (res.ewayBillNo) {
          await this.record(tenantId, actorUserId, 'gst.eway.generated', ctx.invoiceId, appr, { ewayBillNo: res.ewayBillNo, via: 'irn' });
        }
        return committed;
      }
      const res = await this.provider.generateEwayBill(session, buildEwbRequest(ctx.header, ctx.lines, ctx.seller, ctx.buyer));
      if (!(await this.persistEwb(tenantId, ctx.invoiceId, res, ctx.header))) {
        return this.unpersisted(tenantId, actorUserId, ctx.invoiceId, appr, 'e-way bill', res.ewayBillNo);
      }
      committed = { status: 'generated', reference: res.ewayBillNo, detail: { validUpto: res.validUpto } };
      await this.record(tenantId, actorUserId, 'gst.eway.generated', ctx.invoiceId, appr, { ewayBillNo: res.ewayBillNo });
      return committed;
    } catch (e) {
      // The reference is already on the invoice — only the post-commit audit
      // failed. Never downgrade a committed 'generated' to 'failed' (a retry
      // would then re-transmit and the challan PDF would print no reference).
      if (committed) {
        this.log.error(`GST post-commit audit failed for invoice ${ctx.invoiceId}: ${e instanceof Error ? e.message : String(e)}`);
        return committed;
      }
      // A duplicate is the portal's idempotency, not a failure — reconcile it.
      if (e instanceof GstProviderError && (e.code === 'DUPLICATE_IRN' || e.code === 'DUPLICATE_EWB')) {
        if (ctx.isEinvoice) {
          const d = e.detail as unknown as IrnResult;
          if (!(await this.persistIrn(tenantId, ctx.invoiceId, d))) {
            return this.unpersisted(tenantId, actorUserId, ctx.invoiceId, appr, 'IRN', d.irn);
          }
          await this.record(tenantId, actorUserId, 'gst.irn.reconciled', ctx.invoiceId, appr, { irn: d.irn });
          return { status: 'reconciled', reference: d.irn };
        }
        const d = e.detail as unknown as EwbResult;
        if (!(await this.persistEwb(tenantId, ctx.invoiceId, d, ctx.header))) {
          return this.unpersisted(tenantId, actorUserId, ctx.invoiceId, appr, 'e-way bill', d.ewayBillNo);
        }
        await this.record(tenantId, actorUserId, 'gst.eway.reconciled', ctx.invoiceId, appr, { ewayBillNo: d.ewayBillNo });
        return { status: 'reconciled', reference: d.ewayBillNo };
      }
      const message = e instanceof Error ? e.message : String(e);
      this.log.warn(`GST execution failed for invoice ${ctx.invoiceId}: ${message}`);
      this.alertOnAuthFailure(tenantId, e);
      await this.setStatus(tenantId, ctx.invoiceId, ctx.isEinvoice, 'failed');
      await this.record(tenantId, actorUserId, 'gst.execute.failed', ctx.invoiceId, appr, { stage: 'transmit', error: message });
      return { status: 'failed', errors: [message] };
    }
  }

  // ---- loaders ----

  private async loadContext(m: EntityManager, invoiceId: string, actionKind: string): Promise<LoadedContext> {
    const [inv] = await m.query(
      `SELECT id, invoice_no AS "invoiceNo", invoice_date AS "invoiceDate", customer_id AS "customerId",
              invoice_status AS "invoiceStatus", place_of_supply AS "placeOfSupply", gstin,
              taxable_amount AS "taxable", cgst_amount AS "cgst", sgst_amount AS "sgst",
              igst_amount AS "igst", cess_amount AS "cess", round_off AS "roundOff", total_amount AS "total",
              distance_km AS "distanceKm", transport_mode AS "transportMode", vehicle_no AS "vehicleNo",
              transporter_name AS "transporterName", transporter_id AS "transporterId"
         FROM invoices WHERE id = $1`,
      [invoiceId],
    );
    if (!inv) throw new NotFoundException({ code: 'NOT_FOUND', message: 'invoice not found' });

    const [company] = await m.query(
      `SELECT gstin, coalesce(legal_name, company_name) AS "legalName", company_name AS "tradeName",
              address_line1 AS "address1", address_line2 AS "address2", city, pincode
         FROM companies LIMIT 1`,
    );
    const [customer] = inv.customerId
      ? await m.query(`SELECT customer_name AS "name", gstin, billing_address AS "addr", city, state, pincode FROM customers WHERE id = $1`, [inv.customerId])
      : [undefined];
    // Transporter master (optional) — the managed source for the e-way TransId/TransName.
    const [transporter] = inv.transporterId
      ? await m.query(`SELECT transporter_name AS "name", transin, gstin FROM transporters WHERE id = $1`, [inv.transporterId])
      : [undefined];

    const sellerGstin: string = company?.gstin ?? '';
    const seller: SellerParty = {
      gstin: sellerGstin,
      legalName: company?.legalName ?? '',
      tradeName: company?.tradeName ?? null,
      address1: company?.address1 ?? '',
      address2: company?.address2 ?? null,
      location: company?.city ?? '',
      pincode: company?.pincode ?? '',
      stateCode: sellerGstin ? stateCodeOf(sellerGstin) : '',
    };

    const buyerGstin: string | null = inv.gstin ?? customer?.gstin ?? null;
    const buyer: BuyerParty = {
      gstin: buyerGstin,
      legalName: customer?.name ?? '(buyer)',
      // Place of supply is stored as the state NAME; the portal needs the
      // numeric code, so resolve name → code (GSTIN as fallback).
      posStateCode: gstStateCode(inv.placeOfSupply, buyerGstin),
      address1: customer?.addr ?? '',
      location: customer?.city ?? '',
      pincode: customer?.pincode ?? '', // buyer PIN → BuyerDtls.Pin / e-way toPincode (dropped if absent/invalid)
      // Buyer's registration state: the GSTIN's code for B2B, else the
      // place-of-supply state resolved to its numeric code.
      stateCode: buyerGstin ? stateCodeOf(buyerGstin) : gstStateCode(inv.placeOfSupply),
    };

    const header: InvoiceHeader = {
      docNo: inv.invoiceNo,
      docDate: inv.invoiceDate,
      supplyType: 'B2B',
      reverseCharge: false,
      taxable: Number(inv.taxable), cgst: Number(inv.cgst), sgst: Number(inv.sgst),
      igst: Number(inv.igst), cess: Number(inv.cess), roundOff: Number(inv.roundOff), total: Number(inv.total),
      distanceKm: inv.distanceKm, transportMode: inv.transportMode, vehicleNo: inv.vehicleNo,
      // TransId/TransName come from the linked transporter master (TRANSIN, else its
      // GSTIN); fall back to the invoice's free-text transporter name when unlinked.
      transporterName: transporter?.name ?? inv.transporterName,
      transporterId: transporter?.transin ?? transporter?.gstin ?? null,
    };

    const rows: Array<Record<string, unknown>> = await m.query(
      `SELECT hsn_sac AS "hsn", uom, quantity, rate, taxable_amount AS "taxable", gst_rate AS "gstRate",
              cgst_amount AS "cgst", sgst_amount AS "sgst", igst_amount AS "igst", cess_amount AS "cess",
              line_total AS "total"
         FROM invoice_items WHERE invoice_id = $1 ORDER BY created_at, id`,
      [invoiceId],
    );
    const lines: InvoiceLine[] = rows.map((r, i) => ({
      slNo: i + 1,
      hsn: (r.hsn as string) ?? null,
      qty: Number(r.quantity), unit: (r.uom as string) ?? null, unitPrice: Number(r.rate),
      taxable: Number(r.taxable), gstRate: Number(r.gstRate),
      cgst: Number(r.cgst), sgst: Number(r.sgst), igst: Number(r.igst), cess: Number(r.cess),
      total: Number(r.total),
    }));

    return { invoiceId, invoiceStatus: inv.invoiceStatus ?? 'draft', isEinvoice: actionKind === 'einvoice_irn', header, seller, buyer, lines };
  }

  /** The lighter load a CANCEL needs: the existing reference, statuses, seller GSTIN. */
  private async loadCancelContext(m: EntityManager, invoiceId: string, actionKind: string): Promise<CancelContext> {
    const [inv] = await m.query(
      `SELECT id, invoice_no AS "invoiceNo", irn, einvoice_status AS "einvoiceStatus",
              eway_bill_no AS "ewayBillNo", eway_status AS "ewayStatus"
         FROM invoices WHERE id = $1`,
      [invoiceId],
    );
    if (!inv) throw new NotFoundException({ code: 'NOT_FOUND', message: 'invoice not found' });
    const [company] = await m.query(`SELECT gstin FROM companies LIMIT 1`);
    return {
      invoiceId,
      invoiceNo: inv.invoiceNo,
      isEinvoice: actionKind === 'einvoice_cancel',
      sellerGstin: company?.gstin ?? '',
      irn: inv.irn ?? null,
      ewayBillNo: inv.ewayBillNo ?? null,
      einvoiceStatus: inv.einvoiceStatus ?? 'not_generated',
      ewayStatus: inv.ewayStatus ?? 'not_generated',
    };
  }

  /**
   * Cancel an already-generated IRN / e-way against the provider and flip the
   * invoice status to 'cancelled'. Guardrails: idempotent (already-cancelled is a
   * no-op); refuses anything not currently 'generated'; validates the reason code
   * (1–4) before any portal call. The 24-hour window is portal-enforced — a
   * too-late cancel comes back as a portal rejection surfaced as 'failed' (issue a
   * credit note for IRN; an e-way simply lapses at validUpto).
   */
  private async executeCancel(
    tenantId: string,
    appr: AgentApprovalRequest,
    c: CancelContext,
    actorUserId: string | null,
  ): Promise<GstExecutionOutcome> {
    const status = c.isEinvoice ? c.einvoiceStatus : c.ewayStatus;
    const ref = c.isEinvoice ? c.irn : c.ewayBillNo;
    const label = c.isEinvoice ? 'e-invoice' : 'e-way bill';

    // Idempotency — already cancelled? Nothing to do.
    if (status === 'cancelled') return { status: 'already_cancelled', reference: ref ?? '' };

    // Can only cancel something that was actually generated.
    if (status !== 'generated' || !ref) {
      const errors = [`cannot cancel: ${label} status is '${status}', expected 'generated'`];
      await this.record(tenantId, actorUserId, 'gst.execute.failed', c.invoiceId, appr, { stage: 'cancel_preflight', errors });
      return { status: 'failed', errors };
    }

    // Reason code (1–4) — validate before any portal call.
    const reasonCode = String(appr.payload?.reasonCode ?? '').trim();
    if (!GST_CANCEL_REASON_CODES.has(reasonCode)) {
      const errors = [`invalid cancellation reason code '${reasonCode}' (expected 1–4)`];
      await this.record(tenantId, actorUserId, 'gst.execute.failed', c.invoiceId, appr, { stage: 'cancel_preflight', errors });
      return { status: 'failed', errors };
    }
    const remarks = typeof appr.payload?.remarks === 'string' ? appr.payload.remarks : '';

    if (!c.sellerGstin) {
      const errors = ['seller GSTIN is not configured on the company profile'];
      await this.record(tenantId, actorUserId, 'gst.execute.failed', c.invoiceId, appr, { stage: 'cancel_preflight', errors });
      return { status: 'failed', errors };
    }

    try {
      const session = await this.provider.authenticate(tenantId, c.sellerGstin);
      const res = c.isEinvoice
        ? await this.provider.cancelIrn(session, ref, reasonCode, remarks)
        : await this.provider.cancelEwayBill(session, ref, reasonCode, remarks);
      await this.setStatus(tenantId, c.invoiceId, c.isEinvoice, 'cancelled');
      await this.record(tenantId, actorUserId, c.isEinvoice ? 'gst.irn.cancelled' : 'gst.eway.cancelled', c.invoiceId, appr, {
        reference: res.reference, reasonCode,
      });
      return { status: 'cancelled', reference: res.reference };
    } catch (e) {
      // The portal says it is already cancelled → reconcile our row (idempotent).
      if (e instanceof GstProviderError && e.code === 'PORTAL_REJECTED' && /cancel/i.test(e.message)) {
        await this.setStatus(tenantId, c.invoiceId, c.isEinvoice, 'cancelled');
        await this.record(tenantId, actorUserId, c.isEinvoice ? 'gst.irn.cancelled' : 'gst.eway.cancelled', c.invoiceId, appr, {
          reference: ref, reasonCode, reconciled: true,
        });
        return { status: 'already_cancelled', reference: ref };
      }
      const message = e instanceof Error ? e.message : String(e);
      this.log.warn(`GST cancel failed for invoice ${c.invoiceId}: ${message}`);
      this.alertOnAuthFailure(tenantId, e);
      await this.record(tenantId, actorUserId, 'gst.execute.failed', c.invoiceId, appr, { stage: 'cancel_transmit', error: message });
      return { status: 'failed', errors: [message] };
    }
  }

  /** The context an in-place e-way modify needs: the reference, status, and dispatch details. */
  private async loadEwayModifyContext(m: EntityManager, invoiceId: string): Promise<EwayModifyContext> {
    const [inv] = await m.query(
      `SELECT id, invoice_no AS "invoiceNo", invoice_status AS "invoiceStatus", eway_bill_no AS "ewayBillNo", eway_status AS "ewayStatus",
              transport_mode AS "transportMode", vehicle_no AS "vehicleNo"
         FROM invoices WHERE id = $1`,
      [invoiceId],
    );
    if (!inv) throw new NotFoundException({ code: 'NOT_FOUND', message: 'invoice not found' });
    const [company] = await m.query(`SELECT gstin, city FROM companies LIMIT 1`);
    const gstin: string = company?.gstin ?? '';
    return {
      invoiceId,
      invoiceNo: inv.invoiceNo,
      invoiceStatus: inv.invoiceStatus ?? 'draft',
      sellerGstin: gstin,
      sellerStateCode: gstin ? stateCodeOf(gstin) : '',
      sellerLocation: company?.city ?? '',
      ewayBillNo: inv.ewayBillNo ?? null,
      ewayStatus: inv.ewayStatus ?? 'not_generated',
      transportMode: inv.transportMode ?? null,
      vehicleNo: inv.vehicleNo ?? null,
    };
  }

  /**
   * Modify a LIVE e-way bill in place: a Part-B vehicle change or a validity
   * extension. Guardrails: the e-way must be 'generated' (not cancelled/absent);
   * the per-action reason code is validated before any portal call; a vehicle
   * update needs a new vehicle number, an extension a positive remaining distance.
   * The 8-hour extension window is portal-enforced (too-early/late → 'failed').
   * Unlike generate/cancel these have no terminal state, so they are NOT
   * idempotent — each execute is a fresh portal action.
   */
  private async executeEwayModify(
    tenantId: string,
    appr: AgentApprovalRequest,
    c: EwayModifyContext,
    actorUserId: string | null,
  ): Promise<GstExecutionOutcome> {
    const isUpdate = appr.actionKind === 'eway_update_vehicle';
    const verb = isUpdate ? 'update vehicle on' : 'extend';
    const fail = async (errors: string[], stage: string): Promise<GstExecutionOutcome> => {
      await this.record(tenantId, actorUserId, 'gst.execute.failed', c.invoiceId, appr, { stage, errors });
      return { status: 'failed', errors };
    };

    // The e-way must be live to modify it.
    if (c.ewayStatus !== 'generated' || !c.ewayBillNo) {
      return fail([`cannot ${verb} e-way: status is '${c.ewayStatus}', expected 'generated'`], 'eway_modify_preflight');
    }
    if (!c.sellerGstin) {
      return fail(['seller GSTIN is not configured on the company profile'], 'eway_modify_preflight');
    }

    const reasonCode = String(appr.payload?.reasonCode ?? '').trim();
    const remarks = typeof appr.payload?.remarks === 'string' ? appr.payload.remarks : '';

    try {
      const session = await this.provider.authenticate(tenantId, c.sellerGstin);
      if (isUpdate) {
        if (!EWB_UPDATE_REASON_CODES.has(reasonCode)) {
          return fail([`invalid vehicle-update reason code '${reasonCode}' (expected 1–4)`], 'eway_modify_preflight');
        }
        const vehicleNo = String(appr.payload?.vehicleNo ?? '').trim();
        if (!vehicleNo) return fail(['a new vehicle number is required'], 'eway_modify_preflight');
        const res = await this.provider.updateEwayVehicle(session, c.ewayBillNo, {
          vehicleNo, reasonCode, remarks,
          transMode: c.transportMode ?? undefined, fromPlace: c.sellerLocation, fromStateCode: c.sellerStateCode,
        });
        await this.persistEwayModify(tenantId, c.invoiceId, { vehicleNo });
        await this.record(tenantId, actorUserId, 'gst.eway.vehicle_updated', c.invoiceId, appr, {
          ewayBillNo: res.ewayBillNo, vehicleNo, reasonCode,
        });
        return { status: 'updated', reference: res.ewayBillNo, detail: { vehicleNo, validUpto: res.validUpto } };
      }

      if (!EWB_EXTEND_REASON_CODES.has(reasonCode)) {
        return fail([`invalid extension reason code '${reasonCode}' (expected 1–4 or 99)`], 'eway_modify_preflight');
      }
      const remainingDistanceKm = Number(appr.payload?.remainingDistanceKm ?? 0);
      if (!(remainingDistanceKm > 0)) return fail(['remaining distance (km) must be greater than 0'], 'eway_modify_preflight');
      const res = await this.provider.extendEwayValidity(session, c.ewayBillNo, {
        remainingDistanceKm, reasonCode, remarks, vehicleNo: c.vehicleNo ?? undefined,
        transMode: c.transportMode ?? undefined, fromPlace: c.sellerLocation, fromStateCode: c.sellerStateCode,
        consignmentStatus: 'M',
      });
      await this.persistEwayModify(tenantId, c.invoiceId, { validUpto: res.validUpto });
      await this.record(tenantId, actorUserId, 'gst.eway.extended', c.invoiceId, appr, {
        ewayBillNo: res.ewayBillNo, validUpto: res.validUpto, reasonCode,
      });
      return { status: 'extended', reference: res.ewayBillNo, detail: { validUpto: res.validUpto } };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.log.warn(`GST e-way modify failed for invoice ${c.invoiceId}: ${message}`);
      this.alertOnAuthFailure(tenantId, e);
      await this.record(tenantId, actorUserId, 'gst.execute.failed', c.invoiceId, appr, { stage: 'eway_modify_transmit', error: message });
      return { status: 'failed', errors: [message] };
    }
  }

  private currentStatus(tenantId: string, invoiceId: string): Promise<{ einvoice: string; eway: string; irn: string | null; ewayBillNo: string | null }> {
    return this.db.runInTenant(tenantId, async (m) => {
      const [r] = await m.query(
        `SELECT einvoice_status AS einvoice, eway_status AS eway, irn, eway_bill_no AS "ewayBillNo" FROM invoices WHERE id = $1`,
        [invoiceId],
      );
      return { einvoice: r?.einvoice ?? 'not_generated', eway: r?.eway ?? 'not_generated', irn: r?.irn ?? null, ewayBillNo: r?.ewayBillNo ?? null };
    });
  }

  // ---- persistence ----

  /**
   * Persist the IRN (and, when the IRP returned one in the same response, the
   * e-way) in ONE transaction, and only onto an invoice that is still ISSUED.
   * Returns false when no row qualified — the invoice was cancelled between load
   * and persist — so the caller can report the orphaned portal reference instead
   * of stamping it on a cancelled row. On the reconcile path the portal echoes
   * the IRN with blank ack/QR: COALESCE(NULLIF(...)) keeps committed values.
   */
  private async persistIrn(
    tenantId: string,
    invoiceId: string,
    res: IrnResult,
    ewb?: { res: EwbResult; header: InvoiceHeader },
  ): Promise<boolean> {
    const rows = await this.db.runInTenant(tenantId, (m) =>
      ewb
        ? m.query(
            `UPDATE invoices SET irn = coalesce(nullif($2, ''), irn), ack_number = coalesce(nullif($3, ''), ack_number),
                    ack_date = coalesce(nullif($4, '')::timestamptz, ack_date), signed_qr_code = coalesce(nullif($5, ''), signed_qr_code),
                    einvoice_status = 'generated',
                    eway_bill_no = $6, eway_bill_date = $7, eway_valid_until = $8,
                    distance_km = coalesce(distance_km, $9), transport_mode = coalesce(transport_mode, $10),
                    vehicle_no = coalesce(vehicle_no, $11), eway_status = 'generated', updated_at = now()
              WHERE id = $1 AND invoice_status = 'issued' RETURNING id`,
            [invoiceId, res.irn, res.ackNo, res.ackDate, res.signedQrCode,
             ewb.res.ewayBillNo, ewb.res.ewayBillDate, ewb.res.validUpto,
             ewb.header.distanceKm ?? null, ewb.header.transportMode ?? null, ewb.header.vehicleNo ?? null],
          )
        : m.query(
            `UPDATE invoices SET irn = coalesce(nullif($2, ''), irn), ack_number = coalesce(nullif($3, ''), ack_number),
                    ack_date = coalesce(nullif($4, '')::timestamptz, ack_date), signed_qr_code = coalesce(nullif($5, ''), signed_qr_code),
                    einvoice_status = 'generated', updated_at = now()
              WHERE id = $1 AND invoice_status = 'issued' RETURNING id`,
            [invoiceId, res.irn, res.ackNo, res.ackDate, res.signedQrCode],
          ),
    );
    return affectedRows(rows) > 0;
  }

  /** Persist an e-way bill onto an invoice that is still ISSUED; false when none qualified. */
  private async persistEwb(tenantId: string, invoiceId: string, res: EwbResult, header: InvoiceHeader): Promise<boolean> {
    const rows = await this.db.runInTenant(tenantId, (m) =>
      m.query(
        `UPDATE invoices SET eway_bill_no = $2, eway_bill_date = $3, eway_valid_until = $4,
                distance_km = coalesce(distance_km, $5), transport_mode = coalesce(transport_mode, $6),
                vehicle_no = coalesce(vehicle_no, $7), eway_status = 'generated', updated_at = now()
          WHERE id = $1 AND invoice_status = 'issued' RETURNING id`,
        [invoiceId, res.ewayBillNo, res.ewayBillDate, res.validUpto, header.distanceKm ?? null, header.transportMode ?? null, header.vehicleNo ?? null],
      ),
    );
    return affectedRows(rows) > 0;
  }

  /**
   * The portal issued a reference but the invoice is no longer issued (cancelled
   * between load and persist). Nothing is written to the cancelled row; the
   * reference is recorded in the audit trail and raised as an ops alert so it is
   * cancelled on the portal within its window. Non-retryable.
   */
  private async unpersisted(
    tenantId: string,
    actorUserId: string | null,
    invoiceId: string,
    appr: AgentApprovalRequest,
    label: string,
    reference: string,
  ): Promise<GstExecutionOutcome> {
    const message = `invoice is no longer issued — ${label} ${reference} was generated on the portal but NOT recorded; cancel it on the portal`;
    this.log.error(`GST ${label} orphaned for invoice ${invoiceId}: ${reference}`);
    await this.record(tenantId, actorUserId, 'gst.execute.unpersisted', invoiceId, appr, { label, reference, errors: [message] });
    void this.alerter.captureOps({ key: 'gst_reference_unpersisted', message, tenantId, detail: { invoiceId, label, reference, approvalId: appr.id } });
    return { status: 'refused', errors: [message] };
  }

  private setStatus(tenantId: string, invoiceId: string, isEinvoice: boolean, status: string): Promise<unknown> {
    const col = isEinvoice ? 'einvoice_status' : 'eway_status';
    return this.db.runInTenant(tenantId, (m) => m.query(`UPDATE invoices SET ${col} = $2, updated_at = now() WHERE id = $1`, [invoiceId, status]));
  }

  /** Persist an in-place e-way change: the new vehicle (update) or new validity (extend). */
  private persistEwayModify(tenantId: string, invoiceId: string, fields: { vehicleNo?: string; validUpto?: string }): Promise<unknown> {
    return this.db.runInTenant(tenantId, (m) =>
      m.query(
        `UPDATE invoices SET vehicle_no = coalesce($2, vehicle_no),
                eway_valid_until = coalesce($3, eway_valid_until), updated_at = now() WHERE id = $1`,
        [invoiceId, fields.vehicleNo ?? null, fields.validUpto ?? null],
      ),
    );
  }

  private record(
    tenantId: string,
    actorUserId: string | null,
    action: string,
    invoiceId: string,
    appr: AgentApprovalRequest,
    details: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record({
      tenantId,
      actorUserId,
      action,
      summary: `GST ${appr.actionKind} — ${action.split('.').pop()} for approval ${appr.id}`,
      entityType: 'invoice',
      entityId: invoiceId,
      details: { approvalId: appr.id, actionKind: appr.actionKind, ...details },
    });
  }
}
