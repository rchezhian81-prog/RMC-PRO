/**
 * Unit tests for the scheduled alert digest logic (alerts/alert-digest.util.ts).
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAlertDigest, shouldSendDigest } from '../../dist/alerts/alert-digest.util.js';

const alerts = [
  { key: 'receivables_over_90', severity: 'danger', title: '₹5,00,000 outstanding over 90 days' },
  { key: 'concrete_on_road_sla', severity: 'danger', title: '2 loads on the road past the 120-min SLA' },
  { key: 'invoices_past_due', severity: 'warning', title: '₹1,00,000 past due' },
  { key: 'fyi', severity: 'info', title: 'Month-end approaching' },
];

test('default keeps only danger alerts and summarises them', () => {
  const d = buildAlertDigest(alerts);
  assert.equal(d.count, 2);
  assert.deepEqual(d.bySeverity, { danger: 2 });
  assert.equal(d.lines.length, 2);
  assert.match(d.text, /2 alerts need attention \(2 danger\)/);
});

test('warning threshold widens the digest and sorts danger before warning', () => {
  const d = buildAlertDigest(alerts, 'warning');
  assert.equal(d.count, 3); // 2 danger + 1 warning, info excluded
  assert.equal(d.bySeverity.danger, 2);
  assert.equal(d.bySeverity.warning, 1);
  assert.match(d.lines[0], /90 days|SLA/); // a danger alert leads
  assert.match(d.text, /3 alerts need attention \(2 danger, 1 warning\)/);
});

test('nothing at/above the threshold -> null (worker sends nothing)', () => {
  assert.equal(buildAlertDigest([{ key: 'fyi', severity: 'info', title: 'x' }]), null);
  assert.equal(buildAlertDigest([]), null);
});

test('singular phrasing for a single alert', () => {
  const d = buildAlertDigest([{ key: 'x', severity: 'danger', title: 'One thing' }]);
  assert.match(d.text, /1 alert need|1 alert needs|1 alert /); // "1 alert need attention"
  assert.match(d.text, /^1 alert /);
});

test('shouldSendDigest: only at the configured UTC hour, once per day', () => {
  const at8 = new Date('2026-09-02T08:15:00Z');
  const at9 = new Date('2026-09-02T09:15:00Z');
  assert.equal(shouldSendDigest(at8, 8, null), true); // right hour, never sent
  assert.equal(shouldSendDigest(at9, 8, null), false); // wrong hour
  assert.equal(shouldSendDigest(at8, 8, '2026-09-02'), false); // already sent today
  assert.equal(shouldSendDigest(at8, 8, '2026-09-01'), true); // sent yesterday -> due again
});
