/**
 * Small pure helpers shared by the read-only insight agents (M1). Kept separate
 * so they unit-test without a database.
 */

/** A Postgres numeric/aggregate value → a finite JS number (null/NaN → 0). */
export function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Clamp an integer input into [min,max], falling back to `def` when unusable. */
export function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
}

/** Severity for a stock balance at or below the alert threshold. */
export function stockSeverity(qty: number): 'critical' | 'warn' {
  // A negative balance is a real integrity problem; zero/low is a heads-up.
  return qty < 0 ? 'critical' : 'warn';
}
