import { round2 } from '../common/money.util';

/**
 * Receipt allocation (Plan C1) — greedily spread an amount across invoices, in
 * the given order, up to each invoice's outstanding. Used when applying a held
 * advance to later invoices. Pure so the arithmetic is unit-testable.
 */

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

export type PaymentStatus = 'paid' | 'partially_paid' | 'unpaid' | 'credited';

/** Issued credit / debit note totals against an invoice (DB numerics allowed). */
export interface InvoiceNotes {
  credited?: number | string | null;
  debited?: number | string | null;
}

/**
 * An invoice's balance after its paid figure changes, honouring any write-off
 * and any credit / debit notes issued against it.
 *
 *   outstanding = total + debited − credited − paid − writtenOff
 *   status = 'paid' once outstanding clears and money was received,
 *            'credited' once it clears by credit note alone,
 *            'partially_paid' while any money has been received, else 'unpaid'
 *
 * The single source of truth for post-allocation invoice balances: receipt
 * create, advance apply, cheque bounce, write-off and credit / debit notes all
 * settle through here, so none can drift. The notes are part of the formula
 * for a reason: a note that only edited the outstanding would be undone the
 * next time a receipt recomputed it from the invoice's figures. Pure so the
 * arithmetic is unit-testable. Inputs may be numeric strings (DB numerics).
 */
export function invoiceBalanceAfter(
  totalAmount: number | string,
  amountPaid: number | string,
  writtenOffAmount: number | string,
  notes: InvoiceNotes = {},
): { outstanding: number; paymentStatus: PaymentStatus } {
  const paid = round2(Number(amountPaid) || 0);
  const credited = round2(Number(notes.credited) || 0);
  const debited = round2(Number(notes.debited) || 0);
  const outstanding = round2((Number(totalAmount) || 0) + debited - credited - paid - (Number(writtenOffAmount) || 0));
  const paymentStatus: PaymentStatus =
    outstanding <= 0.001 ? (paid > 0.001 ? 'paid' : credited > 0.001 ? 'credited' : 'paid') : paid > 0.001 ? 'partially_paid' : 'unpaid';
  return { outstanding, paymentStatus };
}
