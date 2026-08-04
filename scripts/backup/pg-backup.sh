#!/usr/bin/env bash
# =============================================================================
#  Mix Nova RMC — independent PostgreSQL logical backup  (beyond Acronis)
# =============================================================================
#  Takes a compressed, portable pg_dump of the pilot database and prunes old
#  backups on a GFS schedule (daily / weekly / monthly). This is the granular,
#  "undo one bad migration" layer that Acronis' 7-day whole-VM image is not.
#
#  pg_dump is READ-ONLY on the database — it never modifies data.
#
#  USAGE (run on the VPS, from the repo root):
#     ./scripts/backup/pg-backup.sh                 # normal nightly backup
#     ./scripts/backup/pg-backup.sh --label pre-migrate   # a named snapshot
#
#  Reads settings from .env.production (same file the stack uses). Secrets are
#  passed to Postgres via the environment / container — never printed or logged.
#
#  CRON (2:15am daily, log to a file):
#     15 2 * * *  cd /opt/rmc && ./scripts/backup/pg-backup.sh >> /var/log/rmc-backup.log 2>&1
# =============================================================================
set -u
umask 077   # backups are readable only by their owner

# ---- config (override via env before calling if needed) ----
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_ROOT/docker/docker-compose.prod.yml}"
BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/backups/postgres}"
PG_SERVICE="${PG_SERVICE:-postgres}"
# GFS retention (counts):
KEEP_DAILY="${KEEP_DAILY:-7}"
KEEP_WEEKLY="${KEEP_WEEKLY:-4}"
KEEP_MONTHLY="${KEEP_MONTHLY:-3}"

LABEL="daily"
[ "${1:-}" = "--label" ] && { LABEL="${2:?--label needs a value}"; }

log() { printf '[pg-backup %s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

[ -f "$ENV_FILE" ]      || die "env file not found: $ENV_FILE (copy .env.production.example and fill it in)"
[ -f "$COMPOSE_FILE" ]  || die "compose file not found: $COMPOSE_FILE"
command -v docker >/dev/null 2>&1 || die "docker not found on PATH"

# Pull DB name + OWNER creds from the env file WITHOUT echoing them.
# (grep a single key; never print the value.)
getenv() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- ; }
PGDATABASE="$(getenv POSTGRES_DB)";  PGDATABASE="${PGDATABASE:-rmc}"
PGUSER="$(getenv POSTGRES_USER)";    PGUSER="${PGUSER:-rmc_owner}"
PGPASSWORD_VAL="$(getenv POSTGRES_PASSWORD)"
[ -n "$PGPASSWORD_VAL" ] || die "POSTGRES_PASSWORD is empty in $ENV_FILE"

mkdir -p "$BACKUP_DIR" || die "cannot create $BACKUP_DIR"

STAMP="$(date '+%Y%m%d-%H%M%S')"
OUT="$BACKUP_DIR/rmc-${LABEL}-${STAMP}.dump"

log "starting ${LABEL} backup of db='${PGDATABASE}' -> $(basename "$OUT")"

# Dump from INSIDE the running postgres container (custom format = selective restore).
# -T so no TTY; PGPASSWORD is passed via the container env, not the command line.
if docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T \
      -e PGPASSWORD="$PGPASSWORD_VAL" "$PG_SERVICE" \
      pg_dump -U "$PGUSER" -d "$PGDATABASE" -Fc --no-owner --no-privileges \
      > "$OUT" 2>/tmp/pg-backup.err; then
  :
else
  cat /tmp/pg-backup.err >&2 || true
  rm -f "$OUT"
  die "pg_dump failed (backup removed; nothing partial kept)"
fi

# Integrity: non-empty + valid custom-format archive (pg_restore --list parses it).
[ -s "$OUT" ] || die "backup file is empty"
if docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T "$PG_SERVICE" \
      pg_restore --list - < "$OUT" >/dev/null 2>&1; then
  log "archive verified (pg_restore --list ok)"
else
  log "WARN: could not verify archive with pg_restore --list (kept anyway)"
fi

SIZE="$(du -h "$OUT" | cut -f1)"
( cd "$BACKUP_DIR" && sha256sum "$(basename "$OUT")" > "$(basename "$OUT").sha256" )
log "done: $(basename "$OUT") ($SIZE) + .sha256"

# ---- OPTIONAL off-box copy (uncomment + configure one; keep dumps off VM3 too) ----
# rclone copy "$OUT" remote:rmc-backups/            # rclone to S3/Drive/etc.
# mc cp "$OUT" myminio/rmc-backups/                 # to a SEPARATE MinIO/S3 (not VM3's)
# scp "$OUT" backup@offsite:/srv/rmc-backups/       # to another host
log "reminder: configure an OFF-BOX copy (see commented block) — on-box alone is not a backup"

# ---- GFS pruning: keep newest N of each label ----
prune() {
  local lbl="$1" keep="$2" f n=0
  ls -1t "$BACKUP_DIR"/rmc-"$lbl"-*.dump 2>/dev/null | while read -r f; do
    n=$((n+1))
    if [ "$n" -gt "$keep" ]; then
      rm -f "$f" "$f.sha256"
      log "pruned old ${lbl}: $(basename "$f")"
    fi
  done
}
prune daily   "$KEEP_DAILY"
# Promote-by-copy is unnecessary: weekly/monthly are created by scheduling this
# script with --label weekly / --label monthly on those cadences (see README).
prune weekly  "$KEEP_WEEKLY"
prune monthly "$KEEP_MONTHLY"

log "retention applied (daily=$KEEP_DAILY weekly=$KEEP_WEEKLY monthly=$KEEP_MONTHLY)"
