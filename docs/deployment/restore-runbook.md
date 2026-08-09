# Restore Runbook (DR)

> A backup you have never restored is only a hypothesis. This runbook makes the
> restore **rehearsed** — proven monthly against a scratch database — and gives
> the exact steps for a real recovery.

## 1. The monthly drill (proves backups are restorable)

`scripts/backup/verify-restore.sh` restores the **latest** backup into a
disposable scratch database, asserts the schema and core tables came back, then
drops the scratch db. **Production is never touched.**

```bash
cd /opt/rmc
./scripts/backup/verify-restore.sh                 # drill the newest backup now
sudo ./scripts/backup/verify-restore.sh --install-cron   # + schedule it monthly (1st, 03:15)
```

- **PASS** → the log ends `RESTORE DRILL: PASS …` and exit code 0. Backups are good.
- **FAIL** → `RESTORE DRILL: FAIL …`, exit 1, and (if `RMC_ALERT_WEBHOOK` is set)
  an alert. **Investigate immediately** — your backups are not recoverable.

What it asserts: the `migrations` table has ≥ 10 rows (schema fully applied) and
`tenants`, `users`, `invoices`, `stock_balances` are all present and queryable
(a partial/corrupt restore makes the query error → FAIL). Verified counts are
printed each run. Log: `/var/log/rmc-restore-verify.log`.

**Cadence:** monthly (the installed cron), **and** after any change to the
backup config, Postgres version, or schema.

## 2. Inspect a backup by hand (optional)

```bash
# restore into a named scratch db and KEEP it to poke around; prod untouched
./scripts/backup/pg-restore.sh --file backups/postgres/rmc-daily-YYYYMMDD-HHMMSS.dump \
  --into rmc_restore_test --keep
# … inspect …
docker compose --env-file .env.production -f docker/docker-compose.prod.yml \
  exec -T postgres psql -U "$POSTGRES_USER" -d postgres -c 'DROP DATABASE rmc_restore_test;'
```

## 3. Real recovery — overwrite the LIVE database

**Only when production data is actually lost/corrupt.** This is deliberately hard
(requires `--into rmc --confirm`). Order matters:

```bash
cd /opt/rmc

# 3.1 Take a FRESH backup of the current (broken) state first — never skip this.
./scripts/backup/pg-backup.sh --label pre-restore

# 3.2 Stop the app so nothing writes during the restore (DB stays up).
docker compose --env-file .env.production -f docker/docker-compose.prod.yml stop api web

# 3.3 Restore the chosen good backup OVER the live db (guarded; checksum-verified).
./scripts/backup/pg-restore.sh --file backups/postgres/<good-dump>.dump --into rmc --confirm

# 3.4 Bring the app back and health-check.
docker compose --env-file .env.production -f docker/docker-compose.prod.yml start api web
./scripts/ops/verify-app.sh
```

Then sanity-check in the app: latest invoices/receipts, stock balances, and a
tenant login. If wrong, you still have `pre-restore` (3.1) to roll forward from.

## 4. Choosing which backup

`ls -lt backups/postgres/` — newest first. Files are
`rmc-<label>-<timestamp>.dump` (+ `.sha256`). Prefer the newest **daily** that
predates the corruption. Pre-redeploy snapshots (`rmc-pre-redeploy-*`) are handy
for undoing a bad migration specifically.

## 5. Layers & retention

| Layer | What | Retention |
|---|---|---|
| pg-backup (this) | granular logical dumps, per-table restore | GFS: 7 daily / 4 weekly / 3 monthly |
| MilesWeb Acronis | whole-VM image | 7 days (restore via MilesWeb ticket) |

**Off-box copy:** on-box backups don't survive losing the box. The configured
off-box target is **Backblaze B2** via rclone — set `RMC_OFFBOX_RCLONE=b2:<bucket>`
(and ideally `RMC_ALERT_WEBHOOK`) in `.env.production` so every dump is copied off
the VM and a failed copy is alerted (setup in `scripts/backup/README.md`). The
Acronis whole-VM image remains a second, independent off-box layer. In a real
recovery you can pull the newest dump back with
`rclone copy b2:<bucket>/<dump> backups/postgres/` before restoring.
