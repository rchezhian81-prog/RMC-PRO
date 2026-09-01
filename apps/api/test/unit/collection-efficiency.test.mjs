/**
 * Unit tests for the collection-efficiency + DSO maths
 * (billing/collection-efficiency.util.ts).
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCollectionEfficiency } from '../../dist/billing/collection-efficiency.util.js';

test('merges billed/collected/outstanding by customer and derives efficiency + DSO', () => {
  const { rows, totals, periodDays } = buildCollectionEfficiency(
    [
      { customerId: 'a', customerName: 'Acme', billed: '100000' },
      { customerId: 'b', customerName: 'Beta', billed: '50000' },
    ],
    [
      { customerId: 'a', customerName: 'Acme', collected: '80000' },
      { customerId: 'b', customerName: 'Beta', collected: '50000' },
    ],
    [
      { customerId: 'a', customerName: 'Acme', outstanding: '30000' },
      { customerId: 'b', customerName: 'Beta', outstanding: '0' },
    ],
    90,
  );

  assert.equal(periodDays, 90);
  const acme = rows.find((r) => r.customerName === 'Acme');
  assert.equal(acme.billed, 100000);
  assert.equal(acme.collected, 80000);
  assert.equal(acme.outstanding, 30000);
  assert.equal(acme.efficiencyPct, 80); // 80000/100000
  assert.equal(acme.dsoDays, 27); // 30000 * 90 / 100000

  // Acme (DSO 27) is a slower payer than Beta (DSO 0), so it sorts first.
  assert.equal(rows[0].customerName, 'Acme');

  assert.equal(totals.billed, 150000);
  assert.equal(totals.collected, 130000);
  assert.equal(totals.efficiencyPct, 86.7); // 130000/150000 -> 86.66.. -> 86.7
  assert.equal(totals.dsoDays, 18); // 30000 * 90 / 150000
});

test('a customer with receipts but no billing in the period still lists (efficiency/DSO null)', () => {
  const { rows } = buildCollectionEfficiency(
    [],
    [{ customerId: 'c', customerName: 'Gamma', collected: '5000' }],
    [{ customerId: 'c', customerName: 'Gamma', outstanding: '2000' }],
    30,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].collected, 5000);
  assert.equal(rows[0].outstanding, 2000);
  assert.equal(rows[0].efficiencyPct, null); // no billing basis
  assert.equal(rows[0].dsoDays, null);
});

test('collection efficiency can exceed 100% when old dues are cleared', () => {
  const { rows } = buildCollectionEfficiency(
    [{ customerId: 'd', customerName: 'Delta', billed: '10000' }],
    [{ customerId: 'd', customerName: 'Delta', collected: '14000' }],
    [{ customerId: 'd', customerName: 'Delta', outstanding: '1000' }],
    365,
  );
  assert.equal(rows[0].efficiencyPct, 140); // collected old dues too — informative, not a bug
});

test('unbounded period defaults to a 365-day DSO basis', () => {
  const { periodDays, totals } = buildCollectionEfficiency(
    [{ customerId: 'e', customerName: 'Echo', billed: '365000' }],
    [{ customerId: 'e', customerName: 'Echo', collected: '0' }],
    [{ customerId: 'e', customerName: 'Echo', outstanding: '365000' }],
    0, // service passes 0/undefined -> helper clamps to 365
  );
  assert.equal(periodDays, 365);
  assert.equal(totals.dsoDays, 365); // 365000 * 365 / 365000
});
