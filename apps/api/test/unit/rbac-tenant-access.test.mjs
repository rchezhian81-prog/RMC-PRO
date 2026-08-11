/**
 * Unit tests for TenantAccessService — the single source of "may this tenant
 * trade, and which modules are switched on" that both TenantGuard and ModuleGuard
 * consult on every request. Covers:
 *
 *   • entitlements() shape + the short-lived cache (and invalidate()),
 *   • assertUsable() — suspended / cancelled / missing tenant are blocked,
 *     active / trial / grace pass,
 *   • isModuleEnabled() — exact gating once provisioned, and the deliberate
 *     "unprovisioned ⇒ allow" safety net that keeps a live plant on the air.
 *
 * The reads happen inside the tenant's RLS context, so the fake db answers via
 * `runInTenant` and counts how often it is hit (to prove the cache works).
 *
 * NB: the PROVISIONING_STRICT branch flips the unprovisioned default to "deny".
 * It is read from the environment once at module load, so it cannot be toggled
 * mid-process; these tests cover the shipped default (lenient) and the
 * integration suite exercises the strict production setting.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { TenantAccessService } from '../../dist/rbac/tenant-access.service.js';

/**
 * Fake TenantDbService. `runInTenant` hands the work a manager whose
 * `getRepository(...)` returns the tenant row (findOne) and the module rows
 * (find). `hits` counts invocations so cache behaviour is observable.
 */
function fakeDb({ tenant = null, moduleRows = [] } = {}) {
  const state = { hits: 0, tenantIds: [] };
  const db = {
    runInTenant: async (tenantId, work) => {
      state.hits += 1;
      state.tenantIds.push(tenantId);
      return work({
        getRepository: () => ({
          findOne: async () => tenant,
          find: async () => moduleRows,
        }),
      });
    },
  };
  return { db, state };
}

const mod = (moduleKey, isEnabled) => ({ moduleKey, isEnabled });

test('entitlements reports status, the enabled-module set, provisioned and exists', async () => {
  const { db } = fakeDb({
    tenant: { status: 'active' },
    moduleRows: [mod('billing', true), mod('reports', true), mod('whatsapp_api', false)],
  });
  const svc = new TenantAccessService(db);

  const e = await svc.entitlements('t1');
  assert.equal(e.status, 'active');
  assert.equal(e.exists, true);
  assert.equal(e.provisioned, true);
  assert.equal(e.modules.has('billing'), true);
  assert.equal(e.modules.has('reports'), true);
  assert.equal(e.modules.has('whatsapp_api'), false, 'disabled rows are excluded from the set');
});

test('entitlements of a tenant with no rows: exists reflects the tenant, provisioned is false', async () => {
  const { db } = fakeDb({ tenant: { status: 'active' }, moduleRows: [] });
  const svc = new TenantAccessService(db);
  const e = await svc.entitlements('t1');
  assert.equal(e.exists, true);
  assert.equal(e.provisioned, false, 'no tenant_modules rows ⇒ unprovisioned');
  assert.equal(e.modules.size, 0);
});

test('entitlements caches within the TTL and re-reads after invalidate()', async () => {
  const { db, state } = fakeDb({ tenant: { status: 'active' }, moduleRows: [mod('billing', true)] });
  const svc = new TenantAccessService(db);

  await svc.entitlements('t1');
  await svc.entitlements('t1');
  assert.equal(state.hits, 1, 'second read is served from cache');

  svc.invalidate('t1');
  await svc.entitlements('t1');
  assert.equal(state.hits, 2, 'invalidate forces a fresh read');
});

test('the cache is keyed per tenant', async () => {
  const { db, state } = fakeDb({ tenant: { status: 'active' }, moduleRows: [] });
  const svc = new TenantAccessService(db);
  await svc.entitlements('t1');
  await svc.entitlements('t2');
  assert.equal(state.hits, 2, 'different tenants are cached separately');
});

test('assertUsable passes for active, trial and grace', async () => {
  for (const status of ['active', 'trial', 'grace']) {
    const { db } = fakeDb({ tenant: { status }, moduleRows: [] });
    const svc = new TenantAccessService(db);
    await assert.doesNotReject(svc.assertUsable('t1'), `${status} may trade`);
  }
});

test('assertUsable blocks suspended and cancelled tenants', async () => {
  for (const status of ['suspended', 'cancelled']) {
    const { db } = fakeDb({ tenant: { status }, moduleRows: [] });
    const svc = new TenantAccessService(db);
    await assert.rejects(svc.assertUsable('t1'), (err) => {
      assert.ok(err instanceof ForbiddenException);
      assert.equal(err.getResponse().code, 'TENANT_SUSPENDED');
      return true;
    });
  }
});

test('assertUsable treats a missing tenant row as blocked (token outlived the tenant)', async () => {
  const { db } = fakeDb({ tenant: null, moduleRows: [] });
  const svc = new TenantAccessService(db);
  await assert.rejects(svc.assertUsable('gone'), (err) => {
    assert.equal(err.getResponse().code, 'TENANT_SUSPENDED');
    assert.match(err.getResponse().message, /no longer available/i);
    return true;
  });
});

test('isModuleEnabled gates exactly once the tenant is provisioned', async () => {
  const { db } = fakeDb({
    tenant: { status: 'active' },
    moduleRows: [mod('billing', true), mod('reports', false)],
  });
  const svc = new TenantAccessService(db);
  assert.equal(await svc.isModuleEnabled('t1', 'billing'), true, 'enabled ⇒ allowed');
  assert.equal(await svc.isModuleEnabled('t1', 'reports'), false, 'switched off ⇒ refused');
  assert.equal(await svc.isModuleEnabled('t1', 'dispatch'), false, 'absent ⇒ refused');
});

test('isModuleEnabled allows everything for an UNPROVISIONED tenant (lenient default keeps a plant live)', async () => {
  const { db } = fakeDb({ tenant: { status: 'active' }, moduleRows: [] });
  const svc = new TenantAccessService(db);
  // With no tenant_modules rows at all, the default (PROVISIONING_STRICT unset)
  // is to pass rather than take a live plant off the air over a provisioning gap.
  assert.equal(await svc.isModuleEnabled('t1', 'billing'), true);
  assert.equal(await svc.isModuleEnabled('t1', 'anything_at_all'), true);
});
