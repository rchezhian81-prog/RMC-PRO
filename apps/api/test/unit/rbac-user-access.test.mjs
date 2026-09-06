/**
 * Unit tests for UserAccessService — the per-(tenant, user) cache in front of
 * `loadUserAccess`. Both permission guards and several read services consult it
 * on every request, so it is the hottest access read in the app. Covers:
 *
 *   • get() returns the loaded roles + permissions,
 *   • it caches within the TTL (a second read does NOT touch the DB),
 *   • the cache is keyed per (tenant, user), not per tenant or per user alone,
 *   • invalidateUser() drops exactly one user, leaving others cached,
 *   • invalidateTenant() drops every user in that tenant, leaving other tenants.
 *
 * The reads run inside the tenant's RLS context, so the fake db answers via
 * `runInTenant` and counts loads (each get() that misses issues ONE runInTenant
 * with the two DISTINCT queries), which is what makes cache behaviour observable.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UserAccessService } from '../../dist/rbac/user-access.service.js';

/**
 * Fake TenantDbService driving loadUserAccess's two queries. `byUser` maps a
 * userId to its { roles, perms }. `loads` counts runInTenant invocations so a
 * cache hit (no new load) is observable.
 */
function fakeDb(byUser = {}) {
  const state = { loads: 0 };
  const db = {
    runInTenant: async (_tenantId, work) => {
      state.loads += 1;
      return work({
        query: async (sql, [userId]) => {
          const { roles = [], perms = [] } = byUser[userId] ?? {};
          if (/role_key/.test(sql)) return roles.map((k) => ({ key: k }));
          if (/permission_key/.test(sql)) return perms.map((k) => ({ key: k }));
          return [];
        },
      });
    },
  };
  return { db, state };
}

test('get() returns the user’s role keys and effective permissions', async () => {
  const { db } = fakeDb({ u1: { roles: ['sales_manager'], perms: ['sales.view', 'sales.create'] } });
  const svc = new UserAccessService(db);
  const access = await svc.get('t1', 'u1');
  assert.deepEqual(access.roleKeys, ['sales_manager']);
  assert.deepEqual(access.permissions, ['sales.view', 'sales.create']);
});

test('get() caches within the TTL — a second read is served without a DB load', async () => {
  const { db, state } = fakeDb({ u1: { roles: ['r'], perms: ['p'] } });
  const svc = new UserAccessService(db);
  await svc.get('t1', 'u1');
  await svc.get('t1', 'u1');
  assert.equal(state.loads, 1, 'the second read hits the cache');
});

test('the cache is keyed per (tenant, user)', async () => {
  const { db, state } = fakeDb({
    u1: { roles: ['r1'], perms: [] },
    u2: { roles: ['r2'], perms: [] },
  });
  const svc = new UserAccessService(db);
  await svc.get('t1', 'u1');
  await svc.get('t1', 'u2'); // same tenant, different user ⇒ separate entry
  await svc.get('t2', 'u1'); // same user id, different tenant ⇒ separate entry
  assert.equal(state.loads, 3, 'each distinct (tenant, user) loads once');
});

test('invalidateUser() drops exactly one user and leaves the rest cached', async () => {
  const { db, state } = fakeDb({ u1: { roles: ['r1'], perms: [] }, u2: { roles: ['r2'], perms: [] } });
  const svc = new UserAccessService(db);
  await svc.get('t1', 'u1');
  await svc.get('t1', 'u2');
  assert.equal(state.loads, 2);

  svc.invalidateUser('t1', 'u1');
  await svc.get('t1', 'u1'); // reloads
  await svc.get('t1', 'u2'); // still cached
  assert.equal(state.loads, 3, 'only the invalidated user reloads');
});

test('invalidateTenant() drops every user in that tenant but not other tenants', async () => {
  const { db, state } = fakeDb({
    u1: { roles: ['r1'], perms: [] },
    u2: { roles: ['r2'], perms: [] },
    u3: { roles: ['r3'], perms: [] },
  });
  const svc = new UserAccessService(db);
  await svc.get('t1', 'u1');
  await svc.get('t1', 'u2');
  await svc.get('t2', 'u3');
  assert.equal(state.loads, 3);

  svc.invalidateTenant('t1'); // a role's permissions changed in t1
  await svc.get('t1', 'u1'); // reloads
  await svc.get('t1', 'u2'); // reloads
  await svc.get('t2', 'u3'); // untouched ⇒ still cached
  assert.equal(state.loads, 5, 'both t1 users reload; the t2 user stays cached');
});

test('a fresh load after invalidation reflects the NEW access (a role change is not stale)', async () => {
  const byUser = { u1: { roles: ['viewer'], perms: ['reports.view'] } };
  const { db } = fakeDb(byUser);
  const svc = new UserAccessService(db);
  const before = await svc.get('t1', 'u1');
  assert.deepEqual(before.permissions, ['reports.view']);

  // Simulate a role/permission write, then invalidate as the write paths do.
  byUser.u1 = { roles: ['manager'], perms: ['reports.view', 'invoices.create'] };
  svc.invalidateUser('t1', 'u1');

  const after = await svc.get('t1', 'u1');
  assert.deepEqual(after.roleKeys, ['manager']);
  assert.deepEqual(after.permissions, ['reports.view', 'invoices.create']);
});
