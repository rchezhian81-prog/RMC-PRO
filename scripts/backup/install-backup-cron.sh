#!/usr/bin/env bash
# =============================================================================
#  Mix Nova RMC — install the automated Postgres backup schedule (idempotent)
# =============================================================================
#  Writes /etc/cron.d/rmc-backup so pg-backup.sh runs on a GFS cadence:
#     daily   02:15   (--label daily,   keeps 7)
#     weekly  Sun 02:30 (--label weekly, keeps 4)
#     monthly 1st 02:45 (--label monthly, keeps 3)
#  Then runs ONE verification backup now, so you know it works end-to-end before
#  trusting the schedule. Safe to re-run — it overwrites the same cron file.
#
#  USAGE (on the VPS, as root, from the repo root):
#     sudo ./scripts/backup/install-backup-cron.sh
#
#  The times are interpreted in BACKUP_CRON_TZ (default Asia/Kolkata), NOT in the
#  server's timezone, so a UTC server still backs up at 02:15 local:
#     sudo BACKUP_CRON_TZ=Asia/Kolkata ./scripts/backup/install-backup-cron.sh
#
#  Off-box copies stay opt-in: set RMC_OFFBOX_RCLONE or RMC_OFFBOX_SCP in
#  .env.production (see pg-backup.sh) and every dump is copied off VM3 too.
# =============================================================================
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# The schedule is written in THIS timezone, not the server's. A box serving an
# Indian plant is commonly left on UTC, which turns an intended 02:15 backup into
# a 07:45 IST one — a pg_dump and an off-box upload competing with dispatch and
# billing during the working morning.
#
# CRON_TZ is understood by Vixie-derived cron (Debian/Ubuntu). If a cron build
# does not understand it, the line is treated as an ordinary environment
# variable and the times fall back to server-local — i.e. exactly today's
# behaviour. So this can improve matters or be neutral, never worsen them.
BACKUP_CRON_TZ="${BACKUP_CRON_TZ:-Asia/Kolkata}"
CRON_FILE="/etc/cron.d/rmc-backup"
LOG_FILE="/var/log/rmc-backup.log"
BACKUP_SH="$REPO_ROOT/scripts/backup/pg-backup.sh"

log() { printf '[install-backup-cron] %s\n' "$*"; }
die() { printf '[install-backup-cron] ERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "run as root (writes $CRON_FILE) — use: sudo $0"
[ -x "$BACKUP_SH" ]  || die "not found/executable: $BACKUP_SH"
command -v docker >/dev/null 2>&1 || die "docker not found on PATH"
command -v cron >/dev/null 2>&1 || command -v crond >/dev/null 2>&1 || \
  log "WARN: cron daemon not detected — install it with: apt-get install -y cron && systemctl enable --now cron"

# The cron user: prefer the repo owner so dumps aren't root-owned.
RUN_USER="$(stat -c '%U' "$REPO_ROOT" 2>/dev/null || echo root)"
log "repo:   $REPO_ROOT"
log "user:   $RUN_USER"
log "log:    $LOG_FILE"

touch "$LOG_FILE" || die "cannot create $LOG_FILE"
chown "$RUN_USER" "$LOG_FILE" 2>/dev/null || true

# /etc/cron.d entries include the user field and need a trailing newline.
cat > "$CRON_FILE" <<EOF
# Mix Nova RMC — automated PostgreSQL logical backups (managed by
# scripts/backup/install-backup-cron.sh — edit there, not here).
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
CRON_TZ=$BACKUP_CRON_TZ
15 2 * * *  $RUN_USER  cd $REPO_ROOT && ./scripts/backup/pg-backup.sh                 >> $LOG_FILE 2>&1
30 2 * * 0  $RUN_USER  cd $REPO_ROOT && ./scripts/backup/pg-backup.sh --label weekly  >> $LOG_FILE 2>&1
45 2 1 * *  $RUN_USER  cd $REPO_ROOT && ./scripts/backup/pg-backup.sh --label monthly >> $LOG_FILE 2>&1
EOF
chmod 644 "$CRON_FILE" || die "cannot chmod $CRON_FILE"
log "wrote $CRON_FILE (daily 02:15, weekly Sun 02:30, monthly 1st 02:45 — $BACKUP_CRON_TZ)"

# Say what the server thinks the time is, so a timezone surprise is visible now
# rather than inferred weeks later from log timestamps.
log "server clock: $(date '+%Y-%m-%d %H:%M:%S %Z (UTC%:z)')"
if command -v python3 >/dev/null 2>&1; then
  IN_TZ="$(TZ="$BACKUP_CRON_TZ" date '+%H:%M %Z' 2>/dev/null || true)"
  [ -n "$IN_TZ" ] && log "same moment in $BACKUP_CRON_TZ: $IN_TZ"
fi
log "verify after the next run: grep 'starting daily backup' $LOG_FILE | tail -1"

# Nudge cron to reload where applicable (harmless if not needed).
systemctl reload cron 2>/dev/null || service cron reload 2>/dev/null || true

# ---- Verification backup now (proves the whole chain works) ----
log "running a verification backup now (--label install-check)…"
if sudo -u "$RUN_USER" bash -c "cd $REPO_ROOT && ./scripts/backup/pg-backup.sh --label install-check"; then
  log "verification backup OK — schedule is live."
  # Keep only the newest install-check dump (re-runs shouldn't pile up).
  ls -1t "$REPO_ROOT"/backups/postgres/rmc-install-check-*.dump 2>/dev/null | tail -n +2 | \
    while read -r f; do rm -f "$f" "$f.sha256"; done
  log "list backups:  ls -lh $REPO_ROOT/backups/postgres/"
else
  die "verification backup FAILED — fix the error above; the schedule is written but unproven."
fi
