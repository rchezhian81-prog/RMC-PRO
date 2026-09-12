/**
 * Guards on the backup/alerting section of scripts/ops/verify-app.sh.
 *
 * Nothing else checked that the SCHEDULED backups are still producing files.
 * redeploy.sh takes a pre-redeploy snapshot and verify-restore.sh proves a dump
 * restores — but neither notices when the nightly cron stopped a month ago,
 * which leaves you with a proven restore of a stale backup.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const verify = readFileSync(resolve(here, '../../../../scripts/ops/verify-app.sh'), 'utf8');

test('operator-triggered snapshots do not count as a scheduled backup', () => {
  // A box with ten rmc-pre-redeploy dumps and no daily is EXACTLY the failure
  // being looked for — counting them would report it as healthy.
  const globs = /for f in ([^;]*); do/.exec(verify)?.[1] ?? '';
  assert.match(globs, /rmc-daily-\*/);
  assert.match(globs, /rmc-weekly-\*/);
  assert.match(globs, /rmc-monthly-\*/);
  assert.ok(!globs.includes('pre-redeploy'), 'pre-redeploy snapshots must not count');
  assert.ok(!globs.includes('install-check'), 'install-check snapshots must not count');
});

test('a missing schedule is a failure, not a warning', () => {
  assert.match(verify, /bad "scheduled backup" "no rmc-daily\/weekly\/monthly dump exists/);
  assert.match(verify, /install-backup-cron\.sh/);
});

test('backup age is graded, and a stale schedule fails', () => {
  assert.match(verify, /age_h/);
  assert.match(verify, /-le 48/);
  assert.match(verify, /bad "scheduled backup".*schedule has stopped producing backups/);
});

test('an unconfigured off-box target and alert webhook are surfaced', () => {
  // health-check.sh returns silently with no webhook set, so the monitor cron
  // alerts nowhere; that must not stay invisible.
  assert.match(verify, /warn "off-box target"/);
  assert.match(verify, /warn "failure alerting"/);
  assert.match(verify, /RMC_ALERT_WEBHOOK\|ALERT_WEBHOOK_URL/);
});

test('it skips cleanly when not run on the server', () => {
  assert.match(verify, /skip "scheduled backup" "run from the repo root on the server"/);
});
