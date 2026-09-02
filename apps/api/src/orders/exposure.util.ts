import type { EntityManager } from 'typeorm';
import { Customer } from '../core/database/entities';
import { round2 } from '../billing/tax.util';
import { creditExposureValue } from './credit-value.util';

/**
 * Unified customer credit-exposure — the single source of truth (design plan §3).
 *
 * A customer's exposure is:
 *
 *   opening_balance
 *   + un-invoiced value of CONFIRMED orders   (committed but not yet billed)
 *   + issued-invoice outstanding              (total − paid − written-off)
 *   − unapplied advance credit                (auto-nets, owner-decided)
 *
 * The order→invoice hand-off avoids double counting: a confirmed order counts
 * only its value that has NOT yet been billed (its incl-GST value minus the
 * total of issued invoices raised against its challans). Once fully invoiced it
 * contributes nothing and the invoice's outstanding carries it; a partially
 * invoiced order contributes only its remainder.
 *
 * The arithmetic below is split into pure helpers (unit-tested from dist) and a
 * DB reader `computeCustomerExposure(m, …)` that gathers the four terms and is
 * exercised by the ar-exposure integration scenarios. Reads run inside the
 * caller's tenant transaction, so RLS scopes every query — no tenant filter,
 * exactly like the dashboard/alerts read-models.
 */

const num = (v: unknown): number => Number(v ?? 0) || 0;

/** The still-owed value of one confirmed order: its exposure value minus what
 *  has already been billed, never below zero. Legacy rows (no incl-GST) fall
 *  back to the ex-GST value via creditExposureValue. */
export function orderRemaining(
  inclGst: string | number | null | undefined,
  exGst: string | number | null | undefined,
  billed: string | number | null | undefined,
): number {
  return Math.max(0, round2(creditExposureValue(inclGst, exGst) - num(billed)));
}

export interface ExposureParts {
  openingBalance: number;
  unInvoicedOrderValue: number;
  invoiceOutstanding: number;
  advanceCredit: number;
  creditLimit: number;
}

export interface CustomerExposure extends ExposureParts {
  /** opening + un-invoiced orders + invoice outstanding − advance credit. */
  exposure: number;
  /** credit_limit − exposure, or null when no limit is configured (unlimited). */
  availableCredit: number | null;
}

/** Pure assembly of the four terms into exposure + available credit. A
 *  credit_limit of 0 means "no limit configured" (unlimited), so availableCredit
 *  is null there — mirroring the credit gate's `enforced = limit > 0` rule. */
export function assembleExposure(parts: ExposureParts): CustomerExposure {
  const openingBalance = round2(num(parts.openingBalance));
  const unInvoicedOrderValue = round2(num(parts.unInvoicedOrderValue));
  const invoiceOutstanding = round2(num(parts.invoiceOutstanding));
  const advanceCredit = round2(num(parts.advanceCredit));
  const creditLimit = round2(num(parts.creditLimit));
  const exposure = round2(openingBalance + unInvoicedOrderValue + invoiceOutstanding - advanceCredit);
  return {
    openingBalance,
    unInvoicedOrderValue,
    invoiceOutstanding,
    advanceCredit,
    creditLimit,
    exposure,
    availableCredit: creditLimit > 0 ? round2(creditLimit - exposure) : null,
  };
}

/**
 * Gather a customer's live exposure from the DB. Must run inside a tenant
 * transaction (RLS scopes each query). Pass excludeOrderId to leave one order
 * out of the un-invoiced sum — used when re-assessing that order's own booking
 * so its value is not double-counted with the requested amount.
 */
export async function computeCustomerExposure(
  m: EntityManager,
  customerId: string | null,
  excludeOrderId?: string,
): Promise<CustomerExposure> {
  if (!customerId) {
    return assembleExposure({
      openingBalance: 0, unInvoicedOrderValue: 0, invoiceOutstanding: 0, advanceCredit: 0, creditLimit: 0,
    });
  }

  const customer = await m.getRepository(Customer).findOne({ where: { id: customerId } });
  const openingBalance = num(customer?.openingBalance);
  const creditLimit = num(customer?.creditLimit);

  // Un-invoiced confirmed-order value. billed = Σ issued-invoice line totals
  // raised against each order's challans, summed over invoice_items (each item
  // carries its own challan + line total). Summing i.total_amount over the
  // invoice→challan join instead fans out — a k-challan invoice would add the
  // whole invoice total k times and prematurely zero the order's remainder,
  // under-counting exposure. GREATEST(0, …) floors each order at its remaining
  // value so an over-billed order never turns exposure negative.
  const orderRows: Array<{ total: number | string | null }> = await m.query(
    `SELECT COALESCE(SUM(GREATEST(0,
         COALESCE(o.estimated_order_value_incl_gst, o.estimated_order_value)
         - COALESCE(b.billed, 0))), 0)::float AS total
       FROM orders o
       LEFT JOIN (
         SELECT dc.order_id, SUM(ii.line_total) AS billed
           FROM invoice_items ii
           JOIN invoices i ON i.id = ii.invoice_id AND i.invoice_status = 'issued'
           JOIN delivery_challans dc ON dc.id = ii.challan_id
          GROUP BY dc.order_id
       ) b ON b.order_id = o.id
      WHERE o.customer_id = $1
        AND o.order_status = 'confirmed'
        AND ($2::uuid IS NULL OR o.id <> $2::uuid)`,
    [customerId, excludeOrderId ?? null],
  );
  const unInvoicedOrderValue = num(orderRows[0]?.total);

  // Issued-invoice outstanding (total − paid − written-off, already maintained
  // by the receipt path).
  const invoiceRows: Array<{ total: number | string | null }> = await m.query(
    `SELECT COALESCE(SUM(outstanding_amount), 0)::float AS total
       FROM invoices WHERE customer_id = $1 AND invoice_status = 'issued'`,
    [customerId],
  );
  const invoiceOutstanding = num(invoiceRows[0]?.total);

  // Unapplied advance credit — every non-reversed receipt's leftover. Auto-nets.
  // A PENDING cheque is money-in-transit, not cleared funds, so it must NOT free
  // up credit headroom until it clears (cheque bouncing is common) — exclude it.
  const advanceRows: Array<{ total: number | string | null }> = await m.query(
    `SELECT COALESCE(SUM(unallocated_amount), 0)::float AS total
       FROM payments
      WHERE customer_id = $1 AND status <> 'reversed' AND COALESCE(clearing_status, '') <> 'pending'`,
    [customerId],
  );
  const advanceCredit = num(advanceRows[0]?.total);

  return assembleExposure({ openingBalance, unInvoicedOrderValue, invoiceOutstanding, advanceCredit, creditLimit });
}
