/**
 * The date window a report screen opens on.
 *
 * WHY A DEFAULT EXISTS: report screens used to mount with `{ from: '', to: '' }`
 * and ask the API for everything. That is fine on a young tenant and becomes a
 * wall once the data grows — the API refuses a register covering more than
 * 5,000 rows, because a partial register is a wrong total rather than a slow
 * one. Opening on a bounded window means the first paint is fast and correct,
 * and widening it is a deliberate act by someone who knows what they asked for.
 *
 * The current month is the default because that is what these screens are
 * usually opened to check, and it stays comfortably inside the cap for any
 * realistic plant: 50 deliveries a day is ~1,500 challans a month.
 *
 * WHY LOCAL TIME, NOT UTC: a batching plant pours at night. In IST (UTC+5:30) a
 * UTC-derived "today" is still yesterday until 05:30, so on the 1st of a month
 * an operator opening this at 2am would have been shown all of the PREVIOUS
 * month and none of the shift they are standing in. These read the browser's
 * local calendar date, which is the date on the plant's wall clock.
 */

/** A local calendar date as YYYY-MM-DD — never UTC-shifted. */
const ymd = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/**
 * Today, as the plant's wall clock has it — YYYY-MM-DD.
 *
 * Use this for any date SENT TO THE API as a document's date. `toISOString()` is
 * UTC, so before 05:30 in India it names YESTERDAY. A goods receipt or purchase
 * bill keyed at 2am would be filed a day early, and on the 1st of April that is
 * not a day early but a FINANCIAL YEAR early — the wrong GST period, and the
 * wrong period to claim the input credit in.
 *
 * The server defaults a missing date to the plant's today, but a client that
 * sends an explicit wrong date is believed. So the client has to be right too.
 */
export function todayLocal(now: Date = new Date()): string {
  return ymd(now);
}

/** First day of the current month → today, in the viewer's own timezone. */
export function currentMonthRange(now: Date = new Date()): { from: string; to: string } {
  return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(now) };
}

/**
 * The Indian financial year containing `now` (1 April → 31 March), for screens
 * where a GST-period view is the natural one. Not the default: a busy plant's
 * full year can exceed the report cap, and being told to narrow the range is a
 * worse first impression than being shown this month.
 */
export function financialYearRange(now: Date = new Date()): { from: string; to: string } {
  const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; // month 3 === April
  return { from: `${startYear}-04-01`, to: `${startYear + 1}-03-31` };
}

/**
 * Reading a `Promise.allSettled` batch of independent reports.
 *
 * WHY NOT Promise.all: these screens fetch several reports that have nothing to
 * do with each other. Under `all`, one refusal rejects the batch and blanks
 * every panel — including the ones that answered. Under `allSettled` the screen
 * renders what came back and names what did not.
 */

/** The value of one settled report, or null if it failed. */
export function settledValue<T>(r: PromiseSettledResult<T> | undefined): T | null {
  return r?.status === 'fulfilled' ? (r.value ?? null) : null;
}

/**
 * A one-line summary of the failures in a settled batch, or null if every
 * report answered. Shown to the user so a missing panel is explained rather
 * than silently empty.
 */
export function settledFailure(results: PromiseSettledResult<unknown>[]): string | null {
  const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
  if (!failed.length) return null;
  const first = failed[0]?.reason;
  const why = first instanceof Error ? first.message : String(first ?? '');
  if (results.length === 1) return why;
  return `${failed.length} of ${results.length} reports could not load. ${why}`;
}
