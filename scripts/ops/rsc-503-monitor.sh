#!/usr/bin/env bash
# =============================================================================
#  Mix Nova RMC — RSC prefetch 5xx watch  (QA #7 soak monitor)
# =============================================================================
#  Next.js sidebar hovers fire speculative RSC prefetch requests
#  (GET …?_rsc=<hash>) that were intermittently returning 503 under load. The
#  fix (prefetch={false} on sidebar links) removed the known trigger; this keeps
#  an eye on whether ANY _rsc= request still 5xx's, so the item can be closed on
#  evidence rather than a single clean pass.
#
#  It scans the nginx access log (combined format → docker logs) for the last
#  window and counts requests whose path contains `_rsc=` and whose status is
#  5xx. Read-only; touches nothing but its own log file.
#
#  USAGE (on the VPS, from the repo root):
#     ./scripts/ops/rsc-503-monitor.sh                 # one check now (default 16m window)
#     WINDOW=1h ./scripts/ops/rsc-503-monitor.sh       # custom lookback
#     sudo ./scripts/ops/rsc-503-monitor.sh --install-cron    # every 15 min -> /var/log/rmc-rsc-monitor.log
#     sudo ./scripts/ops/rsc-503-monitor.sh --uninstall-cron  # remove when the soak is done
#
#  If RMC_ALERT_WEBHOOK is set in .env.production, a one-line alert is POSTed the
#  moment a 5xx prefetch is seen (same convention as health-check.sh).
# =============================================================================
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_ROOT/docker/docker-compose.prod.yml}"
WINDOW="${WINDOW:-16m}"          # a touch over the 15-min cron so nothing slips the boundary
NGINX_SERVICE="${NGINX_SERVICE:-nginx}"
CRON_FILE="/etc/cron.d/rmc-rsc-monitor"
LOG_FILE="/var/log/rmc-rsc-monitor.log"

log() { printf '[rsc-monitor] %s\n' "$*"; }
die() { printf '[rsc-monitor] ERROR: %s\n' "$*" >&2; exit 1; }
getenv() { [ -f "$ENV_FILE" ] && grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- ; }

install_cron() {
  [ "$(id -u)" = "0" ] || die "run as root to (un)install cron — use: sudo $0 --install-cron"
  local run_user; run_user="$(stat -c '%U' "$REPO_ROOT" 2>/dev/null || echo root)"
  touch "$LOG_FILE" && chown "$run_user" "$LOG_FILE" 2>/dev/null || true
  cat > "$CRON_FILE" <<EOF
# Mix Nova RMC — RSC prefetch 5xx watch every 15 min (managed by
# scripts/ops/rsc-503-monitor.sh — edit there, not here).
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
*/15 * * * *  $run_user  cd $REPO_ROOT && ./scripts/ops/rsc-503-monitor.sh >> $LOG_FILE 2>&1
EOF
  chmod 644 "$CRON_FILE"
  systemctl reload cron 2>/dev/null || service cron reload 2>/dev/null || true
  log "installed $CRON_FILE (every 15 min) -> $LOG_FILE"
  log "tail it with:  tail -f $LOG_FILE"
  log "running one check now:"
  check
}

uninstall_cron() {
  [ "$(id -u)" = "0" ] || die "run as root to uninstall — use: sudo $0 --uninstall-cron"
  rm -f "$CRON_FILE" && log "removed $CRON_FILE" || log "nothing to remove"
  systemctl reload cron 2>/dev/null || service cron reload 2>/dev/null || true
}

check() {
  command -v docker >/dev/null 2>&1 || die "docker not on PATH"
  local dc=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
  local ts hits count
  ts="$(date '+%Y-%m-%d %H:%M:%S')"
  # Combined log line: "... \"GET /path?_rsc=hash HTTP/2.0\" 5xx ...". Match a
  # request line containing _rsc= immediately followed by a 5xx status.
  hits="$("${dc[@]}" logs --since "$WINDOW" "$NGINX_SERVICE" 2>/dev/null \
            | grep -E '"[A-Z]+ [^"]*_rsc=[^"]*" 50[0-9]' || true)"
  count="$(printf '%s\n' "$hits" | grep -c '_rsc=' || true)"

  if [ "${count:-0}" -gt 0 ]; then
    printf '[%s] RSC 5xx in last %s: %s  <-- ATTENTION\n' "$ts" "$WINDOW" "$count"
    printf '%s\n' "$hits" | sed -E 's/^/    /' | tail -20
    local hook; hook="$(getenv RMC_ALERT_WEBHOOK)"
    if [ -n "${hook:-}" ]; then
      curl -fsS -m 8 -X POST -H 'Content-Type: application/json' \
        -d "{\"text\":\"RMC: ${count} RSC prefetch 5xx in last ${WINDOW} on $(getenv DOMAIN 2>/dev/null || echo host)\"}" \
        "$hook" >/dev/null 2>&1 && log "alert sent" || log "WARN: alert webhook POST failed"
    fi
  else
    printf '[%s] RSC 5xx in last %s: 0 (clean)\n' "$ts" "$WINDOW"
  fi
}

case "${1:-}" in
  --install-cron)   install_cron ;;
  --uninstall-cron) uninstall_cron ;;
  ''|--check)       check ;;
  *) die "unknown arg: $1 (use --install-cron | --uninstall-cron | --check)";;
esac
