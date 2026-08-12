import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Receivables maturity (Plan C1). Track a cheque's clearing state on a receipt
 * (pending → realised / bounced) and how much of an invoice has been written off.
 * Additive and reversible: `down()` drops the two columns.
 */
export class ReceivablesMaturity1720000033000 implements MigrationInterface {
  name = 'ReceivablesMaturity1720000033000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE payments ADD COLUMN clearing_status varchar;`);
    await q.query(`ALTER TABLE invoices ADD COLUMN written_off_amount numeric(16,2) NOT NULL DEFAULT 0;`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE invoices DROP COLUMN IF EXISTS written_off_amount;`);
    await q.query(`ALTER TABLE payments DROP COLUMN IF EXISTS clearing_status;`);
  }
}
