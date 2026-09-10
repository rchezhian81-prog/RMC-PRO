import { BadRequestException } from '@nestjs/common';
import { isYmdDate } from '@rmc/shared';

/**
 * Validate a `from`/`to` report window off the query string.
 *
 * `from` / `to` used to go straight into `$1::date`, so `?from=garbage` reached
 * Postgres as an invalid cast and surfaced as a 500 ("invalid input syntax for
 * type date") instead of a 400 naming the bad value. An empty `?from=` did the
 * same. Both are judged here, in the same YYYY-MM-DD shape the invoice paths
 * already require, and an empty one means unbounded.
 *
 * Shared by every report controller (billing, purchase, QC, inventory): the
 * guard first landed on billing alone and each later module had to remember to
 * copy it, which is exactly how a range check goes missing on a new report.
 */
export function dateRange(from?: string, to?: string): [string | undefined, string | undefined] {
  const clean = (label: string, v?: string): string | undefined => {
    const t = (v ?? '').trim();
    if (!t) return undefined;
    if (!isYmdDate(t)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `${label} must be a date in YYYY-MM-DD form (received "${t.slice(0, 40)}").`,
      });
    }
    return t;
  };
  const f = clean('from', from);
  const t = clean('to', to);
  if (f && t && f > t) {
    throw new BadRequestException({ code: 'VALIDATION_ERROR', message: `from (${f}) is after to (${t}).` });
  }
  return [f, t];
}
