import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Who prepared and who approved a quotation or a rate contract, and when.
 *
 * A customer reading the PDF wants to see the names: the salesperson who
 * prepared it and the manager who approved it. Until now the approval only
 * flipped a status; the approver and the moment were in the audit trail alone.
 * `approved_by` / `approved_at` are set on approve and cleared when the
 * document is rejected or revised; `created_by` is the login that raised it,
 * the fallback preparer when no sales user is named on the quotation.
 */
export class QuotationApprovalPumpEdit1720000076000 implements MigrationInterface {
  name = 'QuotationApprovalPumpEdit1720000076000';

  public async up(q: QueryRunner): Promise<void> {
    for (const table of ['quotations', 'rate_contracts']) {
      await q.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS created_by uuid`);
      await q.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS approved_by uuid`);
      await q.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS approved_at timestamptz`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of ['quotations', 'rate_contracts']) {
      await q.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS approved_at`);
      await q.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS approved_by`);
      await q.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS created_by`);
    }
  }
}
