/**
 * Unit tests for the five RBAC guards (Design Doc 11 §5). These are the request
 * gate that decides who may reach a handler, so each is exercised across its
 * three postures: BYPASS (super_admin / company owner), DENY (no user, no
 * tenant, missing grant, suspended, module off), and ALLOW (has the grant).
 *
 * The guards are plain NestJS classes, so they are constructed directly with
 * fakes for the Reflector, TenantDbService, and TenantAccessService. No DB and
 * no HTTP — just the decision logic.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';

import { PermissionsGuard } from '../../dist/rbac/permissions.guard.js';
import { CrudPermissionsGuard } from '../../dist/rbac/crud-permissions.guard.js';
import { SuperAdminGuard } from '../../dist/rbac/super-admin.guard.js';
import { ModuleGuard } from '../../dist/rbac/module.guard.js';
import { TenantGuard } from '../../dist/rbac/tenant.guard.js';

// ── helpers ────────────────────────────────────────────────────────────────

/** A minimal ExecutionContext carrying a request `{ user, method }`. */
function makeCtx({ user, method = 'GET' } = {}) {
  const handler = function handler() {};
  const cls = class Controller {};
  return {
    switchToHttp: () => ({ getRequest: () => ({ user, method }) }),
    getHandler: () => handler,
    getClass: () => cls,
  };
}

/** A Reflector stub that returns a fixed metadata value for the guard's key. */
function makeReflector(value) {
  return { getAllAndOverride: () => value };
}

/** Fake TenantDbService answering loadUserAccess's two queries. */
function fakeAccessDb({ roles = [], perms = [] } = {}) {
  return {
    runInTenant: async (_tenantId, work) =>
      work({
        query: async (sql) => {
          if (/role_key/.test(sql)) return roles.map((k) => ({ key: k }));
          if (/permission_key/.test(sql)) return perms.map((k) => ({ key: k }));
          return [];
        },
      }),
  };
}

/** Fake TenantAccessService for the module/tenant guards. */
function fakeAccessSvc({ usable = true, blockCode = 'TENANT_SUSPENDED', enabled = true } = {}) {
  return {
    assertUsable: async () => {
      if (!usable) throw new ForbiddenException({ code: blockCode, message: 'blocked' });
    },
    isModuleEnabled: async () => enabled,
  };
}

/** Assert a promise rejects with a ForbiddenException carrying `code`. */
async function rejectsForbidden(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof ForbiddenException, 'is a ForbiddenException');
    assert.equal(err.getResponse().code, code, `code is ${code}`);
    return true;
  });
}

// ── PermissionsGuard ─────────────────────────────────────────────────────────

test('PermissionsGuard: an unguarded route (no required perms) is allowed without touching the DB', async () => {
  let touched = false;
  const db = { runInTenant: async () => { touched = true; return {}; } };
  const guard = new PermissionsGuard(makeReflector([]), db);
  const ok = await guard.canActivate(makeCtx({ user: { userId: 'u', tenantId: 't', userType: 'tenant' } }));
  assert.equal(ok, true);
  assert.equal(touched, false, 'no access load when nothing is required');
});

test('PermissionsGuard: no authenticated user is denied', async () => {
  const guard = new PermissionsGuard(makeReflector(['sales.view']), fakeAccessDb());
  await rejectsForbidden(guard.canActivate(makeCtx({ user: undefined })), 'PERMISSION_DENIED');
});

test('PermissionsGuard: super_admin bypasses without an access load', async () => {
  let touched = false;
  const db = { runInTenant: async () => { touched = true; return {}; } };
  const guard = new PermissionsGuard(makeReflector(['sales.view']), db);
  const ok = await guard.canActivate(
    makeCtx({ user: { userId: 'sa', tenantId: null, userType: 'super_admin' } }),
  );
  assert.equal(ok, true);
  assert.equal(touched, false);
});

test('PermissionsGuard: a tenant user with no tenantId is denied', async () => {
  const guard = new PermissionsGuard(makeReflector(['sales.view']), fakeAccessDb());
  await rejectsForbidden(
    guard.canActivate(makeCtx({ user: { userId: 'u', tenantId: null, userType: 'tenant' } })),
    'PERMISSION_DENIED',
  );
});

test('PermissionsGuard: the company owner bypasses the per-key check', async () => {
  const db = fakeAccessDb({ roles: ['company_owner'], perms: [] });
  const guard = new PermissionsGuard(makeReflector(['sales.approve_price']), db);
  const ok = await guard.canActivate(
    makeCtx({ user: { userId: 'owner', tenantId: 't', userType: 'tenant' } }),
  );
  assert.equal(ok, true, 'owner is the tenant super-user even without the explicit grant');
});

test('PermissionsGuard: a user holding every required permission is allowed', async () => {
  const db = fakeAccessDb({ roles: ['sales_manager'], perms: ['sales.view', 'sales.create'] });
  const guard = new PermissionsGuard(makeReflector(['sales.view', 'sales.create']), db);
  const ok = await guard.canActivate(
    makeCtx({ user: { userId: 'u', tenantId: 't', userType: 'tenant' } }),
  );
  assert.equal(ok, true);
});

test('PermissionsGuard: a user missing any one required permission is denied (all-of semantics)', async () => {
  const db = fakeAccessDb({ roles: ['sales_executive'], perms: ['sales.view'] });
  const guard = new PermissionsGuard(makeReflector(['sales.view', 'sales.create']), db);
  await rejectsForbidden(
    guard.canActivate(makeCtx({ user: { userId: 'u', tenantId: 't', userType: 'tenant' } })),
    'PERMISSION_DENIED',
  );
});

// ── CrudPermissionsGuard ─────────────────────────────────────────────────────

test('CrudPermissionsGuard: a controller with no @CrudResource is not gated', async () => {
  const guard = new CrudPermissionsGuard(makeReflector(undefined), fakeAccessDb());
  const ok = await guard.canActivate(
    makeCtx({ user: { userId: 'u', tenantId: 't', userType: 'tenant' }, method: 'DELETE' }),
  );
  assert.equal(ok, true);
});

test('CrudPermissionsGuard: the HTTP method maps to the resource action key', async () => {
  const cases = [
    ['GET', 'materials.view'],
    ['POST', 'materials.create'],
    ['PATCH', 'materials.edit'],
    ['PUT', 'materials.edit'],
    ['DELETE', 'materials.delete'],
    ['OPTIONS', 'materials.edit'], // unknown method falls back to the strictest write action
  ];
  for (const [method, requiredKey] of cases) {
    const db = fakeAccessDb({ roles: ['store_staff'], perms: [requiredKey] });
    const guard = new CrudPermissionsGuard(makeReflector('materials'), db);
    const ok = await guard.canActivate(
      makeCtx({ user: { userId: 'u', tenantId: 't', userType: 'tenant' }, method }),
    );
    assert.equal(ok, true, `${method} → ${requiredKey}`);
  }
});

test('CrudPermissionsGuard: a view-only role is refused a delete', async () => {
  const db = fakeAccessDb({ roles: ['store_staff'], perms: ['materials.view'] });
  const guard = new CrudPermissionsGuard(makeReflector('materials'), db);
  await rejectsForbidden(
    guard.canActivate(
      makeCtx({ user: { userId: 'u', tenantId: 't', userType: 'tenant' }, method: 'DELETE' }),
    ),
    'PERMISSION_DENIED',
  );
});

test('CrudPermissionsGuard: super_admin and the company owner both bypass', async () => {
  const superGuard = new CrudPermissionsGuard(makeReflector('materials'), fakeAccessDb());
  assert.equal(
    await superGuard.canActivate(
      makeCtx({ user: { userId: 'sa', tenantId: null, userType: 'super_admin' }, method: 'DELETE' }),
    ),
    true,
  );

  const ownerDb = fakeAccessDb({ roles: ['company_owner'], perms: [] });
  const ownerGuard = new CrudPermissionsGuard(makeReflector('materials'), ownerDb);
  assert.equal(
    await ownerGuard.canActivate(
      makeCtx({ user: { userId: 'o', tenantId: 't', userType: 'tenant' }, method: 'DELETE' }),
    ),
    true,
  );
});

test('CrudPermissionsGuard: a tenant user with no user / no tenantId is denied', async () => {
  const guard = new CrudPermissionsGuard(makeReflector('materials'), fakeAccessDb());
  await rejectsForbidden(
    guard.canActivate(makeCtx({ user: undefined, method: 'GET' })),
    'PERMISSION_DENIED',
  );
  await rejectsForbidden(
    guard.canActivate(
      makeCtx({ user: { userId: 'u', tenantId: null, userType: 'tenant' }, method: 'GET' }),
    ),
    'PERMISSION_DENIED',
  );
});

// ── SuperAdminGuard (synchronous) ────────────────────────────────────────────

test('SuperAdminGuard: allows a super_admin, refuses everyone else', () => {
  const guard = new SuperAdminGuard();
  assert.equal(
    guard.canActivate(makeCtx({ user: { userId: 'sa', tenantId: null, userType: 'super_admin' } })),
    true,
  );
  assert.throws(
    () => guard.canActivate(makeCtx({ user: { userId: 'u', tenantId: 't', userType: 'tenant' } })),
    (err) => err instanceof ForbiddenException && err.getResponse().code === 'PERMISSION_DENIED',
  );
  assert.throws(
    () => guard.canActivate(makeCtx({ user: undefined })),
    (err) => err instanceof ForbiddenException && err.getResponse().code === 'PERMISSION_DENIED',
  );
});

// ── ModuleGuard ──────────────────────────────────────────────────────────────

test('ModuleGuard: a route with no @RequireModule is allowed', async () => {
  const guard = new ModuleGuard(makeReflector(undefined), fakeAccessSvc());
  const ok = await guard.canActivate(
    makeCtx({ user: { userId: 'u', tenantId: 't', userType: 'tenant' } }),
  );
  assert.equal(ok, true);
});

test('ModuleGuard: super_admin bypasses the module check', async () => {
  const guard = new ModuleGuard(makeReflector('billing'), fakeAccessSvc({ enabled: false }));
  const ok = await guard.canActivate(
    makeCtx({ user: { userId: 'sa', tenantId: null, userType: 'super_admin' } }),
  );
  assert.equal(ok, true);
});

test('ModuleGuard: no user / no tenantId is denied', async () => {
  const guard = new ModuleGuard(makeReflector('billing'), fakeAccessSvc());
  await rejectsForbidden(guard.canActivate(makeCtx({ user: undefined })), 'PERMISSION_DENIED');
  await rejectsForbidden(
    guard.canActivate(makeCtx({ user: { userId: 'u', tenantId: null, userType: 'tenant' } })),
    'MODULE_NOT_ENABLED',
  );
});

test('ModuleGuard: an enabled module is allowed, a disabled one is refused', async () => {
  const user = { userId: 'u', tenantId: 't', userType: 'tenant' };

  const enabled = new ModuleGuard(makeReflector('billing'), fakeAccessSvc({ enabled: true }));
  assert.equal(await enabled.canActivate(makeCtx({ user })), true);

  const disabled = new ModuleGuard(makeReflector('billing'), fakeAccessSvc({ enabled: false }));
  await rejectsForbidden(disabled.canActivate(makeCtx({ user })), 'MODULE_NOT_ENABLED');
});

test('ModuleGuard: a suspended tenant is refused before the module is even checked', async () => {
  const guard = new ModuleGuard(makeReflector('billing'), fakeAccessSvc({ usable: false }));
  await rejectsForbidden(
    guard.canActivate(makeCtx({ user: { userId: 'u', tenantId: 't', userType: 'tenant' } })),
    'TENANT_SUSPENDED',
  );
});

// ── TenantGuard ──────────────────────────────────────────────────────────────

test('TenantGuard: a non-tenant request (no user / no tenantId) is denied', async () => {
  const guard = new TenantGuard(makeReflector(undefined), fakeAccessSvc());
  await rejectsForbidden(guard.canActivate(makeCtx({ user: undefined })), 'PERMISSION_DENIED');
  await rejectsForbidden(
    guard.canActivate(makeCtx({ user: { userId: 'u', tenantId: null, userType: 'tenant' } })),
    'PERMISSION_DENIED',
  );
});

test('TenantGuard: a usable tenant on a route with no module requirement passes', async () => {
  const guard = new TenantGuard(makeReflector(undefined), fakeAccessSvc({ usable: true }));
  const ok = await guard.canActivate(
    makeCtx({ user: { userId: 'u', tenantId: 't', userType: 'tenant' } }),
  );
  assert.equal(ok, true);
});

test('TenantGuard: a suspended tenant is refused (a token issued pre-suspension stops working)', async () => {
  const guard = new TenantGuard(makeReflector(undefined), fakeAccessSvc({ usable: false }));
  await rejectsForbidden(
    guard.canActivate(makeCtx({ user: { userId: 'u', tenantId: 't', userType: 'tenant' } })),
    'TENANT_SUSPENDED',
  );
});

test('TenantGuard: a required module that is off is refused; on is allowed', async () => {
  const user = { userId: 'u', tenantId: 't', userType: 'tenant' };

  const off = new TenantGuard(makeReflector('billing'), fakeAccessSvc({ usable: true, enabled: false }));
  await rejectsForbidden(off.canActivate(makeCtx({ user })), 'MODULE_NOT_ENABLED');

  const on = new TenantGuard(makeReflector('billing'), fakeAccessSvc({ usable: true, enabled: true }));
  assert.equal(await on.canActivate(makeCtx({ user })), true);
});
