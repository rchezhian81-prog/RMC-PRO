/**
 * Unit tests for the weighbridge indicator protocol helpers (Plan E1): frame
 * parsing across the real-world format variations, kg normalisation, the
 * simulated frame/burst generators, and stable-reading selection.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseIndicatorFrame,
  simulateIndicatorFrame,
  simulateIndicatorBurst,
  pickStableReading,
  toKg,
} from '../../dist/inventory/weighbridge-indicator.util.js';

// ---- parseIndicatorFrame: the canonical stable/gross frame ----
test('parses a stable gross frame', () => {
  const r = parseIndicatorFrame('ST,GS,+  1234.5 kg');
  assert.equal(r.stable, true);
  assert.equal(r.overload, false);
  assert.equal(r.type, 'gross');
  assert.equal(r.weight, 1234.5);
  assert.equal(r.unit, 'kg');
  assert.equal(r.weightKg, 1234.5);
});

test('an unstable frame is not stable', () => {
  assert.equal(parseIndicatorFrame('US,GS,+0012000 kg').stable, false);
});

test('a net frame is typed net', () => {
  const r = parseIndicatorFrame('ST,NT,+0009800 kg');
  assert.equal(r.type, 'net');
  assert.equal(r.weight, 9800);
});

test('strips STX/ETX/CR control framing', () => {
  const r = parseIndicatorFrame('\x02ST,GS,+0001500 kg\r\x03');
  assert.equal(r.weight, 1500);
  assert.equal(r.stable, true);
});

test('a negative (tare-side) weight parses', () => {
  assert.equal(parseIndicatorFrame('ST,GS,-0000050 kg').weight, -50);
});

test('tolerates a comma before the unit and does NOT read the NT "T" as tonnes', () => {
  const r = parseIndicatorFrame('ST,NT,   123.45,kg');
  assert.equal(r.unit, 'kg');
  assert.equal(r.weight, 123.45);
  assert.equal(r.type, 'net');
});

test('a bare number with no status/type prefix parses as unknown type, not stable', () => {
  const r = parseIndicatorFrame('+12345');
  assert.equal(r.weight, 12345);
  assert.equal(r.type, 'unknown');
  assert.equal(r.stable, false);
  assert.equal(r.unit, 'kg');
});

test('a number with no space before the unit still parses', () => {
  const r = parseIndicatorFrame('  1234.5kg');
  assert.equal(r.weight, 1234.5);
  assert.equal(r.unit, 'kg');
});

test('an overload frame is flagged and does not throw', () => {
  const r = parseIndicatorFrame('OL,GS,+0000000 kg');
  assert.equal(r.overload, true);
});

test('garbage throws', () => {
  assert.throws(() => parseIndicatorFrame('\x02???\x03'));
  assert.throws(() => parseIndicatorFrame(''));
});

// ---- toKg: unit normalisation ----
test('normalises tonnes and grams to kg', () => {
  assert.equal(toKg(1.5, 't'), 1500);
  assert.equal(toKg(500, 'g'), 0.5);
  assert.equal(toKg(100, 'kg'), 100);
});

test('parses a tonnes frame and normalises weightKg', () => {
  const r = parseIndicatorFrame('ST,GS,+0001.500 t');
  assert.equal(r.unit, 't');
  assert.equal(r.weight, 1.5);
  assert.equal(r.weightKg, 1500);
});

// ---- simulate → parse round-trip ----
test('a simulated frame round-trips through the parser', () => {
  const frame = simulateIndicatorFrame({ weight: 24680.5, unit: 'kg', type: 'gross', stable: true });
  const r = parseIndicatorFrame(frame);
  assert.equal(r.weight, 24680.5);
  assert.equal(r.unit, 'kg');
  assert.equal(r.type, 'gross');
  assert.equal(r.stable, true);
});

test('a simulated unstable net frame round-trips', () => {
  const r = parseIndicatorFrame(simulateIndicatorFrame({ weight: 900, type: 'net', stable: false }));
  assert.equal(r.type, 'net');
  assert.equal(r.stable, false);
  assert.equal(r.weight, 900);
});

// ---- pickStableReading ----
test('picks the last stable reading from a settling burst', () => {
  const r = pickStableReading(simulateIndicatorBurst(25000));
  assert.equal(r.stable, true);
  assert.equal(r.weight, 25000);
  assert.equal(r.weightKg, 25000);
});

test('skips unstable frames and returns the stable one', () => {
  const frames = [
    simulateIndicatorFrame({ weight: 10, stable: false }),
    simulateIndicatorFrame({ weight: 500, stable: false }),
    simulateIndicatorFrame({ weight: 512, stable: true }),
  ];
  assert.equal(pickStableReading(frames).weight, 512);
});

test('throws when the platform never settles', () => {
  const frames = [
    simulateIndicatorFrame({ weight: 10, stable: false }),
    simulateIndicatorFrame({ weight: 20, stable: false }),
  ];
  assert.throws(() => pickStableReading(frames), /never reported a stable/);
});

test('throws on overload in the burst', () => {
  const frames = ['ST,GS,+0001000 kg', 'OL,GS,+0099999 kg'];
  assert.throws(() => pickStableReading(frames), /OVERLOAD/);
});

console.log('weighbridge-indicator unit tests defined');
