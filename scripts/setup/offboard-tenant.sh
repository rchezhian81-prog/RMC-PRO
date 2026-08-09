#!/usr/bin/env bash
# Mix Nova RMC SaaS — permanently offboard ONE tenant (destructive, backup-first).
#
# Removes a departing company and ALL of its data. This is irreversible, so the
# script is built to make it hard to do by accident and impossible to do without
# a copy of the data in hand:
#
#   1. It REFUSES unless the tenant's status is 'cancelled'. Cancelling first
#      (from the admin portal) blocks every login and is reversible — this
#      forces a deliberate two-step, so nobody purges a company that is still
#      trading.
#   2. It takes a full pre-purge pg_dump of the whole database and verifies it.
#   3. It writes a complete JSON export of just this tenant's data to disk, and
#      refuses to go further unless that file was written and is non-empty.
#   4. ONLY THEN, with --confirm, it deletes every row this tenant owns and the
#      tenant itself, inside one transaction with FK triggers suspended.
#
# What is exported and purged: every table that has a tenant_id column, found
# from the live catalogue so it can never drift as tables are added. Password
# hashes are stripped from the export (a bcrypt hash is still a credential).
#
# ---------------------------------------------------------------------------
# Runs ON the VPS, from the repo root (/opt/rmc). It talks to the Postgres
# CONTAINER over the local socket as the DB owner (a superuser) — so it needs
# NO password on the command line and prints NO secrets.
#
# Usage:
#   # Preview (no changes) — shows the tenant, its status, and row counts:
#   bash scripts/setup/offboard-tenant.sh --tenant-code OLDCO
#
#   # Perform the offboarding (export to disk, then purge):
#   bash scripts/setup/offboard-tenant.sh --tenant-code OLDCO --confirm
#
# Flags:
#   --tenant-code CODE   REQUIRED (or --tenant-id). Never guesses a target.
#   --tenant-id UUID     Target this tenant id directly.
#   --confirm            REQUIRED to delete. Without it, preview + export only.
#   --export-dir DIR     Where to write the JSON export (default: ./offboarding).
#   --backup-dir DIR     Where to write the pg_dump (default: ./backups).
#   --skip-backup        Skip the full-DB dump (NOT recommended; the per-tenant
#                        JSON export is always written regardless).
#
# Env overrides: ENV_FILE (default .env.production),
#                COMPOSE_FILE (default docker/docker-compose.prod.yml),
#                PG_SERVICE (default postgres).
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-docker/docker-compose.prod.yml}"
PG_SERVICE="${PG_SERVICE:-postgres}"
EXPORT_DIR="./offboarding"
BACKUP_DIR="./backups"
CONFIRM=0
SKIP_BACKUP=0
TENANT_CODE=""
TENANT_ID=""

while [ $# -gt 0 ]; do
  case "$1" in
    --confirm)     CONFIRM=1 ;;
    --skip-backup) SKIP_BACKUP=1 ;;
    --tenant-code) TENANT_CODE="${2:-}"; [ $# -ge 2 ] && shift ;;
    --tenant-id)   TENANT_ID="${2:-}"; [ $# -ge 2 ] && shift ;;
    --export-dir)  EXPORT_DIR="${2:-}"; [ $# -ge 2 ] && shift ;;
    --backup-dir)  BACKUP_DIR="${2:-}"; [ $# -ge 2 ] && shift ;;
    -h|--help)     sed -n '2,50p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "✗ Unknown argument: $1  (try --help)" >&2; exit 2 ;;
  esac
  shift
done

[ -f "$COMPOSE_FILE" ] || { echo "✗ $COMPOSE_FILE not found — run from the repo root (e.g. /opt/rmc)." >&2; exit 1; }
[ -f "$ENV_FILE" ]     || { echo "✗ $ENV_FILE not found — run from the repo root." >&2; exit 1; }

# Reject an empty/garbled selector before it reaches SQL.
if [ -z "$TENANT_CODE" ] && [ -z "$TENANT_ID" ]; then
  echo "✗ Name the tenant: --tenant-code CODE  (or --tenant-id UUID)." >&2
  echo "  This deletes an entire company, so it never picks a target for you." >&2
  exit 1
fi
case "$TENANT_CODE$TENANT_ID" in
  *[\'\"\\\;\ ]*) echo "✗ The tenant selector contains characters this tool will not pass to SQL." >&2; exit 1 ;;
esac

dc() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

# psql inside the container as the OWNER over the local socket. SQL on stdin.
psql_owner() {
  dc exec -T "$PG_SERVICE" sh -c 'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"' _ "$@"
}

# Probe the owner connection this script relies on, rather than parsing
# `docker compose ps` output — whose flags/columns vary between Compose versions
# and can wrongly report a healthy container as down.
if ! printf 'SELECT 1;\n' | psql_owner -tAX >/dev/null 2>&1; then
  echo "✗ Cannot reach the '$PG_SERVICE' database over the container socket." >&2
  echo "  Is the stack running?  Check:  docker compose --env-file $ENV_FILE -f $COMPOSE_FILE ps" >&2
  exit 1
fi

# --- resolve the target tenant (must be exactly one) ---
echo "Resolving target tenant…"
if [ -n "$TENANT_ID" ]; then
  RESOLVE="SELECT id FROM tenants WHERE id = '${TENANT_ID}'::uuid;"
else
  RESOLVE="SELECT id FROM tenants WHERE tenant_code = '${TENANT_CODE}';"
fi
mapfile -t RAW < <(printf '%s\n' "$RESOLVE" | psql_owner -tAX)
TIDS=(); for t in "${RAW[@]}"; do [ -n "$t" ] && TIDS+=("$t"); done
if [ "${#TIDS[@]}" -ne 1 ]; then
  echo "✗ Expected exactly one matching tenant, found ${#TIDS[@]}." >&2
  printf '%s\n' "SELECT tenant_code, tenant_name, status FROM tenants ORDER BY tenant_code;" | psql_owner -X >&2 || true
  exit 1
fi
TID="${TIDS[0]}"

# Tenant summary + the safety interlock on status.
echo
echo "Target tenant:"
printf '%s\n' "SELECT tenant_code, tenant_name, status FROM tenants WHERE id = '$TID'::uuid;" | psql_owner -X
STATUS="$(printf '%s\n' "SELECT status FROM tenants WHERE id = '$TID'::uuid;" | psql_owner -tAX | tr -d '[:space:]')"
if [ "$STATUS" != "cancelled" ]; then
  echo
  echo "✗ This tenant's status is '$STATUS', not 'cancelled'." >&2
  echo "  Offboarding permanently deletes a company, so it only runs on a cancelled one." >&2
  echo "  Cancel it first in the admin portal (Subscription status → Cancelled) — that blocks" >&2
  echo "  every login and is reversible — then run this again." >&2
  exit 1
fi

# --- the tenant-scoped tables, straight from the catalogue ---
mapfile -t TABLES < <(printf '%s\n' \
  "SELECT table_name FROM information_schema.columns
     WHERE table_schema='public' AND column_name='tenant_id'
     ORDER BY table_name;" | psql_owner -tAX | sed '/^$/d')
if [ "${#TABLES[@]}" -eq 0 ]; then
  echo "✗ Found no tenant-scoped tables — refusing to proceed." >&2
  exit 1
fi

echo
echo "Rows owned by this tenant (tables with any rows):"
COUNT_SQL="SELECT '  '||rpad(t.name,28)||lpad(t.n::text,8) FROM ("
first=1
for tbl in "${TABLES[@]}"; do
  [ $first -eq 1 ] && first=0 || COUNT_SQL+=" UNION ALL "
  COUNT_SQL+="SELECT '$tbl' AS name, count(*) AS n FROM \"$tbl\" WHERE tenant_id = '$TID'::uuid"
done
COUNT_SQL+=") t WHERE t.n > 0 ORDER BY 1;"
printf '%s\n' "$COUNT_SQL" | psql_owner -tAX || true

# --- write the JSON export FIRST — the purge depends on it existing ---
mkdir -p "$EXPORT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
CODE_SAFE="$(printf '%s\n' "SELECT tenant_code FROM tenants WHERE id='$TID'::uuid;" | psql_owner -tAX | tr -cd '[:alnum:]_-')"
EXPORT_FILE="$EXPORT_DIR/${CODE_SAFE:-tenant}-export-$STAMP.json"

# One JSON document: the tenant row plus every tenant-scoped table. Built by
# jsonb concatenation (`||`) rather than one json_build_object, because Postgres
# caps that function at 100 arguments and there are more than 50 tables. Each
# `- 'password_hash'` is a no-op on tables without that column, so it strips the
# hash wherever it exists.
TABLES_EXPR="'{}'::jsonb"
for tbl in "${TABLES[@]}"; do
  TABLES_EXPR+=" || jsonb_build_object('$tbl', (SELECT coalesce(jsonb_agg(to_jsonb(r) - 'password_hash'), '[]'::jsonb) FROM \"$tbl\" r WHERE r.tenant_id='$TID'::uuid))"
done
EXPORT_SQL="SELECT (jsonb_build_object(
  'exportedAt', now(),
  'tenant', (SELECT to_jsonb(t) - 'password_hash' FROM tenants t WHERE id='$TID'::uuid)
) || jsonb_build_object('tables', ($TABLES_EXPR)))::text;"

echo
echo "Writing data export -> $EXPORT_FILE"
if ! printf '%s\n' "$EXPORT_SQL" | psql_owner -tAX > "$EXPORT_FILE"; then
  echo "✗ Export query failed. Aborting — no data was deleted." >&2
  rm -f "$EXPORT_FILE"
  exit 1
fi
if [ ! -s "$EXPORT_FILE" ] || ! head -c 1 "$EXPORT_FILE" | grep -q '{'; then
  echo "✗ Export looks invalid (empty or not JSON). Aborting — no data was deleted." >&2
  rm -f "$EXPORT_FILE"
  exit 1
fi
echo "✓ Export written ($(wc -c < "$EXPORT_FILE") bytes). Keep this file — it is the record of the company."

if [ "$CONFIRM" -ne 1 ]; then
  echo
  echo "── PREVIEW ONLY ── nothing was deleted. The export above WAS written."
  echo "Re-run with --confirm to permanently remove this tenant."
  exit 0
fi

# --- full-DB backup before the purge ---
if [ "$SKIP_BACKUP" -ne 1 ]; then
  mkdir -p "$BACKUP_DIR"
  BACKUP_FILE="$BACKUP_DIR/pre-offboard-$CODE_SAFE-$STAMP.dump"
  echo
  echo "Taking pre-offboard backup -> $BACKUP_FILE"
  dc exec -T "$PG_SERVICE" sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP_FILE"
  if [ ! -s "$BACKUP_FILE" ] || [ "$(head -c 5 "$BACKUP_FILE")" != "PGDMP" ]; then
    echo "✗ Backup looks invalid (empty or missing PGDMP header). Aborting — no data was deleted." >&2
    rm -f "$BACKUP_FILE"
    exit 1
  fi
  echo "✓ Backup verified ($(wc -c < "$BACKUP_FILE") bytes)."
else
  echo "⚠ Skipping full-DB backup (--skip-backup). The JSON export was still written."
fi

# --- the destructive transaction ---
# session_replication_role=replica suspends FK triggers for this session only, so
# delete order can never trip a constraint and the tenant row deletes cleanly.
echo
echo "Permanently removing tenant $TID …"
{
  echo "BEGIN;"
  echo "SET LOCAL session_replication_role = replica;"
  for tbl in "${TABLES[@]}"; do
    echo "DELETE FROM \"$tbl\" WHERE tenant_id = '$TID'::uuid;"
  done
  echo "DELETE FROM tenants WHERE id = '$TID'::uuid;"
  echo "SET LOCAL session_replication_role = origin;"
  echo "COMMIT;"
} | psql_owner

# Confirm the tenant is gone.
GONE="$(printf '%s\n' "SELECT count(*) FROM tenants WHERE id = '$TID'::uuid;" | psql_owner -tAX | tr -d '[:space:]')"
echo
echo "────────────────────────────────────────"
if [ "$GONE" = "0" ]; then
  echo "✓ Tenant permanently removed."
else
  echo "✗ Tenant row still present — something blocked the delete. Review the output above." >&2
  exit 1
fi
echo "  Data export : $EXPORT_FILE"
[ "$SKIP_BACKUP" -ne 1 ] && echo "  Full backup : $BACKUP_FILE"
echo
echo "Restore from the full backup with:"
echo "  docker compose ... exec -T $PG_SERVICE pg_restore -U \$POSTGRES_USER -d \$POSTGRES_DB --clean < <dump>"
