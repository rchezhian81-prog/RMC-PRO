/**
 * Expense-capture pure helpers (Plan D4). No NestJS/DB imports so each is
 * unit-testable in isolation (the .mjs tests import the compiled dist).
 *
 *   - `voucherTotal`     — sum a voucher's line amounts.
 *   - `allocationSummary`— roll posted lines up by cost object (plant/vehicle/
 *     site/general) with each bucket's share of the total — the cost-allocation
 *     report.
 *   - `categorySummary`  — the same roll-up keyed by an arbitrary category label
 *     (expense head or group), for a spend-by-head/group breakdown.
 */

const round2 = (v: number): number => Math.round((Number(v) || 0) * 100) / 100;
const amt = (v: unknown): number => Number(v ?? 0) || 0;

export interface AmountLine {
  amount: number | string;
}

/** Total of a voucher's line amounts, rounded to paise. */
export function voucherTotal(lines: AmountLine[]): number {
  return round2(lines.reduce((s, l) => s + amt(l.amount), 0));
}

export interface AllocationLine {
  allocationType?: string | null;
  allocationLabel?: string | null;
  amount: number | string;
}

export interface SummaryBucket {
  key: string;
  type: string;
  label: string;
  amount: number;
  /** Percentage of the summarised total (0 when the total is 0). */
  share: number;
}

export interface AllocationReport {
  total: number;
  buckets: SummaryBucket[];
}

const GENERAL_LABEL = 'General / unallocated';

/**
 * Roll lines up by cost object. Each bucket keys on `type|label`; a line with no
 * allocation type or label falls into a single `general` bucket. Buckets are
 * sorted by amount descending, and each carries its share of the grand total.
 */
export function allocationSummary(lines: AllocationLine[]): AllocationReport {
  const map = new Map<string, SummaryBucket>();
  let total = 0;

  for (const l of lines) {
    const amount = amt(l.amount);
    total += amount;
    const type = (l.allocationType || 'general').trim() || 'general';
    const label = type === 'general' ? GENERAL_LABEL : (l.allocationLabel || GENERAL_LABEL).trim() || GENERAL_LABEL;
    const key = `${type}|${label}`;
    const existing = map.get(key);
    if (existing) existing.amount = round2(existing.amount + amount);
    else map.set(key, { key, type, label, amount: round2(amount), share: 0 });
  }

  total = round2(total);
  const buckets = [...map.values()]
    .map((b) => ({ ...b, share: total > 0 ? round2((b.amount / total) * 100) : 0 }))
    .sort((a, b) => b.amount - a.amount);

  return { total, buckets };
}

export interface CategoryLine {
  amount: number | string;
}

/**
 * Roll lines up by an arbitrary category label read off each line via `labelOf`
 * (e.g. the expense-head or group label). Same bucket shape as the allocation
 * report — sorted by amount, each with its share.
 */
export function categorySummary<T extends CategoryLine>(
  lines: T[],
  labelOf: (line: T) => string | null | undefined,
): AllocationReport {
  const map = new Map<string, SummaryBucket>();
  let total = 0;

  for (const l of lines) {
    const amount = amt(l.amount);
    total += amount;
    const label = (labelOf(l) || 'Uncategorised').trim() || 'Uncategorised';
    const existing = map.get(label);
    if (existing) existing.amount = round2(existing.amount + amount);
    else map.set(label, { key: label, type: 'category', label, amount: round2(amount), share: 0 });
  }

  total = round2(total);
  const buckets = [...map.values()]
    .map((b) => ({ ...b, share: total > 0 ? round2((b.amount / total) * 100) : 0 }))
    .sort((a, b) => b.amount - a.amount);

  return { total, buckets };
}
