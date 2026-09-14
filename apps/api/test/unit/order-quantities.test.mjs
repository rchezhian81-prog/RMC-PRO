/**
 * Ordered, batched, delivered — one rule for the order book and the order detail.
 *
 * The defect these pin: the two screens computed "delivered" differently. The
 * book summed delivered challans net of returns; the detail summed confirmed
 * batch tickets and labelled it Delivered. A load batched but still on the
 * road, or delivered with concrete returned, made them disagree about how much
 * of the same order was left.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { reconcileQuantities, attributeByGrade } from '../../dist/orders/order-quantities.util.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('balance is what the customer is still owed; pending is what is made but not yet delivered', () => {
  // 50 ordered, 50 batched, one 45 m³ delivery with 5 m³ returned.
  const r = reconcileQuantities({ orderedM3: 50, batchedM3: 50, deliveredM3: 45, returnedM3: 5 });
  assert.deepEqual(r, { orderedM3: 50, batchedM3: 50, deliveredM3: 45, returnedM3: 5, balanceM3: 5, pendingDeliveryM3: 0 });
});

test('batched but not yet on a delivered challan shows as pending, not delivered', () => {
  // The case the two screens used to disagree on: made, still on the road.
  const r = reconcileQuantities({ orderedM3: 50, batchedM3: 50, deliveredM3: 0, returnedM3: 0 });
  assert.equal(r.deliveredM3, 0, 'nothing has reached the site');
  assert.equal(r.balanceM3, 50, 'so the customer is still owed all of it');
  assert.equal(r.pendingDeliveryM3, 50, 'and all of it is on the road');
});

test('pending never goes negative and everything is rounded to litres', () => {
  const r = reconcileQuantities({ orderedM3: 10, batchedM3: 8, deliveredM3: 8.0004, returnedM3: 0.0004 });
  assert.equal(r.pendingDeliveryM3, 0);
  assert.equal(r.deliveredM3, 8);
  assert.equal(r.balanceM3, 2);
});

test('a line gets its grade’s figures only when it is the only line of that grade', () => {
  const byGrade = new Map([
    ['g25', { batchedM3: 30, deliveredM3: 27, returnedM3: 3 }],
    ['g20', { batchedM3: 10, deliveredM3: 10, returnedM3: 0 }],
  ]);
  const items = [
    { gradeId: 'g25', gradeLabel: 'M25', quantityM3: 30 },
    { gradeId: 'g20', gradeLabel: 'M20', quantityM3: 12 },
    { gradeId: 'g20', gradeLabel: 'M20', quantityM3: 8 }, // a second M20 line: cannot be told apart
  ];
  const lines = attributeByGrade(items, byGrade);
  assert.deepEqual(lines[0], { batchedM3: 30, deliveredM3: 27, returnedM3: 3, balanceM3: 3 });
  assert.equal(lines[1], null, 'two M20 lines share one grade total — showing it on both would double-count');
  assert.equal(lines[2], null);
});

test('a line with no grade master keys by its label, case-insensitively', () => {
  const byGrade = new Map([['M25', { batchedM3: 5, deliveredM3: 5, returnedM3: 0 }]]);
  const [line] = attributeByGrade([{ gradeId: null, gradeLabel: 'm25', quantityM3: 5 }], byGrade);
  assert.deepEqual(line, { batchedM3: 5, deliveredM3: 5, returnedM3: 0, balanceM3: 0 });
});

test('the book and the detail ask one query, not two', () => {
  // A second sum over delivery_challans or batch_tickets in this service is
  // how the two screens drifted apart in the first place.
  const src = codeOnly(readFileSync(resolve(repoRoot, 'apps/api/src/orders/orders.service.ts'), 'utf8'));
  const count = (re) => (src.match(re) ?? []).length;
  // The cancel guard also touches these tables — as existence checks, not
  // quantities — so it is the SUMs that must exist exactly once.
  assert.equal(count(/SUM\(quantity_m3 - return_quantity_m3\)/g), 1, 'exactly one delivered-challan sum, inside orderQuantitiesWithin');
  assert.equal(count(/SUM\(batch_quantity_m3\)/g), 1, 'exactly one batched sum, inside orderQuantitiesWithin');
  assert.equal(count(/orderQuantitiesWithin\(m,/g), 2, 'both orderBook and loadFull call it');
  assert.match(src, /reconcileQuantities\(/, 'and both use the shared arithmetic');
});
