/**
 * RLS drift guard (Tier-2B): every table that carries a `tenant_id` MUST have
 * Row-Level Security ENABLED and FORCED, with a tenant-isolation policy. RLS is
 * added table-by-table by each migration author, so a new tenant table that
 * forgets `ENABLE/FORCE ROW LEVEL SECURITY` + a policy would silently leak
 * across tenants — exactly the class of bug migration 18 was created to close.
 * This asserts the invariant against the live schema, so such an omission fails
 * CI instead of shipping.
 *
 * Connects to the DB directly (owner role) via the env the integration harness
 * already provides; reads only the catalog, changes nothing.
 */
import pg from 'pg';

let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) throw new Error('FAIL: ' + name); pass++; };

const env = process.env;
const host = env.POSTGRES_HOST ?? env.DB_HOST;
const port = Number(env.POSTGRES_PORT ?? env.DB_PORT ?? 5432);
const database = env.POSTGRES_DB ?? env.DB_NAME ?? 'rmc';
const user = env.POSTGRES_USER ?? env.DB_USER;
const password = env.POSTGRES_PASSWORD ?? env.DB_PASSWORD;

// Tables that carry a tenant_id but are intentionally NOT under RLS would be
// listed here with a reason. There are none today.
const ALLOWLIST = new Set([]);

if (!host || !user) {
  console.log('(skipping rls-drift-guard — DB connection env not set)');
  process.exit(0);
}

console.log('=== RLS drift guard (every tenant_id table forced + policied) ===');

const client = new pg.Client({ host, port, database, user, password, connectionTimeoutMillis: 8000 });
await client.connect();
try {
  const { rows } = await client.query(
    `SELECT c.relname AS "table",
            c.relrowsecurity AS enabled,
            c.relforcerowsecurity AS forced,
            EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid) AS "hasPolicy"
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND EXISTS (
          SELECT 1 FROM information_schema.columns col
           WHERE col.table_schema = 'public'
             AND col.table_name = c.relname
             AND col.column_name = 'tenant_id'
        )
      ORDER BY c.relname`,
  );

  ok(`found the tenant tables (${rows.length})`, rows.length >= 20);

  const offenders = rows
    .filter((r) => !ALLOWLIST.has(r.table))
    .filter((r) => !(r.enabled && r.forced && r.hasPolicy))
    .map((r) => `${r.table} (enabled=${r.enabled}, forced=${r.forced}, policy=${r.hasPolicy})`);

  if (offenders.length) console.log('  offenders:\n    ' + offenders.join('\n    '));
  ok('every tenant_id table has RLS enabled + forced + a policy', offenders.length === 0);

  console.log(`\nRLS DRIFT GUARD: ${pass} passed ✓`);
  process.exit(0);
} finally {
  await client.end();
}
