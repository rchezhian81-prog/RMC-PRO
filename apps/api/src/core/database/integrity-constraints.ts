/**
 * The DB data-integrity constraints, expressed as DATA so a deploy can check the
 * live rows against them BEFORE the migration that adds them runs.
 *
 * Why this exists: a constraint-adding migration (see
 * `DataIntegrityChecks1720000016000`) runs inside the deploy's one-shot `migrate`
 * step, and `api` only starts once `migrate` completes. If an existing row
 * violates a new CHECK/FK, the ALTER aborts, `migrate` exits non-zero, and the
 * API never starts — a full outage discovered only *after* the deploy has torn
 * the old app down. This module lets `migration-preflight.ts` detect exactly that
 * data, read-only, while the old app is still serving, so the deploy can be
 * stopped and the data fixed first.
 *
 * SINGLE SOURCE OF TRUTH: keep this in lock-step with the constraint migrations.
 * When a future migration adds a CHECK or FK that an existing row could violate,
 * add it here too — the preflight (scripts/ops/migration-preflight.sh) then
 * guards the next deploy, and a unit test asserts the two never drift.
 *
 * Column names are the DB (snake_case) names, matching the migration SQL.
 */

/** A non-negativity CHECK: every listed column must be `>= 0` on every row. */
export interface NonNegConstraint {
  /** Table the CHECK is attached to. */
  table: string;
  /** DB constraint name, so operators can cross-reference the migration. */
  constraint: string;
  /** Columns that must each be `>= 0`. */
  columns: string[];
}

/**
 * Mirrors `DataIntegrityChecks1720000016000.up()`. Order matches the migration so
 * a preflight report reads in the same sequence a failing migrate would.
 */
export const NONNEG_CONSTRAINTS: NonNegConstraint[] = [
  {
    table: 'invoices',
    constraint: 'chk_invoices_nonneg',
    columns: [
      'taxable_amount',
      'cgst_amount',
      'sgst_amount',
      'igst_amount',
      'cess_amount',
      'total_amount',
      'amount_paid',
    ],
  },
  {
    table: 'invoice_items',
    constraint: 'chk_invoice_items_nonneg',
    columns: [
      'quantity',
      'rate',
      'taxable_amount',
      'gst_rate',
      'cgst_amount',
      'sgst_amount',
      'igst_amount',
      'cess_amount',
      'line_total',
    ],
  },
  {
    table: 'payments',
    constraint: 'chk_payments_nonneg',
    columns: ['amount', 'allocated_amount', 'unallocated_amount'],
  },
  {
    table: 'payment_allocations',
    constraint: 'chk_payment_allocations_nonneg',
    columns: ['allocated_amount'],
  },
  {
    table: 'customers',
    constraint: 'chk_customers_nonneg',
    columns: ['credit_limit', 'credit_days'],
  },
  {
    table: 'materials',
    constraint: 'chk_materials_nonneg',
    columns: ['minimum_stock', 'reorder_level', 'standard_rate'],
  },
  {
    table: 'vehicles',
    constraint: 'chk_vehicles_nonneg',
    columns: ['capacity_m3'],
  },
];

/** A referential-integrity FK: `column` must point at an existing `refTable` row. */
export interface ForeignKeyConstraint {
  table: string;
  column: string;
  refTable: string;
  refColumn: string;
  constraint: string;
}

export const FK_CONSTRAINTS: ForeignKeyConstraint[] = [
  {
    table: 'vehicles',
    column: 'driver_id',
    refTable: 'drivers',
    refColumn: 'id',
    constraint: 'fk_vehicles_driver',
  },
];

/**
 * A (partial) UNIQUE index: the listed `columns` must be unique across the rows
 * matching `predicate`. A duplicate group would make the CREATE UNIQUE INDEX
 * abort, so the preflight must be able to find one.
 */
export interface UniqueConstraint {
  table: string;
  columns: string[];
  /** Row filter the index is partial over (the index's WHERE clause). */
  predicate: string;
  constraint: string;
}

export const UNIQUE_CONSTRAINTS: UniqueConstraint[] = [
  {
    // One live material inward per weighbridge entry — a repeat conversion would
    // double-count the same truck's material into stock.
    table: 'material_inwards',
    columns: ['weighbridge_entry_id'],
    predicate: "weighbridge_entry_id IS NOT NULL AND status <> 'cancelled'",
    constraint: 'uq_material_inwards_weighbridge_entry',
  },
  {
    // One live dispatch per batch ticket — each dispatch claims the ticket's full
    // batched quantity, so a second would double the delivered/billable volume.
    table: 'dispatches',
    columns: ['batch_ticket_id'],
    predicate: "batch_ticket_id IS NOT NULL AND dispatch_status NOT IN ('cancelled', 'rejected')",
    constraint: 'uq_dispatches_batch_ticket',
  },
  {
    // One numbering series per (tenant, document type, plant, financial year).
    // GROUP BY treats NULL plant/FY as equal — matching the index's NULLS NOT
    // DISTINCT — so a cold-start-race duplicate (or a hand-created shadow series)
    // is caught here before the CREATE UNIQUE INDEX would abort the migration.
    table: 'number_series',
    columns: ['tenant_id', 'document_type', 'plant_id', 'financial_year'],
    predicate: 'true',
    constraint: 'uq_number_series_key',
  },
  {
    // One live challan per dispatch (Tier-1B) — a second challan for the same
    // load would double the billable candidates.
    table: 'delivery_challans',
    columns: ['dispatch_id'],
    predicate: "dispatch_id IS NOT NULL AND challan_status <> 'cancelled'",
    constraint: 'uq_delivery_challans_dispatch',
  },
  {
    // One live queue entry per order line (Tier-1B) — the order path dedupes;
    // this also backstops the plan path and any race into double batching.
    table: 'batch_queue',
    columns: ['order_item_id'],
    predicate: "order_item_id IS NOT NULL AND queue_status <> 'cancelled'",
    constraint: 'uq_batch_queue_order_item',
  },
  {
    // One live bill per supplier invoice number (Tier-1B) — the double-payable /
    // double-ITC guard, backstopping the service-level duplicate check.
    table: 'vendor_bills',
    columns: ['tenant_id', 'supplier_id', 'supplier_bill_no'],
    predicate: "supplier_bill_no IS NOT NULL AND status <> 'cancelled'",
    constraint: 'uq_vendor_bills_supplier_billno',
  },
];

/** `WHERE` predicate that is TRUE for a row violating the non-negativity rule. */
export function nonNegViolationPredicate(c: NonNegConstraint): string {
  return c.columns.map((col) => `${col} < 0`).join(' OR ');
}

/** Rows that would fail `c` — full rows, so an operator can see what to fix. */
export function nonNegViolationQuery(c: NonNegConstraint): string {
  return `SELECT * FROM ${c.table} WHERE ${nonNegViolationPredicate(c)}`;
}

/** Fast count of rows that would fail `c`. */
export function nonNegCountQuery(c: NonNegConstraint): string {
  return `SELECT count(*)::int AS violations FROM ${c.table} WHERE ${nonNegViolationPredicate(c)}`;
}

/** Rows whose FK column points at a missing parent (would fail the FK add). */
export function fkViolationQuery(c: ForeignKeyConstraint): string {
  return (
    `SELECT t.* FROM ${c.table} t ` +
    `LEFT JOIN ${c.refTable} r ON r.${c.refColumn} = t.${c.column} ` +
    `WHERE t.${c.column} IS NOT NULL AND r.${c.refColumn} IS NULL`
  );
}

/** Fast count of FK-orphan rows. */
export function fkCountQuery(c: ForeignKeyConstraint): string {
  return (
    `SELECT count(*)::int AS violations FROM ${c.table} t ` +
    `LEFT JOIN ${c.refTable} r ON r.${c.refColumn} = t.${c.column} ` +
    `WHERE t.${c.column} IS NOT NULL AND r.${c.refColumn} IS NULL`
  );
}

/** The duplicate groups that would fail the unique index — each listed once. */
export function uniqueViolationQuery(c: UniqueConstraint): string {
  const cols = c.columns.join(', ');
  return (
    `SELECT ${cols}, count(*)::int AS copies FROM ${c.table} ` +
    `WHERE ${c.predicate} GROUP BY ${cols} HAVING count(*) > 1`
  );
}

/** Fast count of duplicate groups (rows sharing the key under the predicate). */
export function uniqueCountQuery(c: UniqueConstraint): string {
  const cols = c.columns.join(', ');
  return (
    `SELECT count(*)::int AS violations FROM (` +
    `SELECT ${cols} FROM ${c.table} WHERE ${c.predicate} ` +
    `GROUP BY ${cols} HAVING count(*) > 1) d`
  );
}

/** Guard used before querying a table that a very old schema might not have yet. */
export function tableExistsQuery(table: string): string {
  return `SELECT to_regclass('public.${table}') AS oid`;
}
