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
