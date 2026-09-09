/**
 * Unit tests for the off-box backup target guard (scripts/backup/lib-offbox.sh).
 *
 * The defect these pin: `rclone copy` CREATES a missing destination bucket, so a
 * typo in RMC_OFFBOX_RCLONE used to succeed — rclone made an empty bucket,
 * uploaded into it, and the existing read-back check passed against that same
 * typo — reporting "off-box copy verified" while every backup went somewhere
 * nobody monitors. Two things are pinned here:
 *
 *   1. The helpers themselves: bucket-root derivation, the no-bucket case, and
 *      that the existence probe is READ-ONLY (lsf — never a verb that creates).
 *   2. A DRIFT GUARD: pg-backup.sh still gates `rclone copy` on the probe. If a
 *      future edit drops the guard, the silent-diversion bug returns, so this
 *      fails.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const lib = resolve(repoRoot, 'scripts/backup/lib-offbox.sh');
const pgBackup = readFileSync(resolve(repoRoot, 'scripts/backup/pg-backup.sh'), 'utf8');

/** Run a snippet with the lib sourced; returns { status, stdout }. */
function sh(snippet) {
  try {
    const stdout = execFileSync('bash', ['-c', `set -u; . "${lib}"; ${snippet}`], {
      encoding: 'utf8',
    });
    return { status: 0, stdout: stdout.trim() };
  } catch (err) {
    return { status: err.status ?? 1, stdout: String(err.stdout ?? '').trim() };
  }
}

/** Write an executable fake `rclone` that exits `code` and logs its argv. */
function stubRclone(code) {
  const dir = mkdtempSync(join(tmpdir(), 'rmc-offbox-'));
  const bin = join(dir, 'rclone');
  const argvLog = join(dir, 'argv');
  writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$*" > "${argvLog}"\nexit ${code}\n`);
  chmodSync(bin, 0o755);
  return { bin, argv: () => readFileSync(argvLog, 'utf8').trim() };
}

// ── bucket-root derivation ───────────────────────────────────────────────────

test('offbox_bucket_root keeps a plain remote:bucket target', () => {
  assert.equal(sh(`offbox_bucket_root 'b2:rmc-offbox-backups'`).stdout, 'b2:rmc-offbox-backups');
});

test('offbox_bucket_root strips a sub-path to the container rclone would create', () => {
  assert.equal(sh(`offbox_bucket_root 'b2:bucket/sub/dir'`).stdout, 'b2:bucket');
  assert.equal(sh(`offbox_bucket_root 'b2:bucket/'`).stdout, 'b2:bucket');
});

test('offbox_bucket_root leaves a non-remote path unchanged', () => {
  // A mounted NFS/USB target has no "remote:" prefix and no bucket to create.
  assert.equal(sh(`offbox_bucket_root '/mnt/nfs/rmc-backups'`).stdout, '/mnt/nfs/rmc-backups');
});

// ── the no-bucket case ───────────────────────────────────────────────────────

test('offbox_target_has_bucket accepts remote:bucket', () => {
  assert.equal(sh(`offbox_target_has_bucket 'b2:rmc-offbox-backups'`).status, 0);
});

test('offbox_target_has_bucket rejects a bare remote root and an empty target', () => {
  assert.notEqual(sh(`offbox_target_has_bucket 'b2:'`).status, 0);
  assert.notEqual(sh(`offbox_target_has_bucket ''`).status, 0);
});

// ── the existence probe ──────────────────────────────────────────────────────

test('offbox_bucket_exists succeeds when the bucket is there', () => {
  const { bin } = stubRclone(0);
  assert.equal(sh(`offbox_bucket_exists 'b2:rmc-offbox-backups' '${bin}'`).status, 0);
});

test('offbox_bucket_exists fails when rclone cannot find the bucket', () => {
  const { bin } = stubRclone(3); // rclone's "directory not found"
  assert.notEqual(sh(`offbox_bucket_exists 'b2:typo-bucket' '${bin}'`).status, 0);
});

test('offbox_bucket_exists probes READ-ONLY and against the bucket root only', () => {
  const { bin, argv } = stubRclone(0);
  sh(`offbox_bucket_exists 'b2:bucket/sub' '${bin}'`);
  const args = argv();
  assert.equal(args, 'lsf --max-depth 1 b2:bucket');
  // Nothing that could create or mutate the destination.
  for (const verb of ['copy', 'sync', 'mkdir', 'move', 'delete', 'purge']) {
    assert.ok(!args.split(' ').includes(verb), `probe must not use "${verb}"`);
  }
});

// ── drift guard: the caller still uses the guard ─────────────────────────────

test('pg-backup.sh sources the lib and gates rclone copy on the bucket existing', () => {
  assert.match(pgBackup, /\.\s+"\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)\/lib-offbox\.sh"/);
  const guardAt = pgBackup.indexOf('offbox_bucket_exists "$RMC_OFFBOX_RCLONE"');
  const copyAt = pgBackup.indexOf('rclone copy "$OUT" "$RMC_OFFBOX_RCLONE"');
  assert.ok(guardAt > -1, 'pg-backup.sh must probe the bucket before copying');
  assert.ok(copyAt > -1, 'pg-backup.sh must still perform the off-box copy');
  assert.ok(guardAt < copyAt, 'the bucket probe must run BEFORE rclone copy');
  assert.match(pgBackup, /refusing to let rclone create it/);
});

test('pg-backup.sh keeps the local dump when the off-box target is rejected', () => {
  // Off-box failure must never cost us the on-box copy.
  const rejections = pgBackup.match(/offbox_alert "[^"]*local dump kept[^"]*"/g) ?? [];
  assert.ok(rejections.length >= 4, `expected every off-box failure to keep the local dump, saw ${rejections.length}`);
});
