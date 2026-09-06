import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Referential integrity for the purchase tables (data-integrity item I19,
 * schema layer). `1720000034000-Purchase` created supplier_id, material_id and
 * purchase_order_item_id as bare uuid columns with no REFERENCES, so a vendor
 * bill or payment could be committed against a supplier that does not exist —
 * an approved payable with a blank supplier in the ITC register and a NULL
 * bucket in aging — and a GRN/bill line could cite a PO line that was never
 * there. The services now resolve every id in-tenant (layer 1); these plain
 * FKs are the database backstop for raw writes and future code paths.
 *
 * Plain FKs only (no composite (tenant_id, id) keys — deliberately deferred): a
 * UUID of ANOTHER tenant still satisfies them, which is exactly why the service
 * layer resolves ids through the tenant-bound manager.
 *
 * ON DELETE is the default NO ACTION: masters are soft-deleted (status), so
 * nothing legitimate ever deletes a referenced supplier or material; a raw hard
 * delete now fails instead of orphaning payables and receipts.
 *
 * Safe failure mode: an existing dangling reference makes the ADD fail. To make
 * that actionable, up() first counts orphans for EVERY key and throws one
 * message listing them all (the deploy preflight, scripts/ops/migration-
 * preflight.sh, reports the same rows read-only before the deploy). Nothing is
 * altered when it throws. Reversible via down().
 */
const FKS = [
  { table: 'purchase_orders', column: 'supplier_id', refTable: 'suppliers', constraint: 'fk_purchase_orders_supplier' },
  { table: 'purchase_order_items', column: 'material_id', refTable: 'materials', constraint: 'fk_purchase_order_items_material' },
  { table: 'goods_receipts', column: 'supplier_id', refTable: 'suppliers', constraint: 'fk_goods_receipts_supplier' },
  { table: 'goods_receipt_items', column: 'purchase_order_item_id', refTable: 'purchase_order_items', constraint: 'fk_goods_receipt_items_po_item' },
  { table: 'goods_receipt_items', column: 'material_id', refTable: 'materials', constraint: 'fk_goods_receipt_items_material' },
  { table: 'vendor_bills', column: 'supplier_id', refTable: 'suppliers', constraint: 'fk_vendor_bills_supplier' },
  { table: 'vendor_bill_items', column: 'purchase_order_item_id', refTable: 'purchase_order_items', constraint: 'fk_vendor_bill_items_po_item' },
  { table: 'vendor_bill_items', column: 'material_id', refTable: 'materials', constraint: 'fk_vendor_bill_items_material' },
  { table: 'vendor_payments', column: 'supplier_id', refTable: 'suppliers', constraint: 'fk_vendor_payments_supplier' },
] as const;

export class PurchaseForeignKeys1720000060000 implements MigrationInterface {
  name = 'PurchaseForeignKeys1720000060000';

  public async up(q: QueryRunner): Promise<void> {
    const problems: string[] = [];
    for (const fk of FKS) {
      const rows: Array<{ n: number | string }> = await q.query(
        `SELECT count(*)::int AS n FROM ${fk.table} t ` +
          `LEFT JOIN ${fk.refTable} r ON r.id = t.${fk.column} ` +
          `WHERE t.${fk.column} IS NOT NULL AND r.id IS NULL`,
      );
      const n = Number(rows?.[0]?.n ?? 0);
      if (n > 0) problems.push(`${fk.table}.${fk.column}: ${n} row(s) point at a missing ${fk.refTable} row`);
    }
    if (problems.length) {
      throw new Error(
        'PurchaseForeignKeys1720000060000: dangling references must be fixed before the foreign keys can be added ' +
          '(scripts/ops/migration-preflight.sh lists the rows):\n  - ' +
          problems.join('\n  - '),
      );
    }

    await q.query(`ALTER TABLE purchase_orders ADD CONSTRAINT fk_purchase_orders_supplier
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)`);
    await q.query(`ALTER TABLE purchase_order_items ADD CONSTRAINT fk_purchase_order_items_material
      FOREIGN KEY (material_id) REFERENCES materials(id)`);
    await q.query(`ALTER TABLE goods_receipts ADD CONSTRAINT fk_goods_receipts_supplier
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)`);
    await q.query(`ALTER TABLE goods_receipt_items ADD CONSTRAINT fk_goods_receipt_items_po_item
      FOREIGN KEY (purchase_order_item_id) REFERENCES purchase_order_items(id)`);
    await q.query(`ALTER TABLE goods_receipt_items ADD CONSTRAINT fk_goods_receipt_items_material
      FOREIGN KEY (material_id) REFERENCES materials(id)`);
    await q.query(`ALTER TABLE vendor_bills ADD CONSTRAINT fk_vendor_bills_supplier
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)`);
    await q.query(`ALTER TABLE vendor_bill_items ADD CONSTRAINT fk_vendor_bill_items_po_item
      FOREIGN KEY (purchase_order_item_id) REFERENCES purchase_order_items(id)`);
    await q.query(`ALTER TABLE vendor_bill_items ADD CONSTRAINT fk_vendor_bill_items_material
      FOREIGN KEY (material_id) REFERENCES materials(id)`);
    await q.query(`ALTER TABLE vendor_payments ADD CONSTRAINT fk_vendor_payments_supplier
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const fk of [...FKS].reverse()) {
      await q.query(`ALTER TABLE ${fk.table} DROP CONSTRAINT IF EXISTS ${fk.constraint}`);
    }
  }
}
