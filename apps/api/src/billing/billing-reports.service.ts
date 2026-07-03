import { Injectable } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';
import { Customer, Invoice, Payment } from '../core/database/entities';
import { round2 } from './tax.util';

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
      const nameOf = new Map(customers.map((c) => [c.id, c.customerName]));
      const byCustomer = new Map<string, { customerName: string; total: number; b0_30: number; b31_60: number; b61_90: number; b90: number }>();
      const totals = { total: 0, b0_30: 0, b31_60: 0, b61_90: 0, b90: 0 };

      for (const inv of invoices) {
        const out = num(inv.outstandingAmount);
        if (out <= 0) continue;
        const key = inv.customerId ?? 'unknown';
        const row = byCustomer.get(key) ?? { customerName: nameOf.get(key) ?? 'Unknown', total: 0, b0_30: 0, b31_60: 0, b61_90: 0, b90: 0 };
        const bucket = bucketOf(daysBetween(inv.invoiceDate));
        row.total = round2(row.total + out);
        if (bucket === '0-30') { row.b0_30 = round2(row.b0_30 + out); totals.b0_30 = round2(totals.b0_30 + out); }
        else if (bucket === '31-60') { row.b31_60 = round2(row.b31_60 + out); totals.b31_60 = round2(totals.b31_60 + out); }
        else if (bucket === '61-90') { row.b61_90 = round2(row.b61_90 + out); totals.b61_90 = round2(totals.b61_90 + out); }
        else { row.b90 = round2(row.b90 + out); totals.b90 = round2(totals.b90 + out); }
        totals.total = round2(totals.total + out);
        byCustomer.set(key, row);
      }
      return { rows: [...byCustomer.values()].sort((a, b) => b.total - a.total), totals };
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
