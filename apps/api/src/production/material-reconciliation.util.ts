/**
 * Pure material-reconciliation maths for the production report.
 *
 * Three quantities per material, over a period:
 *   - theoretical  : Σ target_quantity  — what the mix design called for
 *   - actualDosed  : Σ actual_quantity  — what the batching controller actually weighed
 *   - stockConsumed: Σ out_quantity     — what the stock ledger drew down
 *
 * Two variances fall out of them, and each catches a different problem:
 *   - dosingVariance = actualDosed − theoretical  (over/under-dosing vs the recipe)
 *   - stockVariance  = stockConsumed − actualDosed (ledger drawdown not matching the
 *     controller — i.e. untracked issue/leakage/manual adjustment)
 *
 * The service supplies two pre-aggregated SQL result sets (dosing rows from
 * batch_ticket_materials, stock rows from stock_transactions); this merges them by
 * material and does the arithmetic, so it is trivially unit-testable.
 */

export interface DoseAggRow {
  material: string | null;
  uom?: string | null;
  theoretical: number | string;
  actualDosed: number | string;
}

export interface StockAggRow {
  material: string | null;
  stockConsumed: number | string;
}

export interface MaterialReconRow {
  material: string;
  uom: string | null;
  theoretical: number;
  actualDosed: number;
  stockConsumed: number;
  dosingVarianceQty: number;
  /** null when there is no theoretical basis to compare against (0 target). */
  dosingVariancePct: number | null;
  stockVarianceQty: number;
  /** null when nothing was dosed to compare the ledger against (0 actual). */
  stockVariancePct: number | null;
}

export interface MaterialReconTotals {
  theoretical: number;
  actualDosed: number;
  stockConsumed: number;
  dosingVarianceQty: number;
  stockVarianceQty: number;
}

export interface MaterialReconResult {
  rows: MaterialReconRow[];
  totals: MaterialReconTotals;
}

const UNSPECIFIED = 'Unspecified';
const r3 = (n: number): number => Math.round(n * 1000) / 1000;
const r2 = (n: number): number => Math.round(n * 100) / 100;
const num = (v: number | string | null | undefined): number =>
  typeof v === 'number' ? v : Number(v ?? 0) || 0;

interface Acc {
  material: string;
  uom: string | null;
  theoretical: number;
  actualDosed: number;
  stockConsumed: number;
}

export function buildMaterialReconciliation(
  doseRows: DoseAggRow[],
  stockRows: StockAggRow[],
): MaterialReconResult {
  const byMaterial = new Map<string, Acc>();
  const get = (label: string | null): Acc => {
    const key = label && label.trim() ? label : UNSPECIFIED;
    let acc = byMaterial.get(key);
    if (!acc) {
      acc = { material: key, uom: null, theoretical: 0, actualDosed: 0, stockConsumed: 0 };
      byMaterial.set(key, acc);
    }
    return acc;
  };

  for (const d of doseRows) {
    const acc = get(d.material);
    acc.theoretical += num(d.theoretical);
    acc.actualDosed += num(d.actualDosed);
    if (!acc.uom && d.uom) acc.uom = d.uom;
  }
  for (const s of stockRows) {
    get(s.material).stockConsumed += num(s.stockConsumed);
  }

  const rows: MaterialReconRow[] = [...byMaterial.values()].map((a) => {
    const dosingVarianceQty = a.actualDosed - a.theoretical;
    const stockVarianceQty = a.stockConsumed - a.actualDosed;
    return {
      material: a.material,
      uom: a.uom,
      theoretical: r3(a.theoretical),
      actualDosed: r3(a.actualDosed),
      stockConsumed: r3(a.stockConsumed),
      dosingVarianceQty: r3(dosingVarianceQty),
      dosingVariancePct: a.theoretical > 0 ? r2((dosingVarianceQty / a.theoretical) * 100) : null,
      stockVarianceQty: r3(stockVarianceQty),
      stockVariancePct: a.actualDosed > 0 ? r2((stockVarianceQty / a.actualDosed) * 100) : null,
    };
  });

  // Largest absolute stock variance first — the strongest leakage signal — then
  // material name for a stable order.
  rows.sort(
    (a, b) => Math.abs(b.stockVarianceQty) - Math.abs(a.stockVarianceQty) || a.material.localeCompare(b.material),
  );

  const totals = rows.reduce<MaterialReconTotals>(
    (t, r) => ({
      theoretical: t.theoretical + r.theoretical,
      actualDosed: t.actualDosed + r.actualDosed,
      stockConsumed: t.stockConsumed + r.stockConsumed,
      dosingVarianceQty: t.dosingVarianceQty + r.dosingVarianceQty,
      stockVarianceQty: t.stockVarianceQty + r.stockVarianceQty,
    }),
    { theoretical: 0, actualDosed: 0, stockConsumed: 0, dosingVarianceQty: 0, stockVarianceQty: 0 },
  );

  return {
    rows,
    totals: {
      theoretical: r3(totals.theoretical),
      actualDosed: r3(totals.actualDosed),
      stockConsumed: r3(totals.stockConsumed),
      dosingVarianceQty: r3(totals.dosingVarianceQty),
      stockVarianceQty: r3(totals.stockVarianceQty),
    },
  };
}
