/**
 * Aggregate moisture & water/cement correction (Plan A2).
 *
 * A mix design's aggregate quantities are SSD (saturated-surface-dry). Real
 * aggregate is not at SSD: it carries total moisture `m%` (over dry mass) while
 * it can absorb `a%` to reach SSD. So each aggregate is batched at its WET
 * weight, and the surface water it carries (m − a) is subtracted from the added
 * mix water — holding the design free-water/cement ratio constant.
 *
 *   dry        = ssd / (1 + a/100)
 *   wet        = dry * (1 + m/100)          ← what to actually weigh out
 *   freeWater  = wet − ssd  = dry*(m−a)/100 ← surface water carried into the mix
 *   addedWater = designWater − Σ freeWater  ← corrected batch water
 *
 * When m < a the aggregate is thirsty (freeWater is negative) and the mix water
 * is increased instead. Materials without type/absorption/moisture data are left
 * unchanged, so the correction is a no-op until the master data is filled in.
 *
 * Pure and database-free so the arithmetic is unit-testable and reused by the
 * batch-ticket service.
 */
export const AGGREGATE_MATERIAL_TYPES = ['fine_aggregate', 'coarse_aggregate'];

export interface MoistureInput {
  materialType: string | null;
  /** Design SSD target for this batch, already scaled to the batch size. */
  targetSsd: number;
  /** Aggregate water absorption %, over dry mass. */
  absorptionPct: number;
  /** Measured (or default) total moisture %, over dry mass. */
  moisturePct: number;
}

export interface MoistureResult {
  /** Moisture-corrected batch weight to weigh out. */
  correctedTarget: number;
  /** correctedTarget − targetSsd: surface water an aggregate adds (+) or water removed from the mix (−). */
  freeWater: number;
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const pct = (v: number): number => (Number.isFinite(v) && v > 0 ? v : 0);

/**
 * Correct a batch's material targets for aggregate moisture. Returns a result
 * per input (same order) plus the total free water the aggregates carry.
 */
export function applyMoistureCorrection(materials: MoistureInput[]): {
  results: MoistureResult[];
  totalFreeWater: number;
} {
  const aggregates = new Set(AGGREGATE_MATERIAL_TYPES);
  const results: MoistureResult[] = materials.map((mm) => ({ correctedTarget: mm.targetSsd, freeWater: 0 }));

  let totalFreeWater = 0;
  materials.forEach((mm, i) => {
    if (!aggregates.has(mm.materialType ?? '')) return;
    const dry = mm.targetSsd / (1 + pct(mm.absorptionPct) / 100);
    const wet = round3(dry * (1 + pct(mm.moisturePct) / 100));
    results[i] = { correctedTarget: wet, freeWater: round3(wet - mm.targetSsd) };
    totalFreeWater += results[i].freeWater;
  });
  totalFreeWater = round3(totalFreeWater);

  materials.forEach((mm, i) => {
    if ((mm.materialType ?? '') !== 'water') return;
    const corrected = round3(Math.max(0, mm.targetSsd - totalFreeWater));
    results[i] = { correctedTarget: corrected, freeWater: round3(corrected - mm.targetSsd) };
  });

  return { results, totalFreeWater };
}
