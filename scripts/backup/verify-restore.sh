#!/usr/bin/env bash
# =============================================================================
#  Mix Nova RMC — automated restore drill  (roadmap A2)
# =============================================================================
#  A backup you have never restored is only a hypothesis. This turns the manual
#  restore-test into a repeatable, pass/fail drill: it restores the latest (or a
#  chosen) backup into a DISPOSABLE scratch database, asserts the schema and core
#  business tables actually came back, reports PASS/FAIL, then drops the scratch
#  db. Production is never touched.
#
#  USAGE (on the VPS, from the repo root):
#     ./scripts/backup/verify-restore.sh                 # drill the newest backup
#     ./scripts/backup/verify-restore.sh --file backups/postgres/rmc-daily-XXXX.dump
#     sudo ./scripts/backup/verify-restore.sh --install-cron    # monthly drill
#     sudo ./scripts/backup/verify-restore.sh --uninstall-cron
#
#  Exit 0 = restore verified. Exit 1 = FAILED (investigate the backup NOW).
#  If RMC_ALERT_WEBHOOK is set in .env.production, a FAIL is alerted.
# =============================================================================
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_ROOT/docker/docker-compose.prod.yml}"
PG_SERVICE="${PG_SERVICE:-postgres}"
BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/backups/postgres}"
SCRATCH="${SCRATCH:-rmc_restore_verify}"
MIN_MIGRATIONS="${MIN_MIGRATIONS:-10}"   # we ship 14; a floor that proves the schema applied
CRON_FILE="/etc/cron.d/rmc-restore-verify"
LOG_FILE="/var/log/rmc-restore-verify.log"

log() { printf '[verify-restore %s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }
getenv() { [ -f "$ENV_FILE" ] && grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- ; }

FILE=""
case "${1:-}" in
  --install-cron)   MODE=install ;;
  --uninstall-cron) MODE=uninstall ;;
  --file)           MODE=drill; FILE="${2:?--file needs a path}" ;;
  ''|--drill)       MODE=drill ;;
  *) die "unknown arg: $1 (use --file <dump> | --install-cron | --uninstall-cron)";;
esac

install_cron() {
  [ "$(id -u)" = "0" ] || die "run as root to (un)install cron — use: sudo $0 --install-cron"
  local run_user; run_user="$(stat -c '%U' "$REPO_ROOT" 2>/dev/null || echo root)"
  touch "$LOG_FILE" && chown "$run_user" "$LOG_FILE" 2>/dev/null || true
  cat > "$CRON_FILE" <<EOF
# Mix Nova RMC — monthly restore drill (managed by
# scripts/backup/verify-restore.sh — edit there, not here).
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
15 3 1 * *  $run_user  cd $REPO_ROOT && ./scripts/backup/verify-restore.sh >> $LOG_FILE 2>&1
EOF
  chmod 644 "$CRON_FILE"
  systemctl reload cron 2>/dev/null || service cron reload 2>/dev/null || true
  log "installed $CRON_FILE (1st of month, 03:15) -> $LOG_FILE"
  log "running one drill now:"; drill
}

uninstall_cron() {
  [ "$(id -u)" = "0" ] || die "run as root — use: sudo $0 --uninstall-cron"
  rm -f "$CRON_FILE" && log "removed $CRON_FILE" || log "nothing to remove"
  systemctl reload cron 2>/dev/null || service cron reload 2>/dev/null || true
}

dc_psql() {  # psql inside the postgres container, as the owner role
  local pw; pw="$(getenv POSTGRES_PASSWORD)"; local u; u="$(getenv POSTGRES_USER)"; u="${u:-rmc_owner}"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T -e PGPASSWORD="$pw" "$PG_SERVICE" \
    psql -U "$u" "$@"
}

fail() {
  log "RESTORE DRILL: FAIL — $1"
  local hook; hook="$(getenv RMC_ALERT_WEBHOOK)"
  [ -n "${hook:-}" ] && curl -fsS -m 8 -X POST -H 'Content-Type: application/json' \
    -d "{\"text\":\"RMC restore drill FAILED: $1\"}" "$hook" >/dev/null 2>&1
  dc_psql -d postgres -c "DROP DATABASE IF EXISTS \"$SCRATCH\";" >/dev/null 2>&1 || true
  exit 1
}

drill() {
  command -v docker >/dev/null 2>&1 || die "docker not on PATH"
  [ -f "$ENV_FILE" ] || die "missing $ENV_FILE"

  if [ -z "$FILE" ]; then
    FILE="$(ls -1t "$BACKUP_DIR"/rmc-*.dump 2>/dev/null | head -1)"
    [ -n "$FILE" ] || die "no backups found in $BACKUP_DIR — run pg-backup.sh first"
  fi
  [ -f "$FILE" ] || die "dump not found: $FILE"
  log "drilling $(basename "$FILE")"

  # Restore into the scratch db and KEEP it so we can inspect the result.
  if ! "$REPO_ROOT/scripts/backup/pg-restore.sh" --file "$FILE" --into "$SCRATCH" --keep; then
    fail "pg-restore.sh could not restore the archive"
  fi

  # Assert the schema + core tables actually came back. ON_ERROR_STOP makes a
  # missing table fail the query (a partial/corrupt restore).
  local out
  out="$(dc_psql -d "$SCRATCH" -v ON_ERROR_STOP=1 -Atc \
    "SELECT (SELECT count(*) FROM migrations)||'|'||(SELECT count(*) FROM tenants)||'|'||(SELECT count(*) FROM users)||'|'||(SELECT count(*) FROM invoices)||'|'||(SELECT count(*) FROM stock_balances)" 2>/tmp/verify-restore.err)" \
    || fail "core tables missing/unreadable after restore ($(tail -1 /tmp/verify-restore.err 2>/dev/null))"

  out="$(printf '%s' "$out" | tr -d '\r')"
  IFS='|' read -r m_ct t_ct u_ct i_ct s_ct <<< "$out"
  log "restored counts: migrations=$m_ct tenants=$t_ct users=$u_ct invoices=$i_ct stock_balances=$s_ct"
  [ "${m_ct:-0}" -ge "$MIN_MIGRATIONS" ] || fail "only $m_ct migration rows (< $MIN_MIGRATIONS) — schema did not fully restore"

  dc_psql -d postgres -c "DROP DATABASE IF EXISTS \"$SCRATCH\";" >/dev/null 2>&1
  log "RESTORE DRILL: PASS — $(basename "$FILE") restores cleanly (scratch db dropped)"
  exit 0
}

case "$MODE" in
  install)   install_cron ;;
  uninstall) uninstall_cron ;;
  drill)     drill ;;
esac
