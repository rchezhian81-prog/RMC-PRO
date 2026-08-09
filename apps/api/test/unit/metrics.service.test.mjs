/**
 * Unit tests for MetricsService — the hand-rolled Prometheus registry. Covers
 * counter + histogram recording, the Prometheus exposition format, route
 * normalisation (ids collapsed), and the cardinality cap (overflow → "other").
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MetricsService, normalizeRoute } from '../../dist/common/metrics.service.js';

test('normalizeRoute collapses uuid and numeric segments to :id', () => {
  assert.equal(normalizeRoute('/api/v1/orders/550e8400-e29b-41d4-a716-446655440000'), '/api/v1/orders/:id');
  assert.equal(normalizeRoute('/api/v1/plants/42/materials'), '/api/v1/plants/:id/materials');
  assert.equal(normalizeRoute('/api/v1/orders?foo=1'), '/api/v1/orders');
  assert.equal(normalizeRoute(''), '/');
});

test('http_requests_total counts by method, route and status', () => {
  const m = new MetricsService();
  m.observeHttp('GET', '/api/v1/orders/550e8400-e29b-41d4-a716-446655440000', 200, 0.02);
  m.observeHttp('get', '/api/v1/orders/111e8400-e29b-41d4-a716-446655440000', 200, 0.03);
  m.observeHttp('POST', '/api/v1/orders', 201, 0.5);
  const out = m.render();
  assert.match(out, /# TYPE http_requests_total counter/);
  // Both GET reads collapse to the same :id route and status → one series of 2.
  assert.match(out, /http_requests_total\{method="GET",route="\/api\/v1\/orders\/:id",status="200"\} 2/);
  assert.match(out, /http_requests_total\{method="POST",route="\/api\/v1\/orders",status="201"\} 1/);
});

test('the duration histogram is cumulative with sum, count and +Inf', () => {
  const m = new MetricsService();
  m.observeHttp('GET', '/x', 200, 0.03); // falls in the 0.05 bucket and up
  m.observeHttp('GET', '/x', 200, 2.0); // falls in the 2.5 bucket and up
  const out = m.render();
  const line = (le) => new RegExp(`http_request_duration_seconds_bucket\\{method="GET",route="/x",le="${le.replace('+', '\\+')}"\\} (\\d+)`);
  const at = (le) => Number(out.match(line(le))[1]);
  assert.equal(at('0.01'), 0); // nothing ≤ 10ms
  assert.equal(at('0.05'), 1); // the 30ms request
  assert.equal(at('2.5'), 2); // both
  assert.equal(at('+Inf'), 2);
  assert.match(out, /http_request_duration_seconds_count\{method="GET",route="\/x"\} 2/);
  const sum = Number(out.match(/http_request_duration_seconds_sum\{method="GET",route="\/x"\} ([\d.eE+-]+)/)[1]);
  assert.ok(Math.abs(sum - 2.03) < 1e-9, `sum ${sum} ≈ 2.03`);
});

test('route cardinality is capped — overflow folds into "other"', () => {
  const m = new MetricsService();
  for (let i = 0; i < 250; i++) m.observeHttp('GET', `/api/v1/thing-${i}`, 200, 0.01);
  const out = m.render();
  assert.match(out, /route="other"/);
  const distinct = new Set([...out.matchAll(/http_requests_total\{method="GET",route="([^"]+)"/g)].map((x) => x[1]));
  // 200 real routes + the "other" bucket, never unbounded.
  assert.ok(distinct.size <= 201, `distinct routes ${distinct.size} should be ≤ 201`);
});

test('exposition includes process gauges and build info, and is well-formed', () => {
  const m = new MetricsService();
  m.observeHttp('GET', '/x', 200, 0.01);
  const out = m.render();
  assert.match(out, /# TYPE process_resident_memory_bytes gauge/);
  assert.match(out, /process_resident_memory_bytes \d+/);
  assert.match(out, /nodejs_heap_used_bytes \d+/);
  assert.match(out, /process_uptime_seconds [\d.]+/);
  assert.match(out, /rmc_build_info\{service="rmc-api",version="[^"]+"\} 1/);
  // Every non-comment, non-blank line is `name...  value` (ends in a number/Inf).
  for (const l of out.split('\n')) {
    if (!l || l.startsWith('#')) continue;
    assert.match(l, /\s[-\d.eE+]+$/, `malformed exposition line: ${l}`);
  }
});

test('bad durations are clamped, not propagated', () => {
  const m = new MetricsService();
  m.observeHttp('GET', '/x', 200, Number.NaN);
  m.observeHttp('GET', '/x', 200, -5);
  const out = m.render();
  assert.match(out, /http_request_duration_seconds_sum\{method="GET",route="\/x"\} 0/);
  assert.match(out, /http_request_duration_seconds_count\{method="GET",route="\/x"\} 2/);
});
