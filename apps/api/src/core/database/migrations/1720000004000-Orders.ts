import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sprint 5: order lifecycle + credit control (DEV-PLAN M6/B8).
 * - Extends orders with confirmed_by / confirmed_at / cancelled_reason.
 * - Adds credit_hold_requests (credit approval + audit trail) and
 *   order_status_history (immutable transition log).
 * Both new tables are tenant-scoped and RLS-enforced (Doc 11 §6.4).
 */
export class Orders1720000004000 implements MigrationInterface {
  name = 'Orders1720000004000';

  private readonly tables = ['credit_hold_requests', 'order_status_history'];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const appUser = (process.env.APP_DB_USER ?? 'rmc_app').replace(/[^a-zA-Z0-9_]/g, '');
    const base = `
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      tenant_id uuid NOT NULL REFERENCES tenants(id)
    `;

    await queryRunner.query(`
      ALTER TABLE orders
        ADD COLUMN confirmed_by uuid,
        ADD COLUMN confirmed_at timestamptz,
        ADD COLUMN cancelled_reason varchar;
    `);

    await queryRunner.query(`
      CREATE TABLE credit_hold_requests (
        ${base},
        order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        customer_id uuid REFERENCES customers(id),
        requested_amount numeric(16,2) NOT NULL DEFAULT 0,
        credit_limit numeric(16,2) NOT NULL DEFAULT 0,
        outstanding_before numeric(16,2) NOT NULL DEFAULT 0,
        exposure_after numeric(16,2) NOT NULL DEFAULT 0,
        reason varchar,
        status varchar NOT NULL DEFAULT 'pending',
        requested_by uuid,
        decided_by uuid,
        decided_at timestamptz,
        decision_note varchar
      );
    `);

    await queryRunner.query(`
      CREATE TABLE order_status_history (
        ${base},
        order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        from_status varchar,
        to_status varchar NOT NULL,
        action varchar NOT NULL,
        actor_user_id uuid,
        note varchar
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

    await queryRunner.query(`CREATE INDEX idx_credit_hold_requests_order ON credit_hold_requests (order_id);`);
    await queryRunner.query(`CREATE INDEX idx_credit_hold_requests_status ON credit_hold_requests (status);`);
    await queryRunner.query(`CREATE INDEX idx_order_status_history_order ON order_status_history (order_id);`);
    // Supports credit-exposure aggregation by customer + status.
    await queryRunner.query(`CREATE INDEX idx_orders_customer_status ON orders (customer_id, order_status);`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const t of [...this.tables].reverse()) {
      await queryRunner.query(`DROP TABLE IF EXISTS ${t} CASCADE;`);
    }
    await queryRunner.query(`DROP INDEX IF EXISTS idx_orders_customer_status;`);
    await queryRunner.query(`
      ALTER TABLE orders
        DROP COLUMN IF EXISTS confirmed_by,
        DROP COLUMN IF EXISTS confirmed_at,
        DROP COLUMN IF EXISTS cancelled_reason;
    `);
  }
}
