/**
 * Alerting is one setting for the whole box, and it can be proven.
 *
 * Before: the API read ALERT_WEBHOOK_URL, the scripts read RMC_ALERT_WEBHOOK,
 * the compose file passed neither into the api container, and each script
 * hand-built a {"text":…} body with no escaping (Discord rejects it; a quote
 * in the message broke it). So a webhook could be set and still page nobody,
 * with nothing to say so. These pin the fix: one name (either accepted), the
 * container gets it, every script posts through one helper that escapes and
 * sends both fields, and a test message can be sent through the real path —
 * from the API (Settings → Send test alert) and from the shell (alert-test.sh).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { ErrorAlertService } from '../../dist/common/error-alert.service.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const read = (rel) => readFileSync(resolve(repoRoot, rel), 'utf8');
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function captureServer(status = 200) {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => { received.push(JSON.parse(body || '{}')); res.writeHead(status); res.end(); });
  });
  return { server, received };
}
const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', r));
const closed = (server) => new Promise((r) => server.close(r));
const urlOf = (server) => `http://127.0.0.1:${server.address().port}/hook`;
/** Run a bash snippet WITHOUT blocking the event loop (an in-process capture server must keep serving). */
const runBash = (snippet, env) => new Promise((resolveP) => {
  const child = spawn('bash', ['-c', snippet], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (d) => (stdout += d));
  child.stderr.on('data', (d) => (stderr += d));
  child.on('close', (status) => resolveP({ status, stdout, stderr }));
});
const quiet = async (fn) => { const o = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = o; } };

test('the API accepts RMC_ALERT_WEBHOOK (the scripts\' name) when ALERT_WEBHOOK_URL is unset', async () => {
  const { server, received } = captureServer();
  await listen(server);
  try {
    const svc = new ErrorAlertService(undefined, { RMC_ALERT_WEBHOOK: urlOf(server) });
    assert.equal(svc.webhookConfigured(), true);
    assert.equal(await quiet(() => svc.capture({ status: 500, message: 'boom', method: 'GET', path: '/x' })), 'sent');
    assert.equal(received.length, 1, 'a 5xx reached the webhook named the scripts\' way');
    assert.ok(received[0].text && received[0].content, 'both render fields');
    const explicit = new ErrorAlertService(undefined, { ALERT_WEBHOOK_URL: urlOf(server), RMC_ALERT_WEBHOOK: 'http://127.0.0.1:1/never' });
    assert.equal(await quiet(() => explicit.capture({ status: 500, message: 'x', method: 'GET', path: '/y' })), 'sent');
    assert.equal(received.length, 2, 'ALERT_WEBHOOK_URL wins when both are set');
    assert.equal(new ErrorAlertService(undefined, {}).webhookConfigured(), false);
  } finally { await closed(server); }
});

test('sendTest goes through the real delivery path and reports exactly what happened', async () => {
  const { server, received } = captureServer();
  await listen(server);
  try {
    const r = await quiet(() => new ErrorAlertService(undefined, { RMC_ALERT_WEBHOOK: urlOf(server) }).sendTest('unit'));
    assert.equal(r.configured, true);
    assert.equal(r.delivered, true);
    assert.equal(r.status, 200);
    assert.match(r.message, /Test alert from Mix Nova RMC \(unit\)/);
    assert.equal(received[0].text, r.message);
    assert.equal(received[0].content, r.message);
    assert.equal(received[0].msg, 'alert_test');
  } finally { await closed(server); }
  const none = await quiet(() => new ErrorAlertService(undefined, {}).sendTest('unit'));
  assert.equal(none.configured, false);
  assert.equal(none.delivered, false);
  assert.match(none.error, /RMC_ALERT_WEBHOOK/, 'says which line to set');
  const { server: bad } = captureServer(404);
  await listen(bad);
  try {
    const r = await quiet(() => new ErrorAlertService(undefined, { RMC_ALERT_WEBHOOK: urlOf(bad) }).sendTest('unit'));
    assert.equal(r.delivered, false);
    assert.equal(r.status, 404);
    assert.match(r.error, /HTTP 404/);
  } finally { await closed(bad); }
  // Slack answers an incomplete URL with a 302 to a help page; following it
  // made a wrong URL look delivered (seen live: "sent" with nothing in the channel).
  const redirecting = [];
  const redirect = http.createServer((req, res) => { redirecting.push(req.url); res.writeHead(302, { Location: `http://127.0.0.1:${redirect.address().port}/help` }); res.end(); });
  await listen(redirect);
  try {
    const r = await quiet(() => new ErrorAlertService(undefined, { RMC_ALERT_WEBHOOK: urlOf(redirect) }).sendTest('unit'));
    assert.equal(r.delivered, false, 'a redirect is not a delivery');
    assert.equal(r.status, 302);
    assert.match(r.error, /redirected \(HTTP 302\).*incomplete or wrong/);
    assert.deepEqual(redirecting, ['/hook'], 'the redirect target is never followed');
  } finally { await closed(redirect); }
  const dead = await quiet(() => new ErrorAlertService({ timeoutMs: 300 }, { RMC_ALERT_WEBHOOK: 'http://127.0.0.1:1/closed' }).sendTest('unit'));
  assert.equal(dead.delivered, false);
  assert.ok(dead.error, 'a dead endpoint is reported, not thrown');
});

test('the ops routes are guarded like Settings and never return the webhook URL; the container receives the setting', () => {
  const ctl = read('apps/api/src/health/ops.controller.ts');
  assert.match(ctl, /@Controller\('ops'\)/);
  assert.match(ctl, /@UseGuards\(JwtAuthGuard, TenantGuard, PermissionsGuard\)/);
  assert.match(ctl, /@RequirePermissions\('settings\.manage'\)/);
  assert.match(ctl, /@Post\('alert-test'\)/);
  assert.match(ctl, /@Get\('alerting'\)/);
  assert.ok(!/webhookUrl|RMC_ALERT_WEBHOOK\?\.trim\(\)\s*\|\||return .*process\.env\.(ALERT_WEBHOOK_URL|RMC_ALERT_WEBHOOK)\s*[,}]/.test(codeOnly(ctl)), 'the URL (a secret) is never in a response');
  assert.match(read('apps/api/src/health/health.module.ts'), /OpsController/);
  const compose = read('docker/docker-compose.prod.yml');
  const api = compose.slice(compose.indexOf('\n  api:\n'), compose.indexOf('\n  web:\n'));
  for (const k of ['ALERT_WEBHOOK_URL', 'RMC_ALERT_WEBHOOK', 'ALERT_DIGEST_ENABLED', 'GST_WORKER_ENABLED', 'GST_WORKER_INTERVAL_MS', 'ALERT_TIMEOUT_MS']) {
    assert.match(api, new RegExp(`^\\s+${k}: \\$\\{${k}`, 'm'), `compose passes ${k} into the api container`);
  }
  assert.match(read('tests/rbac-authorization.mjs'), /'\/ops\/alert-test'/, 'the RBAC matrix covers the test route');
  // MinIO: Docker Hub refused the pull on a live deploy; the image is pinned to
  // the release the box runs, on a registry that still serves it, never `latest`.
  const minio = compose.slice(compose.indexOf('\n  minio:\n'), compose.indexOf('\n  migrate:\n'));
  assert.match(minio, /image: quay\.io\/minio\/minio:RELEASE\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z/, 'MinIO is pinned to a release tag on quay.io');
  assert.ok(!/minio:latest/.test(minio), 'never a floating tag');
  assert.match(minio, /pull_policy: missing/);
  for (const f of ['docs/deployment/DEPLOY-RUNBOOK-01-phase1-pilot.md', 'docs/deployment/DEPLOY-GHCR-PULL-01-phase1-pilot.md']) {
    assert.match(read(f), /docker-compose\.prod\.yml pull api web/, `${f} pulls the app images by name`);
  }
  const settings = read('apps/web/src/app/app/settings/page.tsx');
  assert.match(settings, /opsApi\.alertTest\(\)/, 'Settings has Send test alert');
  assert.match(settings, /gstApi\.status\(\)/, 'Settings says whether live GST filing is enabled');
});

test('every on-box script alerts through the one helper, which escapes and sends both render fields', async () => {
  for (const f of ['scripts/ops/health-check.sh', 'scripts/ops/rsc-503-monitor.sh', 'scripts/backup/pg-backup.sh', 'scripts/backup/verify-restore.sh']) {
    const src = read(f);
    assert.match(src, /lib-alert\.sh/, `${f} sources lib-alert.sh`);
    assert.ok(!/\{\\"text\\"/.test(src) && !/'\{"text"/.test(src), `${f} no longer hand-builds a {"text"} body`);
  }
  const lib = resolve(repoRoot, 'scripts/ops/lib-alert.sh');
  const { server, received } = captureServer(204);
  await listen(server);
  try {
    const msg = 'DOWN — api "unhealthy" \\ path C:\\x\nsecond line\ttab';
    const r = await runBash(`set -u; . "${lib}"; rmc_alert "$MSG"; rc=$?; echo "rc=$rc http=$RMC_ALERT_HTTP"; exit 0`, { ...process.env, NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1', MSG: msg, RMC_ALERT_WEBHOOK: urlOf(server) });
    assert.equal(r.stdout.trim(), 'rc=0 http=204', r.stderr);
    assert.equal(received.length, 1);
    assert.equal(received[0].text, msg, 'quotes, backslashes, newlines and tabs survive as JSON');
    assert.equal(received[0].content, msg, 'Discord\'s field carries the same text');
  } finally { await closed(server); }
  const { server: refusing } = captureServer(400);
  await listen(refusing);
  try {
    const r = await runBash(`set -u; . "${lib}"; rmc_alert "x"; echo "rc=$? http=$RMC_ALERT_HTTP"`, { ...process.env, NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1', RMC_ALERT_WEBHOOK: urlOf(refusing) });
    assert.equal(r.stdout.trim(), 'rc=2 http=400', 'a refusal is a distinct outcome');
  } finally { await closed(refusing); }
  const none = spawnSync('bash', ['-c', `set -u; . "${lib}"; rmc_alert "x"; echo "rc=$?"`], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(none.stdout.trim(), 'rc=1', 'no webhook → 1, nothing sent');
  // The env file is read when the environment has nothing, either name, quotes stripped.
  const dir = mkdtempSync(join(tmpdir(), 'rmc-alert-'));
  writeFileSync(join(dir, 'env'), 'FOO=1\nALERT_WEBHOOK_URL="https://hooks.example/abc"\n');
  const fromFile = spawnSync('bash', ['-c', `set -u; ENV_FILE="${join(dir, 'env')}"; . "${lib}"; echo "$(rmc_alert_webhook) $(rmc_alert_webhook_source)"`], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(fromFile.stdout.trim(), 'https://hooks.example/abc ALERT_WEBHOOK_URL');
});

/** A fake rclone on PATH: answers listremotes / lsf / version / config create the way the real one does. */
function rcloneStub(dir, { newestTs, missingBucket = false }) {
  const bin = join(dir, 'rclone');
  writeFileSync(bin, `#!/usr/bin/env bash
case "$1" in
  version) echo "rclone v1.60.1"; exit 0 ;;
  listremotes) echo "b2:"; exit 0 ;;
  "config")
     if [ "$2" = "file" ]; then echo "$HOME/.config/rclone/rclone.conf"; exit 0; fi
     if [ "$2" = "create" ]; then echo "[$3]"; echo "type = $4"; echo "key = SHOULD-NOT-BE-SHOWN"; exit 0; fi ;;
  lsf)
     target="\${@: -1}"
     if [ "${missingBucket ? 1 : 0}" = "1" ] && printf '%s' "$target" | grep -q missing; then exit 1; fi
     if printf '%s' "$*" | grep -q -- '--max-depth 1'; then echo "postgres/"; exit 0; fi
     if printf '%s' "$*" | grep -q -- '--format tsp'; then echo "${newestTs};4096;rmc-daily-2026-09-14T02-15.dump"; echo "${newestTs};5120;rmc-daily-2026-09-15T02-15.dump"; exit 0; fi
     echo "rmc-daily-2026-09-14T02-15.dump"; echo "rmc-daily-2026-09-15T02-15.dump"; exit 0 ;;
esac
exit 0
`);
  chmodSync(bin, 0o755);
  return bin;
}
const isoHoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString().replace(/\.\d{3}Z$/, '');

test('offbox-setup.sh --verify reads the bucket and judges the newest dump; setup stores the key silently and refuses a missing bucket', () => {
  const script = resolve(repoRoot, 'scripts/backup/offbox-setup.sh');
  const dir = mkdtempSync(join(tmpdir(), 'rmc-offbox-'));
  const env = join(dir, 'env');
  const run = (args, extraEnv = {}, envBody = 'POSTGRES_DB=rmc\nRMC_OFFBOX_RCLONE=b2:rmc-backups\n') => {
    writeFileSync(env, envBody);
    return spawnSync('bash', [script, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: `${dir}:${process.env.PATH}`, HOME: dir, ENV_FILE: env, ...extraEnv } });
  };
  rcloneStub(dir, { newestTs: isoHoursAgo(3) });
  let r = run(['--verify']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /bucket b2:rmc-backups reachable/);
  assert.match(r.stdout, /2 dump\(s\); newest rmc-daily-2026-09-15T02-15\.dump \(5120 bytes\), 3h old/);
  assert.match(r.stdout, /OFF-BOX BACKUP OK/);
  rcloneStub(dir, { newestTs: isoHoursAgo(80) });
  r = run(['--verify']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /80h old — recent backups are not reaching the bucket/);
  r = run(['--verify'], {}, 'POSTGRES_DB=rmc\n');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /no RMC_OFFBOX_RCLONE/);
  // setup (dry run): the secret is never printed, the env line is written, the bucket is probed read-only.
  rcloneStub(dir, { newestTs: isoHoursAgo(1), missingBucket: true });
  r = run(['--bucket', 'rmc-backups', '--replace', '--dry-run'], { OFFBOX_KEY_ID: 'keyid123', OFFBOX_KEY_SECRET: 'K00SECRET-VALUE' }, 'POSTGRES_DB=rmc\n');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(!r.stdout.includes('K00SECRET-VALUE') && !r.stderr.includes('K00SECRET-VALUE'), 'the application key is never echoed');
  assert.ok(!r.stdout.includes('SHOULD-NOT-BE-SHOWN'), 'rclone\'s own echo of the section is silenced');
  assert.match(readFileSync(env, 'utf8'), /^RMC_OFFBOX_RCLONE=b2:rmc-backups$/m, 'the target is written to the env file');
  assert.match(r.stdout, /dry run — stopping before the trial backup/);
  r = run(['--bucket', 'missing-bucket', '--replace', '--dry-run'], { OFFBOX_KEY_ID: 'k', OFFBOX_KEY_SECRET: 's' }, 'POSTGRES_DB=rmc\n');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Refusing to create it/);
  assert.ok(!/RMC_OFFBOX_RCLONE=b2:missing-bucket/.test(readFileSync(env, 'utf8')), 'nothing is written for a bucket that is not there');
  r = run(['--verify'], {}, 'POSTGRES_DB=rmc\nRMC_OFFBOX_RCLONE=b2:\n');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /names no bucket/);
});

test('gst-enable.sh writes the live-filing lines safely, never prints a secret, and refuses the wrong things', () => {
  const script = resolve(repoRoot, 'scripts/ops/gst-enable.sh');
  const dir = mkdtempSync(join(tmpdir(), 'rmc-gst-'));
  const env = join(dir, 'env');
  const pem = join(dir, 'portal.pem');
  writeFileSync(pem, '-----BEGIN PUBLIC KEY-----\r\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA\r\n-----END PUBLIC KEY-----\r\n');
  const base = { PATH: process.env.PATH, ENV_FILE: env, GST_IRP_BASE_URL: 'https://gsp-sandbox.example/eivital/', GST_GSP_CLIENT_ID: 'client$1', GST_GSP_CLIENT_SECRET: 'sec#ret$2', GST_RSA_PUBLIC_KEY_FILE: pem };
  const run = (args, extra = {}) => spawnSync('bash', [script, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...base, ...extra } });
  writeFileSync(env, 'POSTGRES_DB=rmc\nGST_PROVIDER=disabled\n# GST_CRED_ENC_KEY=__REPLACE_WITH_openssl_rand_hex_32__\n');
  let r = run(['--sandbox', '--dry-run']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = readFileSync(env, 'utf8');
  assert.match(out, /^GST_PROVIDER=nic$/m);
  assert.match(out, /^GST_ENV=sandbox$/m);
  assert.match(out, /^GST_WORKER_ENABLED=true$/m);
  assert.match(out, /^GST_IRP_BASE_URL='https:\/\/gsp-sandbox\.example\/eivital'$/m, 'trailing slash dropped, single-quoted so $ stays literal');
  assert.match(out, /^GST_GSP_CLIENT_ID='client\$1'$/m);
  assert.match(out, /^GST_GSP_CLIENT_SECRET='sec#ret\$2'$/m);
  assert.match(out, /^GST_RSA_PUBLIC_KEY_PEM="-----BEGIN PUBLIC KEY-----\\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA\\n-----END PUBLIC KEY-----"$/m, 'one double-quoted line with \\n, CRs dropped');
  assert.match(out, /^GST_CRED_ENC_KEY=[0-9a-f]{64}$/m, 'a 32-byte key generated once');
  assert.equal((out.match(/^GST_PROVIDER=/gm) ?? []).length, 1, 'the existing line is replaced, not duplicated');
  for (const secret of ['sec#ret$2', /[0-9a-f]{64}/]) {
    assert.ok(!(typeof secret === 'string' ? r.stdout.includes(secret) : secret.test(r.stdout)), 'no secret on stdout');
  }
  assert.match(r.stdout, /GST_CRED_ENC_KEY generated/);
  // A second run keeps the key.
  const key = /^GST_CRED_ENC_KEY=(.*)$/m.exec(out)[1];
  r = run(['--sandbox', '--dry-run']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /already present \(kept\)/);
  assert.equal(/^GST_CRED_ENC_KEY=(.*)$/m.exec(readFileSync(env, 'utf8'))[1], key);
  // status never prints values.
  r = run(['--status']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /GST_PROVIDER=nic/);
  assert.match(r.stdout, /GST_GSP_CLIENT_SECRET set/);
  assert.ok(!r.stdout.includes('sec#ret') && !r.stdout.includes(key));
  // refusals
  r = run(['--production', '--dry-run']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /looks like a sandbox/);
  r = run(['--sandbox', '--dry-run'], { GST_GSP_CLIENT_SECRET: "it's" });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /must not contain a single quote/);
  r = run(['--sandbox', '--dry-run'], { GST_IRP_BASE_URL: 'http://plain.example' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /must start with https/);
  // off
  r = run(['--off', '--dry-run']);
  assert.equal(r.status, 0);
  assert.match(readFileSync(env, 'utf8'), /^GST_PROVIDER=disabled$/m);
  assert.match(readFileSync(env, 'utf8'), /^GST_WORKER_ENABLED=false$/m);
  // and the API restores the PEM's line breaks from the one-line form
  assert.match(codeOnly(read('apps/api/src/compliance/nic.provider.ts')), /GST_RSA_PUBLIC_KEY_PEM'\) v = v\.replace\(\/\\\\n\/g, '\\n'\)/);
});

test('alert-test.sh explains itself when nothing is set, and never prints the URL when something is', () => {
  const script = resolve(repoRoot, 'scripts/ops/alert-test.sh');
  const dir = mkdtempSync(join(tmpdir(), 'rmc-alerttest-'));
  writeFileSync(join(dir, 'env'), 'POSTGRES_DB=rmc\n');
  let r = spawnSync('bash', [script], { encoding: 'utf8', env: { PATH: process.env.PATH, ENV_FILE: join(dir, 'env'), COMPOSE_FILE: join(dir, 'nope.yml') } });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /no alert webhook is set/);
  assert.match(r.stdout, /Discord:/);
  writeFileSync(join(dir, 'env'), 'RMC_ALERT_WEBHOOK=https://discord.com/api/webhooks/1234567890/SECRET-TOKEN-XYZ\n');
  r = spawnSync('bash', [script], { encoding: 'utf8', env: { PATH: process.env.PATH, ENV_FILE: join(dir, 'env'), COMPOSE_FILE: join(dir, 'nope.yml') } });
  assert.ok(!r.stdout.includes('SECRET-TOKEN-XYZ'), 'the webhook token never appears in the output');
  assert.match(r.stdout, /webhook set via RMC_ALERT_WEBHOOK → discord\.com/);
  r = spawnSync('bash', [script, '2f9f750'], { encoding: 'utf8', env: { PATH: process.env.PATH, ENV_FILE: join(dir, 'env') } });
  assert.equal(r.status, 2, 'a stray commit argument is refused like the other deploy-path scripts');
});

test('alert-test.sh --set FILE writes the one setting from a file, refuses placeholders and truncated copies, deletes the file', () => {
  const script = resolve(repoRoot, 'scripts/ops/alert-test.sh');
  const dir = mkdtempSync(join(tmpdir(), 'rmc-alertset-'));
  const env = join(dir, 'env'); const f = join(dir, 'webhook.txt');
  const noDocker = join(dir, 'bin'); // a PATH without docker, so the recreate step is skipped deterministically
  execFileSyncSafe('mkdir', ['-p', noDocker]);
  // no curl on this PATH either: the test must never reach the real Slack host
  for (const tool of ['bash', 'tr', 'awk', 'sed', 'mktemp', 'cat', 'rm', 'chmod', 'grep', 'cut', 'head', 'date', 'printf', 'seq', 'sleep', 'dirname']) {
    const found = process.env.PATH.split(':').map((d) => join(d, tool)).find((p) => existsSyncSafe(p));
    if (found) execFileSyncSafe('ln', ['-sf', found, join(noDocker, tool)]);
  }
  const run = () => spawnSync('bash', [script, '--set', f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: noDocker, ENV_FILE: env, COMPOSE_FILE: join(dir, 'nope.yml') } });
  writeFileSync(env, 'POSTGRES_DB=rmc\nALERT_WEBHOOK_URL=https://old.example/x\nRMC_ALERT_WEBHOOK=https://hooks.slack.com/services/T0/B0/old-old-old-old-old-old-old-old-old-old\n');
  // the placeholder from a note, the exact failure seen live
  writeFileSync(f, 'https://hooks.slack.com/services/T…/B…/…\n');
  let r = run();
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /placeholder/);
  assert.match(readFileSync(env, 'utf8'), /old-old-old/, 'nothing written');
  // a truncated copy
  writeFileSync(f, 'https://hooks.slack.com/services/T0ABC/B0DEF/x\n');
  r = run();
  assert.equal(r.status, 1);
  assert.match(r.stdout, /truncated/);
  // the real thing (Slack-shaped, 80 chars)
  // Assembled at runtime: a literal of this shape trips GitHub's secret
  // scanning (Slack incoming webhook URL) and blocks the push.
  const token = 'aB3dE6fG9hJ2kL5mN8pQ1rS4';
  const good = ['https://hooks.slack.com', 'services', 'T0ABCDEFGHI', 'B0JKLMNOPQR', token].join('/');
  writeFileSync(f, good + '\n');
  r = run();
  const out = readFileSync(env, 'utf8');
  assert.equal((out.match(/^RMC_ALERT_WEBHOOK=/gm) ?? []).length, 1, 'exactly one line, the old one replaced');
  assert.ok(out.split('\n').includes(`RMC_ALERT_WEBHOOK=${good}`), 'the full URL is the value');
  assert.ok(!/ALERT_WEBHOOK_URL=/.test(out), 'the second name is removed so there is one setting');
  assert.ok(!existsSyncSafe(f), 'the scratch file is deleted');
  assert.match(r.stdout, /RMC_ALERT_WEBHOOK written .*Slack webhook, 8\d characters/);
  assert.match(r.stdout, /curl is not installed/, 'the send step ran and stopped at the missing curl, never reaching Slack');
  assert.ok(!r.stdout.includes(token), 'the token never appears in the output');
  assert.match(r.stdout, /docker or the compose file is not available here/, 'without docker it says the api was not recreated');
  // Discord is accepted too
  writeFileSync(f, 'https://discord.com/api/webhooks/123456789012345678/' + 'x'.repeat(68) + '\n');
  r = run();
  assert.match(r.stdout, /Discord webhook, 1\d\d characters/);
});
function existsSyncSafe(p) { try { readFileSync(p); return true; } catch { return false; } }
function execFileSyncSafe(cmd, args) { spawnSync(cmd, args); }
