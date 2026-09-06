import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Read-path index for the material-consumption reports.
 *
 * production-reports filters stock_transactions by
 * transaction_type IN ('batch_consumption','negative_stock') (plus optional
 * plant/date). stock_transactions is one of the highest-volume tables — a row
 * per inward, consumption, adjustment and negative-stock event — and carried
 * only tenant_id and (material_id, created_at) indexes, so narrowing to
 * consumption rows seq-scanned the tenant's whole ledger. Leading with
 * (tenant_id, transaction_type) lets the planner index-scan just the two
 * consumption types; created_at rides along for the report's date residual.
 *
 * Plain (non-unique) index — it changes no behaviour and never aborts on
 * existing data, so there is no integrity-constraints.ts entry (the drift guard
 * only tracks CHECK/FK/partial-UNIQUE constraints).
 */
export class StockTransactionsTypeIndex1720000059000 implements MigrationInterface {
  name = 'StockTransactionsTypeIndex1720000059000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE INDEX "idx_stock_transactions_type" ON stock_transactions (tenant_id, transaction_type, created_at)`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "idx_stock_transactions_type"`);
  }
}
