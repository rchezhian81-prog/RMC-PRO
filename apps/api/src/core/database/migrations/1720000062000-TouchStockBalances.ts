import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One-off: re-deliver every stock balance to offline devices once (gap-scan
 * item O2).
 *
 * `upsertBalance` is the only writer of stock_balances and its raw
 * INSERT … ON CONFLICT never set `updated_at` — TypeORM's @UpdateDateColumn
 * does not fire on raw SQL and the table has no trigger — so the column kept
 * each row's CREATION time. The offline pull cursor is `(updated_at, id)`, so a
 * balance was delivered to a device exactly once and never again: a plant's
 * stock view froze at whatever it saw when the row first appeared.
 *
 * The service now advances `updated_at`, which fixes every FUTURE movement. This
 * touches the existing rows once so devices holding a stale copy are corrected
 * on their next pull instead of waiting for each material to move again (a
 * slow-moving material could be months). One UPDATE over a small table — one
 * row per plant × material — with no schema change and nothing to roll back
 * (down() is a no-op: re-touching on the way down would be another spurious
 * change for devices to pull).
 */
export class TouchStockBalances1720000062000 implements MigrationInterface {
  name = 'TouchStockBalances1720000062000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`UPDATE stock_balances SET updated_at = now()`);
  }

  public async down(): Promise<void> {
    /* nothing to undo: the touch is idempotent data, not schema */
  }
}
