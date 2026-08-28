import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Site PIN code (pilot gap): capture the delivery site's postal PIN.
 *
 * Sites recorded city and state but not the PIN code, so the precise delivery
 * locality was missing from the site master — needed on delivery paperwork and
 * for the e-way bill's destination pincode. Customers already carry a 6-digit
 * `pincode`; this brings sites in line, reusing the same field-name validation.
 *
 * Additive + reversible: the column is nullable so no backfill is required, and
 * `down()` drops it.
 */
export class SitePincode1720000044000 implements MigrationInterface {
  name = 'SitePincode1720000044000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "sites" ADD COLUMN "pincode" character varying(6)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "sites" DROP COLUMN "pincode"`);
  }
}
