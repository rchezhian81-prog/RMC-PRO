# Mix Nova RMC — independent PostgreSQL backups

These scripts add a **granular, portable, self-controlled** backup layer on top of
Acronis. Acronis (whole-VM image, 7-day retention, restored via a MilesWeb ticket) is
disaster recovery; it cannot "undo one bad migration." `pg_dump` can.

| Script | What it does | Touches production? |
|---|---|---|
| `pg-backup.sh` | Compressed `pg_dump -Fc` + checksum + GFS pruning | **No** — `pg_dump` is read-only |
| `pg-restore.sh` | Restores an archive; **defaults to a scratch DB** | Only with `--into <live> --confirm` |

Both read DB name + owner credentials from `.env.production` (the same file the stack
uses) and **never print secrets**.

## Prerequisites
- The pilot stack is up (`postgres` service running) via `docker/docker-compose.prod.yml`.
- `.env.production` exists and is filled in (see `.env.production.example`).
- Run from the repo root on the VPS.

## Nightly backup

```bash
./scripts/backup/pg-backup.sh                    # label "daily"
./scripts/backup/pg-backup.sh --label pre-migrate # a named snapshot before migrating
```

Output: `backups/postgres/rmc-<label>-<timestamp>.dump` (+ `.sha256`).
Files are created with `umask 077` (owner-only).

### Cron — GFS cadence
Schedule the same script with different labels so daily/weekly/monthly rotate
independently. Retention counts default to 7 / 4 / 3 (override via env).

```cron
# daily 02:15, weekly Sun 02:30, monthly 1st 02:45
15 2 * * *  cd /opt/rmc && ./scripts/backup/pg-backup.sh --label daily   >> /var/log/rmc-backup.log 2>&1
30 2 * * 0  cd /opt/rmc && ./scripts/backup/pg-backup.sh --label weekly  >> /var/log/rmc-backup.log 2>&1
45 2 1 * *  cd /opt/rmc && ./scripts/backup/pg-backup.sh --label monthly >> /var/log/rmc-backup.log 2>&1
```

## Restore — always test before you trust

```bash
# Safe: restore into a scratch DB, print row counts, drop it. Production untouched.
./scripts/backup/pg-restore.sh --file backups/postgres/rmc-daily-20260804-021500.dump

# Keep the scratch DB to poke at it:
./scripts/backup/pg-restore.sh --file <dump> --into rmc_restore_test --keep

# DANGER — overwrite the live DB (disaster recovery only). Take a fresh backup first:
./scripts/backup/pg-restore.sh --file <dump> --into rmc --confirm
```

Run a **restore test monthly** (and after any backup config change). A green restore
test is the only proof the backup works.

## Off-box copy — required
On-box copies die with the box. Uncomment and configure one transport in
`pg-backup.sh` (rclone / `mc` to a *separate* S3-or-MinIO / `scp` to another host) so a
copy lives somewhere that survives loss of VM3. Do **not** rely on the same disk/VM as
the database.

## Retention & the deploy flow
- `pg-backup.sh --label pre-migrate` **before every migration** — the rollback anchor
  referenced in the deploy runbook (§7 rollback) and plan (§5, §11).
- GFS defaults: 7 daily, 4 weekly, 3 monthly — independent of Acronis' 7 days.

## Optional hardening
- **Encryption at rest:** pipe the dump through `age`/`gpg` before the off-box copy, or
  rely on an encrypted destination bucket. Keep keys off VM3.
- **PITR (RPO < 24h):** enable WAL archiving on Postgres and ship WAL to object storage.
  Recommended before real (non-pilot) customer data; not required for the supervised pilot.

## Safety notes
- `pg_dump` never writes to the database. `pg-restore.sh` cannot overwrite the live DB
  without both `--into <live>` and `--confirm`, and it verifies the `.sha256` first.
- Never commit `backups/` — it is git-ignored. Never paste dump contents into chat.
