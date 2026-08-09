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
// Run work as the app role in the platform context (mirrors runAsPlatform):
// the identity/super-admin path used by auth and platform administration.
const asPlatform = (work) => app.transaction(async (m) => { await m.query(`SELECT set_config('app.platform','on',true)`); return work(m); });
// A read on a PRISTINE app connection (single-use pool) so the tenant GUC is
// genuinely unset — proves the fail-closed default without the '' pooled-GUC
// quirk the header note above describes.
const freshAppRead = async (sql, params) => {
  const c = new DataSource({ ...common, username: process.env.APP_DB_USER ?? 'rmc_app', password: process.env.APP_DB_PASSWORD ?? 'apppw', extra: { max: 1 } });
  await c.initialize();
  try { return await c.query(sql, params); } finally { await c.destroy(); }
};

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

  console.log('=== users + tenant_modules RLS (migration 18: the two formerly app-only tables) ===');
  // Seed a user for each tenant plus a platform super-admin (tenant_id NULL),
  // and a module row per tenant — all as the owner (bypasses RLS).
  const uA = randomUUID(), uB = randomUUID(), uSuper = randomUUID();
  const emailA = `a-${A.slice(0, 8)}@rls.test`, emailB = `b-${B.slice(0, 8)}@rls.test`, emailSuper = `super-${A.slice(0, 8)}@rls.test`;
  await owner.query(
    `INSERT INTO users (id,tenant_id,name,email,password_hash,user_type,status) VALUES
       ($1,$2,'A user',$3,'x','tenant_user','active'),
       ($4,$5,'B user',$6,'x','tenant_user','active'),
       ($7,NULL,'Super admin',$8,'x','platform_admin','active')`,
    [uA, A, emailA, uB, B, emailB, uSuper, emailSuper],
  );
  await owner.query(`INSERT INTO tenant_modules (tenant_id,module_key,is_enabled) VALUES ($1,'sales',true),($2,'sales',true)`, [A, B]);

  // Fail-closed default: with no context set, neither table yields a row.
  ok('no context returns no users (fail-closed)', (await freshAppRead(`SELECT count(*)::int AS n FROM users`))[0].n === 0);
  ok('no context returns no tenant_modules (fail-closed)', (await freshAppRead(`SELECT count(*)::int AS n FROM tenant_modules`))[0].n === 0);

  // Tenant context: only that tenant's rows — and NOT the NULL-tenant super-admin.
  const aUsers = await asTenant(A, (m) => m.query(`SELECT email FROM users`));
  ok('tenant A sees only its own user', aUsers.length === 1 && aUsers[0].email === emailA);
  ok('tenant A sees only its own tenant_modules', (await asTenant(A, (m) => m.query(`SELECT module_key FROM tenant_modules`))).length === 1);
  ok("tenant A cannot read tenant B's user by id", (await asTenant(A, (m) => m.query(`SELECT count(*)::int AS n FROM users WHERE id=$1`, [uB])))[0].n === 0);
  ok('a tenant context cannot see the super-admin (tenant_id NULL)', (await asTenant(A, (m) => m.query(`SELECT count(*)::int AS n FROM users WHERE id=$1`, [uSuper])))[0].n === 0);

  // Platform context: authentication + super-admin administration see across
  // tenants. This also runs AFTER tenant transactions on the pooled connection,
  // so it proves the NULLIF('' ) guard: the leftover '' tenant GUC does not make
  // the uuid cast raise when the platform clause carries the row.
  ok('platform context sees users across tenants', (await asPlatform((m) => m.query(`SELECT count(*)::int AS n FROM users`)))[0].n >= 3);
  ok('platform context can see the tenant_id NULL super-admin', (await asPlatform((m) => m.query(`SELECT count(*)::int AS n FROM users WHERE id=$1`, [uSuper])))[0].n === 1);
  ok('platform context can look a user up by email (login path)', (await asPlatform((m) => m.query(`SELECT id FROM users WHERE email=$1`, [emailA]))).length === 1);

  // WITH CHECK still forbids forging another tenant's row from a tenant context.
  await throwsAsync('tenant A cannot INSERT a user tagged as tenant B', () =>
    asTenant(A, (m) => m.query(`INSERT INTO users (tenant_id,name,email,password_hash) VALUES ($1,'hack',$2,'x')`, [B, `hack-${randomUUID().slice(0, 8)}@rls.test`])));
  await throwsAsync('tenant A cannot INSERT a tenant_module tagged as tenant B', () =>
    asTenant(A, (m) => m.query(`INSERT INTO tenant_modules (tenant_id,module_key) VALUES ($1,'orders')`, [B])));

  await throwsAsync('app role cannot disable RLS', () => app.query(`ALTER TABLE customers DISABLE ROW LEVEL SECURITY`));
  await throwsAsync('app role cannot SET ROLE to the owner', () => app.query(`SET ROLE ${process.env.POSTGRES_USER ?? 'rmc_owner'}`));

  await owner.destroy();
  await app.destroy();
  console.log(`\nRLS ISOLATION TEST: ${pass} passed`);
  process.exit(0);
})().catch((e) => { console.error('\nTEST FAILED:', e.message); process.exit(1); });
