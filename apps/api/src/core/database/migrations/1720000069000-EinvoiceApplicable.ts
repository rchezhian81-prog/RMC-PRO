import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Whether e-invoicing (IRN via the IRP) applies to this company.
 *
 * The compliance check warned about every issued invoice that had no IRN, citing
 * the AATO > ₹5 crore rule — but nothing recorded whether the plant is above that
 * threshold, so the warning could not be right for anyone below it. A new plant
 * would be told on every single invoice to generate an IRN it neither needs nor
 * has credentials to produce, and a warning that is always wrong is one nobody
 * reads.
 *
 * Stored as a flag the owner sets rather than a turnover figure, because the
 * threshold itself has moved repeatedly (₹500 cr → 100 → 50 → 20 → 10 → 5) and a
 * stored figure would have to be re-judged against whichever limit applies each
 * year. Defaults to false: a plant is not nagged about a rule it is not under
 * until it says the rule applies.
 */
export class EinvoiceApplicable1720000069000 implements MigrationInterface {
  name = 'EinvoiceApplicable1720000069000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS einvoice_applicable boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE companies DROP COLUMN IF EXISTS einvoice_applicable`);
  }
}
