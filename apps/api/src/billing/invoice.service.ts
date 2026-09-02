import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import {
  Company,
  Customer,
  DeliveryChallan,
  Invoice,
  InvoiceChallan,
  InvoiceItem,
  Order,
  OrderItem,
  Site,
  Transporter,
} from '../core/database/entities';
import { NumberingService } from '../sales/numbering.service';
import { WhatsAppService } from '../sales/whatsapp.service';
import type { InvoicePdfData } from '../sales/pdf.service';
import { AuditService, AUDIT_ACTIONS } from '../audit/audit.service';
import { computeLineTax, round2, isInterstateSupply } from './tax.util';
import { resolveReturnBilling, isReturnBillingPolicy, type ReturnBillingPolicy } from './return-billing.util';

const notFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Invoice not found' });
const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });
const num = (v: unknown): number => Number(v ?? 0) || 0;
/** Add whole days to a 'yyyy-mm-dd' date, returning the same format (UTC). */
const addDays = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** e-way transport modes NIC accepts (mapped to codes in the payload builder). */
const TRANSPORT_MODES = new Set(['road', 'rail', 'air', 'ship']);

/**
 * Invoicing (DEV-PLAN B12). Generates a GST invoice from DELIVERED, not-yet-
 * invoiced challans; each challan becomes an invoice line with a GENERIC
 * quantity + HSN/SAC + UOM. Marks source challans invoiced. E-invoice / e-way
 * fields are stored ready-only (no live API).
 */
@Injectable()
export class InvoiceService {
  constructor(
    private readonly db: TenantDbService,
    private readonly numbering: NumberingService,
    private readonly whatsapp: WhatsAppService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, status?: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(Invoice).find({ where: status ? { invoiceStatus: status } : {}, order: { createdAt: 'DESC' } }),
    );
  }

  private async loadFull(m: EntityManager, id: string) {
    const invoice = await m.getRepository(Invoice).findOne({ where: { id } });
    if (!invoice) throw notFound();
    const items = await m.getRepository(InvoiceItem).find({ where: { invoiceId: id }, order: { createdAt: 'ASC' } });
    const challans = await m.getRepository(InvoiceChallan).find({ where: { invoiceId: id } });
    return { ...invoice, items, challans };
  }

  get(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, (m) => this.loadFull(m, id));
  }

  /** Delivered, not-yet-invoiced challans for a customer (candidates to bill). */
  async billableChallans(tenantId: string, customerId?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const where: Record<string, unknown> = { challanStatus: 'delivered', invoiceStatus: 'not_invoiced' };
      if (customerId) where.customerId = customerId;
      const challans = await m.getRepository(DeliveryChallan).find({ where, order: { createdAt: 'DESC' } });
      // Suggest the rate the customer already agreed to on the order, so the
      // clerk confirms it rather than re-typing (and mistyping) it. Also surface
      // the order's return-billing policy and the quantity that will actually be
      // billed, so the clerk sees the net (not gross) up front.
      return Promise.all(
        challans.map(async (c) => {
          const order = c.orderId ? await m.getRepository(Order).findOne({ where: { id: c.orderId } }) : null;
          const policy: ReturnBillingPolicy = isReturnBillingPolicy(order?.returnBillingPolicy) ? order!.returnBillingPolicy : 'net';
          const billing = resolveReturnBilling(c.quantityM3, c.returnQuantityM3, policy, order?.returnFeePerM3);
          return {
            ...c,
            suggestedRate: (await this.agreedLine(m, c.orderId, c.gradeId)).rate,
            returnBillingPolicy: policy,
            billedQuantityM3: billing.billedQuantity,
            returnFee: billing.returnFee,
          };
        }),
      );
    });
  }

  /**
   * The all-in agreed price per m³ for a grade on an order — the concrete rate
   * plus its transport, pump and waiting charges (all quoted per m³). This is
   * what the customer signed up to pay, so it is what the invoice should bill.
   * Returns 0 when the order line cannot be found (e.g. an ad-hoc challan).
   */
  private async agreedLine(
    m: EntityManager,
    orderId: string | null,
    gradeId: string | null,
  ): Promise<{ rate: number; gstRate: number }> {
    if (!orderId) return { rate: 0, gstRate: 18 };
    const items = await m.getRepository(OrderItem).find({ where: { orderId } });
    const item = items.find((i) => i.gradeId === gradeId) ?? items[0];
    if (!item) return { rate: 0, gstRate: 18 };
    return {
      rate: round2(num(item.ratePerM3) + num(item.transportCharge) + num(item.pumpCharge) + num(item.waitingCharge)),
      // The order line already stores its resolved GST rate (0 for an exempt
      // line), so the invoice bills the rate the customer agreed to, not a
      // blanket 18%.
      gstRate: num(item.gstRate),
    };
  }

  /** Create a draft invoice from a set of delivered challans (same customer). */
  fromChallans(tenantId: string, dto: Record<string, unknown>) {
    const customerId = String(dto.customerId ?? '');
    if (!customerId) throw badReq('customerId required');
    const lines = Array.isArray(dto.lines) ? (dto.lines as Record<string, unknown>[]) : [];
    if (!lines.length) throw badReq('At least one challan line is required');

    return this.db.runInTenant(tenantId, async (m) => {
      const customer = await m.getRepository(Customer).findOne({ where: { id: customerId } });
      if (!customer) throw badReq('Customer not found');
      const company = (await m.getRepository(Company).find({ take: 1 }))[0];

      // Place of supply for a supply of GOODS is where the movement terminates —
      // the delivery site's state — not the customer's registered state. A bill-to
      // customer HO in one state with a ship-to site in another must be taxed on
      // the site's state (IGST vs CGST+SGST) with the site as POS. Resolve the site
      // from the invoice's siteId, else the first challan's site; fall back to the
      // customer's state only when no site state is known.
      const siteId =
        (dto.siteId as string) ||
        (await (async () => {
          const firstChallanId = String((lines[0] as Record<string, unknown>)?.challanId ?? '');
          if (!firstChallanId) return null;
          const c = await m.getRepository(DeliveryChallan).findOne({ where: { id: firstChallanId } });
          return c?.siteId ?? null;
        })());
      const site = siteId ? await m.getRepository(Site).findOne({ where: { id: siteId } }) : null;
      const placeOfSupplyState = site?.state && String(site.state).trim() ? site.state : customer.state;
      // Normalise state names (trim + case) exactly like the order/quotation
      // paths, so a same-state supply written "Karnataka " vs "Karnataka" is not
      // mis-classified as inter-state (wrong CGST/SGST-vs-IGST heads + portal reject).
      const isInterstate = isInterstateSupply(company?.state, placeOfSupplyState);

      // Due date defaults to invoiceDate + the customer's credit days (falling
      // back to the tenant default_credit_days setting), so aging and overdue
      // alerts key off the agreed terms instead of a hand-typed date.
      const invoiceDate = (dto.invoiceDate as string) || new Date().toISOString().slice(0, 10);
      let dueDate = (dto.dueDate as string) || null;
      if (!dueDate) {
        let days = num(customer.creditDays);
        if (days <= 0) {
          const [s] = await m.query(`SELECT setting_value AS value FROM tenant_settings WHERE setting_key = 'default_credit_days'`);
          days = num(s?.value);
        }
        if (days > 0) dueDate = addDays(invoiceDate, days);
      }

      const invoiceNo = await this.numbering.next(m, tenantId, 'invoice', 'INV-');
      const invoiceRepo = m.getRepository(Invoice);
      const invoice = await invoiceRepo.save(
        invoiceRepo.create({
          tenantId, invoiceNo,
          invoiceDate,
          dueDate,
          customerId, siteId: siteId ?? null,
          billingAddress: customer.billingAddress, placeOfSupply: placeOfSupplyState, gstin: customer.gstin,
          isInterstate, invoiceStatus: 'draft', paymentStatus: 'unpaid',
        }),
      );

      const itemRepo = m.getRepository(InvoiceItem);
      const linkRepo = m.getRepository(InvoiceChallan);
      const challanRepo = m.getRepository(DeliveryChallan);
      let taxable = 0, cgst = 0, sgst = 0, igst = 0, cess = 0;

      for (const line of lines) {
        // Lock the challan row before the not_invoiced check: two concurrent
        // invoices citing the same challan would otherwise both see not_invoiced
        // and bill it twice (duplicate revenue). The partial unique index on
        // invoice_challans (Tier-1B) is the backstop.
        const challan = await challanRepo.findOne({ where: { id: String(line.challanId ?? '') }, lock: { mode: 'pessimistic_write' } });
        if (!challan) throw badReq('Challan not found');
        if (challan.challanStatus !== 'delivered') throw badReq(`Challan ${challan.challanNo} is not delivered`);
        if (challan.invoiceStatus !== 'not_invoiced') throw badReq(`Challan ${challan.challanNo} already invoiced`);
        if (challan.customerId && challan.customerId !== customerId) throw badReq('Challan belongs to a different customer');

        // Bill per the order's returned-concrete policy (default net): the main
        // line carries the poured quantity, and a return charge is added only
        // under net_plus_fee. See resolveReturnBilling.
        const order = challan.orderId ? await m.getRepository(Order).findOne({ where: { id: challan.orderId } }) : null;
        const policy: ReturnBillingPolicy = isReturnBillingPolicy(order?.returnBillingPolicy) ? order!.returnBillingPolicy : 'net';
        const billing = resolveReturnBilling(challan.quantityM3, challan.returnQuantityM3, policy, order?.returnFeePerM3);
        const quantity = billing.billedQuantity;
        const agreed = await this.agreedLine(m, challan.orderId, challan.gradeId);
        // Use the rate/GST the clerk entered; otherwise fall back to the order's
        // agreed line. An explicit 0 is respected (a genuinely free line stays
        // free, and an exempt line stays 0% — not silently bumped to the default).
        const hasRate = line.rate !== undefined && line.rate !== null && String(line.rate).trim() !== '';
        const rate = hasRate ? num(line.rate) : agreed.rate;
        if (rate < 0) throw badReq('Invoice line rate cannot be negative');
        const gstRate = line.gstRate !== undefined ? num(line.gstRate) : agreed.gstRate;
        if (gstRate < 0) throw badReq('Invoice line GST rate cannot be negative');
        const cessRate = num(line.cessRate);
        const t = computeLineTax(quantity, rate, gstRate, cessRate, isInterstate);

        await itemRepo.save(
          itemRepo.create({
            tenantId, invoiceId: invoice.id, challanId: challan.id, gradeId: challan.gradeId,
            description: (line.description as string) ?? `${challan.gradeLabel ?? 'Concrete'} — ${challan.challanNo}`,
            hsnSac: (line.hsnSac as string) ?? null, uom: (line.uom as string) ?? 'm3',
            quantity: String(quantity), rate: String(rate), taxableAmount: String(t.taxableAmount),
            gstRate: String(gstRate),
            cgstRate: String(t.cgstRate), cgstAmount: String(t.cgstAmount),
            sgstRate: String(t.sgstRate), sgstAmount: String(t.sgstAmount),
            igstRate: String(t.igstRate), igstAmount: String(t.igstAmount),
            cessRate: String(t.cessRate), cessAmount: String(t.cessAmount),
            lineTotal: String(t.lineTotal),
          }),
        );
        await linkRepo.save(linkRepo.create({ tenantId, invoiceId: invoice.id, challanId: challan.id, quantityM3: String(quantity) }));
        await challanRepo.update(challan.id, { invoiceStatus: 'invoiced' });

        taxable += t.taxableAmount; cgst += t.cgstAmount; sgst += t.sgstAmount; igst += t.igstAmount; cess += t.cessAmount;

        // net_plus_fee: a separate return / short-load charge line for the
        // returned m³, taxed at the same rate as the concrete (composite supply).
        if (billing.returnFee > 0) {
          const feeRate = order && num(order.returnFeePerM3) > 0 ? num(order.returnFeePerM3) : 0;
          const ft = computeLineTax(billing.returnedQuantity, feeRate, gstRate, 0, isInterstate);
          await itemRepo.save(
            itemRepo.create({
              tenantId, invoiceId: invoice.id, challanId: challan.id, gradeId: challan.gradeId,
              description: `Return / short-load charge — ${challan.challanNo}`,
              hsnSac: (line.hsnSac as string) ?? null, uom: 'm3',
              quantity: String(billing.returnedQuantity), rate: String(feeRate), taxableAmount: String(ft.taxableAmount),
              gstRate: String(gstRate),
              cgstRate: String(ft.cgstRate), cgstAmount: String(ft.cgstAmount),
              sgstRate: String(ft.sgstRate), sgstAmount: String(ft.sgstAmount),
              igstRate: String(ft.igstRate), igstAmount: String(ft.igstAmount),
              cessRate: String(ft.cessRate), cessAmount: String(ft.cessAmount),
              lineTotal: String(ft.lineTotal),
            }),
          );
          taxable += ft.taxableAmount; cgst += ft.cgstAmount; sgst += ft.sgstAmount; igst += ft.igstAmount; cess += ft.cessAmount;
        }
      }

      const grand = taxable + cgst + sgst + igst + cess;
      const total = Math.round(grand);
      const roundOff = round2(total - grand);
      await invoiceRepo.update(invoice.id, {
        taxableAmount: String(round2(taxable)), cgstAmount: String(round2(cgst)), sgstAmount: String(round2(sgst)),
        igstAmount: String(round2(igst)), cessAmount: String(round2(cess)), roundOff: String(roundOff),
        totalAmount: String(total), outstandingAmount: String(total),
      });
      return this.loadFull(m, invoice.id);
    });
  }

  issue(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(Invoice);
      const invoice = await repo.findOne({ where: { id } });
      if (!invoice) throw notFound();
      if (invoice.invoiceStatus !== 'draft') throw badReq(`Invoice already ${invoice.invoiceStatus}`);
      await repo.update(id, { invoiceStatus: 'issued' });
      return this.loadFull(m, id);
    });
  }

  async cancel(tenantId: string, id: string, userId: string, reason?: string) {
    const { result, invoiceNo, total } = await this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(Invoice);
      const invoice = await repo.findOne({ where: { id } });
      if (!invoice) throw notFound();
      if (invoice.invoiceStatus === 'cancelled') throw badReq('Invoice already cancelled');
      // A live IRN / e-way bill is filed with the government. Cancelling locally
      // would flip this row to cancelled and make its challans re-billable while
      // the portal IRN/e-way stays active — a second IRN for the same supply.
      // Cancel it on the IRP first (24h window), or raise a credit note.
      if (invoice.einvoiceStatus === 'generated') {
        throw badReq('This invoice has a live IRN — cancel the e-invoice on the IRP (within 24h) or raise a credit note before cancelling here.');
      }
      if (invoice.ewayStatus === 'generated') {
        throw badReq('This invoice has a live e-way bill — cancel it on the portal before cancelling the invoice.');
      }
      if (num(invoice.amountPaid) > 0) throw badReq('Cannot cancel an invoice with receipts allocated');
      // A write-off is a financial event on this invoice; cancelling would erase
      // it and silently make the challans billable again. Reverse it first.
      if (num(invoice.writtenOffAmount) > 0) throw badReq('Cannot cancel an invoice that has a write-off — reverse the write-off first');
      // Revert linked challans back to not_invoiced.
      const links = await m.getRepository(InvoiceChallan).find({ where: { invoiceId: id } });
      const challanRepo = m.getRepository(DeliveryChallan);
      for (const l of links) await challanRepo.update(l.challanId, { invoiceStatus: 'not_invoiced' });
      await repo.update(id, { invoiceStatus: 'cancelled', paymentStatus: 'cancelled' });
      return { result: await this.loadFull(m, id), invoiceNo: invoice.invoiceNo, total: invoice.totalAmount };
    });
    await this.audit.record({
      tenantId,
      actorUserId: userId,
      action: AUDIT_ACTIONS.INVOICE_CANCEL,
      entityType: 'invoice',
      entityId: id,
      entityLabel: invoiceNo ?? null,
      summary: `Cancelled invoice ${invoiceNo ?? ''} (₹${total ?? 0})${reason ? ` — ${reason}` : ''}`.trim(),
      details: { reason: reason ?? null, totalAmount: total },
    });
    return result;
  }

  /**
   * Write off part (or all) of an invoice's outstanding as a bad debt. Reduces
   * `outstanding_amount` and grows `written_off_amount` by the same figure; the
   * amount actually paid is left untouched. Once nothing collectible remains the
   * invoice reads `written_off`, otherwise it keeps its paid-based status. Only
   * an ISSUED invoice with a positive balance can be written off, and never more
   * than is still outstanding. Audited.
   */
  async writeOff(tenantId: string, id: string, userId: string, amount: number, reason?: string) {
    if (!(amount > 0)) throw badReq('Write-off amount must be greater than zero');
    const { result, invoiceNo, written } = await this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(Invoice);
      const invoice = await repo.findOne({ where: { id } });
      if (!invoice) throw notFound();
      if (invoice.invoiceStatus !== 'issued') throw badReq('Only an issued invoice can be written off');
      const outstanding = round2(num(invoice.outstandingAmount));
      if (outstanding <= 0.001) throw badReq('Invoice has nothing outstanding to write off');
      const amt = round2(amount);
      if (amt > outstanding + 0.001) throw badReq(`Write-off ${amt} exceeds outstanding ${outstanding}`);

      const newWrittenOff = round2(num(invoice.writtenOffAmount) + amt);
      const newOutstanding = round2(outstanding - amt);
      const paid = num(invoice.amountPaid);
      // Nothing left to collect → bad debt; else the paid figure still decides.
      const paymentStatus = newOutstanding <= 0.001 ? 'written_off' : paid > 0.001 ? 'partially_paid' : 'unpaid';
      await repo.update(id, {
        writtenOffAmount: String(newWrittenOff), outstandingAmount: String(newOutstanding), paymentStatus,
      });
      return { result: await this.loadFull(m, id), invoiceNo: invoice.invoiceNo, written: amt };
    });
    await this.audit.record({
      tenantId,
      actorUserId: userId,
      action: AUDIT_ACTIONS.INVOICE_WRITEOFF,
      entityType: 'invoice',
      entityId: id,
      entityLabel: invoiceNo ?? null,
      summary: `Wrote off ₹${written} on invoice ${invoiceNo ?? ''}${reason ? ` — ${reason}` : ''}`.trim(),
      details: { amount: written, reason: reason ?? null },
    });
    return result;
  }

  /**
   * Set the e-way transport details on an invoice: link a transporter master
   * (or clear it), and/or set the vehicle number, transport mode and distance.
   * These feed the e-way bill — TransId/TransName come from the linked
   * transporter (see GstExecutionService.loadContext). Only the fields present
   * in the body are touched; passing null clears one. Blocked once the invoice
   * is cancelled.
   */
  async setTransport(tenantId: string, id: string, userId: string, dto: Record<string, unknown>) {
    const { result, invoiceNo, changes } = await this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(Invoice);
      const invoice = await repo.findOne({ where: { id } });
      if (!invoice) throw notFound();
      if (invoice.invoiceStatus === 'cancelled') throw badReq('Cannot set transport on a cancelled invoice');

      const patch: Partial<Invoice> = {};
      const parts: string[] = [];

      if ('transporterId' in dto) {
        const tId = dto.transporterId;
        if (tId === null || tId === '') {
          patch.transporterId = null;
          parts.push('cleared transporter');
        } else if (typeof tId === 'string') {
          const t = await m.getRepository(Transporter).findOne({ where: { id: tId } });
          if (!t) throw badReq('Unknown transporter');
          patch.transporterId = tId;
          parts.push(`transporter ${t.transporterName}`);
        } else {
          throw badReq('transporterId must be a transporter id or null');
        }
      }
      if (dto.vehicleNo !== undefined) {
        const v = dto.vehicleNo === null ? null : String(dto.vehicleNo).trim().toUpperCase();
        patch.vehicleNo = v || null;
        if (v) parts.push(`vehicle ${v}`);
      }
      if (dto.transportMode !== undefined) {
        const mode = dto.transportMode === null ? null : String(dto.transportMode).trim().toLowerCase();
        if (mode && !TRANSPORT_MODES.has(mode)) throw badReq('transportMode must be road, rail, air or ship');
        patch.transportMode = mode || null;
      }
      if (dto.distanceKm !== undefined) {
        if (dto.distanceKm === null) {
          patch.distanceKm = null;
        } else {
          const d = Number(dto.distanceKm);
          if (!Number.isInteger(d) || d < 0) throw badReq('distanceKm must be a whole number of 0 or more');
          patch.distanceKm = d;
        }
      }
      if (Object.keys(patch).length === 0) throw badReq('No transport fields to update');

      await repo.update(id, patch);
      return { result: await this.loadFull(m, id), invoiceNo: invoice.invoiceNo, changes: parts.join(', ') };
    });
    await this.audit.record({
      tenantId,
      actorUserId: userId,
      action: AUDIT_ACTIONS.INVOICE_TRANSPORT,
      entityType: 'invoice',
      entityId: id,
      entityLabel: invoiceNo ?? null,
      summary: `Updated e-way transport for invoice ${invoiceNo ?? ''}${changes ? ` — ${changes}` : ''}`.trim(),
      details: { ...dto },
    });
    return result;
  }

  async pdfData(tenantId: string, id: string): Promise<{ data: InvoicePdfData; invoice: Invoice }> {
    return this.db.runInTenant(tenantId, async (m) => {
      const full = await this.loadFull(m, id);
      const company = (await m.getRepository(Company).find({ take: 1 }))[0];
      const customer = full.customerId ? await m.getRepository(Customer).findOne({ where: { id: full.customerId } }) : null;
      const addr = [
        company?.addressLine1, company?.addressLine2,
        [company?.city, company?.state, company?.pincode].filter(Boolean).join(', '),
      ].filter((s) => s && String(s).trim()).join(', ');
      const data: InvoicePdfData = {
        companyName: company?.companyName ?? 'Company',
        legalName: company?.legalName ?? null,
        companyGstin: company?.gstin ?? null,
        companyPan: company?.pan ?? null,
        companyState: company?.state ?? null,
        companyAddress: addr || null,
        companyPhone: company?.phone ?? null,
        companyEmail: company?.email ?? null,
        bankName: company?.bankName ?? null,
        bankAccountNo: company?.bankAccountNo ?? null,
        bankIfsc: company?.bankIfsc ?? null,
        bankBranch: company?.bankBranch ?? null,
        logoMime: company?.logoMime ?? null,
        logoData: company?.logoData ?? null,
        invoiceNo: full.invoiceNo, invoiceDate: full.invoiceDate, dueDate: full.dueDate,
        invoiceStatus: full.invoiceStatus,
        customerName: customer?.customerName ?? 'Customer', customerGstin: full.gstin,
        placeOfSupply: full.placeOfSupply, isInterstate: full.isInterstate,
        items: full.items.map((it) => ({
          description: it.description ?? '', hsnSac: it.hsnSac ?? '', uom: it.uom ?? '',
          quantity: it.quantity, rate: it.rate, taxableAmount: it.taxableAmount, gstRate: it.gstRate,
          cgstAmount: it.cgstAmount, sgstAmount: it.sgstAmount, igstAmount: it.igstAmount, lineTotal: it.lineTotal,
        })),
        taxableAmount: full.taxableAmount, cgstAmount: full.cgstAmount, sgstAmount: full.sgstAmount,
        igstAmount: full.igstAmount, cessAmount: full.cessAmount, roundOff: full.roundOff, totalAmount: full.totalAmount,
        // e-invoice (IRP) — drives the signed-QR block when the IRN is generated.
        irn: full.irn ?? null,
        signedQrCode: full.signedQrCode ?? null,
        ackNo: full.ackNumber ?? null,
        ackDate: full.ackDate ? new Date(full.ackDate).toISOString().replace('T', ' ').slice(0, 16) : null,
      };
      return { data, invoice: full };
    });
  }

  async share(tenantId: string, id: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const invoice = await m.getRepository(Invoice).findOne({ where: { id } });
      if (!invoice) throw notFound();
      const customer = invoice.customerId ? await m.getRepository(Customer).findOne({ where: { id: invoice.customerId } }) : null;
      const mobile = (dto.mobile as string) ?? customer?.mobile ?? null;
      const message = (dto.message as string) ??
        `Invoice ${invoice.invoiceNo} for ₹${invoice.totalAmount}. Status: ${invoice.invoiceStatus}. Thank you.`;
      return this.whatsapp.logWithin(m, tenantId, {
        recipientMobile: mobile, moduleKey: 'billing', eventKey: 'invoice_share',
        referenceType: 'invoice', referenceId: id, message,
      });
    });
  }
}
