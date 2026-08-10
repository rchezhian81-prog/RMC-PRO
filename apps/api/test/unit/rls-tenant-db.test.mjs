/**
 * Unit tests for TenantDbService — the enforcement point for PostgreSQL
 * Row-Level Security. Every tenant-scoped read/write goes through `runInTenant`,
 * which must, on the SAME connection that will run the work:
 *
 *   1. open a transaction,
 *   2. set `app.current_tenant_id` TRANSACTION-LOCALLY (set_config(…, true)) so
 *      the GUC can never leak to the next borrower of a pooled connection,
 *   3. pass the tenant id as a BOUND PARAMETER (never string-interpolated),
 *   4. then run the work — so the RLS policy sees the tenant before any row is
 *      touched.
 *
 * `runAsPlatform` is the deliberate cross-tenant escape hatch and must set
 * `app.platform='on'` instead. These invariants are the whole isolation story,
 * so they are asserted directly against a fake DataSource — no live Postgres.
 * (The DB-backed proof that RLS actually filters rows lives in the
 * rls-isolation integration test; this pins the client-side contract that feeds
 * it, fast.)
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TenantDbService } from '../../dist/core/database/tenant-db.service.js';

/**
 * Fake DataSource that records every query in order and hands the callback a
 * single manager, so we can assert both WHAT ran and the ORDER it ran in — and
 * that the work shares the manager the GUC was set on.
 */
function fakeDataSource() {
  const queries = [];
  let txDepth = 0;
  let maxTxDepth = 0;
  const manager = {
    query: async (sql, params) => {
      queries.push({ sql, params, insideTx: txDepth > 0 });
      return { sql, params };
    },
  };
  const ds = {
    queries,
    manager,
    get openedTransaction() {
      return maxTxDepth > 0;
    },
    transaction: async (cb) => {
      txDepth += 1;
      maxTxDepth = Math.max(maxTxDepth, txDepth);
      try {
        return await cb(manager);
      } finally {
        txDepth -= 1;
      }
    },
  };
  return ds;
}

const setConfigOf = (q) => {
  const m = /set_config\('([^']+)',\s*(\$\d+|'[^']*')/.exec(q.sql);
  return m ? { key: m[1], valueToken: m[2] } : null;
};

test('runInTenant opens a transaction and sets app.current_tenant_id before the work', async () => {
  const ds = fakeDataSource();
  const svc = new TenantDbService(ds);

  await svc.runInTenant('tenant-123', async (m) => m.query('SELECT 1'));

  assert.equal(ds.openedTransaction, true, 'work runs inside a transaction');
  assert.equal(ds.queries.length, 2, 'set_config then the work query');

  const cfg = setConfigOf(ds.queries[0]);
  assert.ok(cfg, 'first statement is a set_config');
  assert.equal(cfg.key, 'app.current_tenant_id', 'sets the tenant GUC the RLS policy reads');
  assert.equal(ds.queries[1].sql, 'SELECT 1', 'the work runs AFTER the GUC is set');
  assert.ok(ds.queries[0].insideTx && ds.queries[1].insideTx, 'both run inside the same transaction');
});

test('runInTenant scopes the GUC to the transaction (set_config local flag = true)', async () => {
  const ds = fakeDataSource();
  const svc = new TenantDbService(ds);

  await svc.runInTenant('tenant-123', async () => 'done');

  // A session-level GUC (local=false) would survive the transaction and leak to
  // the next request that borrows this pooled connection — a cross-tenant leak.
  assert.match(
    ds.queries[0].sql,
    /set_config\('app\.current_tenant_id',\s*\$1,\s*true\)/,
    'the third arg to set_config must be true (transaction-local)',
  );
});

test('runInTenant binds the tenant id as a parameter and never interpolates it', async () => {
  const ds = fakeDataSource();
  const svc = new TenantDbService(ds);

  const evil = "abc'; RESET app.current_tenant_id; --";
  await svc.runInTenant(evil, async () => null);

  const q = ds.queries[0];
  assert.deepEqual(q.params, [evil], 'tenant id is passed via the parameter array');
  assert.ok(!q.sql.includes(evil), 'tenant id text never appears in the SQL string');
  assert.match(q.sql, /\$1/, 'the value is referenced as a bound placeholder');
});

test('runInTenant runs the work on the same manager and returns its result', async () => {
  const ds = fakeDataSource();
  const svc = new TenantDbService(ds);

  let seenManager;
  const result = await svc.runInTenant('t', async (m) => {
    seenManager = m;
    return 42;
  });

  assert.equal(result, 42, 'the callback result is propagated');
  assert.equal(seenManager, ds.manager, 'work receives the connection the GUC was set on');
});

test('runAsPlatform sets app.platform=on (the cross-tenant escape hatch) and returns the result', async () => {
  const ds = fakeDataSource();
  const svc = new TenantDbService(ds);

  const result = await svc.runAsPlatform(async (m) => {
    await m.query('SELECT * FROM users');
    return 'ok';
  });

  assert.equal(result, 'ok');
  assert.equal(ds.openedTransaction, true);
  const cfg = setConfigOf(ds.queries[0]);
  assert.equal(cfg.key, 'app.platform', 'platform context, not a tenant GUC');
  assert.match(ds.queries[0].sql, /set_config\('app\.platform',\s*'on'/, "value is 'on'");
  assert.equal(ds.queries[1].sql, 'SELECT * FROM users', 'work runs after the platform context is set');
});

test('runAsPlatform never sets a tenant GUC (it is deliberately unscoped)', async () => {
  const ds = fakeDataSource();
  const svc = new TenantDbService(ds);
  await svc.runAsPlatform(async () => null);
  assert.ok(
    !ds.queries.some((q) => q.sql.includes('app.current_tenant_id')),
    'the platform path must not set app.current_tenant_id',
  );
});

test('the ds getter exposes the injected DataSource', () => {
  const ds = fakeDataSource();
  const svc = new TenantDbService(ds);
  assert.equal(svc.ds, ds);
});
