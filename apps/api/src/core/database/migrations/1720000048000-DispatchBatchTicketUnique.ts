import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One live dispatch per batch ticket (Tier-A gap A4).
 *
 * createFromBatchTicket did not check for an existing dispatch, and each
 * dispatch copies the ticket's full batched quantity — so a confirmed ticket
 * could be dispatched twice, doubling the delivered (and billable) volume for
 * concrete that was batched once. The service now blocks a repeat; this partial
 * unique index is the DB-level guarantee, ignoring cancelled/rejected dispatches
 * so a ticket whose dispatch fell through can be dispatched again.
 *
 * Gated by the integrity-constraints preflight (UNIQUE_CONSTRAINTS), which
 * flags any pre-existing duplicate groups before this runs. down() drops it.
 */
export class DispatchBatchTicketUnique1720000048000 implements MigrationInterface {
  name = 'DispatchBatchTicketUnique1720000048000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE UNIQUE INDEX "uq_dispatches_batch_ticket"
         ON "dispatches" ("batch_ticket_id")
       WHERE "batch_ticket_id" IS NOT NULL AND dispatch_status NOT IN ('cancelled', 'rejected')`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "uq_dispatches_batch_ticket"`);
  }
}
