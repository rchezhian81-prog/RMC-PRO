import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ITC eligibility flag on vendor bills (Tier-2C). Input tax credit was claimed on
 * every approved bill, so blocked credits (Sec 17(5) — motor vehicles, works
 * contract, personal-use, etc.) were over-claimed in the ITC register and the
 * GSTR-3B net liability. A per-bill `itc_eligible` flag (default true) lets the
 * operator mark a bill's credit as blocked; the ITC register and 3B then exclude
 * it.
 *
 * Additive: NOT NULL DEFAULT true backfills every existing bill as eligible (no
 * behaviour change for current data). down() drops the column.
 */
export class VendorBillItcEligible1720000052000 implements MigrationInterface {
  name = 'VendorBillItcEligible1720000052000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "vendor_bills" ADD COLUMN "itc_eligible" boolean NOT NULL DEFAULT true`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "vendor_bills" DROP COLUMN IF EXISTS "itc_eligible"`);
  }
}
