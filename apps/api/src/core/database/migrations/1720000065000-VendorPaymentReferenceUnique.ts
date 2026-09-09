import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One live vendor payment per bank/instrument reference — the money-OUT twin of
 * uq_payments_customer_bank_reference (I5).
 *
 * That guard was added to customer receipts after a lost response + retry
 * posted the same UTR twice and doubled amount_paid. The vendor side takes the
 * same shape of request, stores the same bank_reference, and never got the same
 * protection: a retried payment minted a fresh payment number, allocated again
 * against the bill's CURRENT outstanding, and the supplier's bill read as paid
 * twice while payables understated by the whole amount.
 *
 * Scope mirrors the customer index: per tenant AND supplier, non-cash only
 * (cash has no instrument), live rows only (a reversed payment frees its
 * reference), compared case- and whitespace-insensitively. Blank references are
 * normalised to NULL first so they never collide.
 *
 * Safe failure mode: existing duplicates make the CREATE fail, so up() counts
 * them first and throws one message naming the groups — nothing is altered when
 * it throws, and scripts/ops/migration-preflight.sh reports the same rows
 * read-only before the deploy. Reversible via down().
 */
export class VendorPaymentReferenceUnique1720000065000 implements MigrationInterface {
  name = 'VendorPaymentReferenceUnique1720000065000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `UPDATE vendor_payments SET bank_reference = NULL WHERE bank_reference IS NOT NULL AND btrim(bank_reference) = ''`,
    );

    const dups: Array<{ supplier_id: string; ref: string; copies: number }> = await q.query(
      `SELECT supplier_id, lower(btrim(bank_reference)) AS ref, count(*)::int AS copies FROM vendor_payments
        WHERE bank_reference IS NOT NULL AND COALESCE(payment_mode, '') <> 'cash' AND status <> 'reversed'
        GROUP BY tenant_id, supplier_id, lower(btrim(bank_reference)) HAVING count(*) > 1`,
    );
    if (dups.length) {
      throw new Error(
        'VendorPaymentReferenceUnique1720000065000: the same bank reference is live on more than one payment for a supplier — ' +
          'reverse the duplicate(s) first (scripts/ops/migration-preflight.sh lists them):\n  - ' +
          dups.map((d) => `supplier ${d.supplier_id}: reference "${d.ref}" on ${d.copies} payments`).join('\n  - '),
      );
    }

    await q.query(
      `CREATE UNIQUE INDEX "uq_vendor_payments_supplier_bank_reference" ON vendor_payments (tenant_id, supplier_id, lower(btrim(bank_reference))) ` +
        `WHERE bank_reference IS NOT NULL AND COALESCE(payment_mode, '') <> 'cash' AND status <> 'reversed'`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "uq_vendor_payments_supplier_bank_reference"`);
  }
}
