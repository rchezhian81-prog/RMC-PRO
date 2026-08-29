import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Widen money columns int → numeric(_,2) (pilot gap): stop truncating paise.
 *
 * customers.credit_limit, customers.opening_balance and materials.standard_rate
 * were integer, so a limit of ₹5,00,000.50, an opening balance with paise, or a
 * material rate like ₹52.75 lost its fractional rupees on save — understating
 * exposure and mispricing stock. These are money/price fields and belong in
 * numeric, like every other rupee column.
 *
 * Additive + safe: int values cast to numeric exactly (no rounding, no
 * backfill). down() narrows back to integer, rounding to the nearest rupee
 * (the only lossy direction), so it stays reversible.
 */
export class WidenMoneyColumns1720000045000 implements MigrationInterface {
  name = 'WidenMoneyColumns1720000045000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "customers" ALTER COLUMN "credit_limit" TYPE numeric(16,2)`);
    await q.query(`ALTER TABLE "customers" ALTER COLUMN "opening_balance" TYPE numeric(16,2)`);
    await q.query(`ALTER TABLE "materials" ALTER COLUMN "standard_rate" TYPE numeric(14,2)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "customers" ALTER COLUMN "credit_limit" TYPE integer USING round("credit_limit")`);
    await q.query(`ALTER TABLE "customers" ALTER COLUMN "opening_balance" TYPE integer USING round("opening_balance")`);
    await q.query(`ALTER TABLE "materials" ALTER COLUMN "standard_rate" TYPE integer USING round("standard_rate")`);
  }
}
