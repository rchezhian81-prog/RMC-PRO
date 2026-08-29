import { Injectable } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';
import { Supplier, VendorBill, VendorPayment } from '../core/database/entities';
import { round2 } from '../billing/tax.util';
import { buildStatement, type StatementTxn } from '../billing/statement.util';

const num = (v: unknown): number => Number(v ?? 0) || 0;

/**
 * Purchase / accounts-payable MIS (Tier-D). The counterparts of the billing
 * receivables reports, for the supplier side:
 *  - payables aging   — who we owe, bucketed by how long the bill has stood
 *  - vendor ledger    — one supplier's running payable (bills − payments)
 *  - purchase register — bills booked in a period, with vendor- and material-wise
 *                        rollups
 *
 * All read-only, RLS-scoped, derived from the existing purchase tables — no new
 * columns. (The ITC/GST-input register stays on VendorBillService.)
 */
@Injectable()
export class PurchaseReportsService {
  constructor(private readonly db: TenantDbService) {}

  /**
   * Per-supplier outstanding payable with 0-30 / 31-60 / 61-90 / 90+ aging
   * buckets, aged by the bill date (mirrors the receivables `outstanding`
   * report so the two sides read the same way). Approved bills with a balance
   * only; contact details ride along so payments can be chased without a second
   * lookup.
   */
  payablesAging(tenantId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const age = (lo: string) => `(CURRENT_DATE - COALESCE(b.bill_date, CURRENT_DATE)) ${lo}`;
      const rows: Array<Record<string, string | number>> = await m.query(
        `SELECT s.supplier_name  AS "supplierName",
                s.gstin          AS gstin,
                s.contact_person AS "contactPerson",
                s.mobile         AS mobile,
                SUM(b.outstanding_amount)::float AS total,
                COALESCE(SUM(b.outstanding_amount) FILTER (WHERE ${age('<= 30')}), 0)::float          AS "b0_30",
                COALESCE(SUM(b.outstanding_amount) FILTER (WHERE ${age('BETWEEN 31 AND 60')}), 0)::float AS "b31_60",
                COALESCE(SUM(b.outstanding_amount) FILTER (WHERE ${age('BETWEEN 61 AND 90')}), 0)::float AS "b61_90",
                COALESCE(SUM(b.outstanding_amount) FILTER (WHERE ${age('> 90')}), 0)::float            AS "b90"
           FROM vendor_bills b
           LEFT JOIN suppliers s ON s.id = b.supplier_id
          WHERE b.status = 'approved' AND b.outstanding_amount > 0.001
          GROUP BY s.supplier_name, s.gstin, s.contact_person, s.mobile
          ORDER BY total DESC`,
      );
      const totals = ['total', 'b0_30', 'b31_60', 'b61_90', 'b90'].reduce(
        (acc, k) => ({ ...acc, [k]: round2(rows.reduce((s, r) => s + num(r[k]), 0)) }),
        {} as Record<string, number>,
      );
      return { rows, totals };
    });
  }

  /**
   * Vendor statement of account (payable ledger): a supplier's approved bills as
   * debits (payable rises) and non-reversed payments as credits (payable falls),
   * in date order with a running balance. Suppliers carry no opening balance, so
   * the ledger opens at zero. Optionally bounded to [from, to] — earlier activity
   * folds into the period's opening balance.
   */
  vendorLedger(tenantId: string, supplierId: string, from?: string, to?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const empty = { supplierName: '', opening: 0, rows: [], totalDebit: 0, totalCredit: 0, closing: 0, from: from ?? null, to: to ?? null };
      if (!supplierId) return empty;
      const supplier = await m.getRepository(Supplier).findOne({ where: { id: supplierId } });
      if (!supplier) return empty;
      const [bills, payments] = await Promise.all([
        m.getRepository(VendorBill).find({ where: { supplierId, status: 'approved' } }),
        m.getRepository(VendorPayment).find({ where: { supplierId } }),
      ]);
      const iso = (v: unknown): string => { try { return new Date(v as string | number | Date).toISOString(); } catch { return ''; } };
      const sk = (date: string | null, createdAt: unknown) => `${date ?? '9999-99-99'}#${iso(createdAt)}`;
      const txns: StatementTxn[] = [
        ...bills.map((b) => ({
          date: b.billDate, sortKey: sk(b.billDate, b.createdAt), type: 'bill' as const,
          ref: b.billNo, particulars: `Bill ${b.billNo}${b.supplierBillNo ? ` (${b.supplierBillNo})` : ''}`,
          debit: num(b.totalAmount), credit: 0,
        })),
        ...payments.filter((p) => p.status !== 'reversed' && p.status !== 'cancelled').map((p) => ({
          date: p.paymentDate, sortKey: sk(p.paymentDate, p.createdAt), type: 'payment' as const,
          ref: p.paymentNo, particulars: `Payment ${p.paymentNo}${p.paymentMode ? ` (${p.paymentMode})` : ''}`,
          debit: 0, credit: num(p.amount),
        })),
      ];
      const st = buildStatement({ openingBalance: 0, txns, from, to });
      return { supplierName: supplier.supplierName, ...st, from: from ?? null, to: to ?? null };
    });
  }

  /**
   * Purchase register — approved bills booked in a period, plus vendor-wise and
   * material-wise rollups. The booked-purchases counterpart of the sales
   * register; date-bounded on the bill date.
   */
  purchaseRegister(tenantId: string, from?: string, to?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const params = [from ?? null, to ?? null];
      const dateBounds = `($1::date IS NULL OR b.bill_date >= $1::date) AND ($2::date IS NULL OR b.bill_date <= $2::date)`;

      const rows: Array<Record<string, string | number | null>> = await m.query(
        `SELECT b.bill_no          AS "billNo",
                b.supplier_bill_no AS "supplierBillNo",
                b.bill_date        AS "billDate",
                s.supplier_name    AS "supplierName",
                s.gstin            AS gstin,
                b.taxable_amount::float AS taxable,
                b.tax_amount::float     AS tax,
                b.total_amount::float   AS total,
                b.match_status     AS "matchStatus"
           FROM vendor_bills b
           LEFT JOIN suppliers s ON s.id = b.supplier_id
          WHERE b.status = 'approved' AND ${dateBounds}
          ORDER BY b.bill_date, b.bill_no`,
        params,
      );

      const byVendor: Array<Record<string, string | number | null>> = await m.query(
        `SELECT s.supplier_name AS "supplierName",
                s.gstin         AS gstin,
                COUNT(*)::int   AS "billCount",
                SUM(b.taxable_amount)::float AS taxable,
                SUM(b.tax_amount)::float     AS tax,
                SUM(b.total_amount)::float   AS total
           FROM vendor_bills b
           LEFT JOIN suppliers s ON s.id = b.supplier_id
          WHERE b.status = 'approved' AND ${dateBounds}
          GROUP BY s.supplier_name, s.gstin
          ORDER BY total DESC`,
        params,
      );

      const byMaterial: Array<Record<string, string | number | null>> = await m.query(
        `SELECT COALESCE(NULLIF(bi.material_label, ''), '—') AS material,
                SUM(bi.quantity)::float       AS quantity,
                SUM(bi.taxable_amount)::float AS taxable,
                SUM(bi.tax_amount)::float     AS tax,
                SUM(bi.line_total)::float     AS total
           FROM vendor_bill_items bi
           JOIN vendor_bills b ON b.id = bi.vendor_bill_id
          WHERE b.status = 'approved' AND ${dateBounds}
          GROUP BY bi.material_label
          ORDER BY total DESC`,
        params,
      );

      const totals = {
        taxable: round2(rows.reduce((s, r) => s + num(r.taxable), 0)),
        tax: round2(rows.reduce((s, r) => s + num(r.tax), 0)),
        total: round2(rows.reduce((s, r) => s + num(r.total), 0)),
        count: rows.length,
      };
      return { rows, byVendor, byMaterial, totals };
    });
  }
}
