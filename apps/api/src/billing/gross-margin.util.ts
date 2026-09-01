/**
 * Pure gross-margin-per-m³ maths for the grade-profitability report.
 *
 * Margin here is revenue over STANDARD MATERIAL COST — the mix recipe
 * (mix_design_materials.target_quantity, which is per-m³) valued at each
 * material's standard_rate. It deliberately excludes labour, power, transport
 * and overheads, so it is a "contribution over material" figure, not a fully
 * loaded gross margin. The service supplies two pre-aggregated SQL result sets
 * (revenue+volume by grade from invoice lines; standard cost per m³ by grade from
 * the active mix design); this merges them by grade and does the arithmetic.
 */

export interface MarginRevenueRow {
  gradeId: string | null;
  gradeLabel: string | null;
  volumeM3: number | string;
  revenue: number | string;
}

export interface MarginCostRow {
  gradeId: string | null;
  stdCostPerM3: number | string;
}

export interface GradeMarginRow {
  gradeId: string | null;
  gradeLabel: string;
  volumeM3: number;
  revenue: number;
  revenuePerM3: number;
  stdMaterialCostPerM3: number;
  stdMaterialCost: number;
  grossMarginPerM3: number;
  grossMargin: number;
  /** null when there is no revenue per m³ to express the margin as a share of. */
  marginPct: number | null;
}

export interface GradeMarginTotals {
  volumeM3: number;
  revenue: number;
  stdMaterialCost: number;
  grossMargin: number;
  revenuePerM3: number;
  grossMarginPerM3: number;
  marginPct: number | null;
}

export interface GradeMarginResult {
  rows: GradeMarginRow[];
  totals: GradeMarginTotals;
}

const r2 = (n: number): number => Math.round(n * 100) / 100;
const r3 = (n: number): number => Math.round(n * 1000) / 1000;
const num = (v: number | string | null | undefined): number =>
  typeof v === 'number' ? v : Number(v ?? 0) || 0;

export function buildGradeMargin(
  revenueRows: MarginRevenueRow[],
  costRows: MarginCostRow[],
): GradeMarginResult {
  const costByGrade = new Map<string, number>();
  for (const c of costRows) {
    if (c.gradeId) costByGrade.set(c.gradeId, num(c.stdCostPerM3));
  }

  const rows: GradeMarginRow[] = revenueRows.map((rev) => {
    const volumeM3 = num(rev.volumeM3);
    const revenue = num(rev.revenue);
    const revenuePerM3 = volumeM3 > 0 ? revenue / volumeM3 : 0;
    const stdMaterialCostPerM3 = (rev.gradeId && costByGrade.get(rev.gradeId)) || 0;
    const stdMaterialCost = stdMaterialCostPerM3 * volumeM3;
    const grossMarginPerM3 = revenuePerM3 - stdMaterialCostPerM3;
    const grossMargin = revenue - stdMaterialCost;
    return {
      gradeId: rev.gradeId,
      gradeLabel: rev.gradeLabel && rev.gradeLabel.trim() ? rev.gradeLabel : 'Unspecified',
      volumeM3: r3(volumeM3),
      revenue: r2(revenue),
      revenuePerM3: r2(revenuePerM3),
      stdMaterialCostPerM3: r2(stdMaterialCostPerM3),
      stdMaterialCost: r2(stdMaterialCost),
      grossMarginPerM3: r2(grossMarginPerM3),
      grossMargin: r2(grossMargin),
      marginPct: revenuePerM3 > 0 ? r2((grossMarginPerM3 / revenuePerM3) * 100) : null,
    };
  });

  // Thinnest margin per m³ first — surfaces loss-making / underpriced grades.
  rows.sort((a, b) => a.grossMarginPerM3 - b.grossMarginPerM3 || a.gradeLabel.localeCompare(b.gradeLabel));

  const sums = rows.reduce(
    (t, r) => ({
      volumeM3: t.volumeM3 + r.volumeM3,
      revenue: t.revenue + r.revenue,
      stdMaterialCost: t.stdMaterialCost + r.stdMaterialCost,
      grossMargin: t.grossMargin + r.grossMargin,
    }),
    { volumeM3: 0, revenue: 0, stdMaterialCost: 0, grossMargin: 0 },
  );
  const revenuePerM3 = sums.volumeM3 > 0 ? sums.revenue / sums.volumeM3 : 0;
  const grossMarginPerM3 = sums.volumeM3 > 0 ? sums.grossMargin / sums.volumeM3 : 0;

  return {
    rows,
    totals: {
      volumeM3: r3(sums.volumeM3),
      revenue: r2(sums.revenue),
      stdMaterialCost: r2(sums.stdMaterialCost),
      grossMargin: r2(sums.grossMargin),
      revenuePerM3: r2(revenuePerM3),
      grossMarginPerM3: r2(grossMarginPerM3),
      marginPct: revenuePerM3 > 0 ? r2((grossMarginPerM3 / revenuePerM3) * 100) : null,
    },
  };
}
