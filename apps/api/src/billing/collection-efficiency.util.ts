/**
 * Pure collection-efficiency + DSO maths.
 *
 * Per customer over a period:
 *   - billed       : Σ issued-invoice total in the period
 *   - collected    : Σ receipts (non-reversed) in the period
 *   - outstanding  : Σ current outstanding on issued invoices (closing AR)
 *
 * Two derived measures:
 *   - collection efficiency % = collected / billed × 100  (can exceed 100 when
 *     old dues are cleared — that is informative, not a bug)
 *   - DSO (days sales outstanding) = outstanding ÷ (billed / periodDays)
 *     = outstanding × periodDays / billed — roughly how many days of billing is
 *     tied up in receivables.
 *
 * The service supplies three pre-aggregated SQL result sets keyed by customer;
 * this merges them and does the arithmetic, so it is trivially unit-testable.
 */

export interface BilledRow {
  customerId: string | null;
  customerName?: string | null;
  billed: number | string;
}
export interface CollectedRow {
  customerId: string | null;
  customerName?: string | null;
  collected: number | string;
}
export interface OutstandingRow {
  customerId: string | null;
  customerName?: string | null;
  outstanding: number | string;
}

export interface CollectionEffRow {
  customerId: string | null;
  customerName: string;
  billed: number;
  collected: number;
  outstanding: number;
  /** null when nothing was billed in the period to measure collection against. */
  efficiencyPct: number | null;
  /** null when nothing was billed in the period to annualise the AR over. */
  dsoDays: number | null;
}

export interface CollectionEffTotals {
  billed: number;
  collected: number;
  outstanding: number;
  efficiencyPct: number | null;
  dsoDays: number | null;
}

export interface CollectionEffResult {
  rows: CollectionEffRow[];
  totals: CollectionEffTotals;
  periodDays: number;
}

const UNSPECIFIED = 'Unspecified';
const r2 = (n: number): number => Math.round(n * 100) / 100;
const r1 = (n: number): number => Math.round(n * 10) / 10;
const num = (v: number | string | null | undefined): number =>
  typeof v === 'number' ? v : Number(v ?? 0) || 0;

interface Acc {
  customerId: string | null;
  customerName: string | null;
  billed: number;
  collected: number;
  outstanding: number;
}

export function buildCollectionEfficiency(
  billedRows: BilledRow[],
  collectedRows: CollectedRow[],
  outstandingRows: OutstandingRow[],
  periodDays: number,
): CollectionEffResult {
  const days = periodDays > 0 ? periodDays : 365;
  const byCustomer = new Map<string, Acc>();
  const get = (id: string | null, name?: string | null): Acc => {
    const key = id ?? '∅';
    let acc = byCustomer.get(key);
    if (!acc) {
      acc = { customerId: id, customerName: null, billed: 0, collected: 0, outstanding: 0 };
      byCustomer.set(key, acc);
    }
    if (!acc.customerName && name) acc.customerName = name;
    return acc;
  };

  for (const b of billedRows) get(b.customerId, b.customerName).billed += num(b.billed);
  for (const c of collectedRows) get(c.customerId, c.customerName).collected += num(c.collected);
  for (const o of outstandingRows) get(o.customerId, o.customerName).outstanding += num(o.outstanding);

  const rows: CollectionEffRow[] = [...byCustomer.values()].map((a) => ({
    customerId: a.customerId,
    customerName: a.customerName && a.customerName.trim() ? a.customerName : UNSPECIFIED,
    billed: r2(a.billed),
    collected: r2(a.collected),
    outstanding: r2(a.outstanding),
    efficiencyPct: a.billed > 0 ? r1((a.collected / a.billed) * 100) : null,
    dsoDays: a.billed > 0 ? r1((a.outstanding * days) / a.billed) : null,
  }));

  // Slowest payers first (highest DSO), nulls last; then biggest outstanding.
  rows.sort((a, b) => {
    const ad = a.dsoDays ?? -1;
    const bd = b.dsoDays ?? -1;
    return bd - ad || b.outstanding - a.outstanding || a.customerName.localeCompare(b.customerName);
  });

  const sums = rows.reduce(
    (t, r) => ({
      billed: t.billed + r.billed,
      collected: t.collected + r.collected,
      outstanding: t.outstanding + r.outstanding,
    }),
    { billed: 0, collected: 0, outstanding: 0 },
  );

  return {
    rows,
    periodDays: days,
    totals: {
      billed: r2(sums.billed),
      collected: r2(sums.collected),
      outstanding: r2(sums.outstanding),
      efficiencyPct: sums.billed > 0 ? r1((sums.collected / sums.billed) * 100) : null,
      dsoDays: sums.billed > 0 ? r1((sums.outstanding * days) / sums.billed) : null,
    },
  };
}
