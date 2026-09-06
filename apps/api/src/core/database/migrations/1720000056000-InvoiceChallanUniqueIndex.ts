import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One invoice_challans link per challan — the cross-process backstop for the
 * "a delivered challan is billed by at most one invoice" invariant that the row
 * lock in InvoiceService.fromChallans enforces within a process. The service
 * comment long claimed this index existed; it did not, until now.
 *
 * cancel() now DELETES an invoice's challan links (older builds only reset the
 * challan to not_invoiced and left the link behind), so a cancel → re-invoice
 * cycle no longer leaves a stale second link. This migration first clears any
 * such stale links left by the old cancel() — they point at a cancelled invoice,
 * are not load-bearing (the invoice keeps its line items), and are exactly what
 * would otherwise duplicate a challan_id — then adds the unique index.
 *
 * The index is deliberately NOT partial: after the cleanup there is one link per
 * challan and challan_id is always present, so a plain unique index is correct
 * (SQL already treats NULLs as distinct). It is therefore not declared in
 * integrity-constraints.ts, whose partial-index preflight cannot express the
 * "invoice not cancelled" join this table needs; the self-cleaning DELETE below
 * covers the only realistic pre-existing duplicate. A genuine two-live-invoices-
 * per-challan duplicate is prevented by the fromChallans row lock and would
 * surface loudly at this CREATE rather than silently double-bill.
 */
export class InvoiceChallanUniqueIndex1720000056000 implements MigrationInterface {
  name = 'InvoiceChallanUniqueIndex1720000056000';

  public async up(q: QueryRunner): Promise<void> {
    // Drop links the old cancel() left on cancelled invoices, so the challans
    // they reference are not duplicated by their live re-invoice link.
    await q.query(
      `DELETE FROM invoice_challans ic USING invoices i ` +
        `WHERE ic.invoice_id = i.id AND i.invoice_status = 'cancelled'`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "uq_invoice_challans_challan" ON invoice_challans (challan_id)`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "uq_invoice_challans_challan"`);
  }
}
