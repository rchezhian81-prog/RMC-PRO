/**
 * Guards on the backup/drill cron timezone (scripts/backup/*.sh).
 *
 * The schedules read "02:15" but cron interprets them in the SERVER's timezone.
 * On a UTC box serving an Indian plant that is 07:45 IST — a pg_dump and an
 * off-box upload landing in the middle of the working morning, competing with
 * dispatch and billing. It went unnoticed because the backups themselves
 * succeeded; only the log timestamps gave it away.
 *
 * CRON_TZ pins the times to a named zone. A cron that does not understand it
 * treats the line as a plain environment variable and falls back to
 * server-local — the previous behaviour — so the change cannot regress.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const installer = readFileSync(resolve(root, 'scripts/backup/install-backup-cron.sh'), 'utf8');
const drill = readFileSync(resolve(root, 'scripts/backup/verify-restore.sh'), 'utf8');

test('both cron files pin the schedule to a named timezone', () => {
  for (const [name, s] of [['install-backup-cron.sh', installer], ['verify-restore.sh', drill]]) {
    assert.match(s, /CRON_TZ=\$BACKUP_CRON_TZ/, `${name} must emit CRON_TZ into the cron file`);
    assert.match(s, /BACKUP_CRON_TZ="\$\{BACKUP_CRON_TZ:-Asia\/Kolkata\}"/, `${name} must default the zone`);
  }
});

test('CRON_TZ is declared before the schedule lines, where cron reads it', () => {
  // An env line after a schedule does not apply to the entries above it.
  for (const [name, s] of [['install-backup-cron.sh', installer], ['verify-restore.sh', drill]]) {
    const tz = s.indexOf('CRON_TZ=$BACKUP_CRON_TZ');
    const firstJob = s.search(/^\d+ \d+ .*pg-backup\.sh|^\d+ \d+ .*verify-restore\.sh/m);
    assert.ok(tz > -1 && firstJob > -1, name);
    assert.ok(tz < firstJob, `${name}: CRON_TZ must precede the schedule`);
  }
});

test('the wall-clock times are unchanged — only their timezone is pinned', () => {
  // Pinning the zone is the fix; re-deriving the times in UTC would reintroduce
  // the month-boundary problem (02:45 on the 1st IST is the PREVIOUS month in UTC).
  assert.match(installer, /^15 2 \* \* \*/m);
  assert.match(installer, /^30 2 \* \* 0/m);
  assert.match(installer, /^45 2 1 \* \*/m);
  assert.match(drill, /^15 3 1 \* \*/m);
});

test('the installers report the server clock, so a timezone surprise is visible', () => {
  for (const [name, s] of [['install-backup-cron.sh', installer], ['verify-restore.sh', drill]]) {
    assert.match(s, /server clock:/, `${name} must print the server clock`);
  }
});
