import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sprint 4: Sales module tables (leads, follow-ups, quotations + items +
 * revisions, rate contracts + items), plus order DRAFT handoff tables (orders,
 * order_items) and the notification log. All tenant-scoped and RLS-enforced
 * (Doc 11 §6.4). Order tables are the sales→operations handoff only — the
 * confirmed-order workflow is a later sprint.
 */
export class Sales1720000003000 implements MigrationInterface {
  name = 'Sales1720000003000';

  private readonly tables = [
    'leads',
    'lead_followups',
    'quotations',
    'quotation_items',
    'quotation_revisions',
    'rate_contracts',
    'rate_contract_items',
    'orders',
    'order_items',
    'notification_logs',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const appUser = (process.env.APP_DB_USER ?? 'rmc_app').replace(/[^a-zA-Z0-9_]/g, '');
    const base = `
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      tenant_id uuid NOT NULL REFERENCES tenants(id)
    `;

    await queryRunner.query(`
      CREATE TABLE leads (
        ${base},
        lead_no varchar NOT NULL,
        customer_name varchar NOT NULL,
        contact_person varchar, mobile varchar, email varchar,
        site_location varchar, requirement_notes text, lead_source varchar,
        assigned_sales_user_id uuid,
        lead_stage varchar NOT NULL DEFAULT 'new',
        next_followup_date date,
        lost_reason varchar,
        status varchar NOT NULL DEFAULT 'open',
        CONSTRAINT uq_leads_no UNIQUE (tenant_id, lead_no)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE lead_followups (
        ${base},
        lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        followup_date date, notes text, outcome varchar, next_followup_date date,
        status varchar NOT NULL DEFAULT 'done'
      );
    `);

    await queryRunner.query(`
      CREATE TABLE quotations (
        ${base},
        quotation_no varchar NOT NULL,
        lead_id uuid REFERENCES leads(id),
        customer_id uuid REFERENCES customers(id),
        site_id uuid REFERENCES sites(id),
        quotation_date date, valid_until date,
        sales_user_id uuid, payment_terms varchar,
        approval_status varchar NOT NULL DEFAULT 'draft',
        revision_no int NOT NULL DEFAULT 0,
        remarks text,
        status varchar NOT NULL DEFAULT 'active',
        CONSTRAINT uq_quotations_no UNIQUE (tenant_id, quotation_no)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE quotation_items (
        ${base},
        quotation_id uuid NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
        grade_id uuid REFERENCES concrete_grades(id),
        grade_label varchar,
        estimated_quantity numeric(12,3) NOT NULL DEFAULT 0,
        rate_per_m3 numeric(14,2) NOT NULL DEFAULT 0,
        transport_charge numeric(14,2) NOT NULL DEFAULT 0,
        pump_charge numeric(14,2) NOT NULL DEFAULT 0,
        waiting_charge numeric(14,2) NOT NULL DEFAULT 0,
        gst_applicable boolean NOT NULL DEFAULT true,
        remarks varchar
      );
    `);

    await queryRunner.query(`
      CREATE TABLE quotation_revisions (
        ${base},
        quotation_id uuid NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
        revision_no int NOT NULL DEFAULT 0,
        changed_by uuid, change_reason varchar,
        snapshot_json jsonb
      );
    `);

    await queryRunner.query(`
      CREATE TABLE rate_contracts (
        ${base},
        rate_contract_no varchar NOT NULL,
        customer_id uuid REFERENCES customers(id),
        site_id uuid REFERENCES sites(id),
        valid_from date, valid_to date,
        transport_terms varchar, pump_terms varchar, payment_terms varchar,
        approval_status varchar NOT NULL DEFAULT 'draft',
        remarks text,
        status varchar NOT NULL DEFAULT 'active',
        CONSTRAINT uq_rate_contracts_no UNIQUE (tenant_id, rate_contract_no)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE rate_contract_items (
        ${base},
        rate_contract_id uuid NOT NULL REFERENCES rate_contracts(id) ON DELETE CASCADE,
        grade_id uuid REFERENCES concrete_grades(id),
        grade_label varchar,
        rate_per_m3 numeric(14,2) NOT NULL DEFAULT 0,
        transport_charge numeric(14,2) NOT NULL DEFAULT 0,
        pump_charge numeric(14,2) NOT NULL DEFAULT 0,
        waiting_charge numeric(14,2) NOT NULL DEFAULT 0,
        gst_applicable boolean NOT NULL DEFAULT true,
        remarks varchar
      );
    `);

    await queryRunner.query(`
      CREATE TABLE orders (
        ${base},
        order_no varchar NOT NULL,
        customer_id uuid REFERENCES customers(id),
        site_id uuid REFERENCES sites(id),
        plant_id uuid REFERENCES plants(id),
        quotation_id uuid REFERENCES quotations(id),
        rate_contract_id uuid REFERENCES rate_contracts(id),
        order_date date,
        required_datetime timestamptz,
        estimated_order_value numeric(16,2) NOT NULL DEFAULT 0,
        pricing_source varchar,
        credit_status varchar NOT NULL DEFAULT 'not_checked',
        order_status varchar NOT NULL DEFAULT 'draft',
        special_instructions text,
        CONSTRAINT uq_orders_no UNIQUE (tenant_id, order_no)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE order_items (
        ${base},
        order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        grade_id uuid REFERENCES concrete_grades(id),
        grade_label varchar,
        quantity_m3 numeric(12,3) NOT NULL DEFAULT 0,
        rate_per_m3 numeric(14,2) NOT NULL DEFAULT 0,
        transport_charge numeric(14,2) NOT NULL DEFAULT 0,
        pump_charge numeric(14,2) NOT NULL DEFAULT 0,
        waiting_charge numeric(14,2) NOT NULL DEFAULT 0,
        slump_required varchar,
        pump_required boolean NOT NULL DEFAULT false,
        required_datetime timestamptz,
        delivery_interval_minutes int,
        line_status varchar NOT NULL DEFAULT 'draft'
      );
    `);

    await queryRunner.query(`
      CREATE TABLE notification_logs (
        ${base},
        channel varchar NOT NULL DEFAULT 'whatsapp',
        recipient_mobile varchar,
        module_key varchar, event_key varchar,
        reference_type varchar, reference_id uuid,
        message_body text, share_url varchar,
        message_status varchar NOT NULL DEFAULT 'queued',
        provider_message_id varchar, error_message varchar,
        sent_at timestamptz
      );
    `);

    for (const t of this.tables) {
      await queryRunner.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ${t} TO ${appUser};`,
      );
      await queryRunner.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`);
      await queryRunner.query(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`);
      await queryRunner.query(`
        CREATE POLICY tenant_isolation ON ${t}
          USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
          WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
      `);
      await queryRunner.query(`CREATE INDEX idx_${t}_tenant ON ${t} (tenant_id);`);
    }

    // Child-table lookup indexes (parent FK within tenant).
    await queryRunner.query(`CREATE INDEX idx_lead_followups_lead ON lead_followups (lead_id);`);
    await queryRunner.query(`CREATE INDEX idx_quotation_items_quotation ON quotation_items (quotation_id);`);
    await queryRunner.query(`CREATE INDEX idx_quotation_revisions_quotation ON quotation_revisions (quotation_id);`);
    await queryRunner.query(`CREATE INDEX idx_rate_contract_items_contract ON rate_contract_items (rate_contract_id);`);
    await queryRunner.query(`CREATE INDEX idx_order_items_order ON order_items (order_id);`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const t of [...this.tables].reverse()) {
      await queryRunner.query(`DROP TABLE IF EXISTS ${t} CASCADE;`);
    }
  }
}
