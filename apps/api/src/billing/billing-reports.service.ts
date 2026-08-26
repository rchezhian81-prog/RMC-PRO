import { Injectable } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';
import { Customer, Invoice, Payment } from '../core/database/entities';
import { round2 } from './tax.util';
import { computeCustomerExposure } from '../orders/exposure.util';
import { buildStatement, type StatementTxn } from './statement.util';

const num = (v: unknown): number => Number(v ?? 0) || 0;
const daysBetween = (dateStr: string | null): number => {
  if (!dateStr) return 0;
  const d = new Date(dateStr + 'T00:00:00Z').getTime();
  return Math.max(0, Math.floor((Date.now() - d) / 86_400_000));
};
const bucketOf = (days: number): '0-30' | '31-60' | '61-90' | '90+' =>
  days <= 30 ? '0-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+';

/** Billing reports: outstanding + aging, registers, and Tally export (B12-B13). */
@Injectable()
export class BillingReportsService {
  constructor(private readonly db: TenantDbService) {}

  /** Per-customer outstanding with 0-30/31-60/61-90/90+ aging buckets. */
  outstanding(tenantId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const invoices = await m.getRepository(Invoice).find({ where: { invoiceStatus: 'issued' } });
      const customers = await m.getRepository(Customer).find();
      // Contact details ride along so the UI can send a reminder without a second lookup.
      const infoOf = new Map(customers.map((c) => [c.id, c]));
      const byCustomer = new Map<
        string,
        { customerName: string; contactPerson: string; mobile: string; total: number; b0_30: number; b31_60: number; b61_90: number; b90: number }
      >();
      const totals = { total: 0, b0_30: 0, b31_60: 0, b61_90: 0, b90: 0 };

      for (const inv of invoices) {
        const out = num(inv.outstandingAmount);
        if (out <= 0) continue;
        const key = inv.customerId ?? 'unknown';
        const c = infoOf.get(key);
        const row = byCustomer.get(key) ?? {
          customerName: c?.customerName ?? 'Unknown',
          contactPerson: c?.contactPerson ?? '',
          mobile: c?.mobile ?? '',
          total: 0, b0_30: 0, b31_60: 0, b61_90: 0, b90: 0,
        };
        const bucket = bucketOf(daysBetween(inv.invoiceDate));
        row.total = round2(row.total + out);
        if (bucket === '0-30') { row.b0_30 = round2(row.b0_30 + out); totals.b0_30 = round2(totals.b0_30 + out); }
        else if (bucket === '31-60') { row.b31_60 = round2(row.b31_60 + out); totals.b31_60 = round2(totals.b31_60 + out); }
        else if (bucket === '61-90') { row.b61_90 = round2(row.b61_90 + out); totals.b61_90 = round2(totals.b61_90 + out); }
        else { row.b90 = round2(row.b90 + out); totals.b90 = round2(totals.b90 + out); }
        totals.total = round2(totals.total + out);
        byCustomer.set(key, row);
      }
      // Attach each customer's full credit exposure (opening + un-invoiced
      // orders + invoice outstanding − advances) from the single source of
      // truth, alongside the invoice-aging `total`, so the report reconciles
      // with the customer page and the credit gate (design plan §3). The aging
      // buckets stay invoice-based; `total` is unchanged.
      const rows = await Promise.all(
        [...byCustomer.entries()]
          .sort((a, b) => b[1].total - a[1].total)
          .map(async ([id, row]) => ({
            ...row,
            exposure: id && id !== 'unknown' ? (await computeCustomerExposure(m, id)).exposure : row.total,
          })),
      );
      return { rows, totals };
    });
  }

  /** Sales register — invoices (optionally date-bounded) with a grand total. */
  salesRegister(tenantId: string, from?: string, to?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const all = await m.getRepository(Invoice).find({ where: { invoiceStatus: 'issued' }, order: { invoiceDate: 'ASC' } });
      const rows = all.filter((i) => (!from || (i.invoiceDate ?? '') >= from) && (!to || (i.invoiceDate ?? '') <= to));
      const total = round2(rows.reduce((s, i) => s + num(i.totalAmount), 0));
      const taxable = round2(rows.reduce((s, i) => s + num(i.taxableAmount), 0));
      return { rows, total, taxable, count: rows.length };
    });
  }

  /** GST summary over issued invoices. */
  gstSummary(tenantId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const rows = await m.getRepository(Invoice).find({ where: { invoiceStatus: 'issued' } });
      const sum = (f: (i: Invoice) => unknown) => round2(rows.reduce((s, i) => s + num(f(i)), 0));
      return {
        taxable: sum((i) => i.taxableAmount), cgst: sum((i) => i.cgstAmount), sgst: sum((i) => i.sgstAmount),
        igst: sum((i) => i.igstAmount), cess: sum((i) => i.cessAmount), total: sum((i) => i.totalAmount),
      };
    });
  }

  receiptsRegister(tenantId: string) {
    return this.db.runInTenant(tenantId, (m) => m.getRepository(Payment).find({ order: { createdAt: 'DESC' } }));
  }

  /**
   * Customer statement of account (party ledger): the customer's opening
   * balance, then issued invoices as debits and non-reversed receipts as
   * credits, in date order with a running balance. Optionally bounded to
   * [from, to] — earlier activity folds into the period's opening balance.
   */
  customerStatement(tenantId: string, customerId: string, from?: string, to?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const empty = { customerName: '', opening: 0, rows: [], totalDebit: 0, totalCredit: 0, closing: 0, from: from ?? null, to: to ?? null };
      if (!customerId) return empty;
      const customer = await m.getRepository(Customer).findOne({ where: { id: customerId } });
      if (!customer) return empty;
      const [invoices, payments] = await Promise.all([
        m.getRepository(Invoice).find({ where: { customerId, invoiceStatus: 'issued' } }),
        m.getRepository(Payment).find({ where: { customerId } }),
      ]);
      const iso = (v: unknown): string => { try { return new Date(v as string | number | Date).toISOString(); } catch { return ''; } };
      const sk = (date: string | null, createdAt: unknown) => `${date ?? '9999-99-99'}#${iso(createdAt)}`;
      const txns: StatementTxn[] = [
        ...invoices.map((i) => ({
          date: i.invoiceDate, sortKey: sk(i.invoiceDate, i.createdAt), type: 'invoice' as const,
          ref: i.invoiceNo, particulars: `Invoice ${i.invoiceNo}`, debit: num(i.totalAmount), credit: 0,
        })),
        ...payments.filter((p) => p.status !== 'reversed').map((p) => ({
          date: p.receiptDate, sortKey: sk(p.receiptDate, p.createdAt), type: 'receipt' as const,
          ref: p.receiptNo, particulars: `Receipt ${p.receiptNo}${p.paymentMode ? ` (${p.paymentMode})` : ''}`,
          debit: 0, credit: num(p.amount),
        })),
      ];
      const st = buildStatement({ openingBalance: num(customer.openingBalance), txns, from, to });
      return { customerName: customer.customerName, ...st, from: from ?? null, to: to ?? null };
    });
  }

  /** Tally-ready CSV of issued invoices (Phase-1 file export — no live Tally API). */
  tallyExportCsv(tenantId: string, from?: string, to?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const invoices = (await m.getRepository(Invoice).find({ where: { invoiceStatus: 'issued' }, order: { invoiceDate: 'ASC' } }))
        .filter((i) => (!from || (i.invoiceDate ?? '') >= from) && (!to || (i.invoiceDate ?? '') <= to));
      const customers = await m.getRepository(Customer).find();
      const nameOf = new Map(customers.map((c) => [c.id, c.customerName]));
      const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const header = ['Date', 'VoucherType', 'InvoiceNo', 'Party', 'GSTIN', 'Taxable', 'CGST', 'SGST', 'IGST', 'Cess', 'RoundOff', 'Total'];
      const lines = [header.join(',')];
      for (const i of invoices) {
        lines.push([
          esc(i.invoiceDate), esc('Sales'), esc(i.invoiceNo), esc(nameOf.get(i.customerId ?? '') ?? ''), esc(i.gstin),
          i.taxableAmount, i.cgstAmount, i.sgstAmount, i.igstAmount, i.cessAmount, i.roundOff, i.totalAmount,
        ].join(','));
      }
      return { csv: lines.join('\n'), count: invoices.length };
    });
  }
}
