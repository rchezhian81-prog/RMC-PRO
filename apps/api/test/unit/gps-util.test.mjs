/**
 * Unit tests for the GPS tracking helpers: coordinate validation, great-circle
 * distance, track summarisation and a naive ETA.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidLatLng,
  haversineKm,
  trackSummary,
  etaMinutes,
} from '../../dist/gps/gps.util.js';

// ---- isValidLatLng ----
test('accepts in-range coordinates', () => {
  assert.equal(isValidLatLng(13.0827, 80.2707), true); // Chennai
  assert.equal(isValidLatLng(-90, 180), true);
});

test('rejects out-of-range or non-numeric coordinates', () => {
  assert.equal(isValidLatLng(91, 0), false);
  assert.equal(isValidLatLng(0, 181), false);
  assert.equal(isValidLatLng('abc', 0), false);
  assert.equal(isValidLatLng(NaN, 0), false);
});

// ---- haversineKm ----
test('distance between two nearby points is a few km', () => {
  // ~1.57 km apart in Chennai.
  const d = haversineKm({ latitude: 13.0827, longitude: 80.2707 }, { latitude: 13.0700, longitude: 80.2800 });
  assert.ok(d > 1.4 && d < 1.8, `expected ~1.6 km, got ${d}`);
});

test('distance between identical points is zero', () => {
  assert.equal(haversineKm({ latitude: 13, longitude: 80 }, { latitude: 13, longitude: 80 }), 0);
});

test('one degree of latitude is about 111 km', () => {
  const d = haversineKm({ latitude: 13, longitude: 80 }, { latitude: 14, longitude: 80 });
  assert.ok(d > 110 && d < 112, `expected ~111 km, got ${d}`);
});

// ---- trackSummary ----
test('summary sums consecutive hops and the straight line', () => {
  const s = trackSummary([
    { latitude: 13.00, longitude: 80.00 },
    { latitude: 13.01, longitude: 80.00 },
    { latitude: 13.02, longitude: 80.00 },
  ]);
  assert.equal(s.pings, 3);
  // three collinear points → path ≈ straight line
  assert.ok(Math.abs(s.pathKm - s.straightLineKm) < 0.01);
  assert.ok(s.pathKm > 2.1 && s.pathKm < 2.3); // ~2.22 km
  assert.deepEqual(s.first, { latitude: 13.0, longitude: 80.0 });
  assert.deepEqual(s.last, { latitude: 13.02, longitude: 80.0 });
});

test('summary ignores invalid points', () => {
  const s = trackSummary([
    { latitude: 13.0, longitude: 80.0 },
    { latitude: 999, longitude: 80.0 }, // invalid
    { latitude: 13.01, longitude: 80.0 },
  ]);
  assert.equal(s.pings, 2);
});

test('an empty track summarises to zeros', () => {
  const s = trackSummary([]);
  assert.equal(s.pings, 0);
  assert.equal(s.pathKm, 0);
  assert.equal(s.first, null);
  assert.equal(s.last, null);
});

// ---- etaMinutes ----
test('eta from distance and speed', () => {
  assert.equal(etaMinutes(30, 60), 30); // 30 km at 60 km/h = 30 min
});

test('eta is null when stopped or speed is unknown', () => {
  assert.equal(etaMinutes(10, 0), null);
  assert.equal(etaMinutes(10, null), null);
  assert.equal(etaMinutes(-5, 60), null);
});
