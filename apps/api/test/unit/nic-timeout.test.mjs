/**
 * Unit test for the IRP / e-way HTTP request timeout (gap scan — concurrency /
 * resilience). The portal POST had no timeout, so a stalled socket hung on
 * undici's ~300s default — and because the GST worker drains jobs serially
 * behind an overlap guard, one hung call blocks IRN/e-way for EVERY tenant.
 * post() now passes an AbortSignal.timeout; a hung call is aborted and surfaces
 * as the transient PORTAL_UNAVAILABLE the retry policy already backs off on.
 *
 * Stubs globalThis.fetch — no live portal. Imports the COMPILED output, so
 * `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NicGstProvider } from '../../dist/compliance/nic.provider.js';

const creds = { resolve: async () => ({ username: 'u', password: 'p' }) };
const GSTIN = '29ABCDE1234F1Z5';

// post() reads GST_GSP_CLIENT_ID/SECRET to build the request headers; set them
// for the test and restore the environment afterwards so other suites are clean.
function withEnv(overrides, fn) {
  const saved = {};
  for (const k of Object.keys(overrides)) saved[k] = process.env[k];
  Object.assign(process.env, overrides);
  const restore = () => {
    for (const k of Object.keys(overrides)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  };
  return Promise.resolve()
    .then(fn)
    .finally(restore);
}

test('post() aborts a hung portal call and surfaces PORTAL_UNAVAILABLE', async () => {
  await withEnv(
    { GST_GSP_CLIENT_ID: 'cid', GST_GSP_CLIENT_SECRET: 'csec', GST_IRP_TIMEOUT_MS: '80' },
    async () => {
      const savedFetch = globalThis.fetch;
      let sawSignal = false;
      globalThis.fetch = (_url, opts = {}) => {
        sawSignal = !!opts.signal;
        // Hang until the AbortSignal fires, then reject with its reason — exactly
        // how undici surfaces a client-side timeout abort. AbortSignal.timeout's
        // own timer is UNREF'd (it won't hold the loop open), and a real fetch
        // would keep the socket ref'd — so hold a ref'd keepalive here so the
        // abort actually fires instead of the runner going idle first.
        return new Promise((_resolve, reject) => {
          const keepAlive = setTimeout(() => {}, 5000);
          opts.signal?.addEventListener('abort', () => {
            clearTimeout(keepAlive);
            reject(opts.signal.reason ?? new DOMException('aborted', 'AbortError'));
          });
        });
      };
      const provider = new NicGstProvider(creds);
      const started = Date.now();
      let err;
      try {
        await provider.post('http://irp.invalid', '/x', GSTIN, { Data: '...' }, 'tok');
      } catch (e) {
        err = e;
      }
      const elapsed = Date.now() - started;
      globalThis.fetch = savedFetch;

      assert.ok(sawSignal, 'fetch is called with an AbortSignal');
      assert.ok(err, 'the hung call rejects rather than hanging');
      assert.equal(err.code, 'PORTAL_UNAVAILABLE', 'a timed-out call is a transient PORTAL_UNAVAILABLE');
      assert.ok(elapsed < 3000, `aborted at the ~80ms budget, not undici's ~300s default (took ${elapsed}ms)`);
    },
  );
});

test('post() returns the parsed body on a normal response (the signal does not break the happy path)', async () => {
  await withEnv({ GST_GSP_CLIENT_ID: 'cid', GST_GSP_CLIENT_SECRET: 'csec' }, async () => {
    const savedFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ status: 200, json: async () => ({ Status: 1, ok: true }) });
    const provider = new NicGstProvider(creds);
    const res = await provider.post('http://irp', '/x', GSTIN, {}, 'tok');
    globalThis.fetch = savedFetch;
    assert.deepEqual(res, { Status: 1, ok: true });
  });
});
