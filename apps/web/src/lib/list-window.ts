'use client';

import { useState } from 'react';

/**
 * How much of a long list a screen is currently showing.
 *
 * WHY THIS EXISTS: the API caps every transaction list at 200 rows, newest
 * first, so one plant-year of invoices cannot arrive as a 31 MB response. That
 * cap was silent — a screen received 200 rows and had no way to know, or to
 * say, that a 201st existed. On a list with no filter (invoices, receipts,
 * vendor bills) the older records were simply unreachable from the UI, and
 * nothing on screen admitted it. For an accounting system that is a
 * correctness problem, not a convenience one.
 *
 * A screen asks for `limit` rows; if exactly that many come back there is
 * probably more, so <ListCap> says so and offers to widen the window. Widening
 * re-fetches rather than appending, which keeps the list a single consistent
 * snapshot — no duplicated or skipped rows if someone raises an invoice while
 * you are paging.
 */

/** The API's own default page, and its hard ceiling (list-limit.util.ts). */
export const LIST_PAGE = 200;
export const LIST_MAX = 1000;

export function useListWindow(page: number = LIST_PAGE) {
  const [limit, setLimit] = useState(page);
  /** Next window up, clamped to what the API will serve. */
  const widen = () => Math.min(limit + page, LIST_MAX);
  return {
    limit,
    /** True when the response filled the window — there is probably more. */
    atCap: (rows: { length: number } | null | undefined) => (rows?.length ?? 0) >= limit,
    canWiden: limit < LIST_MAX,
    widen,
    setLimit,
  };
}
