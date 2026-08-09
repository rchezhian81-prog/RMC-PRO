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
#  Off-box copies stay opt-in: set RMC_OFFBOX_RCLONE or RMC_OFFBOX_SCP in
#  .env.production (see pg-backup.sh) and every dump is copied off VM3 too.
# =============================================================================
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
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
15 2 * * *  $RUN_USER  cd $REPO_ROOT && ./scripts/backup/pg-backup.sh                 >> $LOG_FILE 2>&1
30 2 * * 0  $RUN_USER  cd $REPO_ROOT && ./scripts/backup/pg-backup.sh --label weekly  >> $LOG_FILE 2>&1
45 2 1 * *  $RUN_USER  cd $REPO_ROOT && ./scripts/backup/pg-backup.sh --label monthly >> $LOG_FILE 2>&1
EOF
chmod 644 "$CRON_FILE" || die "cannot chmod $CRON_FILE"
log "wrote $CRON_FILE (daily 02:15, weekly Sun 02:30, monthly 1st 02:45)"

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
