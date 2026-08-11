import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import { AuditService } from '../audit/audit.service';
import { AgentApprovalRequest } from '../core/database/entities';
import {
  GST_ACTION_KINDS,
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
  | { status: 'generated'; reference: string; detail: Record<string, unknown> }
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
  ) {}

  isConfigured(): boolean {
    return this.provider.isConfigured();
  }
  providerName(): string {
    return this.provider.name;
  }

  async execute(tenantId: string, approvalId: string, actorUserId: string | null): Promise<GstExecutionOutcome> {
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
      return { appr, ctx: await this.loadContext(m, appr.entityId, appr.actionKind) };
    });

    const { appr, ctx } = loaded;

    // Provider off → skip. Prepare-only behaviour is preserved; nothing mutates.
    if (!this.provider.isConfigured()) {
      await this.record(tenantId, actorUserId, 'gst.execute.skipped', ctx.invoiceId, appr, { reason: 'provider_disabled' });
      return { status: 'skipped', reason: 'provider_disabled' };
    }

    // Idempotency — already generated for this action? Nothing to do.
    const now = await this.currentStatus(tenantId, ctx.invoiceId);
    if (ctx.isEinvoice && now.einvoice === 'generated') return { status: 'already_generated', reference: now.irn ?? '' };
    if (!ctx.isEinvoice && now.eway === 'generated') return { status: 'already_generated', reference: now.ewayBillNo ?? '' };

    // Pre-flight (pure) — reject master-data problems before any portal call.
    const pf = ctx.isEinvoice
      ? validateIrnPreflight(ctx.header, ctx.lines, ctx.seller, ctx.buyer)
      : validateEwbPreflight(ctx.header, ctx.seller, ctx.buyer);
    if (!pf.ok) {
      await this.setStatus(tenantId, ctx.invoiceId, ctx.isEinvoice, 'failed');
      await this.record(tenantId, actorUserId, 'gst.execute.failed', ctx.invoiceId, appr, { stage: 'preflight', errors: pf.errors });
      return { status: 'failed', errors: pf.errors };
    }

    // Phase 2 — transmit OUTSIDE any transaction.
    try {
      const session = await this.provider.authenticate(tenantId, ctx.seller.gstin);
      if (ctx.isEinvoice) {
        const res = await this.provider.generateIrn(session, buildIrnRequest(ctx.header, ctx.lines, ctx.seller, ctx.buyer));
        await this.persistIrn(tenantId, ctx.invoiceId, res);
        await this.record(tenantId, actorUserId, 'gst.irn.generated', ctx.invoiceId, appr, { irn: res.irn, ackNo: res.ackNo });
        return { status: 'generated', reference: res.irn, detail: { ackNo: res.ackNo, ackDate: res.ackDate } };
      }
      const res = await this.provider.generateEwayBill(session, buildEwbRequest(ctx.header, ctx.seller, ctx.buyer));
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
      ? await m.query(`SELECT customer_name AS "name", gstin, billing_address AS "addr", city, state FROM customers WHERE id = $1`, [inv.customerId])
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
      pincode: '', // customers table has no pincode; supply at deploy if the portal requires it
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
