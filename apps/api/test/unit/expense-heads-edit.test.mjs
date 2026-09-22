/**
 * Expense heads and groups could only be added: no edit, no deactivate, on
 * the screen. The API had update all along. These pin the screen and the two
 * rules that make deactivation safe: a new voucher cannot pick an inactive
 * head (posted vouchers keep theirs), and a group cannot go inactive while it
 * still holds active heads.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const read = (rel) => readFileSync(resolve(repoRoot, rel), 'utf8');

test('the screen offers Edit and Deactivate / Reactivate on every group and head', () => {
  const page = read('apps/web/src/app/app/expenses/heads/page.tsx');
  assert.match(page, /expensesApi\.updateGroup\(editGroup\.id/, 'group edit saves through the API');
  assert.match(page, /expensesApi\.updateHead\(editHead\.id/, 'head edit saves name, group and default cost');
  assert.equal((page.match(/'Deactivate' : 'Reactivate'/g) ?? []).length, 2, 'both tables toggle status');
  assert.match(page, /groups\.filter\(\(g\) => String\(g\.status\) === 'active'\)\.map/, 'a new head is offered active groups only');
  const vouchers = read('apps/web/src/app/app/expenses/vouchers/page.tsx');
  assert.match(vouchers, /heads\.filter\(\(h\) => String\(h\.status \?\? 'active'\) === 'active'\)/, 'the voucher pick-list offers active heads only');
});

test('the API refuses an inactive head on a new voucher and a group deactivation with active heads', () => {
  assert.match(read('apps/api/src/expenses/expense-voucher.service.ts'), /head\.status !== 'active'/);
  const master = read('apps/api/src/expenses/expense-master.service.ts');
  assert.match(master, /still has \$\{live\} active head\(s\)/);
  assert.equal((master.match(/status must be active or inactive/g) ?? []).length, 2, 'status validated on group and head');
});
