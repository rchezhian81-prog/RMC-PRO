/**
 * Dispatch cycle-time report (Tier-C gap C2). Each dispatch stamps four
 * timestamps as it crosses the board — left plant (dispatchTime), reached site
 * (siteArrivalTime), pour start and pour end — but nothing surfaced them. This
 * turns them into the delivery-cycle KPIs an RMC watches: travel, on-site wait,
 * pour duration, and total truck turnaround (minutes).
 *
 * Pure and DB-free so the arithmetic is unit-testable.
 */
export interface CycleTimeInput {
  dispatchNo?: string | null;
  gradeLabel?: string | null;
  dispatchTime?: string | Date | null;
  siteArrivalTime?: string | Date | null;
  pourStartTime?: string | Date | null;
  pourEndTime?: string | Date | null;
}
export interface CycleTimeRow {
  dispatchNo: string;
  gradeLabel: string | null;
  /** left-plant → reached-site (min); null if either stamp is missing. */
  travelMin: number | null;
  /** reached-site → pour-start (min). */
  waitMin: number | null;
  /** pour-start → pour-end (min). */
  pourMin: number | null;
  /** left-plant → pour-end, the truck's total turnaround (min). */
  turnaroundMin: number | null;
}
export interface CycleTimes {
  rows: CycleTimeRow[];
  /** Average of each duration over the rows where it is present (null if none). */
  averages: { travelMin: number | null; waitMin: number | null; pourMin: number | null; turnaroundMin: number | null };
  count: number;
}

const ms = (v: string | Date | null | undefined): number | null => {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
};
/** Whole minutes between two stamps, or null if either is missing / negative. */
const diffMin = (a: number | null, b: number | null): number | null => {
  if (a == null || b == null) return null;
  const min = Math.round((b - a) / 60000);
  return min >= 0 ? min : null;
};
const avg = (xs: (number | null)[]): number | null => {
  const vals = xs.filter((x): x is number => x != null);
  return vals.length ? Math.round((vals.reduce((s, x) => s + x, 0) / vals.length) * 10) / 10 : null;
};

export function buildCycleTimes(input: CycleTimeInput[]): CycleTimes {
  const rows: CycleTimeRow[] = input.map((r) => {
    const left = ms(r.dispatchTime);
    const arrive = ms(r.siteArrivalTime);
    const pourStart = ms(r.pourStartTime);
    const pourEnd = ms(r.pourEndTime);
    return {
      dispatchNo: r.dispatchNo ?? '',
      gradeLabel: r.gradeLabel ?? null,
      travelMin: diffMin(left, arrive),
      waitMin: diffMin(arrive, pourStart),
      pourMin: diffMin(pourStart, pourEnd),
      turnaroundMin: diffMin(left, pourEnd),
    };
  });
  return {
    rows,
    averages: {
      travelMin: avg(rows.map((r) => r.travelMin)),
      waitMin: avg(rows.map((r) => r.waitMin)),
      pourMin: avg(rows.map((r) => r.pourMin)),
      turnaroundMin: avg(rows.map((r) => r.turnaroundMin)),
    },
    count: rows.length,
  };
}
