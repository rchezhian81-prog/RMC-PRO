import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sprint 9: billing & payments (DEV-PLAN M9, B12-B13). Tables: invoices (with
 * embedded e-invoice / e-way-ready fields), invoice_items (generic quantity),
 * invoice_challans, payments, payment_allocations. All tenant-scoped and
 * RLS-enforced (Doc 11 §6.4).
 */
export class Billing1720000008000 implements MigrationInterface {
  name = 'Billing1720000008000';

  private readonly tables = ['invoices', 'invoice_items', 'invoice_challans', 'payments', 'payment_allocations'];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const appUser = (process.env.APP_DB_USER ?? 'rmc_app').replace(/[^a-zA-Z0-9_]/g, '');
    const base = `
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      tenant_id uuid NOT NULL REFERENCES tenants(id)
    `;

    await queryRunner.query(`
      CREATE TABLE invoices (
        ${base},
        invoice_no varchar NOT NULL,
        invoice_date date, due_date date,
        plant_id uuid REFERENCES plants(id),
        customer_id uuid REFERENCES customers(id),
        site_id uuid REFERENCES sites(id),
        billing_address varchar, place_of_supply varchar, gstin varchar,
        is_interstate boolean NOT NULL DEFAULT false,
        taxable_amount numeric(16,2) NOT NULL DEFAULT 0,
        cgst_amount numeric(16,2) NOT NULL DEFAULT 0,
        sgst_amount numeric(16,2) NOT NULL DEFAULT 0,
        igst_amount numeric(16,2) NOT NULL DEFAULT 0,
        cess_amount numeric(16,2) NOT NULL DEFAULT 0,
        round_off numeric(8,2) NOT NULL DEFAULT 0,
        total_amount numeric(16,2) NOT NULL DEFAULT 0,
        amount_paid numeric(16,2) NOT NULL DEFAULT 0,
        outstanding_amount numeric(16,2) NOT NULL DEFAULT 0,
        payment_status varchar NOT NULL DEFAULT 'unpaid',
        invoice_status varchar NOT NULL DEFAULT 'draft',
        irn varchar, ack_number varchar, ack_date timestamptz, signed_qr_code text,
        einvoice_status varchar NOT NULL DEFAULT 'not_generated',
        eway_bill_no varchar, eway_bill_date timestamptz, eway_valid_until timestamptz,
        distance_km int, transport_mode varchar, transporter_name varchar, vehicle_no varchar,
        eway_status varchar NOT NULL DEFAULT 'not_generated',
        CONSTRAINT uq_invoices_no UNIQUE (tenant_id, invoice_no)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE invoice_items (
        ${base},
        invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        challan_id uuid REFERENCES delivery_challans(id),
        grade_id uuid REFERENCES concrete_grades(id),
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

    await queryRunner.query(`
      CREATE TABLE invoice_challans (
        ${base},
        invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        challan_id uuid NOT NULL REFERENCES delivery_challans(id),
        quantity_m3 numeric(12,3) NOT NULL DEFAULT 0
      );
    `);

    await queryRunner.query(`
      CREATE TABLE payments (
        ${base},
        receipt_no varchar NOT NULL,
        customer_id uuid REFERENCES customers(id),
        receipt_date date, payment_mode varchar,
        amount numeric(16,2) NOT NULL DEFAULT 0,
        allocated_amount numeric(16,2) NOT NULL DEFAULT 0,
        unallocated_amount numeric(16,2) NOT NULL DEFAULT 0,
        bank_reference varchar, is_advance boolean NOT NULL DEFAULT false,
        remarks varchar, status varchar NOT NULL DEFAULT 'posted',
        CONSTRAINT uq_payments_no UNIQUE (tenant_id, receipt_no)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE payment_allocations (
        ${base},
        payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
        invoice_id uuid NOT NULL REFERENCES invoices(id),
        allocated_amount numeric(16,2) NOT NULL DEFAULT 0
      );
    `);

    for (const t of this.tables) {
      await queryRunner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${t} TO ${appUser};`);
      await queryRunner.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`);
      await queryRunner.query(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`);
      await queryRunner.query(`
        CREATE POLICY tenant_isolation ON ${t}
          USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
          WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
      `);
      await queryRunner.query(`CREATE INDEX idx_${t}_tenant ON ${t} (tenant_id);`);
    }

    await queryRunner.query(`CREATE INDEX idx_invoices_customer_status ON invoices (customer_id, invoice_status);`);
    await queryRunner.query(`CREATE INDEX idx_invoice_items_invoice ON invoice_items (invoice_id);`);
    await queryRunner.query(`CREATE INDEX idx_invoice_challans_invoice ON invoice_challans (invoice_id);`);
    await queryRunner.query(`CREATE INDEX idx_invoice_challans_challan ON invoice_challans (challan_id);`);
    await queryRunner.query(`CREATE INDEX idx_payment_allocations_payment ON payment_allocations (payment_id);`);
    await queryRunner.query(`CREATE INDEX idx_payment_allocations_invoice ON payment_allocations (invoice_id);`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const t of [...this.tables].reverse()) {
      await queryRunner.query(`DROP TABLE IF EXISTS ${t} CASCADE;`);
    }
  }
}
