/**
 * Unit tests for the restore path (scripts/backup/pg-restore.sh,
 * scripts/backup/verify-restore.sh).
 *
 * The defect these pin: a restore that restored NOTHING used to report success.
 * pg_restore's exit status was discarded, the "sanity" block only printed row
 * counts without asserting anything, and the cleanup path printed "restore test
 * passed" unconditionally — so a truncated archive produced an empty database
 * and exit 0. On the live database it was worse: the counts printed were the OLD
 * data that had never been replaced, so a failed disaster recovery read as a
 * successful one.
 *
 * Three gates now stand between an archive and a claim of success, and each is
 * pinned here:
 *
 *   1. The archive's contents are read BEFORE anything is dropped, so a truncated
 *      dump cannot destroy the target on its way to failing.
 *   2. Any `pg_restore: error:` line fails the restore. Row counts cannot settle
 *      this alone: restoring over a live database that already holds good data
 *      looks exactly like a restore that did nothing.
 *   3. Success requires real count(*) values — schema, at least one company, at
 *      least one user — not pg_stat_user_tables estimates.
 *
 * Overwriting the live database also takes a safety dump first, so restoring the
 * wrong backup no longer throws away the work done since that backup was taken.
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
const restoreSh = resolve(repoRoot, 'scripts/backup/pg-restore.sh');

/**
 * Strip bash comments so these guards read CODE, not the explanation above it.
 * A guard that matches its own prose passes while the behaviour is gone.
 * `${...}` is tracked so a `#` inside a parameter expansion is not mistaken for
 * the start of a comment.
 */
function stripComments(src) {
  return src
    .split('\n')
    .map((line) => {
      let qs = false;
      let qd = false;
      let brace = 0;
      for (let i = 0; i < line.length; i += 1) {
        const c = line[i];
        if (c === '\\') { i += 1; continue; }
        if (!qd && c === "'") qs = !qs;
        else if (!qs && c === '"') qd = !qd;
        else if (!qs && c === '{' && line[i - 1] === '$') brace += 1;
        else if (!qs && c === '}' && brace > 0) brace -= 1;
        else if (!qs && !qd && brace === 0 && c === '#') return line.slice(0, i);
      }
      return line;
    })
    .join('\n');
}

const code = stripComments(readFileSync(restoreSh, 'utf8'));
const verifyCode = stripComments(
  readFileSync(resolve(repoRoot, 'scripts/backup/verify-restore.sh'), 'utf8'),
);

/**
 * Run pg-restore.sh with a stub `docker` on PATH. The guards exercised here all
 * fire before Postgres is ever contacted, so this runs anywhere — no database,
 * no container.
 */
function runRestore(args, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rmc-restore-'));
  const bin = join(dir, 'bin');
  execFileSync('mkdir', ['-p', bin]);
  writeFileSync(join(bin, 'docker'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(bin, 'docker'), 0o755);
  const env = join(dir, 'env');
  writeFileSync(env, 'POSTGRES_DB=rmc\nPOSTGRES_USER=rmc_owner\nPOSTGRES_PASSWORD=x\n');
  writeFileSync(join(dir, 'compose.yml'), '');
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  try {
    const stdout = execFileSync('bash', [restoreSh, ...args.map((a) => a.replace('%DIR%', dir))], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        ENV_FILE: env,
        COMPOSE_FILE: join(dir, 'compose.yml'),
        BACKUP_DIR: join(dir, 'backups'),
      },
    });
    return { status: 0, out: stdout };
  } catch (err) {
    return {
      status: err.status ?? 1,
      out: `${String(err.stdout ?? '')}${String(err.stderr ?? '')}`,
    };
  }
}

test('a truncated archive is refused before anything is restored', () => {
  const r = runRestore(['--file', '%DIR%/cut.dump'], { 'cut.dump': 'not-a-pg-dump-archive' });
  assert.notEqual(r.status, 0, 'a file that is not a pg_dump archive must not report success');
  assert.match(r.out, /PGDMP|truncated|corrupt/i);
});

test('an empty archive is refused', () => {
  const r = runRestore(['--file', '%DIR%/empty.dump'], { 'empty.dump': '' });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /empty/i);
});

test('the live database is never overwritten without --confirm', () => {
  const r = runRestore(['--file', '%DIR%/any.dump', '--into', 'rmc'], { 'any.dump': 'PGDMPxx' });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /--confirm/);
});

test('the archive is read before the target is touched', () => {
  const preflight = code.indexOf('pg_restore --list');
  const restore = code.indexOf('pg_restore -U "$PGUSER" -d "$INTO"');
  assert.ok(preflight > -1, 'pg-restore.sh must read the archive contents before restoring');
  assert.ok(restore > -1, 'pg-restore.sh must still run the restore');
  assert.ok(
    preflight < restore,
    'the contents check must come BEFORE the restore — --clean drops the live tables first',
  );
});

test('an error from pg_restore fails the restore', () => {
  assert.match(code, /pg_restore: error:/, 'pg-restore.sh must look for error lines');
  assert.match(
    code,
    /ERR_COUNT[\s\S]{0,600}restore_failed/,
    'error lines must lead to restore_failed, not to a success message',
  );
});

test('success is decided by real row counts, not by stats estimates', () => {
  assert.match(code, /count\(\*\) FROM migrations/);
  assert.match(code, /count\(\*\) FROM tenants/);
  assert.match(code, /count\(\*\) FROM users/);
  assert.doesNotMatch(
    code,
    /n_live_tup/,
    'n_live_tup is an estimate, and on a live restore it reports the data being replaced',
  );
  for (const v of ['M_CT', 'T_CT', 'U_CT']) {
    assert.match(
      code,
      new RegExp(`\\$\\{${v}:-0\\}[^\\n]*restore_failed`),
      `${v} must be asserted, not merely printed`,
    );
  }
});

test('every failure path exits non-zero', () => {
  assert.match(code, /restore_failed\(\)[\s\S]*?exit 1/, 'restore_failed must exit non-zero');
});

test('overwriting the live database takes a safety dump first', () => {
  const safety = code.indexOf('SAFETY_FILE="$BACKUP_DIR');
  const restore = code.indexOf('pg_restore -U "$PGUSER" -d "$INTO"');
  assert.ok(safety > -1, 'a live restore must dump the current database first');
  assert.ok(safety < restore, 'the safety dump must be taken BEFORE the restore overwrites it');
  assert.match(
    code,
    /FORCE[\s\S]{0,400}die "safety dump/,
    'a failed safety dump must refuse to continue unless --force is given',
  );
});

test('the monthly drill fails a backup that holds a schema but no data', () => {
  assert.match(
    verifyCode,
    /\$\{t_ct:-0\}[^\n]*fail/,
    'the drill must assert companies were restored, not just count them',
  );
  assert.match(
    verifyCode,
    /\$\{u_ct:-0\}[^\n]*fail/,
    'the drill must assert users were restored — nobody could log in otherwise',
  );
});
