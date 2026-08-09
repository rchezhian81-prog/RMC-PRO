import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Company logo for invoice branding (B19 follow-up). Two nullable columns on
 * `companies`: the validated MIME type and the raw file base64-encoded. Stored
 * in-row so it is RLS-isolated per tenant and persists across redeploys. All
 * nullable, so existing rows are untouched and invoices keep the text header
 * until a logo is uploaded.
 */
export class CompanyLogo1720000013000 implements MigrationInterface {
  name = 'CompanyLogo1720000013000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_mime varchar;`);
    await q.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_data text;`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE companies DROP COLUMN IF EXISTS logo_data;`);
    await q.query(`ALTER TABLE companies DROP COLUMN IF EXISTS logo_mime;`);
  }
}
