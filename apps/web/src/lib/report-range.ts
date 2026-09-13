/**
 * The date window a report screen opens on.
 *
 * WHY A DEFAULT EXISTS: report screens used to mount with `{ from: '', to: '' }`
 * and ask the API for everything. That is fine on a young tenant and becomes a
 * wall once the data grows — the API now refuses a register covering more than
 * 5,000 rows, because a partial register is a wrong total rather than a slow
 * one. Opening on a bounded window means the first paint is fast and correct,
 * and widening it is a deliberate act by someone who knows what they are asking
 * for.
 *
 * The current month is the default because that is what these screens are
 * usually opened to check, and it stays comfortably inside the cap for any
 * realistic plant: 50 deliveries a day is ~1,500 challans a month.
 */

const ymd = (d: Date): string => d.toISOString().slice(0, 10);

/** First day of the current month → today, as YYYY-MM-DD. */
export function currentMonthRange(now: Date = new Date()): { from: string; to: string } {
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { from: ymd(first), to: ymd(now) };
}

/**
 * The Indian financial year containing `now` (1 April → 31 March), for screens
 * where a GST-period view is the natural one. Not the default: a busy plant's
 * full year can exceed the report cap, and being told to narrow the range is a
 * worse first impression than being shown this month.
 */
export function financialYearRange(now: Date = new Date()): { from: string; to: string } {
  const y = now.getUTCFullYear();
  const startYear = now.getUTCMonth() >= 3 ? y : y - 1; // month 3 === April
  return { from: `${startYear}-04-01`, to: `${startYear + 1}-03-31` };
}
