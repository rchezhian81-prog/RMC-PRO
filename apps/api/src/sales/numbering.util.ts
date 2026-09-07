/**
 * Document-numbering pure helpers (Plan F2). No NestJS/DB imports so each is
 * unit-testable in isolation (the .mjs tests import the compiled dist).
 *
 *   - `financialYearOf`  — the Indian financial year (Apr 1 – Mar 31) for a date,
 *     as `YYYY-YY` (e.g. 2026-08-12 → "2026-27").
 *   - `formatSeriesNumber`— assemble prefix + zero-padded number + suffix.
 *   - `applyYearlyReset`  — decide whether a series rolls over to a new FY (and so
 *     restarts at 1) or carries on, given its reset frequency.
 */

/** Indian financial year for an ISO date, as `YYYY-YY`. */
export function financialYearOf(dateIso: string): string {
  const ms = Date.parse(`${dateIso}T00:00:00Z`);
  const d = new Date(Number.isNaN(ms) ? Date.parse(String(dateIso)) : ms);
  const y = d.getUTCFullYear();
  const month = d.getUTCMonth(); // 0 = Jan
  const startYear = month >= 3 ? y : y - 1; // April (3) starts the FY
  const endYY = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${endYY}`;
}

export interface FormatInput {
  prefix?: string | null;
  suffix?: string | null;
  number: number;
  paddingLength?: number | null;
}

/**
 * The financial-year token carried in a document number, "/YY-YY" — the
 * conventional Indian format (INV-0001/27-28). Empty for a malformed / absent FY.
 */
export function fyToken(financialYear: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(financialYear ?? ''));
  if (!m) return '';
  const [, start = '', end = ''] = m;
  return `/${start.slice(2)}-${end}`;
}

/**
 * The suffix a NEW financial-year series row inherits from the previous FY's
 * row: the previous FY's token is replaced by the new one when present, else
 * the new token is appended to whatever suffix the tenant configured. This is
 * what keeps INV-0001 (FY 2026-27) and INV-0001/27-28 distinct: a yearly reset
 * used to restart the SAME row at 0 and re-issue last year's strings.
 */
export function rolloverSuffix(
  previousSuffix: string | null | undefined,
  previousFy: string | null | undefined,
  newFy: string,
): string {
  const prev = fyToken(previousFy);
  const next = fyToken(newFy);
  const base = previousSuffix ?? '';
  if (prev && base.includes(prev)) return base.replace(prev, next);
  return `${base}${next}`;
}

/** prefix + zero-padded number + suffix (padding defaults to 4). */
export function formatSeriesNumber({ prefix, suffix, number, paddingLength }: FormatInput): string {
  const pad = Number(paddingLength) || 4;
  return `${prefix ?? ''}${String(number).padStart(pad, '0')}${suffix ?? ''}`;
}

export interface ResetInput {
  resetFrequency?: string | null;
  /** The FY currently stamped on the series row (may be null on an old row). */
  seriesFy?: string | null;
  /** The FY the caller is numbering in. */
  currentFy: string;
  currentNumber: number;
}

export interface ResetResult {
  financialYear: string | null;
  currentNumber: number;
  didReset: boolean;
}

/**
 * Decide a series' financial year and counter before the next allocation:
 *   - non-yearly reset ('never') → carry on, keep the counter and FY as-is.
 *   - yearly, no FY stamped yet → adopt the current FY, keep the counter (so an
 *     existing continuous series isn't reset the first time FY-awareness runs).
 *   - yearly, stamped FY differs from the current FY → roll over: stamp the new
 *     FY and restart the counter at 0.
 *   - yearly, same FY → carry on.
 */
export function applyYearlyReset(input: ResetInput): ResetResult {
  const freq = input.resetFrequency ?? 'yearly';
  if (freq !== 'yearly') {
    return { financialYear: input.seriesFy ?? null, currentNumber: input.currentNumber, didReset: false };
  }
  if (!input.seriesFy) {
    return { financialYear: input.currentFy, currentNumber: input.currentNumber, didReset: false };
  }
  if (input.seriesFy !== input.currentFy) {
    return { financialYear: input.currentFy, currentNumber: 0, didReset: true };
  }
  return { financialYear: input.seriesFy, currentNumber: input.currentNumber, didReset: false };
}
