/**
 * Unit tests for the GPS vendor feed parser and key helpers.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeVehicleNo, parseTimestamp, parsePositions, generateIngestKey, hashIngestKey, ingestKeyHint, MAX_POSITIONS_PER_REQUEST,
} from '../../dist/gps/gps-ingest.util.js';

const NOW = new Date('2026-06-01T10:00:00Z');

test('normalizeVehicleNo ignores spaces, hyphens and case', () => {
  assert.equal(normalizeVehicleNo('tn 01 ab-1234'), 'TN01AB1234');
  assert.equal(normalizeVehicleNo('TN01AB1234'), 'TN01AB1234');
  assert.equal(normalizeVehicleNo(null), '');
});

test('parseTimestamp: ISO, epoch seconds, epoch milliseconds, missing → now, garbage → null', () => {
  assert.equal(parseTimestamp('2026-06-01T09:00:00Z', NOW).toISOString(), '2026-06-01T09:00:00.000Z');
  assert.equal(parseTimestamp(1780304400, NOW).toISOString(), '2026-06-01T09:00:00.000Z');
  assert.equal(parseTimestamp(1780304400000, NOW).toISOString(), '2026-06-01T09:00:00.000Z');
  assert.equal(parseTimestamp(undefined, NOW), NOW);
  assert.equal(parseTimestamp('yesterday-ish', NOW), null);
});

test('parsePositions: one object, a list, or a wrapped list; vendor field spellings', () => {
  const one = parsePositions({ vehicleNo: 'TN 01 AB 1234', lat: 13.1, lng: 80.2, speed: 40 }, NOW);
  assert.equal(one.positions.length, 1);
  assert.equal(one.positions[0].vehicleNo, 'TN01AB1234');
  assert.equal(one.positions[0].speedKmph, 40);
  assert.equal(one.positions[0].recordedAt, NOW);
  const list = parsePositions([{ imei: '35812345', latitude: 13, longitude: 80, course: 90, fixTime: '2026-06-01T09:30:00Z' }], NOW);
  assert.equal(list.positions[0].deviceId, '35812345');
  assert.equal(list.positions[0].heading, 90);
  assert.equal(list.positions[0].recordedAt.toISOString(), '2026-06-01T09:30:00.000Z');
  const wrapped = parsePositions({ positions: [{ registration: 'ka01x1', lat: 12, lon: 77 }] }, NOW);
  assert.equal(wrapped.positions[0].vehicleNo, 'KA01X1');
});

test('parsePositions: rejects with a reason and keeps the rest', () => {
  const r = parsePositions([
    { lat: 13, lng: 80 },                                   // no vehicle
    { vehicleNo: 'A', lat: 99, lng: 80 },                   // bad coordinate
    { vehicleNo: 'B', lat: 13, lng: 80, timestamp: 'nope' }, // bad time
    { vehicleNo: 'C', lat: 13, lng: 80, timestamp: '2030-01-01T00:00:00Z' }, // future
    'junk',
    { vehicleNo: 'D', lat: 13, lng: 80, speed: -5, heading: 400 },
  ], NOW);
  assert.equal(r.positions.length, 1);
  assert.equal(r.positions[0].vehicleNo, 'D');
  assert.equal(r.positions[0].speedKmph, null, 'a negative speed is dropped, the fix kept');
  assert.equal(r.positions[0].heading, null);
  assert.deepEqual(r.rejected.map((x) => x.index), [0, 1, 2, 3, 4]);
  assert.match(r.rejected[0].reason, /no vehicleNo or deviceId/);
  assert.match(r.rejected[3].reason, /future/);
});

test('parsePositions caps a request at MAX_POSITIONS_PER_REQUEST', () => {
  const many = Array.from({ length: MAX_POSITIONS_PER_REQUEST + 5 }, (_, i) => ({ vehicleNo: `V${i}`, lat: 13, lng: 80 }));
  const r = parsePositions(many, NOW);
  assert.equal(r.positions.length, MAX_POSITIONS_PER_REQUEST);
  assert.match(r.rejected[r.rejected.length - 1].reason, /only the first/);
});

test('ingest keys: prefixed, hashed with SHA-256, hinted by the last four characters', () => {
  const k = generateIngestKey();
  assert.match(k, /^rmcgps_[A-Za-z0-9_-]{40}$/);
  assert.notEqual(generateIngestKey(), k);
  assert.match(hashIngestKey(k), /^[0-9a-f]{64}$/);
  assert.equal(hashIngestKey(` ${k} `), hashIngestKey(k), 'whitespace around a pasted key is ignored');
  assert.equal(ingestKeyHint(k), k.slice(-4));
});
