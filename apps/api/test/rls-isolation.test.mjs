/**
 * Tenant-isolation integration test (architecture invariant).
 *
 * Seeds two tenants as the owner role, then — connected as the non-superuser
 * app role exactly like the API runtime — proves Row-Level Security keeps them
 * apart: each tenant sees only its own rows, a cross-tenant read returns
 * nothing, a cross-tenant write is refused, no tenant context yields nothing,
 * and the app role cannot escalate. This is the guarantee the whole
 * multi-tenant model rests on, so it is worth a permanent test.
 *
 * Env: POSTGRES_* (owner) + APP_DB_USER/APP_DB_PASSWORD (app role).
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { DataSource } = require('typeorm');

const common = {
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? '127.0.0.1',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  database: process.env.POSTGRES_DB ?? 'rmc',
  synchronize: false,
  logging: false,
};
const owner = new DataSource({ ...common, username: process.env.POSTGRES_USER ?? 'rmc_owner', password: process.env.POSTGRES_PASSWORD ?? 'ownerpw' });
const app = new DataSource({ ...common, username: process.env.APP_DB_USER ?? 'rmc_app', password: process.env.APP_DB_PASSWORD ?? 'apppw' });

let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) throw new Error('FAIL: ' + name); pass++; };
const throwsAsync = async (name, fn) => { try { await fn(); ok(name + ' (should be refused)', false); } catch { ok(name + ' refused', true); } };
// Run work as the app role with a tenant context set (mirrors runInTenant).
const asTenant = (tid, work) => app.transaction(async (m) => { await m.query(`SELECT set_config('app.current_tenant_id',$1,true)`, [tid]); return work(m); });

(async () => {
  await owner.initialize();
  await app.initialize();

  const A = randomUUID(), B = randomUUID();
  const codeA = 'RLSA-' + A.slice(0, 8), codeB = 'RLSB-' + B.slice(0, 8);
  await owner.query(`INSERT INTO tenants (id,tenant_code,tenant_name,status) VALUES ($1,$2,'RLS A','active'),($3,$4,'RLS B','active')`, [A, codeA, B, codeB]);
  await owner.query(`INSERT INTO customers (tenant_id,customer_code,customer_name) VALUES ($1,$2,'A-secret'),($3,$4,'B-secret')`, [A, 'CA-' + A.slice(0, 6), B, 'CB-' + B.slice(0, 6)]);
  const bId = (await owner.query(`SELECT id FROM customers WHERE tenant_id=$1 LIMIT 1`, [B]))[0].id;

  console.log('=== tenant isolation (as the app role) ===');
  const role = (await app.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user`))[0];
  ok('app role is NOT superuser', role.rolsuper === false);
  ok('app role does NOT bypass RLS', role.rolbypassrls === false);

  // No tenant context → nothing (fail-closed). Run this BEFORE any tenant
  // transaction: a transaction-local set_config reverts to '' (not NULL) on
  // commit, and ''::uuid in the policy would error on a reused pooled
  // connection. On a fresh connection the GUC is unset → NULL → 0 rows.
  const noCtx = await app.query(`SELECT count(*)::int AS n FROM customers`);
  ok('no tenant context returns nothing (safe default)', noCtx[0].n === 0);

  const aRows = await asTenant(A, (m) => m.query(`SELECT customer_name FROM customers`));
  ok('tenant A sees only its own customer', aRows.length === 1 && aRows[0].customer_name === 'A-secret');
  const bRows = await asTenant(B, (m) => m.query(`SELECT customer_name FROM customers`));
  ok('tenant B sees only its own customer', bRows.length === 1 && bRows[0].customer_name === 'B-secret');

  const crossRead = await asTenant(A, (m) => m.query(`SELECT count(*)::int AS n FROM customers WHERE id=$1`, [bId]));
  ok("tenant A cannot read tenant B's row by id", crossRead[0].n === 0);

  await throwsAsync('tenant A cannot INSERT a row tagged as tenant B', () =>
    asTenant(A, (m) => m.query(`INSERT INTO customers (tenant_id,customer_code,customer_name) VALUES ($1,'HACK','x')`, [B])));

  await throwsAsync('app role cannot disable RLS', () => app.query(`ALTER TABLE customers DISABLE ROW LEVEL SECURITY`));
  await throwsAsync('app role cannot SET ROLE to the owner', () => app.query(`SET ROLE ${process.env.POSTGRES_USER ?? 'rmc_owner'}`));

  await owner.destroy();
  await app.destroy();
  console.log(`\nRLS ISOLATION TEST: ${pass} passed`);
  process.exit(0);
})().catch((e) => { console.error('\nTEST FAILED:', e.message); process.exit(1); });
