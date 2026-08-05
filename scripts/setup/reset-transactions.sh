#!/usr/bin/env bash
# RMC Plant SaaS — tenant-scoped TRANSACTIONAL reset (destructive, backup-first).
#
# Wipes the test/pilot *transactions* for ONE tenant so you can start clean
# before real customers — while KEEPING all master & config data:
#
#   DELETED  quotations, orders, batch tickets/queue, dispatches, challans,
#            invoices, receipts (payments) + their line/child rows, stock
#            balances & transactions, leads, and notification logs.
#   RESET    every document number series -> next document is 0001 again.
#   KEPT     customers, sites, materials, suppliers, vehicles, drivers, grades,
#            mix designs, plants, company, users/roles/permissions, settings,
#            subscription/modules, devices.
#
# Opening stock lives in stock_balances (deleted here), so AFTER this runs,
# re-seed to restore it:
#
#   API_URL=https://api.mixnovas.com LOGIN='<tenant owner>' \
#     RMC_PASSWORD='<password>' node scripts/setup/seed-plant-master.mjs
#
# The seeder sets opening stock as an absolute quantity, so re-running it
# restores exactly the opening levels (undoing the batch consumption).
#
# ---------------------------------------------------------------------------
# Runs ON the VPS, from the repo root (/opt/rmc). It talks to the Postgres
# CONTAINER over the local socket as the DB owner (a superuser) — so it needs
# NO password on the command line and prints NO secrets. It:
#   1. takes a full pre-reset pg_dump (custom format) and verifies it,
#   2. resolves the target tenant (exactly one, or you name it),
#   3. deletes the transactional tables scoped to that tenant inside ONE
#      transaction (FK triggers suspended so order can't bite us),
#   4. resets number_series counters to 0.
#
# Usage:
#   bash scripts/setup/reset-transactions.sh --confirm
#   bash scripts/setup/reset-transactions.sh --confirm --tenant-code SRE
#   bash scripts/setup/reset-transactions.sh --confirm --tenant-id <uuid>
#
# Flags:
#   --confirm            REQUIRED. Without it the script only prints a preview.
#   --tenant-code CODE   Target the tenant with this code (tenants.code).
#   --tenant-id UUID     Target this tenant id directly.
#   --skip-backup        Skip the pre-reset dump (NOT recommended).
#   --backup-dir DIR     Where to write the dump (default: ./backups).
#
# Env overrides: ENV_FILE (default .env.production),
#                COMPOSE_FILE (default docker/docker-compose.prod.yml),
#                PG_SERVICE (default postgres).
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-docker/docker-compose.prod.yml}"
PG_SERVICE="${PG_SERVICE:-postgres}"
BACKUP_DIR="./backups"
CONFIRM=0
SKIP_BACKUP=0
TENANT_CODE=""
TENANT_ID=""

while [ $# -gt 0 ]; do
  case "$1" in
    --confirm)      CONFIRM=1 ;;
    --skip-backup)  SKIP_BACKUP=1 ;;
    --tenant-code)  TENANT_CODE="${2:-}"; shift ;;
    --tenant-id)    TENANT_ID="${2:-}"; shift ;;
    --backup-dir)   BACKUP_DIR="${2:-}"; shift ;;
    -h|--help)      sed -n '2,55p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

# --- sanity: repo root + files present ---
[ -f "$COMPOSE_FILE" ] || { echo "✗ $COMPOSE_FILE not found — run from the repo root (e.g. /opt/rmc)." >&2; exit 1; }
[ -f "$ENV_FILE" ]     || { echo "✗ $ENV_FILE not found — run from the repo root." >&2; exit 1; }

dc() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

# Run a psql command inside the container as the OWNER over the local socket
# (trust auth — no password on the CLI, nothing secret printed). Extra args are
# passed straight to psql; SQL comes on stdin.
psql_owner() {
  dc exec -T "$PG_SERVICE" sh -c 'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"' _ "$@"
}

# --- container up? ---
if ! dc ps --status running 2>/dev/null | grep -q "$PG_SERVICE"; then
  echo "✗ The '$PG_SERVICE' container is not running. Start the stack first." >&2
  exit 1
fi

# Transactional tables to clear, in child-first order (belt-and-suspenders;
# FK triggers are suspended in the transaction anyway). Masters, mix designs,
# users/roles, settings and modules are deliberately NOT here.
TX_TABLES=(
  payment_allocations
  payments
  invoice_challans
  invoice_items
  invoices
  delivery_status_history
  delivery_challans
  dispatches
  stock_transactions
  stock_balances
  batch_ticket_materials
  batch_tickets
  batch_queue
  production_plan_items
  production_plans
  negative_stock_requests
  weighbridge_entries
  material_inwards
  order_status_history
  credit_hold_requests
  order_items
  orders
  rate_contract_items
  rate_contracts
  quotation_revisions
  quotation_items
  quotations
  lead_followups
  leads
  notification_logs
)

# --- resolve the target tenant (exactly one, or as named) ---
echo "Resolving target tenant…"
if [ -n "$TENANT_ID" ]; then
  RESOLVE="SELECT id FROM tenants WHERE id = '${TENANT_ID//\'/}'::uuid;"
elif [ -n "$TENANT_CODE" ]; then
  RESOLVE="SELECT id FROM tenants WHERE code = '${TENANT_CODE//\'/}';"
else
  RESOLVE="SELECT id FROM tenants;"
fi

mapfile -t RAW < <(printf '%s\n' "$RESOLVE" | psql_owner -tAX)
# Drop any blank lines the driver may emit.
TIDS=()
for t in "${RAW[@]}"; do [ -n "$t" ] && TIDS+=("$t"); done

if [ "${#TIDS[@]}" -eq 0 ]; then
  echo "✗ No matching tenant found. Pass --tenant-code or --tenant-id." >&2
  exit 1
elif [ "${#TIDS[@]}" -gt 1 ]; then
  echo "✗ Multiple tenants exist — refusing to guess. Re-run with --tenant-code <CODE>:" >&2
  printf '%s\n' "SELECT code, name FROM tenants ORDER BY code;" | psql_owner -X >&2 || true
  exit 1
fi
TID="${TIDS[0]}"

# Show what we're about to hit (name + row counts) so the operator can confirm.
echo
echo "Target tenant:"
printf '%s\n' "SELECT code, name FROM tenants WHERE id = '$TID'::uuid;" | psql_owner -X
echo
echo "Rows to be deleted for this tenant:"
COUNT_SQL="SELECT '  '||rpad(t.name,26)||lpad(t.n::text,8) AS \"table / rows\" FROM ("
first=1
for tbl in "${TX_TABLES[@]}"; do
  [ $first -eq 1 ] && first=0 || COUNT_SQL+=" UNION ALL "
  COUNT_SQL+="SELECT '$tbl' AS name, count(*) AS n FROM $tbl WHERE tenant_id = '$TID'::uuid"
done
COUNT_SQL+=") t WHERE t.n > 0 ORDER BY 1;"
printf '%s\n' "$COUNT_SQL" | psql_owner -tAX || true
echo
echo "number_series counters for this tenant will be reset to 0."

if [ "$CONFIRM" -ne 1 ]; then
  echo
  echo "── PREVIEW ONLY ── nothing was changed."
  echo "Re-run with --confirm to perform the reset."
  exit 0
fi

# --- pre-reset backup (full DB, custom format) ---
if [ "$SKIP_BACKUP" -ne 1 ]; then
  mkdir -p "$BACKUP_DIR"
  STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
  BACKUP_FILE="$BACKUP_DIR/pre-reset-$STAMP.dump"
  echo
  echo "Taking pre-reset backup -> $BACKUP_FILE"
  dc exec -T "$PG_SERVICE" sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP_FILE"
  # Verify: non-trivial size and the custom-format "PGDMP" magic header.
  if [ ! -s "$BACKUP_FILE" ] || [ "$(head -c 5 "$BACKUP_FILE")" != "PGDMP" ]; then
    echo "✗ Backup looks invalid (empty or missing PGDMP header). Aborting — no data was touched." >&2
    rm -f "$BACKUP_FILE"
    exit 1
  fi
  echo "✓ Backup verified ($(wc -c < "$BACKUP_FILE") bytes)."
else
  echo "⚠ Skipping backup (--skip-backup)."
fi

# --- the destructive transaction ---
# session_replication_role=replica suspends FK/user triggers for this session
# only, so delete order can never trip a constraint. Owner is a superuser and
# BYPASSRLS, so every statement is explicitly scoped by tenant_id.
echo
echo "Applying reset for tenant $TID …"
{
  echo "BEGIN;"
  echo "SET LOCAL session_replication_role = replica;"
  for tbl in "${TX_TABLES[@]}"; do
    echo "DELETE FROM $tbl WHERE tenant_id = '$TID'::uuid;"
  done
  echo "UPDATE number_series SET current_number = 0 WHERE tenant_id = '$TID'::uuid;"
  echo "SET LOCAL session_replication_role = origin;"
  echo "COMMIT;"
} | psql_owner

echo
echo "────────────────────────────────────────"
echo "✓ Transactional data cleared and numbering reset for the tenant."
echo
echo "Next — restore opening stock by re-running the seeder (sets it absolutely):"
echo "  API_URL=https://api.mixnovas.com LOGIN='<tenant owner>' \\"
echo "    RMC_PASSWORD='<password>' node scripts/setup/seed-plant-master.mjs"
echo
echo "The backup above is a full snapshot taken just before the reset —"
echo "restore with: docker compose ... exec -T $PG_SERVICE pg_restore -U \$POSTGRES_USER -d \$POSTGRES_DB --clean < <dump>"
