/**
 * "Today", as the plant means it.
 *
 * Every document — a receipt, an order, a goods receipt — is dated the day it
 * happened. Two things were wrong with how that date was decided.
 *
 * FIRST, it was often not decided at all. The date was stored as `?? null` when
 * the caller omitted it, and the web forms make it optional. A ₹50,000 cash
 * receipt entered without picking a date was saved with NO date — and then it
 * vanished from the receipts register and the cash/bank day book, both of which
 * bound by date, while still reducing the customer's outstanding. Money you
 * collected, missing from the report you reconcile the day's cash against.
 *
 * SECOND, "today" meant UTC. A ready-mix plant pours at night: a receipt taken
 * at 2am in India is 20:30 the PREVIOUS day in UTC, so it would be filed under
 * yesterday and land in the wrong day's collections — the same off-by-one that
 * the report screens had before they were moved to local dates.
 *
 * So a document's date defaults to the calendar date in the plant's own zone,
 * Asia/Kolkata unless PLANT_TIMEZONE says otherwise.
 */

/** The plant's timezone. Indian ready-mix unless deployed elsewhere. */
export const plantTimeZone = (): string => process.env.PLANT_TIMEZONE || 'Asia/Kolkata';

/**
 * Today's calendar date in the plant's timezone, as YYYY-MM-DD.
 *
 * `en-CA` formats as YYYY-MM-DD, which is what the DATE columns hold, so this
 * needs no arithmetic and cannot drift by an hour.
 */
export function businessToday(now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: plantTimeZone(),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    // An unknown PLANT_TIMEZONE must not stop a plant from raising a receipt.
    return now.toISOString().slice(0, 10);
  }
}

/**
 * The date to store on a document: what the caller gave, else today in the
 * plant's zone. Never null — a document that happened has a date.
 */
export function documentDate(value: unknown, now: Date = new Date()): string {
  const v = typeof value === 'string' ? value.trim() : '';
  return v || businessToday(now);
}
