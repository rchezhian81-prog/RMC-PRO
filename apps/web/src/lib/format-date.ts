/**
 * Dates as a plant reads them.
 *
 * Two problems this solves. The delivery register printed its date column as
 * "2026-09-13T00:00:00.000Z" — a raw timestamp on the screen a manager checks
 * every morning, and wide enough that it was a large part of why that table
 * needed sideways scrolling on a phone. Everywhere else printed "2026-09-13",
 * readable but not the DD/MM/YYYY an Indian office expects.
 *
 * TIMEZONE CARE: a plain "YYYY-MM-DD" from a DATE column is a calendar date
 * with no time and no zone. Passing it through `new Date()` makes it UTC
 * midnight, which in a timezone BEHIND UTC renders as the day before — an
 * invoice dated the 1st showing as the 31st. So a bare date is reformatted by
 * string surgery and never parsed. Only a value that genuinely carries a time
 * goes through Date, where converting to the viewer's zone is the right thing.
 */

const BARE_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** DD/MM/YYYY, or an em dash when there is no date. Never "Invalid Date". */
export function formatDate(value: unknown): string {
  const raw = value == null ? '' : String(value).trim();
  if (!raw) return '—';

  const bare = BARE_DATE.exec(raw);
  if (bare) return `${bare[3]}/${bare[2]}/${bare[1]}`;

  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw; // show what we were given rather than a lie
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** DD/MM/YYYY HH:MM for the places where the time of day is the point. */
export function formatDateTime(value: unknown): string {
  const raw = value == null ? '' : String(value).trim();
  if (!raw) return '—';
  if (BARE_DATE.test(raw)) return formatDate(raw); // a date column has no time to show
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${formatDate(raw)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
