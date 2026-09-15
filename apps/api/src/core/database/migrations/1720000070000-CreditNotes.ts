import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * GST credit and debit notes (CGST Rule 53).
 *
 * Until now a wrong invoice could only be cancelled and re-issued. That is
 * valid until the invoice has been reported in GSTR-1; after that a rate
 * reduction, a shortfall or a return must go by credit note, and an
 * under-billing by debit note — documents this system could not produce.
 *
 * Two tables, tenant-scoped and RLS-enforced like every other, and two
 * columns on invoices holding the issued credit and debit totals against
 * each invoice. The columns matter: an invoice's outstanding is recomputed
 * from its figures whenever a receipt touches it, so a note that only edited
 * the outstanding would be silently undone by the next receipt.
 */
export class CreditNotes1720000070000 implements MigrationInterface {
  name = 'CreditNotes1720000070000';

  private readonly tables = ['credit_notes', 'credit_note_items'];

  public async up(q: QueryRunner): Promise<void> {
    const appUser = (process.env.APP_DB_USER ?? 'rmc_app').replace(/[^a-zA-Z0-9_]/g, '');
    const base = `
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      tenant_id uuid NOT NULL REFERENCES tenants(id)
    `;
    await q.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS credit_note_amount numeric(16,2) NOT NULL DEFAULT 0`);
    await q.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS debit_note_amount numeric(16,2) NOT NULL DEFAULT 0`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS credit_notes (
        ${base},
        note_no varchar,
        note_type varchar NOT NULL,
        invoice_id uuid NOT NULL REFERENCES invoices(id),
        customer_id uuid REFERENCES customers(id),
        note_date date,
        reason varchar, remarks varchar,
        place_of_supply varchar, gstin varchar,
        is_interstate boolean NOT NULL DEFAULT false,
        taxable_amount numeric(16,2) NOT NULL DEFAULT 0,
        cgst_amount numeric(16,2) NOT NULL DEFAULT 0,
        sgst_amount numeric(16,2) NOT NULL DEFAULT 0,
        igst_amount numeric(16,2) NOT NULL DEFAULT 0,
        cess_amount numeric(16,2) NOT NULL DEFAULT 0,
        round_off numeric(8,2) NOT NULL DEFAULT 0,
        total_amount numeric(16,2) NOT NULL DEFAULT 0,
        status varchar NOT NULL DEFAULT 'draft',
        cancel_reason varchar,
        CONSTRAINT chk_credit_notes_type CHECK (note_type IN ('credit', 'debit')),
        CONSTRAINT chk_credit_notes_status CHECK (status IN ('draft', 'issued', 'cancelled'))
      );
    `);
    await q.query(`
      CREATE TABLE IF NOT EXISTS credit_note_items (
        ${base},
        credit_note_id uuid NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
        description varchar, hsn_sac varchar, uom varchar,
        quantity numeric(16,3) NOT NULL DEFAULT 0,
        rate numeric(14,2) NOT NULL DEFAULT 0,
        taxable_amount numeric(16,2) NOT NULL DEFAULT 0,
        gst_rate numeric(6,2) NOT NULL DEFAULT 0,
        cgst_rate numeric(6,2) NOT NULL DEFAULT 0, cgst_amount numeric(16,2) NOT NULL DEFAULT 0,
        sgst_rate numeric(6,2) NOT NULL DEFAULT 0, sgst_amount numeric(16,2) NOT NULL DEFAULT 0,
        igst_rate numeric(6,2) NOT NULL DEFAULT 0, igst_amount numeric(16,2) NOT NULL DEFAULT 0,
        cess_rate numeric(6,2) NOT NULL DEFAULT 0, cess_amount numeric(16,2) NOT NULL DEFAULT 0,
        line_total numeric(16,2) NOT NULL DEFAULT 0
      );
    `);
    for (const t of this.tables) {
      await q.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${t} TO ${appUser};`);
      await q.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`);
      await q.query(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`);
      await q.query(`
        CREATE POLICY tenant_isolation ON ${t}
          USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
          WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
      `);
      await q.query(`CREATE INDEX IF NOT EXISTS idx_${t}_tenant ON ${t} (tenant_id);`);
    }
    await q.query(`CREATE INDEX IF NOT EXISTS idx_credit_notes_invoice ON credit_notes (invoice_id);`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_credit_notes_customer_status ON credit_notes (customer_id, status);`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_credit_note_items_note ON credit_note_items (credit_note_id);`);
    // One number per tenant per issued note — the same backstop the invoice series has.
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_notes_no ON credit_notes (tenant_id, note_no) WHERE note_no IS NOT NULL;`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS credit_note_items`);
    await q.query(`DROP TABLE IF EXISTS credit_notes`);
    await q.query(`ALTER TABLE invoices DROP COLUMN IF EXISTS credit_note_amount`);
    await q.query(`ALTER TABLE invoices DROP COLUMN IF EXISTS debit_note_amount`);
  }
}
