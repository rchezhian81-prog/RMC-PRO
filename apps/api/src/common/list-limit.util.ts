/**
 * How many rows a list endpoint may return.
 *
 * WHY THIS EXISTS: the core business lists — orders, delivery challans,
 * invoices, quotations — were unbounded `find()` calls. They are fine on a
 * young tenant and become the product's worst performance problem as data
 * accumulates, because nothing about them degrades gracefully: every screen
 * load returns the whole table.
 *
 * Measured on a seeded tenant, GET /delivery-challans at 50,000 rows (roughly
 * three years at 50 deliveries a day) returned a 31 MB JSON body in ~1.5s on an
 * idle local database. Over a plant's connection that is about a minute of
 * waiting, and several concurrent requests each buffering 31 MB is a memory
 * problem on a 4 GB box, not merely a slow page.
 *
 * The newer modules (corrections, stock, agents, GST jobs) already cap at
 * 100-200. This is the same convention, shared, so the next list added does not
 * have to remember it.
 */

/** Newest-N returned when the caller does not ask for a size. */
export const DEFAULT_LIST_LIMIT = 200;

/** Hard ceiling, so `?limit=999999` cannot reinstate the unbounded read. */
export const MAX_LIST_LIMIT = 1000;

/**
 * Resolve a caller-supplied limit to something safe.
 * Absent, unparseable, zero and negative all fall back to the default; anything
 * above the ceiling is clamped down to it.
 */
export function listLimit(raw?: string | number | null): number {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIST_LIMIT;
  return Math.min(Math.floor(n), MAX_LIST_LIMIT);
}
