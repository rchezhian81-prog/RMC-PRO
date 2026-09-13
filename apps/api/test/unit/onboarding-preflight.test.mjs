/**
 * Guards on the go-live scripts in scripts/setup.
 *
 * The defect these pin: `test-order-cycle.mjs` drives a real quotation → order →
 * batch → challan → invoice against the live plant. The batch ticket CONSUMES
 * REAL STOCK and every document is real and numbered. Run on a freshly
 * provisioned tenant it got all the way to the invoice before being refused for
 * a missing company GSTIN — leaving five documents in the plant's books, the
 * stock already deducted, and nothing to show for it.
 *
 * The company profile is now checked before anything is created, so the run
 * either completes or changes nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const read = (p) => readFileSync(resolve(repoRoot, p), 'utf8');

/** Drop // and /* *\/ comments so these read code, not the prose explaining it. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('the order cycle checks the company profile before creating anything', () => {
  const src = stripComments(read('scripts/setup/test-order-cycle.mjs'));
  // Anchored to the call site and to the first BUSINESS document, not to the
  // first POST in the file — that one is the login, whose function definition
  // sits above either of them and says nothing about execution order.
  const check = src.indexOf('await assertCompanyReady()');
  const firstWrite = src.indexOf("api('POST', '/quotations'");
  assert.ok(check > -1, 'test-order-cycle.mjs must call the company-profile check');
  assert.ok(firstWrite > -1, 'test-order-cycle.mjs must still raise a quotation');
  assert.ok(
    check < firstWrite,
    'the company check must run BEFORE the first POST — otherwise a failed run ' +
      'leaves real documents behind and stock already consumed',
  );
  assert.match(src, /gstin/i, 'the check must look at the GSTIN');
  assert.match(src, /state/, 'the check must look at the state — it decides CGST+SGST vs IGST');
});

test('the master seeder points at the company profile step', () => {
  const src = read('scripts/setup/seed-plant-master.mjs');
  assert.match(
    src,
    /apply-plant-config/,
    'the seeder must send people to the company-profile step, not straight to raising documents',
  );
});

test('recovery instructions name a real file, not a placeholder', () => {
  // A placeholder in a runnable command is worse than no command: it is pasted
  // verbatim. These print after a destructive step, when it matters most.
  for (const f of ['scripts/setup/reset-transactions.sh', 'scripts/setup/offboard-tenant.sh']) {
    const src = read(f);
    assert.ok(
      !/pg_restore[^\n]*<dump>/.test(src),
      `${f} must print the real backup filename, not <dump>`,
    );
    assert.match(src, /pg-restore\.sh --file "?\$BACKUP_FILE/, `${f} must use the verified restore script`);
  }
});
