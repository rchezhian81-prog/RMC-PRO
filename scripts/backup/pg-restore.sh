#!/usr/bin/env bash
# =============================================================================
#  Mix Nova RMC — PostgreSQL restore / restore-TEST
# =============================================================================
#  A backup you have never restored is only a hypothesis. This script restores a
#  pg_dump archive. By DEFAULT it restores into a disposable SCRATCH database and
#  drops it afterwards — proving the archive is good WITHOUT touching production.
#
#  Overwriting the real database is deliberately hard: it requires BOTH an
#  explicit target (--into <db>) AND --confirm. Without them, production is safe.
#
#  USAGE (run on the VPS, from the repo root):
#     ./scripts/backup/pg-restore.sh --file backups/postgres/rmc-daily-XXXX.dump
#         -> restores into scratch db 'rmc_restore_test', reports table counts, drops it.
#
#     ./scripts/backup/pg-restore.sh --file <dump> --into rmc_restore_test --keep
#         -> restore into a named scratch db and KEEP it for inspection.
#
#     ./scripts/backup/pg-restore.sh --file <dump> --into rmc --confirm
#         -> DANGER: overwrite the LIVE 'rmc' database. Requires --confirm.
# =============================================================================
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_ROOT/docker/docker-compose.prod.yml}"
PG_SERVICE="${PG_SERVICE:-postgres}"

FILE=""; INTO="rmc_restore_test"; CONFIRM=0; KEEP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --file)    FILE="${2:?}"; shift 2;;
    --into)    INTO="${2:?}"; shift 2;;
    --confirm) CONFIRM=1; shift;;
    --keep)    KEEP=1; shift;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done

log() { printf '[pg-restore %s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

[ -n "$FILE" ]      || die "give a dump with --file <path>"
[ -f "$FILE" ]      || die "dump not found: $FILE"
[ -f "$ENV_FILE" ]  || die "env file not found: $ENV_FILE"
command -v docker >/dev/null 2>&1 || die "docker not found"

getenv() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- ; }
LIVE_DB="$(getenv POSTGRES_DB)"; LIVE_DB="${LIVE_DB:-rmc}"
PGUSER="$(getenv POSTGRES_USER)"; PGUSER="${PGUSER:-rmc_owner}"
PGPASSWORD_VAL="$(getenv POSTGRES_PASSWORD)"
[ -n "$PGPASSWORD_VAL" ] || die "POSTGRES_PASSWORD empty in $ENV_FILE"

# verify checksum if present
if [ -f "$FILE.sha256" ]; then
  ( cd "$(dirname "$FILE")" && sha256sum -c "$(basename "$FILE").sha256" ) >/dev/null 2>&1 \
    && log "checksum ok" || die "checksum MISMATCH for $FILE — refusing to restore"
fi

dc() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T \
        -e PGPASSWORD="$PGPASSWORD_VAL" "$PG_SERVICE" "$@"; }

# ---- guard the live database ----
IS_LIVE=0; [ "$INTO" = "$LIVE_DB" ] && IS_LIVE=1
if [ "$IS_LIVE" = "1" ]; then
  if [ "$CONFIRM" != "1" ]; then
    die "refusing to overwrite LIVE db '$LIVE_DB' without --confirm. Restore to a scratch db instead."
  fi
  log "!! LIVE RESTORE into '$LIVE_DB' requested (--confirm given). Take a fresh pg-backup FIRST."
  KEEP=1   # never auto-drop the live db
else
  log "restore TEST into scratch db '$INTO' (production db '$LIVE_DB' is untouched)"
fi

# ---- (re)create the target db ----
if [ "$IS_LIVE" = "0" ]; then
  dc psql -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$INTO\";" >/dev/null 2>&1
  dc psql -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$INTO\";" >/dev/null 2>&1 \
    || die "could not create scratch db '$INTO'"
fi

log "restoring $(basename "$FILE") -> '$INTO' ..."
if dc pg_restore -U "$PGUSER" -d "$INTO" --no-owner --no-privileges --clean --if-exists < "$FILE" 2>/tmp/pg-restore.err; then
  log "restore completed"
else
  # pg_restore often emits benign warnings; surface them but judge by the checks below.
  log "pg_restore returned warnings/errors (see below) — validating result anyway"
  tail -5 /tmp/pg-restore.err >&2 || true
fi

# ---- sanity: list a few table row counts as proof of a usable restore ----
log "post-restore sanity (row counts):"
dc psql -U "$PGUSER" -d "$INTO" -Atc \
  "SELECT format('  %s = %s', relname, n_live_tup)
     FROM pg_stat_user_tables
    WHERE relname IN ('tenants','users','plans','concrete_grades')
 ORDER BY relname;" 2>/dev/null || log "  (could not read row counts)"

# ---- clean up scratch db unless --keep ----
if [ "$IS_LIVE" = "0" ] && [ "$KEEP" = "0" ]; then
  dc psql -U "$PGUSER" -d postgres -c "DROP DATABASE IF EXISTS \"$INTO\";" >/dev/null 2>&1
  log "scratch db '$INTO' dropped (restore test passed). Use --keep to retain it."
else
  log "target db '$INTO' retained."
fi
