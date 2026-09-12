#!/usr/bin/env node
/**
 * =============================================================================
 *  Mix Nova RMC — read-only load probe
 * =============================================================================
 *  Drives a fixed set of GET endpoints at a chosen concurrency for a chosen
 *  duration and reports per-endpoint latency percentiles, throughput and error
 *  rate. Answers "what does this box actually do under N concurrent users", which
 *  no unit or integration test can.
 *
 *  READ-ONLY BY DESIGN. It issues GETs and nothing else: a write load test
 *  against a live pilot would leave real orders, invoices and stock movements
 *  behind. Adding a write mix is a deliberate future change, not a flag.
 *
 *  USAGE (from the repo root, against a running stack):
 *     LOGIN=owner@pilot1.com RMC_PASSWORD=... \
 *     API_BASE=http://localhost:4000 node scripts/ops/load-test.mjs
 *
 *  Options (env):
 *     API_BASE      default http://localhost:4000
 *     CONCURRENCY   parallel virtual users (default 10)
 *     DURATION_SEC  how long to sustain it (default 30)
 *     TARGETS       comma-separated paths, overriding the defaults
 *     P95_BUDGET_MS fail the run above this p95 (default 1500)
 *     ERROR_BUDGET  fail the run above this error fraction (default 0.01)
 *     I_MEAN_IT=1   required when API_BASE is not localhost
 *
 *  Exits non-zero when a budget is breached, so it can gate a release.
 * =============================================================================
 */

const BASE = (process.env.API_BASE ?? 'http://localhost:4000').replace(/\/$/, '');
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY ?? 10));
const DURATION_SEC = Math.max(1, Number(process.env.DURATION_SEC ?? 30));
const P95_BUDGET_MS = Number(process.env.P95_BUDGET_MS ?? 1500);
const ERROR_BUDGET = Number(process.env.ERROR_BUDGET ?? 0.01);

const DEFAULT_TARGETS = [
  '/health',
  '/api/v1/customers',
  '/api/v1/orders',
  '/api/v1/materials',
  '/api/v1/delivery-challans',
  '/api/v1/inventory-reports/valuation',
  '/api/v1/dashboard',
];
const TARGETS = (process.env.TARGETS ?? '').trim()
  ? process.env.TARGETS.split(',').map((t) => t.trim()).filter(Boolean)
  : DEFAULT_TARGETS;

const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE);
if (!isLocal && process.env.I_MEAN_IT !== '1') {
  console.error(
    `Refusing to load-test ${BASE} without I_MEAN_IT=1.\n` +
      'Sustained load against a live box competes with real users for the same\n' +
      'database connections — run it in a maintenance window, deliberately.',
  );
  process.exit(2);
}
if (TARGETS.some((t) => !t.startsWith('/'))) {
  console.error('TARGETS must be paths beginning with "/" — this probe never issues writes.');
  process.exit(2);
}

// ---- auth (optional: /health needs none, the rest do) ----
let token = '';
if (process.env.LOGIN && process.env.RMC_PASSWORD) {
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: process.env.LOGIN, password: process.env.RMC_PASSWORD }),
  }).then((r) => r.json()).catch(() => null);
  token = res?.data?.access_token ?? '';
  if (!token) {
    console.error('login failed — authenticated targets will report 401.');
  }
} else {
  console.error('note: LOGIN/RMC_PASSWORD not set — only unauthenticated targets will succeed.');
}

const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };
const stats = new Map(TARGETS.map((t) => [t, { ms: [], ok: 0, errors: 0, codes: new Map() }]));

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

const deadline = Date.now() + DURATION_SEC * 1000;
let issued = 0;

async function worker(seed) {
  let i = seed;
  while (Date.now() < deadline) {
    const path = TARGETS[i++ % TARGETS.length];
    const s = stats.get(path);
    const started = performance.now();
    try {
      const res = await fetch(`${BASE}${path}`, { headers });
      // Drain the body: without it the timing excludes transfer and sockets leak.
      await res.arrayBuffer();
      const ms = performance.now() - started;
      s.ms.push(ms);
      s.codes.set(res.status, (s.codes.get(res.status) ?? 0) + 1);
      if (res.ok) s.ok++; else s.errors++;
    } catch {
      s.ms.push(performance.now() - started);
      s.errors++;
      s.codes.set('network', (s.codes.get('network') ?? 0) + 1);
    }
    issued++;
  }
}

console.log(
  `\nload probe -> ${BASE}\n  ${CONCURRENCY} concurrent, ${DURATION_SEC}s, ${TARGETS.length} endpoints (GET only)\n`,
);
const wallStart = performance.now();
await Promise.all(Array.from({ length: CONCURRENCY }, (_, n) => worker(n)));
const wallSec = (performance.now() - wallStart) / 1000;

let totalErrors = 0;
let worstP95 = 0;
console.log(`${'endpoint'.padEnd(42)} ${'n'.padStart(6)} ${'p50'.padStart(8)} ${'p95'.padStart(8)} ${'p99'.padStart(8)}  codes`);
for (const [path, s] of stats) {
  const sorted = [...s.ms].sort((a, b) => a - b);
  const p95 = percentile(sorted, 95);
  worstP95 = Math.max(worstP95, p95);
  totalErrors += s.errors;
  const codes = [...s.codes.entries()].map(([c, n]) => `${c}:${n}`).join(' ');
  console.log(
    `${path.padEnd(42)} ${String(sorted.length).padStart(6)} ` +
      `${percentile(sorted, 50).toFixed(0).padStart(7)}ms ${p95.toFixed(0).padStart(7)}ms ` +
      `${percentile(sorted, 99).toFixed(0).padStart(7)}ms  ${codes}`,
  );
}

const errorRate = issued ? totalErrors / issued : 0;
console.log(
  `\n${issued} requests in ${wallSec.toFixed(1)}s — ${(issued / wallSec).toFixed(1)} req/s, ` +
    `${totalErrors} failed (${(errorRate * 100).toFixed(2)}%)`,
);

const breaches = [];
if (errorRate > ERROR_BUDGET) breaches.push(`error rate ${(errorRate * 100).toFixed(2)}% > budget ${(ERROR_BUDGET * 100).toFixed(2)}%`);
if (worstP95 > P95_BUDGET_MS) breaches.push(`worst p95 ${worstP95.toFixed(0)}ms > budget ${P95_BUDGET_MS}ms`);
if (breaches.length) {
  console.log(`\nLOAD PROBE: FAIL\n  - ${breaches.join('\n  - ')}`);
  process.exit(1);
}
console.log('\nLOAD PROBE: PASS');
