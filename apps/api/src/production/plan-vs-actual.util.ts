/**
 * Plan-vs-actual production report (Tier 5C). Merges planned m³ (from the
 * production plan) with actually-batched m³ (confirmed batch tickets) by grade,
 * and reports the variance. Under-production (actual < planned) shows a negative
 * variance; grades batched with no plan line still appear (planned 0).
 *
 * Pure and DB-free so the arithmetic is unit-testable.
 */
const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const round1 = (n: number): number => Math.round(n * 10) / 10;
const numv = (v: unknown): number => Number(v ?? 0) || 0;

export interface PlannedGrade {
  gradeLabel?: string | null;
  plannedM3: number | string;
}
export interface ActualGrade {
  gradeLabel?: string | null;
  actualM3: number | string;
}
export interface PlanVsActualRow {
  gradeLabel: string;
  plannedM3: number;
  actualM3: number;
  /** actual − planned (negative = under-produced). */
  varianceM3: number;
  /** variance as a % of planned; null when nothing was planned. */
  variancePct: number | null;
}
export interface PlanVsActual {
  rows: PlanVsActualRow[];
  totals: { plannedM3: number; actualM3: number; varianceM3: number; variancePct: number | null };
}

const label = (v: string | null | undefined): string => {
  const s = (v ?? '').trim();
  return s || 'Unspecified';
};

export function buildPlanVsActual(planned: PlannedGrade[], actual: ActualGrade[]): PlanVsActual {
  const byGrade = new Map<string, { plannedM3: number; actualM3: number }>();
  const get = (g: string) => byGrade.get(g) ?? byGrade.set(g, { plannedM3: 0, actualM3: 0 }).get(g)!;

  for (const p of planned) get(label(p.gradeLabel)).plannedM3 += numv(p.plannedM3);
  for (const a of actual) get(label(a.gradeLabel)).actualM3 += numv(a.actualM3);

  const rows: PlanVsActualRow[] = [...byGrade.entries()]
    .map(([gradeLabel, v]) => {
      const plannedM3 = round3(v.plannedM3);
      const actualM3 = round3(v.actualM3);
      const varianceM3 = round3(actualM3 - plannedM3);
      return {
        gradeLabel,
        plannedM3,
        actualM3,
        varianceM3,
        variancePct: plannedM3 > 0 ? round1((varianceM3 / plannedM3) * 100) : null,
      };
    })
    .sort((a, b) => a.gradeLabel.localeCompare(b.gradeLabel));

  const plannedTotal = round3(rows.reduce((s, r) => s + r.plannedM3, 0));
  const actualTotal = round3(rows.reduce((s, r) => s + r.actualM3, 0));
  const varianceTotal = round3(actualTotal - plannedTotal);
  return {
    rows,
    totals: {
      plannedM3: plannedTotal,
      actualM3: actualTotal,
      varianceM3: varianceTotal,
      variancePct: plannedTotal > 0 ? round1((varianceTotal / plannedTotal) * 100) : null,
    },
  };
}
