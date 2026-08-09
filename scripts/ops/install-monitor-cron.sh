#!/usr/bin/env bash
# =============================================================================
#  Mix Nova RMC — install the on-box health monitor schedule (idempotent)
# =============================================================================
#  Writes /etc/cron.d/rmc-monitor so health-check.sh runs every 5 minutes,
#  logging to /var/log/rmc-monitor.log and alerting (once per state change) if
#  RMC_ALERT_WEBHOOK is set in .env.production. Runs one check now to confirm.
#  Safe to re-run.
#
#  USAGE (on the VPS, as root, from the repo root):
#     sudo ./scripts/ops/install-monitor-cron.sh
# =============================================================================
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CRON_FILE="/etc/cron.d/rmc-monitor"
LOG_FILE="/var/log/rmc-monitor.log"
CHECK_SH="$REPO_ROOT/scripts/ops/health-check.sh"

log() { printf '[install-monitor-cron] %s\n' "$*"; }
die() { printf '[install-monitor-cron] ERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "run as root (writes $CRON_FILE) — use: sudo $0"
[ -x "$CHECK_SH" ]   || die "not found/executable: $CHECK_SH"

RUN_USER="$(stat -c '%U' "$REPO_ROOT" 2>/dev/null || echo root)"
touch "$LOG_FILE" || die "cannot create $LOG_FILE"
chown "$RUN_USER" "$LOG_FILE" 2>/dev/null || true
mkdir -p /var/lib/rmc && chown "$RUN_USER" /var/lib/rmc 2>/dev/null || true

cat > "$CRON_FILE" <<EOF
# Mix Nova RMC — on-box health monitor every 5 min (managed by
# scripts/ops/install-monitor-cron.sh — edit there, not here).
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
*/5 * * * *  $RUN_USER  cd $REPO_ROOT && ./scripts/ops/health-check.sh >> $LOG_FILE 2>&1
EOF
chmod 644 "$CRON_FILE" || die "cannot chmod $CRON_FILE"
log "wrote $CRON_FILE (every 5 min) -> $LOG_FILE"
systemctl reload cron 2>/dev/null || service cron reload 2>/dev/null || true

log "running one check now:"
sudo -u "$RUN_USER" bash -c "cd $REPO_ROOT && ./scripts/ops/health-check.sh" || \
  log "check reported problems (see line above) — the monitor is installed and will keep watching."
log "done. tail the log with:  tail -f $LOG_FILE"
