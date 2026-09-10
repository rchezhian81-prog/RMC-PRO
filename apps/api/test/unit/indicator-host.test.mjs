/**
 * Unit tests for the weighbridge-indicator address guard (W1).
 *
 * The defect: `readTcpFrame` dials the host/port stored on the indicator record,
 * and those routes are gated on `weighbridge.device` — which Store Staff holds.
 * An operator could register an "indicator" at 169.254.169.254:80 (cloud
 * metadata) or 127.0.0.1:6379 (Redis) and make the API connect to it, with the
 * first line of the reply returned in the reading's `raw` field and a
 * refused-vs-timeout error message mapping open ports on the private network.
 *
 * Pinned here: the classification itself, and — as a DRIFT GUARD — that the
 * service still resolves-and-vets before connecting and no longer echoes the
 * socket errno.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  classifyAddress,
  isRoutableAddress,
  isValidPort,
  privateIndicatorsAllowed,
} from '../../dist/inventory/indicator-host.util.js';

const here = dirname(fileURLToPath(import.meta.url));
const service = readFileSync(resolve(here, '../../src/inventory/weighbridge-indicator.service.ts'), 'utf8');

// ── the addresses an SSRF would reach for ────────────────────────────────────

test('the cloud metadata endpoint is link-local, never routable', () => {
  assert.equal(classifyAddress('169.254.169.254'), 'link-local');
  assert.equal(isRoutableAddress('169.254.169.254'), false);
});

test('loopback is blocked in both families', () => {
  for (const ip of ['127.0.0.1', '127.1.2.3', '::1']) {
    assert.equal(classifyAddress(ip), 'loopback', ip);
    assert.equal(isRoutableAddress(ip), false, ip);
  }
});

test('every RFC1918 range plus CGNAT is blocked', () => {
  for (const ip of ['10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.1.50', '100.64.0.1']) {
    assert.equal(classifyAddress(ip), 'private', ip);
    assert.equal(isRoutableAddress(ip), false, ip);
  }
});

test('a private address just outside the 172.16/12 block is still public', () => {
  // 172.15 and 172.32 are NOT private — an off-by-one here would over-block.
  assert.equal(classifyAddress('172.15.0.1'), 'public');
  assert.equal(classifyAddress('172.32.0.1'), 'public');
});

test('IPv4-mapped IPv6 is judged by the address it actually reaches', () => {
  // ::ffff:127.0.0.1 connects to loopback; reading it as "some IPv6 string"
  // would wave the block straight through.
  assert.equal(classifyAddress('::ffff:127.0.0.1'), 'loopback');
  assert.equal(classifyAddress('::ffff:169.254.169.254'), 'link-local');
  assert.equal(isRoutableAddress('::ffff:10.0.0.1'), false);
});

test('IPv6 unique-local, link-local, multicast and unspecified are blocked', () => {
  assert.equal(classifyAddress('fc00::1'), 'private');
  assert.equal(classifyAddress('fd12:3456::1'), 'private');
  assert.equal(classifyAddress('fe80::1'), 'link-local');
  assert.equal(classifyAddress('fe80::1%eth0'), 'link-local'); // zone index stripped
  assert.equal(classifyAddress('ff02::1'), 'multicast');
  assert.equal(classifyAddress('::'), 'unspecified');
});

test('0.0.0.0, broadcast and reserved space are blocked', () => {
  assert.equal(classifyAddress('0.0.0.0'), 'unspecified');
  assert.equal(classifyAddress('255.255.255.255'), 'reserved');
  assert.equal(classifyAddress('240.0.0.1'), 'reserved');
  assert.equal(classifyAddress('224.0.0.1'), 'multicast');
});

test('a genuine public indicator address passes', () => {
  for (const ip of ['203.0.113.10', '8.8.8.8', '2404:6800:4007::1']) {
    assert.equal(isRoutableAddress(ip), true, ip);
  }
});

test('junk and empty input are invalid, never routable', () => {
  for (const v of ['', '   ', 'not-an-ip', '999.1.1.1', '1.2.3', null, undefined]) {
    assert.equal(isRoutableAddress(v), false, String(v));
  }
});

// ── the on-premise escape hatch ──────────────────────────────────────────────

test('private indicators are opt-in and off by default', () => {
  assert.equal(privateIndicatorsAllowed({}), false);
  assert.equal(privateIndicatorsAllowed({ WEIGHBRIDGE_ALLOW_PRIVATE_INDICATORS: '0' }), false);
  assert.equal(privateIndicatorsAllowed({ WEIGHBRIDGE_ALLOW_PRIVATE_INDICATORS: 'true' }), false);
  assert.equal(privateIndicatorsAllowed({ WEIGHBRIDGE_ALLOW_PRIVATE_INDICATORS: '1' }), true);
});

// ── ports ────────────────────────────────────────────────────────────────────

test('isValidPort accepts 1-65535 and rejects everything else', () => {
  for (const p of [1, 502, 4001, 65535, '4001']) assert.equal(isValidPort(p), true, String(p));
  for (const p of [0, -1, 65536, 1.5, 'abc', '', null, undefined]) assert.equal(isValidPort(p), false, String(p));
});

// ── drift guards: the service must keep using all of this ────────────────────

test('readTcpFrame vets the resolved address before connecting', () => {
  const resolveAt = service.indexOf('resolveIndicatorAddress(host)');
  const connectAt = service.indexOf('socket.connect(port, target)');
  assert.ok(resolveAt > -1, 'the host must be resolved and vetted');
  assert.ok(connectAt > -1, 'the socket must dial the vetted address, not the hostname');
  assert.ok(resolveAt < connectAt, 'vetting must happen BEFORE the connection');
  assert.match(service, /isRoutableAddress/);
});

test('the socket error is no longer reflected back to the caller', () => {
  // `(${err.message})` distinguished ECONNREFUSED from ETIMEDOUT — an open-port
  // oracle for the internal network, which is the whole point of the guard.
  assert.ok(!service.includes('err.message'), 'the errno must not reach the API response');
  assert.match(service, /did not respond at/);
});

test('every resolved address must pass, not merely the first', () => {
  // A name answering with one public and one private address must not be usable
  // to reach the private one.
  assert.match(service, /addresses\.find\(\(a\) => !isRoutableAddress\(a\.address\)\)/);
});
