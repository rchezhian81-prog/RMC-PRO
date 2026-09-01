import { Injectable } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';
import { Company, Customer, Invoice, Payment, Supplier, VendorBill } from '../core/database/entities';
import { round2, isInterstateSupply } from './tax.util';
import { deriveGstSplit } from '../purchase/purchase.util';
import { computeCustomerExposure } from '../orders/exposure.util';
import { buildStatement, type StatementTxn } from './statement.util';
import { buildGradeMargin, type MarginRevenueRow, type MarginCostRow } from './gross-margin.util';
import {
  buildCollectionEfficiency,
  type BilledRow,
  type CollectedRow,
  type OutstandingRow,
} from './collection-efficiency.util';

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

  /**
   * Gross margin per m³ by concrete grade over [from, to]: invoiced revenue and
   * volume from grade invoice lines, against the STANDARD material cost per m³
   * (the active mix design's per-m³ recipe valued at each material's standard
   * rate). This is margin over material only — it excludes labour, power,
   * transport and overheads — so it reads as "contribution over material", useful
   * for spotting an underpriced or loss-making grade.
   */
  gradeMargin(tenantId: string, from?: string, to?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const params = [from ?? null, to ?? null];
      const revenueRows: MarginRevenueRow[] = await m.query(
        `SELECT ii.grade_id AS "gradeId",
                MAX(g.grade_name) AS "gradeLabel",
                COALESCE(SUM(ii.quantity), 0)::float AS "volumeM3",
                COALESCE(SUM(ii.taxable_amount), 0)::float AS revenue
           FROM invoice_items ii
           JOIN invoices i ON i.id = ii.invoice_id
           LEFT JOIN concrete_grades g ON g.id = ii.grade_id
          WHERE i.invoice_status = 'issued'
            AND ii.grade_id IS NOT NULL
            AND ($1::date IS NULL OR i.invoice_date >= $1::date)
            AND ($2::date IS NULL OR i.invoice_date <= $2::date)
          GROUP BY ii.grade_id`,
        params,
      );
      const costRows: MarginCostRow[] = await m.query(
        `SELECT md.grade_id AS "gradeId",
                COALESCE(SUM(mdm.target_quantity * COALESCE(mat.standard_rate, 0)), 0)::float AS "stdCostPerM3"
           FROM mix_designs md
           JOIN mix_design_materials mdm ON mdm.mix_design_id = md.id
           LEFT JOIN materials mat ON mat.id = mdm.material_id
          WHERE md.is_active_version = true
            AND md.approval_status = 'approved'
            AND md.grade_id IS NOT NULL
          GROUP BY md.grade_id`,
      );
      return { ...buildGradeMargin(revenueRows, costRows), from: from ?? null, to: to ?? null };
    });
  }

  /**
   * Collection efficiency + DSO over [from, to], per customer and overall:
   * billed (issued invoices in the period), collected (non-reversed receipts in
   * the period), and closing receivables (current outstanding on issued
   * invoices). Efficiency = collected/billed; DSO = outstanding × periodDays /
   * billed. periodDays is the from..to span (inclusive), or 365 when unbounded.
   */
  collectionEfficiency(tenantId: string, from?: string, to?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const params = [from ?? null, to ?? null];
      const billedRows: BilledRow[] = await m.query(
        `SELECT i.customer_id AS "customerId",
                MAX(c.customer_name) AS "customerName",
                COALESCE(SUM(i.total_amount), 0)::float AS billed
           FROM invoices i
           LEFT JOIN customers c ON c.id = i.customer_id
          WHERE i.invoice_status = 'issued'
            AND ($1::date IS NULL OR i.invoice_date >= $1::date)
            AND ($2::date IS NULL OR i.invoice_date <= $2::date)
          GROUP BY i.customer_id`,
        params,
      );
      const collectedRows: CollectedRow[] = await m.query(
        `SELECT p.customer_id AS "customerId",
                MAX(c.customer_name) AS "customerName",
                COALESCE(SUM(p.amount), 0)::float AS collected
           FROM payments p
           LEFT JOIN customers c ON c.id = p.customer_id
          WHERE p.status <> 'reversed'
            AND ($1::date IS NULL OR p.receipt_date >= $1::date)
            AND ($2::date IS NULL OR p.receipt_date <= $2::date)
          GROUP BY p.customer_id`,
        params,
      );
      // Closing receivables are current (not period-bounded) — the AR balance now.
      const outstandingRows: OutstandingRow[] = await m.query(
        `SELECT i.customer_id AS "customerId",
                MAX(c.customer_name) AS "customerName",
                COALESCE(SUM(i.outstanding_amount), 0)::float AS outstanding
           FROM invoices i
           LEFT JOIN customers c ON c.id = i.customer_id
          WHERE i.invoice_status = 'issued'
          GROUP BY i.customer_id`,
      );
      const periodDays =
        from && to
          ? Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1)
          : 365;
      return {
        ...buildCollectionEfficiency(billedRows, collectedRows, outstandingRows, periodDays),
        from: from ?? null,
        to: to ?? null,
      };
    });
  }

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

  /**
   * Sales register — issued invoices (optionally date-bounded), GSTR-1-shaped:
   * each row already carries GSTIN, place-of-supply and the tax-head split, and
   * a B2B/B2C summary classifies registered (has GSTIN) vs unregistered buyers.
   */
  salesRegister(tenantId: string, from?: string, to?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const all = await m.getRepository(Invoice).find({ where: { invoiceStatus: 'issued' }, order: { invoiceDate: 'ASC' } });
      const rows = all.filter((i) => (!from || (i.invoiceDate ?? '') >= from) && (!to || (i.invoiceDate ?? '') <= to));
      const total = round2(rows.reduce((s, i) => s + num(i.totalAmount), 0));
      const taxable = round2(rows.reduce((s, i) => s + num(i.taxableAmount), 0));
      const bucket = (list: Invoice[]) => ({
        count: list.length,
        taxable: round2(list.reduce((s, i) => s + num(i.taxableAmount), 0)),
        total: round2(list.reduce((s, i) => s + num(i.totalAmount), 0)),
      });
      const isB2b = (i: Invoice) => !!(i.gstin && String(i.gstin).trim());
      const summary = { b2b: bucket(rows.filter(isB2b)), b2c: bucket(rows.filter((i) => !isB2b(i))) };
      return { rows, total, taxable, count: rows.length, summary };
    });
  }

  /** GST summary (tax heads) over issued invoices, optionally date-bounded. */
  gstSummary(tenantId: string, from?: string, to?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const all = await m.getRepository(Invoice).find({ where: { invoiceStatus: 'issued' } });
      const rows = all.filter((i) => (!from || (i.invoiceDate ?? '') >= from) && (!to || (i.invoiceDate ?? '') <= to));
      const sum = (f: (i: Invoice) => unknown) => round2(rows.reduce((s, i) => s + num(f(i)), 0));
      return {
        taxable: sum((i) => i.taxableAmount), cgst: sum((i) => i.cgstAmount), sgst: sum((i) => i.sgstAmount),
        igst: sum((i) => i.igstAmount), cess: sum((i) => i.cessAmount), total: sum((i) => i.totalAmount),
      };
    });
  }

  /**
   * HSN/SAC summary (GSTR-1 Table 12): issued-invoice line items grouped by HSN
   * and GST rate — quantity, taxable and each tax head — optionally date-bounded.
   * Read via raw SQL (RLS-scoped) so the group-by runs in the database.
   */
  hsnSummary(tenantId: string, from?: string, to?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const where = ["i.invoice_status = 'issued'"];
      const params: unknown[] = [];
      if (from) { params.push(from); where.push(`i.invoice_date >= $${params.length}`); }
      if (to) { params.push(to); where.push(`i.invoice_date <= $${params.length}`); }
      const rows: Array<Record<string, number | string>> = await m.query(
        `SELECT COALESCE(NULLIF(ii.hsn_sac, ''), '—') AS hsn,
                ii.gst_rate::float                    AS "gstRate",
                SUM(ii.quantity)::float               AS quantity,
                SUM(ii.taxable_amount)::float         AS taxable,
                SUM(ii.cgst_amount)::float            AS cgst,
                SUM(ii.sgst_amount)::float            AS sgst,
                SUM(ii.igst_amount)::float            AS igst,
                SUM(ii.cess_amount)::float            AS cess,
                SUM(ii.line_total)::float             AS total
           FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
          WHERE ${where.join(' AND ')}
          GROUP BY ii.hsn_sac, ii.gst_rate
          ORDER BY hsn, "gstRate"`,
        params,
      );
      const totals = ['quantity', 'taxable', 'cgst', 'sgst', 'igst', 'cess', 'total'].reduce(
        (acc, k) => ({ ...acc, [k]: round2(rows.reduce((s, r) => s + num(r[k]), 0)) }),
        {} as Record<string, number>,
      );
      return { rows, totals };
    });
  }

  /** Receipts register, optionally bounded to [from, to] on the receipt date. */
  receiptsRegister(tenantId: string, from?: string, to?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const all = await m.getRepository(Payment).find({ order: { createdAt: 'DESC' } });
      return all.filter((p) => (!from || (p.receiptDate ?? '') >= from) && (!to || (p.receiptDate ?? '') <= to));
    });
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

  /**
   * GSTR-3B net liability — the output tax on issued sales invoices less the
   * input tax credit on approved purchase bills, over a period. Combines the two
   * sides the system already tracks separately (the GST summary and the ITC
   * register) into the net cash payable per tax head. The purchase side has no
   * stored CGST/SGST/IGST split, so it is derived from the bill's tax and the
   * supplier-vs-company state test, exactly as the ITC register does.
   */
  gstr3b(tenantId: string, from?: string, to?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const inPeriod = (d: string | null) => (!from || (d ?? '') >= from) && (!to || (d ?? '') <= to);

      // Output tax — issued invoices, from the stored header tax heads.
      const invoices = (await m.getRepository(Invoice).find({ where: { invoiceStatus: 'issued' } })).filter((i) => inPeriod(i.invoiceDate));
      const oSum = (f: (i: Invoice) => unknown) => round2(invoices.reduce((s, i) => s + num(f(i)), 0));
      const output = {
        taxable: oSum((i) => i.taxableAmount), cgst: oSum((i) => i.cgstAmount), sgst: oSum((i) => i.sgstAmount),
        igst: oSum((i) => i.igstAmount), cess: oSum((i) => i.cessAmount), total: oSum((i) => i.totalAmount),
      };

      // Input tax credit — approved AND ITC-eligible bills only; blocked-credit
      // bills (Sec 17(5)) are excluded from the claimable ITC. Split derived from
      // the supplier-vs-company state test.
      const bills = (await m.getRepository(VendorBill).find({ where: { status: 'approved', itcEligible: true } })).filter((b) => inPeriod(b.billDate));
      const suppliers = await m.getRepository(Supplier).find();
      const supOf = new Map(suppliers.map((s) => [s.id, s]));
      const company = (await m.getRepository(Company).find({ take: 1 }))[0];
      const itc = { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
      for (const b of bills) {
        const s = b.supplierId ? supOf.get(b.supplierId) : null;
        const split = deriveGstSplit(num(b.taxAmount), isInterstateSupply(company?.state, s?.state));
        itc.taxable = round2(itc.taxable + num(b.taxableAmount));
        itc.cgst = round2(itc.cgst + split.cgst);
        itc.sgst = round2(itc.sgst + split.sgst);
        itc.igst = round2(itc.igst + split.igst);
      }
      const itcTotal = round2(itc.cgst + itc.sgst + itc.igst);

      // Net liability per head (output − ITC); cess has no ITC here.
      const net = {
        cgst: round2(output.cgst - itc.cgst), sgst: round2(output.sgst - itc.sgst),
        igst: round2(output.igst - itc.igst), cess: output.cess,
      };
      const netTotal = round2(net.cgst + net.sgst + net.igst + net.cess);

      return {
        output: { ...output },
        itc: { ...itc, total: itcTotal },
        net: { ...net, total: netTotal },
        from: from ?? null, to: to ?? null,
      };
    });
  }

  /**
   * Cash / bank day book — every money movement in a period from the three
   * transactional sources, since there is no single ledger table: customer
   * receipts (inflow), vendor payments and expense vouchers (outflow). Direction
   * is implicit by source; reversed receipts and unposted vouchers are excluded.
   * Returns the line items plus overall and per-mode (cash/bank/upi/cheque)
   * totals. RLS-scoped raw SQL so the union runs in the database.
   */
  cashBankDayBook(tenantId: string, from?: string, to?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const params = [from ?? null, to ?? null];
      const rows: Array<{ date: string; kind: string; ref: string; mode: string; party: string; inflow: number; outflow: number }> = await m.query(
        `WITH tx AS (
            SELECT p.receipt_date AS date, 'Receipt' AS kind, p.receipt_no AS ref,
                   COALESCE(NULLIF(p.payment_mode, ''), '—') AS mode,
                   COALESCE(c.customer_name, '') AS party,
                   p.amount::float AS inflow, 0::float AS outflow
              FROM payments p LEFT JOIN customers c ON c.id = p.customer_id
             WHERE p.status <> 'reversed'
            UNION ALL
            SELECT vp.payment_date, 'Vendor payment', vp.payment_no,
                   COALESCE(NULLIF(vp.payment_mode, ''), '—'),
                   COALESCE(s.supplier_name, ''),
                   0::float, vp.amount::float
              FROM vendor_payments vp LEFT JOIN suppliers s ON s.id = vp.supplier_id
             WHERE vp.status = 'posted'
            UNION ALL
            SELECT ev.voucher_date, 'Expense', ev.voucher_no,
                   COALESCE(NULLIF(ev.payment_mode, ''), '—'),
                   COALESCE(ev.payee, ''),
                   0::float, ev.total_amount::float
              FROM expense_vouchers ev
             WHERE ev.status = 'posted'
         )
         SELECT date, kind, ref, mode, party, inflow, outflow
           FROM tx
          WHERE ($1::date IS NULL OR date >= $1::date)
            AND ($2::date IS NULL OR date <= $2::date)
          ORDER BY date, ref`,
        params,
      );

      const totals = {
        inflow: round2(rows.reduce((s, r) => s + num(r.inflow), 0)),
        outflow: round2(rows.reduce((s, r) => s + num(r.outflow), 0)),
        net: 0, count: rows.length,
      };
      totals.net = round2(totals.inflow - totals.outflow);

      const modeMap = new Map<string, { mode: string; inflow: number; outflow: number; net: number }>();
      for (const r of rows) {
        const key = r.mode || '—';
        const e = modeMap.get(key) ?? { mode: key, inflow: 0, outflow: 0, net: 0 };
        e.inflow = round2(e.inflow + num(r.inflow));
        e.outflow = round2(e.outflow + num(r.outflow));
        e.net = round2(e.inflow - e.outflow);
        modeMap.set(key, e);
      }
      const byMode = [...modeMap.values()].sort((a, b) => b.inflow + b.outflow - (a.inflow + a.outflow));

      return { rows, totals, byMode, from: from ?? null, to: to ?? null };
    });
  }

  /**
   * Sales MIS — issued-invoice sales sliced three ways: by customer, by plant
   * (invoice header) and by concrete grade (invoice lines). The management view
   * the sales register (a flat list) does not give. Value-bearing; date-bounded
   * on the invoice date. RLS-scoped raw SQL so the group-bys run in the database.
   */
  salesMis(tenantId: string, from?: string, to?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const params = [from ?? null, to ?? null];
      const invBounds = `i.invoice_status = 'issued' AND ($1::date IS NULL OR i.invoice_date >= $1::date) AND ($2::date IS NULL OR i.invoice_date <= $2::date)`;

      const byCustomer: Array<Record<string, string | number | null>> = await m.query(
        `SELECT COALESCE(c.customer_name, 'Unknown') AS "customerName",
                COALESCE(c.customer_type, '')        AS "customerType",
                COUNT(i.id)::int                     AS invoices,
                SUM(i.taxable_amount)::float         AS taxable,
                SUM(i.total_amount)::float           AS total
           FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
          WHERE ${invBounds}
          GROUP BY c.customer_name, c.customer_type
          ORDER BY total DESC`,
        params,
      );

      const byPlant: Array<Record<string, string | number | null>> = await m.query(
        `SELECT COALESCE(p.plant_name, 'Unassigned') AS "plantName",
                COUNT(i.id)::int             AS invoices,
                SUM(i.taxable_amount)::float AS taxable,
                SUM(i.total_amount)::float   AS total
           FROM invoices i LEFT JOIN plants p ON p.id = i.plant_id
          WHERE ${invBounds}
          GROUP BY p.plant_name
          ORDER BY total DESC`,
        params,
      );

      const byGrade: Array<Record<string, string | number | null>> = await m.query(
        `SELECT COALESCE(cg.grade_name, NULLIF(ii.description, ''), 'Ungraded') AS grade,
                SUM(ii.quantity)::float       AS quantity,
                SUM(ii.taxable_amount)::float AS taxable,
                SUM(ii.line_total)::float     AS total
           FROM invoice_items ii
           JOIN invoices i ON i.id = ii.invoice_id AND ${invBounds}
           LEFT JOIN concrete_grades cg ON cg.id = ii.grade_id
          GROUP BY COALESCE(cg.grade_name, NULLIF(ii.description, ''), 'Ungraded')
          ORDER BY total DESC`,
        params,
      );

      const totals = {
        invoices: byCustomer.reduce((s, r) => s + num(r.invoices), 0),
        taxable: round2(byCustomer.reduce((s, r) => s + num(r.taxable), 0)),
        total: round2(byCustomer.reduce((s, r) => s + num(r.total), 0)),
      };
      return { byCustomer, byPlant, byGrade, totals, from: from ?? null, to: to ?? null };
    });
  }
}
