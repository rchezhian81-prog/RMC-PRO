/**
 * Unit tests for ErrorAlertService — the ops 5xx alerter. Covers the behaviour
 * that makes it "alerting" rather than "log forwarding": the status threshold,
 * signature dedup + cooldown, the circuit breaker, secret redaction, id
 * normalisation, webhook delivery, the log-only fallback, and best-effort
 * delivery. No Nest, no DB — a local HTTP server captures the webhook POSTs and
 * the clock is injected for deterministic dedup.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ErrorAlertService } from '../../dist/common/error-alert.service.js';

function captureServer(responder) {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push(JSON.parse(body || '{}'));
      (responder ?? ((_req, r) => { r.writeHead(200); r.end('ok'); }))(req, res);
    });
  });
  return { server, received };
}
const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', r));
const closed = (server) => new Promise((r) => server.close(r));
const urlOf = (server) => `http://127.0.0.1:${server.address().port}/hook`;

/** Run `fn` while capturing console.log lines (parsed as JSON when possible). */
async function captureLogs(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (s) => { try { lines.push(JSON.parse(s)); } catch { lines.push(s); } };
  try { await fn(); } finally { console.log = orig; }
  return lines;
}

const evt = (over = {}) => ({
  status: 500, message: 'boom', name: 'QueryFailedError',
  requestId: 'rid-1', method: 'POST', path: '/api/v1/orders/550e8400-e29b-41d4-a716-446655440000',
  ...over,
});

test('a below-threshold status is ignored', async () => {
  const svc = new ErrorAlertService({}, {});
  assert.equal(await svc.capture(evt({ status: 404 })), 'ignored');
});

test('a 5xx is delivered as a structured, redacted, id-normalised payload', async () => {
  const { server, received } = captureServer();
  await listen(server);
  try {
    const svc = new ErrorAlertService({ webhookUrl: urlOf(server) }, {});
    const r = await svc.capture(evt({ message: 'connect failed password=hunter2' }), 1_000);
    assert.equal(r, 'sent');
    assert.equal(received.length, 1);
    const p = received[0];
    assert.equal(p.status, 500);
    assert.equal(p.requestId, 'rid-1');
    assert.equal(p.method, 'POST');
    assert.equal(p.path, '/api/v1/orders/:id'); // uuid collapsed
    assert.equal(p.level, 'alert');
    assert.equal(p.service, 'rmc-api');
    assert.ok(typeof p.text === 'string' && p.text.includes('500'));
    assert.ok(!p.error.includes('hunter2') && p.error.includes('[redacted]')); // secret scrubbed
  } finally {
    await closed(server);
  }
});

test('a duplicate signature within the window is deduped, then sent after cooldown', async () => {
  const { server, received } = captureServer();
  await listen(server);
  try {
    const svc = new ErrorAlertService({ webhookUrl: urlOf(server), dedupWindowMs: 60_000 }, {});
    assert.equal(await svc.capture(evt(), 1_000), 'sent');
    assert.equal(await svc.capture(evt({ path: '/api/v1/orders/999' }), 1_500), 'deduped'); // same signature (id-normalised)
    assert.equal(received.length, 1);
    const r3 = await svc.capture(evt(), 1_000 + 60_001);
    assert.equal(r3, 'sent');
    assert.equal(received.length, 2);
    assert.equal(received[1].suppressedSincePrev, 1); // reports the one it swallowed
    assert.ok(received[1].text.includes('suppressed'));
  } finally {
    await closed(server);
  }
});

test('the circuit breaker caps alerts per window', async () => {
  const { server, received } = captureServer();
  await listen(server);
  try {
    const svc = new ErrorAlertService({ webhookUrl: urlOf(server), maxPerWindow: 2, dedupWindowMs: 100_000 }, {});
    assert.equal(await svc.capture(evt({ name: 'E1' }), 1_000), 'sent');
    assert.equal(await svc.capture(evt({ name: 'E2' }), 1_001), 'sent');
    assert.equal(await svc.capture(evt({ name: 'E3' }), 1_002), 'stormed'); // over the cap
    assert.equal(received.length, 2);
  } finally {
    await closed(server);
  }
});

test('without a webhook it emits a structured alert log line and does not throw', async () => {
  const svc = new ErrorAlertService({}, {}); // no webhookUrl
  let result;
  const lines = await captureLogs(async () => { result = await svc.capture(evt(), 1_000); });
  assert.equal(result, 'sent');
  const alert = lines.find((l) => l && l.msg === 'error_alert');
  assert.ok(alert && alert.status === 500 && alert.requestId === 'rid-1');
});

test('a webhook failure is swallowed (best-effort) — capture still resolves', async () => {
  const { server } = captureServer((_req, res) => { res.writeHead(500); res.end('nope'); });
  await listen(server);
  try {
    const svc = new ErrorAlertService({ webhookUrl: urlOf(server) }, {});
    const lines = await captureLogs(async () => {
      assert.equal(await svc.capture(evt(), 1_000), 'sent');
    });
    assert.ok(lines.some((l) => l && l.msg === 'error_alert_delivery_failed'));
  } finally {
    await closed(server);
  }
});

test('invalid env values fall back to defaults (still alerts on 500)', async () => {
  const svc = new ErrorAlertService(
    {},
    { ALERT_MIN_STATUS: 'nope', ALERT_DEDUP_WINDOW_MS: '0', ALERT_MAX_PER_WINDOW: '-1', ALERT_TIMEOUT_MS: 'x' },
  );
  const lines = await captureLogs(async () => { assert.equal(await svc.capture(evt(), 1_000), 'sent'); });
  assert.ok(lines.some((l) => l && l.msg === 'error_alert' && l.status === 500));
});

test('missing message/method/path degrade gracefully', async () => {
  const { server, received } = captureServer();
  await listen(server);
  try {
    const svc = new ErrorAlertService({ webhookUrl: urlOf(server) }, {});
    await svc.capture({ status: 503 }, 1_000);
    const p = received[0];
    assert.equal(p.error, 'Unhandled error');
    assert.equal(p.path, null);
    assert.equal(p.method, null);
    assert.ok(p.text.includes('503'));
  } finally {
    await closed(server);
  }
});

test('captureOps delivers a structured, redacted ops alert (not gated on HTTP status)', async () => {
  const { server, received } = captureServer();
  await listen(server);
  try {
    const svc = new ErrorAlertService({ webhookUrl: urlOf(server) }, {});
    const r = await svc.captureOps({ key: 'gst_auth_failed', message: 'auth failed token=abc123', tenantId: 't-1' }, 1_000);
    assert.equal(r, 'sent');
    const p = received[0];
    assert.equal(p.msg, 'ops_alert');
    assert.equal(p.key, 'gst_auth_failed');
    assert.equal(p.tenantId, 't-1');
    assert.equal(p.level, 'alert');
    assert.ok(!p.error.includes('abc123') && p.error.includes('[redacted]')); // secret scrubbed
    assert.ok(p.text.includes('gst_auth_failed'));
  } finally {
    await closed(server);
  }
});

test('captureOps dedups a recurring condition by key, then re-sends after cooldown', async () => {
  const { server, received } = captureServer();
  await listen(server);
  try {
    const svc = new ErrorAlertService({ webhookUrl: urlOf(server), dedupWindowMs: 60_000 }, {});
    assert.equal(await svc.captureOps({ key: 'gst_job_deadlettered', message: 'job A' }, 1_000), 'sent');
    assert.equal(await svc.captureOps({ key: 'gst_job_deadlettered', message: 'job B' }, 1_500), 'deduped'); // same key
    assert.equal(received.length, 1);
    assert.equal(await svc.captureOps({ key: 'gst_job_deadlettered', message: 'job C' }, 1_000 + 60_001), 'sent');
    assert.equal(received.length, 2);
    assert.equal(received[1].suppressedSincePrev, 1);
  } finally {
    await closed(server);
  }
});

test('a slow webhook is aborted on timeout (delivery does not hang the caller)', async () => {
  const { server } = captureServer((_req, res) => { setTimeout(() => { res.writeHead(200); res.end('late'); }, 200); });
  await listen(server);
  try {
    const svc = new ErrorAlertService({ webhookUrl: urlOf(server), timeoutMs: 10 }, {});
    const lines = await captureLogs(async () => { assert.equal(await svc.capture(evt(), 1_000), 'sent'); });
    assert.ok(lines.some((l) => l && l.msg === 'error_alert_delivery_error'));
  } finally {
    await closed(server);
  }
});
