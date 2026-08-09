import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Closes the ledger half of the null-plant "ghost row" class (audit gap G/#7).
 * Migration 14 made stock_balances.plant_id NOT NULL and re-scoped null-plant
 * ledger rows, but stock_transactions.plant_id stayed nullable — so a future bug
 * could still write a plant-less ledger row. The app already resolves a non-null
 * plant for every movement (StockService.resolvePlant, used by opening,
 * consumption, inward and adjustment), so this promotes that invariant to a
 * database guarantee.
 *
 * Defensive: re-scope any remaining null-plant rows to the tenant's earliest
 * plant before SET NOT NULL. Runs as the owner (bypasses RLS), so it sees every
 * tenant. A tenant that somehow has ledger rows but no plant cannot be scoped
 * and would abort the migrate step — safe (no data change; pre-redeploy backup
 * already taken), not silent.
 */
export class StockTransactionPlantNotNull1720000017000 implements MigrationInterface {
  name = 'StockTransactionPlantNotNull1720000017000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      UPDATE stock_transactions st
         SET plant_id = p.id
        FROM (SELECT DISTINCT ON (tenant_id) tenant_id, id
                FROM plants ORDER BY tenant_id, created_at ASC) p
       WHERE st.plant_id IS NULL AND st.tenant_id = p.tenant_id`);
    await q.query(`ALTER TABLE stock_transactions ALTER COLUMN plant_id SET NOT NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE stock_transactions ALTER COLUMN plant_id DROP NOT NULL`);
  }
}
