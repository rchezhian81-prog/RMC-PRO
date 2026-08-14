/**
 * Unit tests for the UI V2 rollout-flag resolver (PR-UI0).
 *
 * Locks the fail-safe contract the whole rollout depends on: the flag is OFF
 * unless the value is exactly "1"/"true", so a missing / empty / invalid env
 * value can never silently switch tenants to the new skin. Deterministic and
 * pure so server and client resolve identically (no hydration mismatch).
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/shared build` runs first
 * (the root `test`/`coverage` scripts build shared before running).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveUiV2 } from '../../dist/index.js';

test('defaults OFF for missing / null / empty / whitespace', () => {
  assert.equal(resolveUiV2(undefined), false);
  assert.equal(resolveUiV2(null), false);
  assert.equal(resolveUiV2(''), false);
  assert.equal(resolveUiV2('   '), false);
});

test('OFF for every falsey or invalid value', () => {
  for (const v of ['0', 'false', 'FALSE', 'False', 'no', 'off', 'yes', 'on', '2', 'v2', 'enabled', 'truthy', 'null', 'undefined']) {
    assert.equal(resolveUiV2(v), false, `expected OFF for ${JSON.stringify(v)}`);
  }
});

test('ON only for exactly "1" or "true" (case- and whitespace-insensitive)', () => {
  for (const v of ['1', 'true', 'TRUE', 'True', ' 1 ', '  true  ', '\ttrue\n']) {
    assert.equal(resolveUiV2(v), true, `expected ON for ${JSON.stringify(v)}`);
  }
});
