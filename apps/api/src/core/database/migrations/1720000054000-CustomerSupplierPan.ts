import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * PAN on the customer and supplier masters (Tier-4E #26). Indian KYC/compliance
 * needs the party PAN: a vendor's for TDS / 26Q, a customer's for TCS and
 * high-value KYC. The Company master already carries a PAN; the party masters did
 * not, so it had to be kept off-system. Nullable (not every party is registered),
 * validated as a well-formed PAN when supplied.
 */
export class CustomerSupplierPan1720000054000 implements MigrationInterface {
  name = 'CustomerSupplierPan1720000054000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "customers" ADD COLUMN "pan" varchar`);
    await q.query(`ALTER TABLE "suppliers" ADD COLUMN "pan" varchar`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "customers" DROP COLUMN IF EXISTS "pan"`);
    await q.query(`ALTER TABLE "suppliers" DROP COLUMN IF EXISTS "pan"`);
  }
}
