import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Give every undated document the date it was recorded.
 *
 * A document's date was stored as NULL when the caller omitted it, and the web
 * forms make the date field optional. A receipt entered without picking a date
 * was therefore saved with no date at all — and then vanished from the receipts
 * register and the cash/bank day book, both of which bound by date, while still
 * reducing the customer's outstanding. Money collected, missing from the report
 * the day's cash is reconciled against.
 *
 * New documents now default to today in the plant's timezone. Rows already
 * written keep their NULL and stay invisible, so this backfills them from
 * `created_at` — the moment the document was recorded, which is the best
 * evidence of its date and is exactly what the default would have produced.
 *
 * Only rows with no date are touched, so this is idempotent and cannot move a
 * date anybody actually chose.
 */
export class BackfillDocumentDates1720000068000 implements MigrationInterface {
  name = 'BackfillDocumentDates1720000068000';

  /** table → the date column that should never have been null. */
  private static readonly TARGETS: ReadonlyArray<readonly [string, string]> = [
    ['payments', 'receipt_date'],
    ['orders', 'order_date'],
    ['purchase_orders', 'order_date'],
    ['vendor_payments', 'payment_date'],
    ['goods_receipts', 'receipt_date'],
    ['vendor_bills', 'bill_date'],
    ['expense_vouchers', 'voucher_date'],
  ];

  public async up(q: QueryRunner): Promise<void> {
    for (const [table, column] of BackfillDocumentDates1720000068000.TARGETS) {
      // The plant's own calendar date, not UTC: a receipt taken at 2am in India
      // is 20:30 the previous day in UTC and would otherwise be filed a day early.
      await q.query(
        `UPDATE "${table}"
            SET "${column}" = (created_at AT TIME ZONE 'Asia/Kolkata')::date
          WHERE "${column}" IS NULL`,
      );
    }
  }

  /**
   * Not reversible, and should not be. Down would have to blank dates that are
   * now correct, and it could not tell the backfilled ones from dates a user
   * has since chosen.
   */
  public async down(): Promise<void> {
    /* intentionally empty */
  }
}
