/**
 * Roles can be renamed and taken out of use from the screen. The one rule
 * that must hold for this to be honest: a standard role is ARCHIVED, never
 * deleted, because the production seed re-provisions any standard role a
 * tenant lacks — a real delete would come back on the next deploy while the
 * screen said it was gone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const read = (rel) => readFileSync(resolve(repoRoot, rel), 'utf8');
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('the provisioner treats an archived role as existing, so it is never re-created', () => {
  const src = codeOnly(read('apps/api/src/core/database/provision-tenant-roles.ts'));
  assert.match(src, /find\(Role, \{ where: \{ tenantId \} \}\)/, 'existing roles are read without an archived filter');
  assert.ok(!/archivedAt|archived_at/.test(src), 'the provisioner knows nothing of archiving — an archived row is simply a row');
});

test('the service archives standard roles, deletes custom ones, refuses the core two, and blocks assignment of archived roles', () => {
  const src = codeOnly(read('apps/api/src/setup/setup.services.ts'));
  assert.match(src, /SYSTEM_ROLE_KEYS\.includes\(role\.roleKey\)/, 'core roles are refused');
  assert.match(src, /update\(id, \{ archivedAt: new Date\(\) \}\)/, 'a standard role is archived');
  assert.match(src, /getRepository\(Role\)\.delete\(id\)/, 'a custom role is deleted');
  assert.ok(!/System roles cannot be modified/.test(src), 'renaming is no longer refused for standard roles');
  assert.equal((src.match(/is archived — restore it in Setup → Roles/g) ?? []).length, 2, 'both user paths (create, update) refuse an archived role');
  assert.match(src, /where: includeArchived \? \{\} : \{ archivedAt: IsNull\(\) \}/, 'the default list hides archived roles');
  assert.match(src, /async restore\(/);
  const audit = read('apps/api/src/audit/audit.service.ts');
  assert.match(audit, /ROLE_ARCHIVE: 'role\.archive'/);
  assert.match(audit, /ROLE_RESTORE: 'role\.restore'/);
  assert.match(read('apps/api/src/core/database/data-source.ts'), /RoleArchive1720000071000/, 'migration registered');
});

test('the screen offers Rename on every role, Archive or Delete except on the core two, and Restore for archived ones', () => {
  const page = read('apps/web/src/app/app/roles/page.tsx');
  assert.match(page, /rolesApi\.list\(true\)/, 'the page asks for archived roles too');
  assert.match(page, /\{system \? 'Archive' : 'Delete'\}/);
  assert.match(page, /\{!core && \(/, 'no remove button on the core roles');
  assert.match(page, /restoreRole\(r\)/);
  assert.match(page, /Archived roles \(/);
  const users = read('apps/web/src/app/app/users/page.tsx');
  assert.match(users, /rolesApi\.list\(\)/, 'the Users page lists active roles only');
  const verify = read('scripts/ops/verify-app.sh');
  assert.match(verify, /roles\?includeArchived=1/, 'the deploy check sees archived roles');
  assert.match(verify, /if k not in archived\]/, 'and does not count them as missing');
  assert.match(read('tests/rbac-authorization.mjs'), /\/roles\/00000000-0000-0000-0000-000000000000\/restore/);
});
