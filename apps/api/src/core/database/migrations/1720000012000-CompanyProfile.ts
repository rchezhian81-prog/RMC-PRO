import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fuller company profile (B19). The plant's own legal identity for GST tax
 * invoices — legal name, PAN, full address, contact and bank details — added to
 * the `companies` table. All nullable, so existing rows are untouched; the
 * owner fills them in from the Company screen.
 */
export class CompanyProfile1720000012000 implements MigrationInterface {
  name = 'CompanyProfile1720000012000';

  private readonly cols = [
    'legal_name', 'pan', 'address_line1', 'address_line2', 'city', 'pincode',
    'phone', 'email', 'website', 'bank_name', 'bank_account_no', 'bank_ifsc', 'bank_branch',
  ];

  public async up(q: QueryRunner): Promise<void> {
    for (const c of this.cols) {
      await q.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS ${c} varchar;`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const c of this.cols) {
      await q.query(`ALTER TABLE companies DROP COLUMN IF EXISTS ${c};`);
    }
  }
}
