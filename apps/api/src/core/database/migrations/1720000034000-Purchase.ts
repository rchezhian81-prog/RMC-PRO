import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Purchase / AP-lite (Plan D2). Procurement chain — purchase orders + items,
 * multi-line goods receipts + items, vendor bills + items, and vendor payments
 * + allocations — all tenant-scoped under the same FORCE-RLS, NULLIF-guarded
 * policy as the rest of the schema. Reversible: `down()` drops the tables.
 */
export class Purchase1720000034000 implements MigrationInterface {
  name = 'Purchase1720000034000';

  private readonly tables = [
    'purchase_orders',
    'purchase_order_items',
    'goods_receipts',
    'goods_receipt_items',
    'vendor_bills',
    'vendor_bill_items',
    'vendor_payments',
    'vendor_payment_allocations',
  ];

  public async up(q: QueryRunner): Promise<void> {
    const appUser = (process.env.APP_DB_USER ?? 'rmc_app').replace(/[^a-zA-Z0-9_]/g, '');
    const base = `
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      tenant_id uuid NOT NULL REFERENCES tenants(id)
    `;

    await q.query(`
      CREATE TABLE purchase_orders (
        ${base},
        po_no varchar NOT NULL,
        supplier_id uuid,
        plant_id uuid REFERENCES plants(id),
        order_date date,
        expected_date date,
        taxable_amount numeric(16,2) NOT NULL DEFAULT 0,
        tax_amount numeric(16,2) NOT NULL DEFAULT 0,
        total_amount numeric(16,2) NOT NULL DEFAULT 0,
        status varchar NOT NULL DEFAULT 'draft',
        remarks varchar,
        CONSTRAINT uq_purchase_orders_no UNIQUE (tenant_id, po_no)
      );
    `);

    await q.query(`
      CREATE TABLE purchase_order_items (
        ${base},
        purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
        material_id uuid,
        material_label varchar,
        uom varchar,
        quantity numeric(16,3) NOT NULL DEFAULT 0,
        rate numeric(14,2) NOT NULL DEFAULT 0,
        gst_rate numeric(6,2) NOT NULL DEFAULT 0,
        taxable_amount numeric(16,2) NOT NULL DEFAULT 0,
        tax_amount numeric(16,2) NOT NULL DEFAULT 0,
        line_total numeric(16,2) NOT NULL DEFAULT 0,
        received_quantity numeric(16,3) NOT NULL DEFAULT 0
      );
    `);

    await q.query(`
      CREATE TABLE goods_receipts (
        ${base},
        grn_no varchar NOT NULL,
        purchase_order_id uuid REFERENCES purchase_orders(id),
        supplier_id uuid,
        plant_id uuid REFERENCES plants(id),
        receipt_date date,
        vehicle_no varchar,
        supplier_challan_no varchar,
        status varchar NOT NULL DEFAULT 'draft',
        remarks varchar,
        CONSTRAINT uq_goods_receipts_no UNIQUE (tenant_id, grn_no)
      );
    `);

    await q.query(`
      CREATE TABLE goods_receipt_items (
        ${base},
        goods_receipt_id uuid NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
        purchase_order_item_id uuid,
        material_id uuid,
        material_label varchar,
        uom varchar,
        received_quantity numeric(16,3) NOT NULL DEFAULT 0,
        accepted_quantity numeric(16,3) NOT NULL DEFAULT 0,
        rate numeric(14,2) NOT NULL DEFAULT 0,
        remarks varchar
      );
    `);

    await q.query(`
      CREATE TABLE vendor_bills (
        ${base},
        bill_no varchar NOT NULL,
        supplier_bill_no varchar,
        supplier_id uuid,
        purchase_order_id uuid REFERENCES purchase_orders(id),
        goods_receipt_id uuid REFERENCES goods_receipts(id),
        bill_date date,
        due_date date,
        taxable_amount numeric(16,2) NOT NULL DEFAULT 0,
        tax_amount numeric(16,2) NOT NULL DEFAULT 0,
        total_amount numeric(16,2) NOT NULL DEFAULT 0,
        paid_amount numeric(16,2) NOT NULL DEFAULT 0,
        outstanding_amount numeric(16,2) NOT NULL DEFAULT 0,
        match_status varchar,
        status varchar NOT NULL DEFAULT 'draft',
        payment_status varchar NOT NULL DEFAULT 'unpaid',
        remarks varchar,
        CONSTRAINT uq_vendor_bills_no UNIQUE (tenant_id, bill_no)
      );
    `);

    await q.query(`
      CREATE TABLE vendor_bill_items (
        ${base},
        vendor_bill_id uuid NOT NULL REFERENCES vendor_bills(id) ON DELETE CASCADE,
        purchase_order_item_id uuid,
        material_id uuid,
        material_label varchar,
        uom varchar,
        quantity numeric(16,3) NOT NULL DEFAULT 0,
        rate numeric(14,2) NOT NULL DEFAULT 0,
        gst_rate numeric(6,2) NOT NULL DEFAULT 0,
        taxable_amount numeric(16,2) NOT NULL DEFAULT 0,
        tax_amount numeric(16,2) NOT NULL DEFAULT 0,
        line_total numeric(16,2) NOT NULL DEFAULT 0
      );
    `);

    await q.query(`
      CREATE TABLE vendor_payments (
        ${base},
        payment_no varchar NOT NULL,
        supplier_id uuid,
        payment_date date,
        payment_mode varchar,
        amount numeric(16,2) NOT NULL DEFAULT 0,
        allocated_amount numeric(16,2) NOT NULL DEFAULT 0,
        unallocated_amount numeric(16,2) NOT NULL DEFAULT 0,
        bank_reference varchar,
        remarks varchar,
        status varchar NOT NULL DEFAULT 'posted',
        CONSTRAINT uq_vendor_payments_no UNIQUE (tenant_id, payment_no)
      );
    `);

    await q.query(`
      CREATE TABLE vendor_payment_allocations (
        ${base},
        vendor_payment_id uuid NOT NULL REFERENCES vendor_payments(id) ON DELETE CASCADE,
        vendor_bill_id uuid NOT NULL REFERENCES vendor_bills(id),
        allocated_amount numeric(16,2) NOT NULL DEFAULT 0
      );
    `);

    for (const t of this.tables) {
      await q.query(`CREATE INDEX idx_${t}_tenant ON ${t} (tenant_id);`);
      await q.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${t} TO ${appUser};`);
      await q.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`);
      await q.query(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`);
      await q.query(`
        CREATE POLICY tenant_isolation ON ${t}
          USING (
                tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
             OR current_setting('app.platform', true) = 'on'
          )
          WITH CHECK (
                tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
             OR current_setting('app.platform', true) = 'on'
          );
      `);
    }

    // Line/child lookups by parent.
    await q.query(`CREATE INDEX idx_purchase_order_items_po ON purchase_order_items (purchase_order_id);`);
    await q.query(`CREATE INDEX idx_goods_receipt_items_grn ON goods_receipt_items (goods_receipt_id);`);
    await q.query(`CREATE INDEX idx_vendor_bill_items_bill ON vendor_bill_items (vendor_bill_id);`);
    await q.query(`CREATE INDEX idx_vendor_payment_allocations_payment ON vendor_payment_allocations (vendor_payment_id);`);
    await q.query(`CREATE INDEX idx_vendor_payment_allocations_bill ON vendor_payment_allocations (vendor_bill_id);`);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const t of [...this.tables].reverse()) {
      await q.query(`DROP TABLE IF EXISTS ${t} CASCADE;`);
    }
  }
}
