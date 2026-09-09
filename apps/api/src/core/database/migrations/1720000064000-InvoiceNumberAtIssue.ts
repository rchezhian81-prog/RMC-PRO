import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * An invoice number is now taken when the invoice is ISSUED, not when a draft
 * is created, so a draft that is abandoned no longer burns a number.
 *
 * That means a draft has no invoice number at all, which is what this column
 * has to be able to say. `uq_invoices_no UNIQUE (tenant_id, invoice_no)` keeps
 * working: Postgres treats NULLs as distinct, so any number of drafts can sit
 * unnumbered while every issued number stays unique within the tenant.
 *
 * Existing invoices are untouched — drafts already carrying a number keep it,
 * and issue() only draws a new one when the invoice has none.
 */
export class InvoiceNumberAtIssue1720000064000 implements MigrationInterface {
  name = 'InvoiceNumberAtIssue1720000064000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE invoices ALTER COLUMN invoice_no DROP NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Only reinstatable once every unnumbered draft has a number; give the
    // un-numbered ones a placeholder rather than failing the rollback.
    await queryRunner.query(
      `UPDATE invoices SET invoice_no = 'UNNUMBERED-' || left(id::text, 8) WHERE invoice_no IS NULL`,
    );
    await queryRunner.query(`ALTER TABLE invoices ALTER COLUMN invoice_no SET NOT NULL`);
  }
}
