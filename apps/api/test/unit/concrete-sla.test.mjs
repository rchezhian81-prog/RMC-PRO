/**
 * Unit tests for the concrete-on-road SLA alert (alerts/concrete-sla.util.ts).
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { concreteSlaAlerts, CONCRETE_SLA_MINUTES } from '../../dist/alerts/concrete-sla.util.js';

test('no loads over the SLA -> no alert', () => {
  assert.deepEqual(concreteSlaAlerts({ overSla: 0, oldestMinutes: 0 }), []);
  assert.deepEqual(concreteSlaAlerts(undefined), []);
});

test('loads over the SLA -> one danger alert naming the count and oldest', () => {
  const [a] = concreteSlaAlerts({ overSla: 3, oldestMinutes: 168.6 });
  assert.equal(a.key, 'concrete_on_road_sla');
  assert.equal(a.severity, 'danger');
  assert.equal(a.count, 3);
  assert.match(a.title, /3 loads/);
  assert.match(a.title, new RegExp(`${CONCRETE_SLA_MINUTES}-min`));
  assert.match(a.detail, /169 min out/); // 168.6 rounds to 169
  assert.equal(a.href, '/app/dispatch/board');
});

test('singular phrasing for exactly one load', () => {
  const [a] = concreteSlaAlerts({ overSla: 1, oldestMinutes: 130 });
  assert.match(a.title, /1 load on the road/);
  assert.match(a.detail, /1 dispatch left the plant/);
});

test('honours a custom SLA threshold in the message', () => {
  const [a] = concreteSlaAlerts({ overSla: 2, oldestMinutes: 100 }, 90);
  assert.match(a.title, /90-min SLA/);
});
