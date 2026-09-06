/**
 * Money rounding that agrees with Postgres `numeric(…, 2)`.
 *
 * `Math.round(v * 100) / 100` rounds the BINARY value: 1.005 is really
 * 1.00499999…, so JS says 1.00 while Postgres — which parses the decimal text
 * the driver sends — stores 1.01. With the raw value going to the DB and the
 * rounded one into the arithmetic, a receipt of 1.005 produced an allocation
 * row of 1.01 next to an `amount_paid` delta of 1.00: the ledger disagreed with
 * itself by a paise inside one transaction.
 *
 * Rounding on the DECIMAL string ("1.005e2" → 100.5 → 101 → 1.01) makes both
 * sides agree: half away from zero, exactly like `numeric`. Every money path
 * normalises its inputs through `round2` once at the boundary and uses that
 * value for both the write and the maths.
 */
export function roundTo(value: unknown, dp: number): number {
  const n = Number(value ?? 0) || 0;
  if (!Number.isFinite(n) || n === 0) return 0;
  const abs = Math.abs(n);
  const scale = 10 ** dp;
  const text = String(abs);
  // Exponent notation (1e-7, 1e21) has no plain decimal form; fall back to the
  // binary shift — those magnitudes are never real money. Dividing the rounded
  // integer by the scale is correctly rounded (IEEE), so 101 / 100 === 1.01.
  const shifted = text.includes('e') ? abs * scale : Number(`${text}e${dp}`);
  const rounded = Math.round(shifted) / scale;
  if (rounded === 0) return 0; // never -0
  return n < 0 ? -rounded : rounded;
}

/** Round to 2 decimals (paise), matching `numeric(…, 2)`. */
export const round2 = (value: unknown): number => roundTo(value, 2);
