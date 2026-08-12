import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Expense capture (Plan D4). Four tenant-scoped tables under the same FORCE-RLS,
 * NULLIF-guarded policy as the rest of the schema:
 *   - `expense_groups`        — top-level category master.
 *   - `expense_heads`         — expense type under a group.
 *   - `expense_vouchers`      — a payment header (draft → posted).
 *   - `expense_voucher_lines` — allocated lines (plant / vehicle / site / general).
 * Reversible: `down()` drops the four tables in dependency order.
 */
export class Expenses1720000038000 implements MigrationInterface {
  name = 'Expenses1720000038000';

  // Ordered parent → child for creation; dropped in reverse.
  private readonly tables = ['expense_groups', 'expense_heads', 'expense_vouchers', 'expense_voucher_lines'];

  public async up(q: QueryRunner): Promise<void> {
    const appUser = (process.env.APP_DB_USER ?? 'rmc_app').replace(/[^a-zA-Z0-9_]/g, '');
    const base = `
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      tenant_id uuid NOT NULL REFERENCES tenants(id)
    `;

    await q.query(`
      CREATE TABLE expense_groups (
        ${base},
        group_code varchar NOT NULL,
        group_name varchar NOT NULL,
        status varchar NOT NULL DEFAULT 'active',
        remarks varchar,
        CONSTRAINT uq_expense_groups_code UNIQUE (tenant_id, group_code)
      );
    `);

    await q.query(`
      CREATE TABLE expense_heads (
        ${base},
        head_code varchar NOT NULL,
        head_name varchar NOT NULL,
        group_id uuid REFERENCES expense_groups(id),
        default_cost_type varchar,
        status varchar NOT NULL DEFAULT 'active',
        CONSTRAINT uq_expense_heads_code UNIQUE (tenant_id, head_code)
      );
    `);

    await q.query(`
      CREATE TABLE expense_vouchers (
        ${base},
        voucher_no varchar NOT NULL,
        voucher_date date,
        payee varchar,
        payment_mode varchar,
        plant_id uuid REFERENCES plants(id),
        narration varchar,
        total_amount numeric(16,2) NOT NULL DEFAULT 0,
        status varchar NOT NULL DEFAULT 'draft',
        remarks varchar,
        CONSTRAINT uq_expense_vouchers_no UNIQUE (tenant_id, voucher_no)
      );
    `);

    await q.query(`
      CREATE TABLE expense_voucher_lines (
        ${base},
        expense_voucher_id uuid NOT NULL REFERENCES expense_vouchers(id),
        expense_head_id uuid REFERENCES expense_heads(id),
        expense_head_label varchar,
        description varchar,
        amount numeric(16,2) NOT NULL DEFAULT 0,
        allocation_type varchar NOT NULL DEFAULT 'general',
        allocation_id uuid,
        allocation_label varchar
      );
    `);

    // Extra child-key indexes for the roll-ups (tenant index applied to all below).
    await q.query(`CREATE INDEX idx_expense_heads_group ON expense_heads (group_id);`);
    await q.query(`CREATE INDEX idx_expense_voucher_lines_voucher ON expense_voucher_lines (expense_voucher_id);`);

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
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const t of [...this.tables].reverse()) {
      await q.query(`DROP TABLE IF EXISTS ${t} CASCADE;`);
    }
  }
}
