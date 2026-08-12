/**
 * Returned / short-load concrete wastage helpers (Plan B3). No NestJS/DB imports
 * so each is unit-testable in isolation (the .mjs tests import the compiled dist).
 *
 *   - `returnCost`      — value a returned quantity at a cost per m³.
 *   - `wastageSummary`  — roll delivered challans' returns up by reason and by
 *     grade, with each bucket's share of the total wasted value.
 */

const round2 = (v: number): number => Math.round((Number(v) || 0) * 100) / 100;
const round3 = (v: number): number => Math.round((Number(v) || 0) * 1000) / 1000;
const numv = (v: unknown): number => Number(v ?? 0) || 0;

/** Value of returned concrete: quantity (m³) × cost per m³, to paise. */
export function returnCost(returnQuantityM3: unknown, costPerM3: unknown): number {
  return round2(numv(returnQuantityM3) * numv(costPerM3));
}

export interface WastageRow {
  returnQuantityM3: number | string;
  returnCost: number | string;
  returnReason?: string | null;
  gradeLabel?: string | null;
}

export interface WastageBucket {
  key: string;
  label: string;
  quantityM3: number;
  cost: number;
  /** Percentage of the total wasted value (0 when the total is 0). */
  share: number;
}

export interface WastageSummary {
  totalReturnedM3: number;
  totalReturnCost: number;
  entryCount: number;
  byReason: WastageBucket[];
  byGrade: WastageBucket[];
}

const UNSPECIFIED = 'Unspecified';

function summariseBy(rows: WastageRow[], keyOf: (r: WastageRow) => string | null | undefined, totalCost: number): WastageBucket[] {
  const map = new Map<string, WastageBucket>();
  for (const r of rows) {
    const label = (keyOf(r) || UNSPECIFIED).toString().trim() || UNSPECIFIED;
    const qty = numv(r.returnQuantityM3);
    const cost = numv(r.returnCost);
    const existing = map.get(label);
    if (existing) {
      existing.quantityM3 = round3(existing.quantityM3 + qty);
      existing.cost = round2(existing.cost + cost);
    } else {
      map.set(label, { key: label, label, quantityM3: round3(qty), cost: round2(cost), share: 0 });
    }
  }
  return [...map.values()]
    .map((b) => ({ ...b, share: totalCost > 0 ? round2((b.cost / totalCost) * 100) : 0 }))
    .sort((a, b) => b.cost - a.cost || b.quantityM3 - a.quantityM3);
}

/**
 * Aggregate returned-concrete rows into a wastage report: the total returned m³
 * and value, plus a breakdown by reason and by grade (each bucket carries its
 * share of the total wasted value). Only rows with a positive returned quantity
 * should be passed in; empty input yields zeroed totals.
 */
export function wastageSummary(rows: WastageRow[]): WastageSummary {
  const totalReturnedM3 = round3(rows.reduce((s, r) => s + numv(r.returnQuantityM3), 0));
  const totalReturnCost = round2(rows.reduce((s, r) => s + numv(r.returnCost), 0));
  return {
    totalReturnedM3,
    totalReturnCost,
    entryCount: rows.length,
    byReason: summariseBy(rows, (r) => r.returnReason, totalReturnCost),
    byGrade: summariseBy(rows, (r) => r.gradeLabel, totalReturnCost),
  };
}
