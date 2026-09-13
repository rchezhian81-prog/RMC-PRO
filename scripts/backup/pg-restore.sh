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
#  A restore is only reported as successful if the restored database is actually
#  usable: the schema is there, and there is at least one tenant and one user.
#  Exit 0 means verified. Any other exit means DO NOT trust the result.
#
#  USAGE (run on the VPS, from the repo root):
#     ./scripts/backup/pg-restore.sh --file backups/postgres/rmc-daily-XXXX.dump
#         -> restores into scratch db 'rmc_restore_test', verifies it, drops it.
#
#     ./scripts/backup/pg-restore.sh --file <dump> --into rmc_restore_test --keep
#         -> restore into a named scratch db and KEEP it for inspection.
#
#     ./scripts/backup/pg-restore.sh --file <dump> --into rmc --confirm
#         -> DANGER: overwrite the LIVE 'rmc' database. Requires --confirm.
#            Takes a safety dump of the live database FIRST, so that a restore
#            of the wrong backup can itself be undone. Today's work is only
#            recoverable because of that dump — do not skip it lightly.
#
#  Extra flags for the live path:
#     --no-safety-dump   skip the pre-restore safety dump
#     --force            proceed even if the safety dump fails (no way back)
# =============================================================================
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_ROOT/docker/docker-compose.prod.yml}"
PG_SERVICE="${PG_SERVICE:-postgres}"
BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/backups/postgres}"

FILE=""; INTO="rmc_restore_test"; CONFIRM=0; KEEP=0; SAFETY=1; FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --file)            FILE="${2:?}"; shift 2;;
    --into)            INTO="${2:?}"; shift 2;;
    --confirm)         CONFIRM=1; shift;;
    --keep)            KEEP=1; shift;;
    --no-safety-dump)  SAFETY=0; shift;;
    --force)           FORCE=1; shift;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done

log() { printf '[pg-restore %s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
# psql reports an error over several lines, the last of which is just a caret
# pointing into the query. The line carrying ERROR is the one worth repeating.
first_error() { grep -m1 'ERROR' "$1" 2>/dev/null | sed 's/^ *//' | cut -c1-200; }
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
else
  # A dump fetched back from off-box storage often arrives without its sidecar.
  # The header check below is then the only proof the file is not truncated.
  log "note: no $(basename "$FILE").sha256 alongside the dump — cannot verify the file is complete by checksum"
fi
[ -s "$FILE" ] || die "dump file is empty: $FILE"
[ "$(head -c5 "$FILE" 2>/dev/null)" = "PGDMP" ] \
  || die "not a custom-format pg_dump archive (missing PGDMP header) — truncated or wrong file: $FILE"

dc() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T \
        -e PGPASSWORD="$PGPASSWORD_VAL" "$PG_SERVICE" "$@"; }

# Read the archive's table of contents before touching anything. A dump that was
# cut short in transit still starts with a valid PGDMP header, and --clean would
# drop the live tables before discovering it cannot be read. Failing here costs
# nothing; failing later costs the database.
if dc pg_restore --list < "$FILE" >/dev/null 2>/tmp/pg-restore-list.err; then
  log "archive contents readable (pg_restore --list ok)"
else
  die "cannot read the archive's contents — it is truncated or corrupt, and nothing has been changed: $(sed -n 's/^pg_restore: error: *//p' /tmp/pg-restore-list.err | head -1)"
fi

# ---- guard the live database ----
IS_LIVE=0; [ "$INTO" = "$LIVE_DB" ] && IS_LIVE=1
SAFETY_FILE=""
if [ "$IS_LIVE" = "1" ]; then
  if [ "$CONFIRM" != "1" ]; then
    die "refusing to overwrite LIVE db '$LIVE_DB' without --confirm. Restore to a scratch db instead."
  fi
  log "!! LIVE RESTORE into '$LIVE_DB' requested (--confirm given)."
  KEEP=1   # never auto-drop the live db
else
  log "restore TEST into scratch db '$INTO' (production db '$LIVE_DB' is untouched)"
fi

# A restore replaces everything. If the backup turns out to be the wrong one, or
# older than you thought, this dump is the only route back to the data that was
# there a minute ago — every challan and receipt entered since the backup.
if [ "$IS_LIVE" = "1" ] && [ "$SAFETY" = "1" ]; then
  mkdir -p "$BACKUP_DIR" || die "cannot create $BACKUP_DIR for the safety dump"
  SAFETY_FILE="$BACKUP_DIR/rmc-pre-restore-$(date '+%Y%m%d-%H%M%S').dump"
  log "safety dump of '$LIVE_DB' before overwriting -> $(basename "$SAFETY_FILE")"
  if dc pg_dump -U "$PGUSER" -d "$LIVE_DB" -Fc --no-owner --no-privileges \
        > "$SAFETY_FILE" 2>/tmp/pg-restore-safety.err \
     && [ -s "$SAFETY_FILE" ] && [ "$(head -c5 "$SAFETY_FILE")" = "PGDMP" ]; then
    ( cd "$BACKUP_DIR" && sha256sum "$(basename "$SAFETY_FILE")" > "$(basename "$SAFETY_FILE").sha256" )
    log "safety dump ok — this restore can be undone from it"
  else
    rm -f "$SAFETY_FILE"; SAFETY_FILE=""
    tail -3 /tmp/pg-restore-safety.err >&2 || true
    if [ "$FORCE" = "1" ]; then
      log "WARN: safety dump FAILED, but --force was given — continuing with no way back"
    else
      die "safety dump of '$LIVE_DB' failed — refusing to overwrite it. Fix that first, or re-run with --force to overwrite anyway (this cannot be undone)."
    fi
  fi
fi

# ---- (re)create the target db ----
if [ "$IS_LIVE" = "0" ]; then
  dc psql -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$INTO\";" >/dev/null 2>&1
  dc psql -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$INTO\";" >/dev/null 2>&1 \
    || die "could not create scratch db '$INTO'"
fi

# Reported when the restore produced something unusable. On the live database
# that is an emergency: --clean has already dropped objects, so the database can
# be half old and half new. Say so, and name the way back.
restore_failed() {
  log "RESTORE FAILED — $1"
  if [ "$IS_LIVE" = "1" ]; then
    log "'$LIVE_DB' may now hold a PARTIAL restore. Do not start the app against it."
    if [ -n "$SAFETY_FILE" ] && [ -f "$SAFETY_FILE" ]; then
      log "to put it back as it was a moment ago, run:"
      log "  $0 --file $SAFETY_FILE --into $LIVE_DB --confirm --no-safety-dump"
    fi
  fi
  exit 1
}

log "restoring $(basename "$FILE") -> '$INTO' ..."
RC=0
dc pg_restore -U "$PGUSER" -d "$INTO" --no-owner --no-privileges --clean --if-exists \
   < "$FILE" 2>/tmp/pg-restore.err || RC=$?
ERR_COUNT="$(grep -c 'pg_restore: error:' /tmp/pg-restore.err 2>/dev/null || true)"
ERR_COUNT="${ERR_COUNT:-0}"
if [ "$RC" = "0" ] && [ "$ERR_COUNT" = "0" ]; then
  log "pg_restore reported no errors"
else
  # The row counts below cannot settle this on their own: restoring over a live
  # database that already holds good data looks identical to a restore that did
  # nothing at all. An error line from pg_restore is the difference, so it is
  # treated as decisive. A restore reported as failed can be investigated; one
  # wrongly reported as successful is how a company loses its books.
  log "pg_restore exited $RC with $ERR_COUNT error line(s):"
  grep 'pg_restore: error:' /tmp/pg-restore.err | head -5 >&2 || tail -5 /tmp/pg-restore.err >&2 || true
  restore_failed "pg_restore could not apply the whole archive"
fi

# ---- verify the restore actually produced a usable database ----
# count(*) is the truth; pg_stat_user_tables.n_live_tup is only an estimate, and
# on a live restore it can still show the counts of the data being replaced.
# ON_ERROR_STOP turns a missing table into a failed query, which is what a
# half-finished restore looks like.
COUNTS="$(dc psql -U "$PGUSER" -d "$INTO" -v ON_ERROR_STOP=1 -Atc \
  "SELECT (SELECT count(*) FROM migrations)||'|'||(SELECT count(*) FROM tenants)||'|'||(SELECT count(*) FROM users)||'|'||(SELECT count(*) FROM concrete_grades)" \
  2>/tmp/pg-restore-verify.err)" || COUNTS=""
COUNTS="$(printf '%s' "$COUNTS" | tr -d '\r')"
[ -n "$COUNTS" ] || restore_failed "core tables are missing or unreadable ($(first_error /tmp/pg-restore-verify.err))"

IFS='|' read -r M_CT T_CT U_CT G_CT <<< "$COUNTS"
log "post-restore row counts: migrations=$M_CT tenants=$T_CT users=$U_CT concrete_grades=$G_CT"
[ "${M_CT:-0}" -ge 1 ] || restore_failed "the schema did not restore (0 migration rows)"
[ "${T_CT:-0}" -ge 1 ] || restore_failed "0 companies restored — this archive holds a schema but no business data"
[ "${U_CT:-0}" -ge 1 ] || restore_failed "0 users restored — nobody could log in to this database"

# ---- clean up scratch db unless --keep ----
if [ "$IS_LIVE" = "0" ] && [ "$KEEP" = "0" ]; then
  dc psql -U "$PGUSER" -d postgres -c "DROP DATABASE IF EXISTS \"$INTO\";" >/dev/null 2>&1
  log "RESTORE TEST PASSED — the archive restores to a usable database (scratch db '$INTO' dropped; --keep retains it)."
elif [ "$IS_LIVE" = "1" ]; then
  log "LIVE RESTORE VERIFIED — '$LIVE_DB' restored and readable."
  [ -n "$SAFETY_FILE" ] && log "pre-restore state kept at $(basename "$SAFETY_FILE") in case this was the wrong backup."
else
  log "RESTORE VERIFIED — target db '$INTO' retained."
fi
exit 0
