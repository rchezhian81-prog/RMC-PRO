/**
 * Receipt allocation (Plan C1) — greedily spread an amount across invoices, in
 * the given order, up to each invoice's outstanding. Used when applying a held
 * advance to later invoices. Pure so the arithmetic is unit-testable.
 */
const round2 = (v: number): number => Math.round((Number(v) || 0) * 100) / 100;

export interface AllocatableInvoice {
  id: string;
  outstanding: number;
}
export interface AllocationLine {
  invoiceId: string;
  amount: number;
}

export function allocateAcrossInvoices(amount: number, invoices: AllocatableInvoice[]): AllocationLine[] {
  let left = round2(amount);
  const out: AllocationLine[] = [];
  for (const inv of invoices) {
    if (left <= 0.001) break;
    const take = round2(Math.min(left, round2(inv.outstanding)));
    if (take > 0.001) {
      out.push({ invoiceId: inv.id, amount: take });
      left = round2(left - take);
    }
  }
  return out;
}

export type PaymentStatus = 'paid' | 'partially_paid' | 'unpaid';

/**
 * An invoice's balance after its paid figure changes, honouring any write-off.
 *
 *   outstanding = total − paid − writtenOff
 *   status = 'paid' once outstanding clears, 'partially_paid' while any money
 *            has been received, else 'unpaid'
 *
 * The single source of truth for post-allocation invoice balances: receipt
 * create, advance apply, and cheque bounce all settle through here, so none can
 * drift (e.g. forget the write-off and resurrect a written-off balance). Pure so
 * the arithmetic is unit-testable. Inputs may be numeric strings (DB numerics).
 */
export function invoiceBalanceAfter(
  totalAmount: number | string,
  amountPaid: number | string,
  writtenOffAmount: number | string,
): { outstanding: number; paymentStatus: PaymentStatus } {
  const paid = round2(Number(amountPaid) || 0);
  const outstanding = round2((Number(totalAmount) || 0) - paid - (Number(writtenOffAmount) || 0));
  const paymentStatus: PaymentStatus = outstanding <= 0.001 ? 'paid' : paid > 0.001 ? 'partially_paid' : 'unpaid';
  return { outstanding, paymentStatus };
}
