/**
 * Unit tests for the deploy-path argument guard (scripts/ops/lib-args.sh).
 *
 * THE DEFECT: redeploy.sh, migration-preflight.sh and verify-app.sh all act on
 * the CURRENT CHECKOUT and take no positional arguments — but bash silently
 * ignores the ones it is handed, so `./scripts/ops/redeploy.sh a1b2c3d` ran
 * happily, built whatever the working tree contained, and read as though it had
 * deployed a1b2c3d. Stale code gets rebuilt under a fresh-looking label and
 * every downstream check still passes, because the app is fine — it is just the
 * wrong commit.
 *
 * Pinned here: the guard fires, says something useful for the commit-ish case,
 * lets a bare invocation through, and — as a DRIFT GUARD — is still wired into
 * all three scripts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const lib = resolve(repoRoot, 'scripts/ops/lib-args.sh');

const GUARDED = ['redeploy.sh', 'migration-preflight.sh', 'verify-app.sh'];

/** Call the guard with `args`; returns { status, err }. */
function guard(...args) {
  const quoted = args.map((a) => `'${a}'`).join(' ');
  try {
    const out = execFileSync('bash', ['-c', `set -u; . "${lib}"; reject_positional_args ${quoted}; echo PASSED_THROUGH`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, out, err: '' };
  } catch (e) {
    return { status: e.status ?? 1, out: String(e.stdout ?? ''), err: String(e.stderr ?? '') };
  }
}

// ── the guard lets legitimate use through ────────────────────────────────────

test('no arguments: the script continues', () => {
  const r = guard();
  assert.equal(r.status, 0);
  assert.match(r.out, /PASSED_THROUGH/);
});

// ── and refuses everything else ──────────────────────────────────────────────

test('a commit-ish argument is refused and explained', () => {
  const r = guard('cff2198');
  assert.equal(r.status, 2);
  assert.match(r.err, /takes no positional arguments/);
  assert.match(r.err, /It looks like you passed a commit \(cff2198\)/);
  // The fix must be spelled out, not merely implied.
  assert.match(r.err, /git pull --ff-only origin main/);
  assert.match(r.err, /IMAGE_TAG=/);
  assert.match(r.err, /no argument/);
  assert.ok(!r.out.includes('PASSED_THROUGH'), 'the script must not continue');
});

test('a full-length SHA is recognised as a commit too', () => {
  const r = guard('a'.repeat(40));
  assert.equal(r.status, 2);
  assert.match(r.err, /It looks like you passed a commit/);
});

test('a short or non-hex argument gets the plain message', () => {
  for (const arg of ['abc123', '--wat', 'main', 'production']) {
    const r = guard(arg);
    assert.equal(r.status, 2, arg);
    assert.match(r.err, /Run it with no arguments/, arg);
    assert.ok(!/It looks like you passed a commit/.test(r.err), `${arg} is not a commit`);
  }
});

test('several arguments are all reported', () => {
  const r = guard('cff2198', '--force');
  assert.equal(r.status, 2);
  assert.match(r.err, /but got: cff2198 --force/);
});

test('the guard names the script the user actually ran', () => {
  // $0 inside the sourced function must resolve to the caller, not the lib.
  const r = guard('--wat');
  assert.ok(!/lib-args\.sh/.test(r.err), 'the message must not blame the library');
});

// ── drift guard: every deploy-path script keeps the guard ────────────────────

test('all three deploy-path scripts invoke the guard', () => {
  for (const name of GUARDED) {
    const s = readFileSync(resolve(repoRoot, 'scripts/ops', name), 'utf8');
    assert.match(s, /\.\s+"\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)\/lib-args\.sh"/, `${name} must source the guard`);
    assert.match(s, /reject_positional_args "\$@"/, `${name} must call the guard`);
  }
});

test('the guard runs before any work is done', () => {
  // Rejecting after a build has started would defeat the point.
  for (const name of GUARDED) {
    // Blank out comments first: the usage headers mention `docker compose`, and
    // matching that prose would compare the guard against a line of documentation.
    const raw = readFileSync(resolve(repoRoot, 'scripts/ops', name), 'utf8');
    const s = raw.replace(/^\s*#.*$/gm, '');
    const guardAt = s.indexOf('reject_positional_args "$@"');
    const dockerAt = s.search(/docker compose|docker-compose|DC=\(/);
    assert.ok(guardAt > -1, `${name} must call the guard`);
    if (dockerAt > -1) {
      assert.ok(guardAt < dockerAt, `${name} must reject arguments before touching docker`);
    }
  }
});
