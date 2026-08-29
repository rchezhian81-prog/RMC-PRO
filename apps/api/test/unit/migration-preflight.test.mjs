/**
 * Unit tests for the migration-preflight source of truth
 * (core/database/integrity-constraints.ts).
 *
 * Two things are pinned:
 *   1. The violation-query builders emit the exact SQL the preflight runs.
 *   2. A DRIFT GUARD: the declarative constraint list stays in lock-step with the
 *      migration that actually adds the constraints
 *      (1720000016000-DataIntegrityChecks). If a future migration adds a
 *      chk_*_nonneg CHECK or an FK the preflight doesn't know about, this fails —
 *      so the deploy gate can never silently miss a new constraint.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  NONNEG_CONSTRAINTS,
  FK_CONSTRAINTS,
  UNIQUE_CONSTRAINTS,
  nonNegViolationPredicate,
  nonNegViolationQuery,
  nonNegCountQuery,
  fkViolationQuery,
  fkCountQuery,
  uniqueCountQuery,
  uniqueViolationQuery,
  tableExistsQuery,
} from '../../dist/core/database/integrity-constraints.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationSrc = readFileSync(
  resolve(here, '../../src/core/database/migrations/1720000016000-DataIntegrityChecks.ts'),
  'utf8',
);
const migrationsDir = resolve(here, '../../src/core/database/migrations/');
const allMigrations = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => readFileSync(resolve(migrationsDir, f), 'utf8'))
  .join('\n');

const byTable = (list, table) => list.find((c) => c.table === table);

// ── query builders ───────────────────────────────────────────────────────────

test('nonNegViolationPredicate ORs a "< 0" test across every column', () => {
  const customers = byTable(NONNEG_CONSTRAINTS, 'customers');
  assert.equal(nonNegViolationPredicate(customers), 'credit_limit < 0 OR credit_days < 0');
});

test('nonNegViolationQuery selects the full offending rows', () => {
  const customers = byTable(NONNEG_CONSTRAINTS, 'customers');
  assert.equal(
    nonNegViolationQuery(customers),
    'SELECT * FROM customers WHERE credit_limit < 0 OR credit_days < 0',
  );
});

test('nonNegCountQuery counts offending rows as an int alias "violations"', () => {
  const customers = byTable(NONNEG_CONSTRAINTS, 'customers');
  assert.equal(
    nonNegCountQuery(customers),
    'SELECT count(*)::int AS violations FROM customers WHERE credit_limit < 0 OR credit_days < 0',
  );
});

test('fk queries find rows whose FK points at a missing parent', () => {
  const fk = FK_CONSTRAINTS[0]; // vehicles.driver_id -> drivers.id
  assert.equal(
    fkViolationQuery(fk),
    'SELECT t.* FROM vehicles t LEFT JOIN drivers r ON r.id = t.driver_id ' +
      'WHERE t.driver_id IS NOT NULL AND r.id IS NULL',
  );
  assert.equal(
    fkCountQuery(fk),
    'SELECT count(*)::int AS violations FROM vehicles t LEFT JOIN drivers r ON r.id = t.driver_id ' +
      'WHERE t.driver_id IS NOT NULL AND r.id IS NULL',
  );
});

test('tableExistsQuery uses to_regclass so a missing table is null, not an error', () => {
  assert.equal(tableExistsQuery('customers'), "SELECT to_regclass('public.customers') AS oid");
});

test('uniqueCountQuery counts duplicate groups under the partial predicate', () => {
  const wb = UNIQUE_CONSTRAINTS.find((c) => c.table === 'material_inwards');
  assert.ok(wb, 'material_inwards unique constraint must be covered');
  assert.equal(
    uniqueCountQuery(wb),
    "SELECT count(*)::int AS violations FROM (SELECT weighbridge_entry_id FROM material_inwards " +
      "WHERE weighbridge_entry_id IS NOT NULL AND status <> 'cancelled' " +
      'GROUP BY weighbridge_entry_id HAVING count(*) > 1) d',
  );
  assert.match(uniqueViolationQuery(wb), /HAVING count\(\*\) > 1$/);
});

test('the customers non-negativity check is present (the constraint that caused the outage)', () => {
  const customers = byTable(NONNEG_CONSTRAINTS, 'customers');
  assert.ok(customers, 'customers must be covered');
  assert.equal(customers.constraint, 'chk_customers_nonneg');
  assert.deepEqual(customers.columns, ['credit_limit', 'credit_days']);
});

// ── drift guard vs the migration ─────────────────────────────────────────────

test('every declared non-negativity constraint matches the migration (name + columns)', () => {
  for (const c of NONNEG_CONSTRAINTS) {
    assert.match(
      migrationSrc,
      new RegExp(`ALTER TABLE ${c.table} ADD CONSTRAINT ${c.constraint}`),
      `${c.constraint} must be added on ${c.table} in the migration`,
    );
    for (const col of c.columns) {
      assert.match(
        migrationSrc,
        new RegExp(`${col}\\s*>=\\s*0`),
        `${c.table}.${col} must be constrained >= 0 in the migration`,
      );
    }
  }
});

test('every declared FK constraint matches the migration', () => {
  for (const c of FK_CONSTRAINTS) {
    assert.match(migrationSrc, new RegExp(`ADD CONSTRAINT ${c.constraint}`));
    assert.match(
      migrationSrc,
      new RegExp(`FOREIGN KEY \\(${c.column}\\)\\s*REFERENCES ${c.refTable}\\(${c.refColumn}\\)`),
      `${c.constraint} must reference ${c.refTable}(${c.refColumn})`,
    );
  }
});

test('every declared unique constraint is created by a migration', () => {
  assert.ok(UNIQUE_CONSTRAINTS.length >= 2, 'sanity: unique constraints declared');
  for (const c of UNIQUE_CONSTRAINTS) {
    assert.match(
      allMigrations,
      new RegExp(`CREATE UNIQUE INDEX "${c.constraint}"`),
      `${c.constraint} must be created by a migration, or the preflight guards a constraint that does not exist`,
    );
  }
});

test('DRIFT GUARD: no partial UNIQUE index in the migrations is missing from the preflight', () => {
  // Reverse direction: a CREATE UNIQUE INDEX ... WHERE (a partial unique, which
  // a duplicate row could abort) that the preflight does not know about would
  // let the deploy gate silently miss it. Catch that.
  const declared = new Set(UNIQUE_CONSTRAINTS.map((c) => c.constraint));
  // `[^`]*?` keeps the match inside the one SQL template literal, so a plain
  // (non-partial) CREATE UNIQUE INDEX in another statement is never mis-flagged.
  const partialUnique = [...allMigrations.matchAll(/CREATE UNIQUE INDEX "([\w]+)"[^`]*?WHERE/g)].map((m) => m[1]);
  for (const name of partialUnique) {
    assert.ok(
      declared.has(name),
      `${name} is a partial UNIQUE index in a migration but missing from UNIQUE_CONSTRAINTS — the preflight would not catch violations of it`,
    );
  }
});

test('DRIFT GUARD: no chk_*_nonneg constraint in the migration is missing from the preflight', () => {
  // Reverse direction: if someone adds a new nonneg CHECK to the migration but
  // forgets the preflight, the deploy gate would silently skip it. Catch that.
  const declared = new Set(NONNEG_CONSTRAINTS.map((c) => c.constraint));
  const inMigration = [...migrationSrc.matchAll(/ADD CONSTRAINT (chk_\w+_nonneg)\b/g)].map(
    (m) => m[1],
  );
  assert.ok(inMigration.length >= NONNEG_CONSTRAINTS.length, 'sanity: migration parsed');
  for (const name of inMigration) {
    assert.ok(
      declared.has(name),
      `${name} is enforced by the migration but missing from NONNEG_CONSTRAINTS — the preflight would not catch violations of it`,
    );
  }
});
