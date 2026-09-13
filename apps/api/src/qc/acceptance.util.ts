/**
 * Concrete cube-strength acceptance (IS 456:2000 §16 / Table 11).
 *
 * A set of cubes is accepted at 28 days when BOTH criteria hold:
 *   - mean strength    ≥ fck + margin
 *   - every individual ≥ fck − margin
 *
 * ONE margin governs both sides, and it is the same number in each direction:
 * 3 N/mm² for M15, 4 N/mm² for M20 and above. That is Table 11, and it is also
 * how this repo's own plan states the rule — "mean ≥ fck + margin, no
 * individual < fck − margin" (docs/planning/RMC-GAP-CLOSURE-PLAN.md).
 *
 * This previously used two different figures that were crossed over: a margin of
 * 4 with a tolerance of 3 for M20 and above, and 3 with 4 below it. Both grade
 * bands were wrong, in opposite directions:
 *
 *   - M20 and up — the bread-and-butter M20/M25/M30 — became STRICTER than the
 *     standard. An M25 cube breaking at 21.0 N/mm² meets IS 456 exactly (fck−4)
 *     and was marked a failure, so a compliant pour looked like a failed one:
 *     an investigation, an argument with the customer, possibly a demolition,
 *     over concrete that was fine.
 *   - M15 and below became LOOSER. An individual at fck−4 was accepted where the
 *     standard requires fck−3, so genuinely deficient concrete could pass. That
 *     is the direction that matters most, because nothing downstream questions
 *     an acceptance.
 *
 * Note the shape of the mistake: no single band is "3" or "4" — both criteria
 * move together per band. A rule where the mean requirement loosens while the
 * individual requirement tightens is not something a standard does.
 *
 * The full standard also allows an SD-based mean criterion (fck + 0.825 × the
 * established standard deviation, whichever is greater) once enough samples
 * exist; that can be layered on later. Pure and database-free for unit testing.
 */
export interface CubeAcceptance {
  n: number;
  mean: number;
  min: number;
  /** fck + margin — the mean must reach this. */
  meanFloor: number;
  /** fck − margin — no individual may fall below this. */
  individualFloor: number;
  meanPass: boolean;
  individualPass: boolean;
  accepted: boolean;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * The IS 456 Table 11 margin for a characteristic strength, in N/mm².
 *
 * Exported because the per-cube pass/fail flag is stamped in the QC service and
 * the set verdict is decided here. Two copies of this number is how they drift
 * apart, and a cube marked "passed" inside a rejected set is the kind of
 * contradiction nobody can explain to an auditor a year later.
 */
export function acceptanceMargin(fck: number): number {
  return fck >= 20 ? 4 : 3;
}

/** The lowest any single 28-day cube may break at and still comply. */
export function individualFloor(fck: number): number {
  return round2(fck - acceptanceMargin(fck));
}

/** The lowest the set mean may be and still comply. */
export function meanFloor(fck: number): number {
  return round2(fck + acceptanceMargin(fck));
}

/** Assess a set of 28-day cube strengths (N/mm²) against fck. Null if no data. */
export function assessCubeSet(strengths: number[], fck: number): CubeAcceptance | null {
  const values = strengths.filter((s) => Number.isFinite(s));
  if (!values.length || !(fck > 0)) return null;

  const mean = round2(values.reduce((a, b) => a + b, 0) / values.length);
  const min = Math.min(...values);
  const meanAt = meanFloor(fck);
  const individualAt = individualFloor(fck);
  const meanPass = mean >= meanAt;
  const individualPass = min >= individualAt;

  return {
    n: values.length,
    mean,
    min: round2(min),
    meanFloor: meanAt,
    individualFloor: individualAt,
    meanPass,
    individualPass,
    accepted: meanPass && individualPass,
  };
}
