/**
 * The uploaded files (MinIO) were not in any backup: dumps carry records, not
 * photos, scans or logos. files-backup.sh archives the volume nightly beside
 * the dumps and copies it off-box. Exercised here with a stub `docker` so the
 * script's real logic runs: the archive is a tar of /data, it is checksummed,
 * old ones are pruned per label, and an unusable off-box target keeps the
 * local copy and says so. Plus guards: the schedule includes it, the deploy
 * check watches it, container logs are capped, and the Roles screen no longer
 * offers platform-only keys.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const read = (rel) => readFileSync(resolve(repoRoot, rel), 'utf8');
const script = resolve(repoRoot, 'scripts/backup/files-backup.sh');

function stubDocker(dir, dataDir) {
  const bin = join(dir, 'bin'); mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'docker'), `#!/usr/bin/env bash
case "$1 $2" in
  "ps --format") echo "rmc-pilot-minio-1"; echo "rmc-pilot-api-1"; exit 0 ;;
  "cp rmc-pilot-minio-1:/data") tar cf - -C "${dataDir}" data; exit 0 ;;
esac
echo "unexpected docker $*" >&2; exit 1
`);
  chmodSync(join(bin, 'docker'), 0o755);
  return bin;
}

test('files-backup.sh archives the MinIO data via docker cp, checksums it, and prunes per label', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rmc-files-'));
  mkdirSync(join(dir, 'data', 'rmc', 'qc'), { recursive: true });
  writeFileSync(join(dir, 'data', 'rmc', 'qc', 'cube-1.jpg'), 'not really a jpeg');
  writeFileSync(join(dir, 'env'), 'POSTGRES_DB=rmc\n');
  const bin = stubDocker(dir, dir);
  const out = join(dir, 'out');
  const run = (extra = {}) => spawnSync('bash', [script], { encoding: 'utf8', env: { PATH: `${bin}:${process.env.PATH}`, ENV_FILE: join(dir, 'env'), FILES_BACKUP_DIR: out, KEEP_FILES: '3', ...extra } });
  let r = run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const files = readdirSync(out);
  const tgz = files.find((f) => /^rmc-files-daily-\d{8}-\d{6}\.tgz$/.test(f));
  assert.ok(tgz, `an archive named by label and time (${files.join(', ')})`);
  assert.ok(files.includes(`${tgz}.sha256`), 'with a checksum beside it');
  const listing = spawnSync('tar', ['tzf', join(out, tgz)], { encoding: 'utf8' }).stdout;
  assert.match(listing, /data\/rmc\/qc\/cube-1\.jpg/, 'the archive holds the data directory');
  assert.equal(spawnSync('bash', ['-c', `cd "${out}" && sha256sum -c "${tgz}.sha256"`], { encoding: 'utf8' }).status, 0, 'the checksum verifies');
  assert.match(r.stdout, /no off-box target set/, 'says when nothing is copied off-box');
  // retention: keep the newest 3 of the label
  for (let i = 0; i < 4; i++) { spawnSync('sleep', ['1.1']); run(); }
  const kept = readdirSync(out).filter((f) => f.endsWith('.tgz'));
  assert.equal(kept.length, 3, `keeps KEEP_FILES archives (${kept.length})`);
  // an off-box target without rclone: alerted, local copy kept, exit 0
  r = run({ RMC_OFFBOX_RCLONE: 'b2:rmc-offbox-backups' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /rclone not installed but RMC_OFFBOX_RCLONE is set \(local archive kept\)/);
  // MinIO not running: refuses clearly
  writeFileSync(join(bin, 'docker'), '#!/usr/bin/env bash\ncase "$1 $2" in "ps --format") echo "rmc-pilot-api-1"; exit 0;; esac; exit 1\n');
  r = run();
  assert.equal(r.status, 1);
  assert.match(r.stderr + r.stdout, /MinIO container rmc-pilot-minio-1 is not running/);
});

test('the schedule includes the files job, the deploy check watches it and the drill, and the restore is documented', () => {
  const cron = read('scripts/backup/install-backup-cron.sh');
  assert.match(cron, /^50 2 \* \* \*\s+\$RUN_USER\s+cd \$REPO_ROOT && \.\/scripts\/backup\/files-backup\.sh/m, 'nightly at 02:50');
  assert.match(cron, /files-backup\.sh --label install-check/, 'one archive is taken at install time');
  const verify = read('scripts/ops/verify-app.sh');
  assert.match(verify, /ok {3}"files backup"/);
  assert.match(verify, /bad "files backup" .*the nightly files job has stopped/);
  assert.match(verify, /warn "restore drill" "not scheduled — sudo \.\/scripts\/backup\/verify-restore\.sh --install-cron"/);
  assert.match(read('docs/deployment/restore-runbook.md'), /## 6\. Restore uploaded files \(MinIO\)/);
  assert.match(read('scripts/backup/README.md'), /## Uploaded files \(MinIO\) — backed up nightly too/);
});

test('container logs are capped on the services that talk; the Roles screen hides platform-only keys', () => {
  const compose = read('docker/docker-compose.prod.yml');
  assert.match(compose, /x-logging: &rotated-logs/);
  assert.match(compose, /max-size: '20m'/);
  for (const svc of ['api', 'web', 'nginx']) {
    const block = compose.slice(compose.indexOf(`\n  ${svc}:\n`));
    const head = block.slice(0, block.indexOf('\n  ', 5) > 0 ? block.indexOf('\n\n') : undefined);
    assert.match(head, /logging: \*rotated-logs/, `${svc} logs are rotated`);
  }
  assert.match(read('apps/web/src/app/app/roles/page.tsx'), /catalog\.filter\(\(p\) => !String\(p\.permissionKey\)\.startsWith\('platform\.'\)\)/);
});
