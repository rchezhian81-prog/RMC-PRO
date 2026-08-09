/**
 * Observability test: request correlation + readiness.
 *
 * Drives the booted API to prove the operability contract:
 *   - every response carries an X-Request-Id header (success and error alike)
 *   - a guard rejection (401, before any interceptor) is still tagged and the
 *     id appears in the error envelope, so a caller can quote it
 *   - an inbound X-Request-Id from the edge (nginx) is honoured; an unsafe one
 *     is replaced rather than echoed (no log/header injection)
 *   - /health is liveness; /health/ready pings the DB (readiness)
 *
 * Fixtures (from run-integration.mjs env): API_BASE, API_URL.
 */
import { randomUUID } from 'node:crypto';

const BASE = process.env.API_BASE ?? `http://localhost:${process.env.API_PORT ?? 4000}/api/v1`;
const ROOT = process.env.API_URL ?? `http://localhost:${process.env.API_PORT ?? 4000}`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) throw new Error('FAIL: ' + name); pass++; };

(async () => {
  console.log('=== health: liveness + readiness ===');
  const live = await fetch(`${ROOT}/health`);
  ok('liveness /health → 200', live.status === 200);
  ok('liveness carries an X-Request-Id header', UUID_RE.test(live.headers.get('x-request-id') ?? ''));

  const ready = await fetch(`${ROOT}/health/ready`);
  const readyBody = await ready.json();
  ok('readiness /health/ready → 200', ready.status === 200);
  // Success bodies go through the standard envelope: { success, data }.
  ok('readiness reports the DB is up', readyBody?.data?.status === 'ready' && readyBody?.data?.db === 'up');

  console.log('=== request correlation ===');
  // A protected route with no token: rejected by a guard, before any
  // interceptor. It must still be tagged and the id must reach the envelope.
  const noauth = await fetch(`${BASE}/users`);
  const naBody = await noauth.json();
  const hdrId = noauth.headers.get('x-request-id');
  ok('protected route without a token → 401', noauth.status === 401);
  ok('a guard rejection still carries an X-Request-Id header', UUID_RE.test(hdrId ?? ''));
  ok('the error envelope includes requestId', typeof naBody?.error?.requestId === 'string' && naBody.error.requestId.length > 0);
  ok('envelope requestId matches the response header', naBody.error.requestId === hdrId);

  // An id forwarded by the edge (nginx `proxy_set_header X-Request-Id`) is kept
  // end to end so the API line ties back to the access log.
  const myId = `trace-${randomUUID()}`;
  const echoed = await fetch(`${BASE}/users`, { headers: { 'X-Request-Id': myId } });
  const echoedBody = await echoed.json();
  ok('a safe inbound X-Request-Id is honoured (echoed back)', echoed.headers.get('x-request-id') === myId);
  ok('the honoured id flows into the error envelope', echoedBody?.error?.requestId === myId);

  // An unsafe inbound id (spaces — could forge a second log record) is dropped
  // for a fresh uuid, never echoed.
  const badId = 'not a safe id';
  const bad = await fetch(`${BASE}/users`, { headers: { 'X-Request-Id': badId } });
  const returned = bad.headers.get('x-request-id');
  ok('an unsafe inbound id is replaced, not echoed', returned !== badId && UUID_RE.test(returned ?? ''));

  console.log(`\nOBSERVABILITY TEST: ${pass} passed`);
  process.exit(0);
})().catch((e) => { console.error('\nTEST FAILED:', e.message); process.exit(1); });
