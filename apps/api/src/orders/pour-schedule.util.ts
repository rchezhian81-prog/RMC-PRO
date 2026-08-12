/**
 * Pour schedule roll-up (Plan B1) — pure arithmetic over an order's pour slots,
 * kept database-free so it is unit-testable and reusable.
 *
 *   scheduled          = Σ quantity of non-cancelled slots
 *   unscheduled        = ordered − scheduled   (order volume not yet slotted)
 *   remainingToDeliver = scheduled − delivered (slotted volume not yet produced)
 */
export interface PourSlot {
  quantityM3: number;
  status?: string | null;
}

export interface PourScheduleSummary {
  ordered: number;
  scheduled: number;
  delivered: number;
  unscheduled: number;
  remainingToDeliver: number;
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const num = (v: unknown): number => Number(v ?? 0) || 0;

export function summarisePourSchedule(
  slots: PourSlot[],
  orderedM3: number,
  deliveredM3: number,
): PourScheduleSummary {
  const scheduled = round3(
    slots.filter((s) => (s.status ?? '') !== 'cancelled').reduce((a, s) => a + num(s.quantityM3), 0),
  );
  return {
    ordered: round3(orderedM3),
    scheduled,
    delivered: round3(deliveredM3),
    unscheduled: round3(orderedM3 - scheduled),
    remainingToDeliver: round3(scheduled - deliveredM3),
  };
}
