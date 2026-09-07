import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One live customer receipt per bank/instrument reference (data-integrity item
 * I5). A lost response + retry posted the same UTR / cheque number twice: each
 * call minted a fresh receipt number, the allocation guard only compared to the
 * CURRENT outstanding, so amount_paid doubled and AR was understated by the
 * whole receipt — irrecoverable for non-cheque modes until `reverse` existed.
 * ReceiptService.create now refuses the duplicate up front; this partial unique
 * index is the backstop under concurrency (two retries racing past the check).
 *
 * Scope: per tenant AND customer (two cheques with the same number from
 * different banks are possible across customers), non-cash only (cash has no
 * instrument), live rows only (a reversed receipt frees its reference), and the
 * comparison is case- and whitespace-insensitive. Blank references are first
 * normalised to NULL so they never collide — the web form used to send ''.
 *
 * Safe failure mode: existing duplicates make the CREATE fail. up() counts
 * them first and throws one message listing the groups (the deploy preflight,
 * scripts/ops/migration-preflight.sh, reports the same rows read-only before
 * the deploy) — nothing is altered when it throws. Reversible via down().
 */
export class PaymentsBankReferenceUnique1720000061000 implements MigrationInterface {
  name = 'PaymentsBankReferenceUnique1720000061000';

  public async up(q: QueryRunner): Promise<void> {
    // Data hygiene first (idempotent): blank references are "no reference".
    await q.query(`UPDATE payments SET bank_reference = NULL WHERE bank_reference IS NOT NULL AND btrim(bank_reference) = ''`);

    const dups: Array<{ customer_id: string; ref: string; copies: number }> = await q.query(
      `SELECT customer_id, lower(btrim(bank_reference)) AS ref, count(*)::int AS copies FROM payments
        WHERE bank_reference IS NOT NULL AND COALESCE(payment_mode, '') <> 'cash' AND status <> 'reversed'
        GROUP BY tenant_id, customer_id, lower(btrim(bank_reference)) HAVING count(*) > 1`,
    );
    if (dups.length) {
      throw new Error(
        'PaymentsBankReferenceUnique1720000061000: the same bank reference is live on more than one receipt for a customer — ' +
          'reverse the duplicate(s) first (scripts/ops/migration-preflight.sh lists them):\n  - ' +
          dups.map((d) => `customer ${d.customer_id}: reference "${d.ref}" on ${d.copies} receipts`).join('\n  - '),
      );
    }

    await q.query(
      `CREATE UNIQUE INDEX "uq_payments_customer_bank_reference" ON payments (tenant_id, customer_id, lower(btrim(bank_reference))) ` +
        `WHERE bank_reference IS NOT NULL AND COALESCE(payment_mode, '') <> 'cash' AND status <> 'reversed'`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "uq_payments_customer_bank_reference"`);
  }
}
