import 'reflect-metadata';
import type { DataSource } from 'typeorm';
import { AppDataSource } from './data-source';
import {
  FK_CONSTRAINTS,
  NONNEG_CONSTRAINTS,
  UNIQUE_CONSTRAINTS,
  fkCountQuery,
  nonNegCountQuery,
  nonNegViolationPredicate,
  tableExistsQuery,
  uniqueCountQuery,
  uniqueViolationQuery,
} from './integrity-constraints';

/**
 * Read-only deploy gate. Checks the LIVE data against the integrity constraints
 * the migrations will enforce (see integrity-constraints.ts) and reports any row
 * that would make a constraint-adding ALTER fail — BEFORE the deploy runs the
 * `migrate` step. Run it while the old app is still serving; if it fails, fix the
 * data (or roll back) rather than deploying into a migrate abort that blocks the
 * API.
 *
 * Connects as the OWNER role via AppDataSource, so it sees every tenant's rows
 * (RLS bypassed) exactly as the migration's ALTER would.
 *
 * Exit codes:  0 = safe to migrate · 1 = violations found (fix first) ·
 *              2 = preflight could not run (fail closed — do not deploy).
 *
 * Usage on the box (via the migrate service's env):
 *   scripts/ops/migration-preflight.sh
 * or directly:
 *   node dist/core/database/migration-preflight.js
 */

const SAMPLE_LIMIT = 20;
const log = (msg: string): void => console.log(`[preflight] ${msg}`);

async function tableExists(ds: DataSource, table: string): Promise<boolean> {
  const rows: Array<{ oid: string | null }> = await ds.query(tableExistsQuery(table));
  return rows?.[0]?.oid != null;
}

async function run(ds: DataSource): Promise<number> {
  let violations = 0;
  const skipped: string[] = [];

  for (const c of NONNEG_CONSTRAINTS) {
    if (!(await tableExists(ds, c.table))) {
      skipped.push(`${c.table} (table not present yet)`);
      continue;
    }
    const n = Number((await ds.query(nonNegCountQuery(c)))[0].violations);
    if (n > 0) {
      violations += n;
      log(`FAIL  ${c.table}.${c.constraint} (${c.columns.join(', ')}) — ${n} row(s) below zero`);
      const cols = ['id', ...c.columns].join(', ');
      const sample = await ds.query(
        `SELECT ${cols} FROM ${c.table} WHERE ${nonNegViolationPredicate(c)} LIMIT ${SAMPLE_LIMIT}`,
      );
      console.table(sample);
    } else {
      log(`ok    ${c.table}.${c.constraint}`);
    }
  }

  for (const c of FK_CONSTRAINTS) {
    if (!(await tableExists(ds, c.table)) || !(await tableExists(ds, c.refTable))) {
      skipped.push(`${c.table}.${c.column} (table not present yet)`);
      continue;
    }
    const n = Number((await ds.query(fkCountQuery(c)))[0].violations);
    if (n > 0) {
      violations += n;
      log(
        `FAIL  ${c.table}.${c.constraint} (${c.column} -> ${c.refTable}.${c.refColumn}) — ${n} orphan row(s)`,
      );
      const sample = await ds.query(
        `SELECT t.id, t.${c.column} FROM ${c.table} t ` +
          `LEFT JOIN ${c.refTable} r ON r.${c.refColumn} = t.${c.column} ` +
          `WHERE t.${c.column} IS NOT NULL AND r.${c.refColumn} IS NULL LIMIT ${SAMPLE_LIMIT}`,
      );
      console.table(sample);
    } else {
      log(`ok    ${c.table}.${c.constraint}`);
    }
  }

  for (const c of UNIQUE_CONSTRAINTS) {
    if (!(await tableExists(ds, c.table))) {
      skipped.push(`${c.table} (table not present yet)`);
      continue;
    }
    const n = Number((await ds.query(uniqueCountQuery(c)))[0].violations);
    if (n > 0) {
      violations += n;
      log(`FAIL  ${c.table}.${c.constraint} (${c.columns.join(', ')}) — ${n} duplicate group(s)`);
      console.table(await ds.query(`${uniqueViolationQuery(c)} LIMIT ${SAMPLE_LIMIT}`));
    } else {
      log(`ok    ${c.table}.${c.constraint}`);
    }
  }

  if (skipped.length) log(`skipped: ${skipped.join('; ')}`);

  if (violations > 0) {
    log(`FAIL — ${violations} row(s) violate a constraint the migration will enforce.`);
    log(
      'Fix the data shown above (or roll back the deploy), THEN migrate. Deploying now ' +
        'would abort the migrate step and leave the API unable to start.',
    );
  } else {
    log('PASS — all data satisfies the integrity constraints. Safe to migrate.');
  }
  return violations > 0 ? 1 : 0;
}

async function main(): Promise<number> {
  log('Mix Nova RMC — migration data-integrity preflight (read-only)');
  const ds = await AppDataSource.initialize();
  try {
    return await run(ds);
  } finally {
    await ds.destroy();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    // Fail closed: if the check could not complete, do not green-light a deploy.
    console.error('[preflight] ERROR — preflight could not run:', err instanceof Error ? err.message : err);
    process.exit(2);
  });
