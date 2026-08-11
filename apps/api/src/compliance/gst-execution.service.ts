import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import { AuditService } from '../audit/audit.service';
import { MetricsService } from '../common/metrics.service';
import { ErrorAlertService } from '../common/error-alert.service';
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
  stateCodeOf,
  validateEwbPreflight,
  validateIrnPreflight,
  type BuyerParty,
  type InvoiceHeader,
  type InvoiceLine,
  type SellerParty,
} from './gst-payload.util';

export type GstExecutionOutcome =
  | { status: 'skipped'; reason: string }
  | { status: 'already_generated'; reference: string }
  | { status: 'already_cancelled'; reference: string }
  | { status: 'generated'; reference: string; detail: Record<string, unknown> }
  | { status: 'cancelled'; reference: string }
  | { status: 'updated'; reference: string; detail: Record<string, unknown> }
  | { status: 'extended'; reference: string; detail: Record<string, unknown> }
  | { status: 'reconciled'; reference: string }
  | { status: 'failed'; errors: string[] };

interface LoadedContext {
  invoiceId: string;
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

    // In-place e-way modification (Part-B vehicle change / validity extension).
    if (loaded.kind === 'modify') {
      return this.executeEwayModify(tenantId, appr, loaded.modify, actorUserId);
    }

    const { ctx } = loaded;

    // Idempotency — already generated for this action? Nothing to do.
    const now = await this.currentStatus(tenantId, ctx.invoiceId);
    if (ctx.isEinvoice && now.einvoice === 'generated') return { status: 'already_generated', reference: now.irn ?? '' };
    if (!ctx.isEinvoice && now.eway === 'generated') return { status: 'already_generated', reference: now.ewayBillNo ?? '' };

    // Pre-flight (pure) — reject master-data problems before any portal call.
    const pf = ctx.isEinvoice
      ? validateIrnPreflight(ctx.header, ctx.lines, ctx.seller, ctx.buyer)
      : validateEwbPreflight(ctx.header, ctx.lines, ctx.seller, ctx.buyer);
    if (!pf.ok) {
      await this.setStatus(tenantId, ctx.invoiceId, ctx.isEinvoice, 'failed');
      await this.record(tenantId, actorUserId, 'gst.execute.failed', ctx.invoiceId, appr, { stage: 'preflight', errors: pf.errors });
      return { status: 'failed', errors: pf.errors };
    }

    // Phase 2 — transmit OUTSIDE any transaction.
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
          wantsEway && now.eway !== 'generated' && validateEwbPreflight(ctx.header, ctx.lines, ctx.seller, ctx.buyer).ok;
        const res = await this.provider.generateIrn(
          session,
          buildIrnRequest(ctx.header, ctx.lines, ctx.seller, ctx.buyer, { includeEwb }),
        );
        await this.persistIrn(tenantId, ctx.invoiceId, res);
        await this.record(tenantId, actorUserId, 'gst.irn.generated', ctx.invoiceId, appr, { irn: res.irn, ackNo: res.ackNo });
        // The IRP returned the e-way in the same response — persist it too.
        if (res.ewayBillNo) {
          await this.persistEwb(
            tenantId,
            ctx.invoiceId,
            { ewayBillNo: res.ewayBillNo, ewayBillDate: res.ewayBillDate ?? '', validUpto: res.validUpto ?? '' },
            ctx.header,
          );
          await this.record(tenantId, actorUserId, 'gst.eway.generated', ctx.invoiceId, appr, { ewayBillNo: res.ewayBillNo, via: 'irn' });
        }
        return { status: 'generated', reference: res.irn, detail: { ackNo: res.ackNo, ackDate: res.ackDate, ewayBillNo: res.ewayBillNo } };
      }
      const res = await this.provider.generateEwayBill(session, buildEwbRequest(ctx.header, ctx.lines, ctx.seller, ctx.buyer));
      await this.persistEwb(tenantId, ctx.invoiceId, res, ctx.header);
      await this.record(tenantId, actorUserId, 'gst.eway.generated', ctx.invoiceId, appr, { ewayBillNo: res.ewayBillNo });
      return { status: 'generated', reference: res.ewayBillNo, detail: { validUpto: res.validUpto } };
    } catch (e) {
      // A duplicate is the portal's idempotency, not a failure — reconcile it.
      if (e instanceof GstProviderError && (e.code === 'DUPLICATE_IRN' || e.code === 'DUPLICATE_EWB')) {
        if (ctx.isEinvoice) {
          const d = e.detail as unknown as IrnResult;
          await this.persistIrn(tenantId, ctx.invoiceId, d);
          await this.record(tenantId, actorUserId, 'gst.irn.reconciled', ctx.invoiceId, appr, { irn: d.irn });
          return { status: 'reconciled', reference: d.irn };
        }
        const d = e.detail as unknown as EwbResult;
        await this.persistEwb(tenantId, ctx.invoiceId, d, ctx.header);
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
              place_of_supply AS "placeOfSupply", gstin,
              taxable_amount AS "taxable", cgst_amount AS "cgst", sgst_amount AS "sgst",
              igst_amount AS "igst", cess_amount AS "cess", round_off AS "roundOff", total_amount AS "total",
              distance_km AS "distanceKm", transport_mode AS "transportMode", vehicle_no AS "vehicleNo",
              transporter_name AS "transporterName"
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
      posStateCode: inv.placeOfSupply ?? (buyerGstin ? stateCodeOf(buyerGstin) : ''),
      address1: customer?.addr ?? '',
      location: customer?.city ?? '',
      pincode: customer?.pincode ?? '', // buyer PIN → BuyerDtls.Pin / e-way toPincode (dropped if absent/invalid)
      stateCode: buyerGstin ? stateCodeOf(buyerGstin) : inv.placeOfSupply ?? '',
    };

    const header: InvoiceHeader = {
      docNo: inv.invoiceNo,
      docDate: inv.invoiceDate,
      supplyType: 'B2B',
      reverseCharge: false,
      taxable: Number(inv.taxable), cgst: Number(inv.cgst), sgst: Number(inv.sgst),
      igst: Number(inv.igst), cess: Number(inv.cess), roundOff: Number(inv.roundOff), total: Number(inv.total),
      distanceKm: inv.distanceKm, transportMode: inv.transportMode, vehicleNo: inv.vehicleNo,
      transporterName: inv.transporterName,
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

    return { invoiceId, isEinvoice: actionKind === 'einvoice_irn', header, seller, buyer, lines };
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
      `SELECT id, invoice_no AS "invoiceNo", eway_bill_no AS "ewayBillNo", eway_status AS "ewayStatus",
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

  private persistIrn(tenantId: string, invoiceId: string, res: IrnResult): Promise<unknown> {
    return this.db.runInTenant(tenantId, (m) =>
      m.query(
        `UPDATE invoices SET irn = $2, ack_number = $3, ack_date = $4, signed_qr_code = $5,
                einvoice_status = 'generated', updated_at = now() WHERE id = $1`,
        [invoiceId, res.irn, res.ackNo, res.ackDate, res.signedQrCode],
      ),
    );
  }

  private persistEwb(tenantId: string, invoiceId: string, res: EwbResult, header: InvoiceHeader): Promise<unknown> {
    return this.db.runInTenant(tenantId, (m) =>
      m.query(
        `UPDATE invoices SET eway_bill_no = $2, eway_bill_date = $3, eway_valid_until = $4,
                distance_km = coalesce(distance_km, $5), transport_mode = coalesce(transport_mode, $6),
                vehicle_no = coalesce(vehicle_no, $7), eway_status = 'generated', updated_at = now() WHERE id = $1`,
        [invoiceId, res.ewayBillNo, res.ewayBillDate, res.validUpto, header.distanceKm ?? null, header.transportMode ?? null, header.vehicleNo ?? null],
      ),
    );
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
