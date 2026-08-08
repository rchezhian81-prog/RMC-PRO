import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Repair the null-plant "ghost" stock rows and forbid them going forward.
 *
 * A bug let batch consumption write stock_balances / stock_transactions rows
 * with plant_id = NULL (the plant never resolved from the order/batch context).
 * Because Postgres treats NULLs as distinct in a unique index, those ghost rows
 * sat alongside the real plant-scoped row, doubling and corrupting stock totals
 * and valuation reports.
 *
 * This migration:
 *   1. Merges each null-plant balance into its matching plant-scoped sibling.
 *   2. Attaches any remaining null-plant balance to the tenant's plant (the
 *      single-plant case; the earliest plant otherwise — a documented best
 *      effort, since the ghost rows lost their true plant).
 *   3. Drops any balance whose tenant has no plant at all (unscopeable).
 *   4. Re-scopes null-plant ledger rows the same way so consumption reports add
 *      up.
 *   5. Sets stock_balances.plant_id NOT NULL so the ghost rows cannot recur.
 *
 * Runs as the owner role (BYPASSRLS), so the cross-tenant repair is allowed.
 */
export class StockBalancePlantNotNull1720000014000 implements MigrationInterface {
  name = 'StockBalancePlantNotNull1720000014000';

  public async up(q: QueryRunner): Promise<void> {
    // 1) Merge a null-plant balance into the real plant-scoped row for the same
    //    (tenant, material), then remove the merged null rows.
    await q.query(`
      UPDATE stock_balances b
      SET current_quantity = b.current_quantity + n.current_quantity,
          last_updated_at = now()
      FROM stock_balances n
      WHERE n.plant_id IS NULL
        AND b.plant_id IS NOT NULL
        AND b.tenant_id = n.tenant_id
        AND b.material_id = n.material_id;
    `);
    await q.query(`
      DELETE FROM stock_balances n
      WHERE n.plant_id IS NULL
        AND EXISTS (
          SELECT 1 FROM stock_balances b
          WHERE b.plant_id IS NOT NULL
            AND b.tenant_id = n.tenant_id
            AND b.material_id = n.material_id
        );
    `);

    // 2) Remaining null-plant balances have no sibling → attach to the tenant's
    //    (sole / earliest) plant.
    await q.query(`
      UPDATE stock_balances b
      SET plant_id = p.id
      FROM (SELECT DISTINCT ON (tenant_id) tenant_id, id FROM plants ORDER BY tenant_id, created_at ASC) p
      WHERE b.plant_id IS NULL AND b.tenant_id = p.tenant_id;
    `);

    // 3) Anything still null belongs to a tenant with no plant — cannot be
    //    scoped, so drop it (its quantity has nowhere to live).
    await q.query(`DELETE FROM stock_balances WHERE plant_id IS NULL;`);

    // 4) Re-scope null-plant ledger rows the same way (report correctness).
    await q.query(`
      UPDATE stock_transactions t
      SET plant_id = p.id
      FROM (SELECT DISTINCT ON (tenant_id) tenant_id, id FROM plants ORDER BY tenant_id, created_at ASC) p
      WHERE t.plant_id IS NULL AND t.tenant_id = p.tenant_id;
    `);

    // 5) Enforce the invariant.
    await q.query(`ALTER TABLE stock_balances ALTER COLUMN plant_id SET NOT NULL;`);
  }

  public async down(q: QueryRunner): Promise<void> {
    // The merge/repair cannot be un-done; only the constraint is reversible.
    await q.query(`ALTER TABLE stock_balances ALTER COLUMN plant_id DROP NOT NULL;`);
  }
}
