/**
 * Unit tests for rbac/access.ts — the shared access-loading helper behind both
 * PermissionsGuard and CrudPermissionsGuard, plus the owner-bypass predicate.
 *
 * `loadUserAccess` is the one place a user's role keys and effective permissions
 * are read, and it must do so INSIDE the tenant's RLS context (so a user can
 * never load another tenant's grants). These tests pin that contract with a fake
 * TenantDbService: the load runs through `runInTenant(tenantId, …)`, the userId
 * is passed as a bound parameter to both queries, and the row shapes map to the
 * documented result.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first
 * (the `test` turbo task depends on `build`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadUserAccess, isTenantOwner } from '../../dist/rbac/access.js';

/**
 * A stand-in for TenantDbService that records how it was called and answers the
 * two queries `loadUserAccess` issues (roles by `role_key`, permissions by
 * `permission_key`). Nothing runs unless it goes through `runInTenant`.
 */
function fakeDb({ roles = [], perms = [] } = {}) {
  const state = { tenantId: null, ran: false, queries: [] };
  const db = {
    runInTenant: async (tenantId, work) => {
      state.tenantId = tenantId;
      state.ran = true;
      const manager = {
        query: async (sql, params) => {
          state.queries.push({ sql, params });
          if (/role_key/.test(sql)) return roles.map((k) => ({ key: k }));
          if (/permission_key/.test(sql)) return perms.map((k) => ({ key: k }));
          return [];
        },
      };
      return work(manager);
    },
  };
  return { db, state };
}

test('loadUserAccess reads roles and permissions inside the tenant context', async () => {
  const { db, state } = fakeDb({
    roles: ['sales_executive'],
    perms: ['sales.view', 'sales.create'],
  });

  const access = await loadUserAccess(db, 'tenant-1', 'user-9');

  assert.equal(state.ran, true, 'must run through runInTenant (RLS applies)');
  assert.equal(state.tenantId, 'tenant-1', 'load is scoped to the caller tenant');
  assert.deepEqual(access.roleKeys, ['sales_executive']);
  assert.deepEqual(access.permissions, ['sales.view', 'sales.create']);
});

test('loadUserAccess binds the userId as a parameter to both queries (no interpolation)', async () => {
  const { db, state } = fakeDb({ roles: ['auditor'], perms: ['audit.view'] });

  await loadUserAccess(db, 'tenant-1', 'user-42');

  assert.equal(state.queries.length, 2, 'one role query and one permission query');
  for (const q of state.queries) {
    assert.deepEqual(q.params, ['user-42'], 'userId is a bound parameter');
    assert.ok(!q.sql.includes('user-42'), 'userId is never interpolated into the SQL text');
  }
});

test('loadUserAccess returns empty arrays for a user with no roles', async () => {
  const { db } = fakeDb({ roles: [], perms: [] });
  const access = await loadUserAccess(db, 'tenant-1', 'ghost');
  assert.deepEqual(access.roleKeys, []);
  assert.deepEqual(access.permissions, []);
});

test('isTenantOwner is true only for the company_owner role', () => {
  assert.equal(isTenantOwner({ roleKeys: ['company_owner'], permissions: [] }), true);
  assert.equal(
    isTenantOwner({ roleKeys: ['plant_manager', 'company_owner'], permissions: [] }),
    true,
    'owner alongside other roles still bypasses',
  );
});

test('isTenantOwner does NOT treat company_admin (or any non-owner) as the owner', () => {
  // The owner bypass is the tenant super-user. company_admin is powerful but is
  // still subject to per-key checks — conflating the two would silently widen it.
  assert.equal(isTenantOwner({ roleKeys: ['company_admin'], permissions: [] }), false);
  assert.equal(isTenantOwner({ roleKeys: ['sales_manager'], permissions: [] }), false);
  assert.equal(isTenantOwner({ roleKeys: [], permissions: [] }), false);
});
