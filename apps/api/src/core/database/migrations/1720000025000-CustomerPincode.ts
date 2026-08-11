import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add `pincode` to customers — the buyer's 6-digit PIN, needed for the GST
 * INV-01 `BuyerDtls.Pin` and the e-way `toPincode`. Previously the execution
 * service sent an empty buyer Pin (the column did not exist); a GSP that marks
 * buyer `Pin` mandatory would reject the invoice. Nullable + backward-compatible:
 * existing customers keep a NULL pincode until edited, and the field is validated
 * (6 digits) only when provided. Reversible: `down()` drops the column.
 */
export class CustomerPincode1720000025000 implements MigrationInterface {
  name = 'CustomerPincode1720000025000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS pincode varchar(6);`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE customers DROP COLUMN IF EXISTS pincode;`);
  }
}
