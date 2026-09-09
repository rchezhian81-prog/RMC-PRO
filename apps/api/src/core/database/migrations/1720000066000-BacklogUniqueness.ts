import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Three uniqueness rules the code has always assumed and the schema never
 * enforced (data-integrity backlog items I35, I36, I30).
 *
 * I35 — `companies` is a singleton per tenant in every reader: eleven call
 * sites do `find({ take: 1 })` and treat the result as "the company", so a
 * second row would silently change which GSTIN, state and bank details land on
 * invoices depending on insertion order. provisionTenantCompany only ever
 * creates one, so this makes the existing assumption enforceable.
 *
 * I36 — `plants.plant_code` is what operators type and what imports match on,
 * but nothing stopped two plants sharing a code within a tenant, after which
 * "plant P1" is ambiguous in every report and CSV import.
 *
 * I30 — a batch ticket ingested from a plant controller carries the
 * controller's own batch reference. Re-running an ingest (a retried upload, an
 * overlapping log window) created a SECOND ticket for the same physical batch,
 * double-counting production and consuming stock twice. One ticket per
 * (controller, reference), and only where both are present — hand-entered
 * tickets have neither.
 *
 * Safe failure mode: each CREATE is preceded by a duplicate count that throws
 * one message naming the offending groups, altering nothing. The deploy
 * preflight (scripts/ops/migration-preflight.sh) reports the same rows
 * read-only beforehand. Reversible via down().
 */
export class BacklogUniqueness1720000066000 implements MigrationInterface {
  name = 'BacklogUniqueness1720000066000';

  public async up(q: QueryRunner): Promise<void> {
    const companies: Array<{ tenant_id: string; copies: number }> = await q.query(
      `SELECT tenant_id, count(*)::int AS copies FROM companies GROUP BY tenant_id HAVING count(*) > 1`,
    );
    if (companies.length) {
      throw new Error(
        'BacklogUniqueness1720000066000: more than one company row for a tenant — merge them first:\n  - ' +
          companies.map((c) => `tenant ${c.tenant_id}: ${c.copies} rows`).join('\n  - '),
      );
    }

    const plants: Array<{ tenant_id: string; plant_code: string; copies: number }> = await q.query(
      `SELECT tenant_id, plant_code, count(*)::int AS copies FROM plants
        GROUP BY tenant_id, plant_code HAVING count(*) > 1`,
    );
    if (plants.length) {
      throw new Error(
        'BacklogUniqueness1720000066000: the same plant code is used twice in a tenant — rename one first:\n  - ' +
          plants.map((p) => `tenant ${p.tenant_id}: code "${p.plant_code}" on ${p.copies} plants`).join('\n  - '),
      );
    }

    const tickets: Array<{ controller_id: string; controller_batch_ref: string; copies: number }> = await q.query(
      `SELECT controller_id, controller_batch_ref, count(*)::int AS copies FROM batch_tickets
        WHERE controller_id IS NOT NULL AND controller_batch_ref IS NOT NULL
        GROUP BY tenant_id, controller_id, controller_batch_ref HAVING count(*) > 1`,
    );
    if (tickets.length) {
      throw new Error(
        'BacklogUniqueness1720000066000: the same controller batch reference is on more than one ticket — cancel the duplicate(s) first:\n  - ' +
          tickets
            .map((t) => `controller ${t.controller_id}: reference "${t.controller_batch_ref}" on ${t.copies} tickets`)
            .join('\n  - '),
      );
    }

    await q.query(`CREATE UNIQUE INDEX "uq_companies_tenant" ON companies (tenant_id)`);
    await q.query(`CREATE UNIQUE INDEX "uq_plants_tenant_code" ON plants (tenant_id, plant_code)`);
    await q.query(
      `CREATE UNIQUE INDEX "uq_batch_tickets_controller_ref" ON batch_tickets (tenant_id, controller_id, controller_batch_ref) ` +
        `WHERE controller_id IS NOT NULL AND controller_batch_ref IS NOT NULL`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "uq_batch_tickets_controller_ref"`);
    await q.query(`DROP INDEX IF EXISTS "uq_plants_tenant_code"`);
    await q.query(`DROP INDEX IF EXISTS "uq_companies_tenant"`);
  }
}
