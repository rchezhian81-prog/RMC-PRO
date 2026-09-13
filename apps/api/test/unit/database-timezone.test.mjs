/**
 * The database speaks the plant's time, not UTC.
 *
 * The defect this pins: nothing configured a timezone, so Postgres ran in UTC
 * and `current_date` was UTC's date. Between midnight and 05:30 in India that is
 * YESTERDAY — and 19 queries decide things on it, including the dashboard's date
 * window, whether an invoice is overdue, and the calendar day a timestamp cast
 * to DATE lands on. A plant pouring at 2am would open the dashboard and be shown
 * the previous day, with the night's challans outside the window entirely.
 *
 * This is the SQL-side twin of the businessToday() work: the JavaScript layer
 * had been moved off UTC while every `current_date` in SQL was still on it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  plantTimeZone,
  plantTimeZoneForPostgres,
  postgresTimeZoneOptions,
} from '../../dist/common/business-date.util.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const read = (p) => readFileSync(resolve(repoRoot, p), 'utf8');

test('the zone handed to Postgres is the plant zone', () => {
  const prev = process.env.PLANT_TIMEZONE;
  try {
    delete process.env.PLANT_TIMEZONE;
    assert.equal(plantTimeZoneForPostgres(), 'Asia/Kolkata');
    assert.deepEqual(postgresTimeZoneOptions(), { options: '-c timezone=Asia/Kolkata' });

    process.env.PLANT_TIMEZONE = 'Asia/Dubai';
    assert.equal(plantTimeZone(), 'Asia/Dubai');
    assert.equal(plantTimeZoneForPostgres(), 'Asia/Dubai');
    assert.deepEqual(postgresTimeZoneOptions(), { options: '-c timezone=Asia/Dubai' });

    process.env.PLANT_TIMEZONE = 'Etc/GMT+5';
    assert.equal(plantTimeZoneForPostgres(), 'Etc/GMT+5', 'real zone names may carry + and digits');
  } finally {
    if (prev === undefined) delete process.env.PLANT_TIMEZONE;
    else process.env.PLANT_TIMEZONE = prev;
  }
});

test('a malformed zone cannot smuggle a second setting into the connection', () => {
  const prev = process.env.PLANT_TIMEZONE;
  try {
    // The value lands inside the connection's startup options string. A space
    // would let another -c setting ride along; a quote would break every
    // connection at boot. Neither may reach Postgres.
    for (const hostile of [
      'Asia/Kolkata -c log_statement=all',
      "Asia/Kolkata' -c x=y",
      'Asia/Kolkata;DROP',
      '',
      'a'.repeat(100),
      'has space',
    ]) {
      process.env.PLANT_TIMEZONE = hostile;
      assert.equal(
        plantTimeZoneForPostgres(),
        'Asia/Kolkata',
        `${JSON.stringify(hostile)} must fall back to the default`,
      );
      assert.match(postgresTimeZoneOptions().options, /^-c timezone=[A-Za-z][A-Za-z0-9_+/-]*$/);
    }
  } finally {
    if (prev === undefined) delete process.env.PLANT_TIMEZONE;
    else process.env.PLANT_TIMEZONE = prev;
  }
});

test('both connections carry it — the API and the migrations/seed', () => {
  // The CLI connection runs migrations and the seed. If only the API had the
  // setting, a migration casting a timestamp to DATE would still write UTC's day.
  for (const file of [
    'apps/api/src/core/database/database.module.ts',
    'apps/api/src/core/database/data-source.ts',
  ]) {
    assert.match(
      read(file),
      /extra:\s*postgresTimeZoneOptions\(\)/,
      `${file} must connect on the plant's clock`,
    );
  }
});

test('SQL still asks the database for today, rather than hardcoding a zone', () => {
  // With the connection set, `current_date` is already the plant's date. A query
  // that spells out AT TIME ZONE 'Asia/Kolkata' instead would ignore
  // PLANT_TIMEZONE and be wrong for a plant deployed anywhere else.
  const dashboard = read('apps/api/src/sync/dashboard.service.ts');
  assert.match(dashboard, /current_date/, 'the dashboard window comes from the database clock');
  assert.doesNotMatch(
    dashboard,
    /AT TIME ZONE 'Asia\/Kolkata'/,
    'the dashboard must not pin one zone of its own',
  );
});
