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

In the commands below, replace the dump filename with a real one from
`ls -1t backups/postgres/*.dump` — the names carry the date and time they were taken.

```bash
# Safe: restore into a scratch DB, check it, drop it. Production untouched.
./scripts/backup/pg-restore.sh --file backups/postgres/rmc-daily-20260804-021500.dump

# Keep the scratch DB to poke at it:
./scripts/backup/pg-restore.sh --file backups/postgres/rmc-daily-20260804-021500.dump \
    --into rmc_restore_test --keep

# DANGER — overwrite the live DB (disaster recovery only):
./scripts/backup/pg-restore.sh --file backups/postgres/rmc-daily-20260804-021500.dump \
    --into rmc --confirm
```

Run a **restore test monthly** (and after any backup config change). A green restore
test is the only proof the backup works.

### What "it worked" means

The script only reports success if the restored database is actually usable. It
reads the archive **before** it changes anything (so a half-downloaded dump cannot
wipe the target on its way to failing), treats any `pg_restore` error as a failed
restore, and then counts real rows — the schema, at least one company, at least one
user. Anything less prints `RESTORE FAILED` and exits non-zero.

This matters most on the live database: restoring over data that is already there
looks identical to a restore that did nothing at all, so row counts alone cannot
tell you it worked.

### Undoing a restore

A live restore (`--into rmc --confirm`) takes a **safety dump of the current
database first**, named `rmc-pre-restore-<date>-<time>.dump`. If you restore the
wrong backup — or an older one than you meant — that file is how you get back
everything entered since the backup was taken. The script prints the exact command
to run; it also refuses to overwrite the live database at all if that safety dump
fails, unless you add `--force`.

Safety dumps are deliberately **never pruned** — the nightly GFS retention only
touches `rmc-daily-*`, `rmc-weekly-*` and `rmc-monthly-*`. Delete them by hand once
you are sure the restore was the right one.

## Off-box copy — required (Backblaze B2)
On-box copies die with the box. Every dump is copied off VM3 to **Backblaze B2**
(the configured target) via `rclone`. A **failed** off-box copy is *alerted*, not
silently logged (see `RMC_ALERT_WEBHOOK`) — a backup that never leaves the box is
the failure that loses everything when the box does.

**One-time setup on the VPS — one command** (as the user the backup cron runs
as, root on the pilot box):

```bash
# Create a PRIVATE bucket in the Backblaze console first (e.g. rmc-offbox-backups)
# and an application key scoped to it (Account → App Keys). Then:
./scripts/backup/offbox-setup.sh --bucket rmc-offbox-backups
#   installs rclone if missing → prompts for the keyID and the applicationKey
#   (typed hidden, stored only in ~/.config/rclone/rclone.conf) → checks the
#   bucket exists (read-only) → writes RMC_OFFBOX_RCLONE to .env.production →
#   takes a trial dump, copies it and reads it back → prints OFF-BOX BACKUP OK.

# Any time later — is it still working? (read-only; newest dump in the bucket, its age)
./scripts/backup/offbox-setup.sh --verify
```

Any S3-compatible store works too: `--type s3 --endpoint https://… --bucket NAME`.
`verify-app.sh` also checks the bucket on every deploy and fails when the newest
off-box dump is older than 48 hours.

<details><summary>Manual steps (what the script does)</summary>

```bash
sudo apt-get update && sudo apt-get install -y rclone   # or: curl https://rclone.org/install.sh | sudo bash
rclone config      # n) New remote → name: b2 → storage: "Backblaze B2" → account: <keyID>, key: <applicationKey>
rclone lsd b2:     # the bucket must be listed
# .env.production:  RMC_OFFBOX_RCLONE=b2:rmc-offbox-backups
```
</details>

After that, `pg-backup.sh` uploads each `.dump` + `.sha256` to B2 and **reads it
back** to confirm it landed (it doesn't just trust a zero exit code).

The bucket must **already exist**: `rclone copy` would otherwise *create* a
mistyped one, upload into it, and the read-back would pass against that same
typo — backups silently diverted to a bucket nobody monitors. So the script
probes the bucket read-only first (`rclone lsf`) and, if it is missing or
unreachable, **refuses the copy and alerts** rather than letting rclone conjure
it. The local dump is always kept. If you see
`off-box bucket … does not exist or is unreachable`, check `RMC_OFFBOX_RCLONE`
for a typo and confirm the bucket with `rclone lsd b2:`. Do **not**
rely on the same disk/VM as the database. An `scp` to a separate host is an
alternative — set `RMC_OFFBOX_SCP` and leave `RMC_OFFBOX_RCLONE` unset.

> **Timing the drill against RTO:** run `verify-restore.sh` and note how long the
> restore takes; that time is your restore-side RTO. Confirm the newest B2 dump
> restores cleanly, not just the on-box copy.

## Uploaded files (MinIO) — backed up nightly too

The dumps carry every record; the photos, scans and logos live in MinIO's data
volume, which no dump touches. `files-backup.sh` archives that volume every
night at 02:50 (`docker cp` out of the running container — no extra image, no
credentials, read-only), keeps seven, and copies each archive to the same
off-box target under `files/`. A failed copy is alerted like a dump's.
`install-backup-cron.sh` schedules it; `verify-app.sh` checks its age and the
off-box copy. Restore: `docs/deployment/restore-runbook.md` §6.

## What time do the backups actually run?

The schedules say 02:15 / 02:30 / 02:45, and the restore drill 03:15 — and those
are **IST**, not server time. `CRON_TZ=Asia/Kolkata` is written into both cron
files, so a server left on UTC still backs up overnight local rather than during
the working day.

This is worth knowing because it bit us: with no `CRON_TZ`, cron interprets
`15 2 * * *` in the server's timezone. On a UTC box that fires at **02:15 UTC =
07:45 IST** — a `pg_dump` plus an off-box upload landing mid-morning, against
live dispatch and billing traffic. The backups all succeeded, so nothing looked
wrong; only the timestamps in `/var/log/rmc-backup.log` showed it.

Override the zone if the plant is elsewhere:

```bash
sudo BACKUP_CRON_TZ=Asia/Dubai ./scripts/backup/install-backup-cron.sh
```

A cron build that does not understand `CRON_TZ` treats it as an ordinary
environment variable and falls back to server-local time — the old behaviour —
so this can only help or be neutral. Confirm which you got from the next run:

```bash
grep 'starting daily backup' /var/log/rmc-backup.log | tail -1
```

Those timestamps are in the **server's** zone, so on a UTC box a correctly
pinned 02:15 IST backup will appear there as `20:45` the previous day.

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
