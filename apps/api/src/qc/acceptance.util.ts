/**
 * Concrete cube-strength acceptance (Plan A3, IS 456:2000 §15.4 / Table 11).
 *
 * A set of cubes is accepted at 28 days when BOTH criteria hold:
 *   - mean strength      ≥ fck + margin      (margin 4 N/mm² for fck ≥ 20, else 3)
 *   - every individual   ≥ fck − tolerance   (tolerance 3 N/mm² for fck ≥ 20, else 4)
 *
 * These are the fixed operational margins from IS 456 Table 11 (the full
 * standard also allows an SD-based mean criterion once enough samples exist;
 * that can be layered on later). Pure and database-free for unit-testing.
 */
export interface CubeAcceptance {
  n: number;
  mean: number;
  min: number;
  /** fck + margin — the mean must reach this. */
  meanFloor: number;
  /** fck − tolerance — no individual may fall below this. */
  individualFloor: number;
  meanPass: boolean;
  individualPass: boolean;
  accepted: boolean;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Assess a set of 28-day cube strengths (N/mm²) against fck. Null if no data. */
export function assessCubeSet(strengths: number[], fck: number): CubeAcceptance | null {
  const values = strengths.filter((s) => Number.isFinite(s));
  if (!values.length || !(fck > 0)) return null;

  const margin = fck >= 20 ? 4 : 3;
  const tolerance = fck >= 20 ? 3 : 4;
  const mean = round2(values.reduce((a, b) => a + b, 0) / values.length);
  const min = Math.min(...values);
  const meanFloor = round2(fck + margin);
  const individualFloor = round2(fck - tolerance);
  const meanPass = mean >= meanFloor;
  const individualPass = min >= individualFloor;

  return {
    n: values.length,
    mean,
    min: round2(min),
    meanFloor,
    individualFloor,
    meanPass,
    individualPass,
    accepted: meanPass && individualPass,
  };
}
