#!/usr/bin/env bash
# =============================================================================
#  Mix Nova RMC — migration data-integrity preflight (pre-deploy gate)
# =============================================================================
#  A constraint-adding migration runs in the deploy's one-shot `migrate` step,
#  and `api` only starts once `migrate` succeeds. If a live row violates a new
#  CHECK/FK, the ALTER aborts, `migrate` exits non-zero, and the API never comes
#  back — an outage found only AFTER the old app was torn down. (This is exactly
#  what took app.mixnovas.com down: two customer rows with a negative
#  credit_limit blocked chk_customers_nonneg.)
#
#  This script runs the read-only checker (apps/api/src/core/database/
#  migration-preflight.ts) against the LIVE database, using the `migrate`
#  service's own environment (owner DB role, so RLS is bypassed and every
#  tenant's rows are seen — just as the migration's ALTER sees them). It changes
#  NOTHING; it only SELECTs.
#
#  Run it BEFORE `docker compose ... up -d` on every deploy that ships a new
#  image. If it fails, fix the offending rows it prints (or hold the deploy) —
#  do not migrate into a guaranteed abort.
#
#  USAGE (on the VPS, from the repo root):
#     ./scripts/ops/migration-preflight.sh
#
#  EXIT CODES:  0 = safe to migrate · 1 = violations found (fix first) ·
#               2 = preflight could not run (fail closed — do not deploy).
# =============================================================================
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_ROOT/docker/docker-compose.prod.yml}"
MIGRATE_SERVICE="${MIGRATE_SERVICE:-migrate}"

log() { printf '[migration-preflight] %s\n' "$*"; }
die() { printf '[migration-preflight] ERROR: %s\n' "$*" >&2; exit 2; }

command -v docker >/dev/null 2>&1 || die "docker not on PATH"
[ -f "$COMPOSE_FILE" ] || die "compose file not found: $COMPOSE_FILE"
[ -f "$ENV_FILE" ] || die "env file not found: $ENV_FILE"

# AUTH GATE FIRST. A role-password mismatch is the OTHER way the migrate step (and
# then the API) dies — and, unlike a data violation, the data checker can't even
# report it because it can't connect. Verify both roles can log in before we bother
# checking rows; bail with the auth check's own exit code if it fails.
if [ -x "$REPO_ROOT/scripts/ops/db-auth-check.sh" ]; then
  "$REPO_ROOT/scripts/ops/db-auth-check.sh" || exit $?
else
  log "WARN: db-auth-check.sh not found/executable; skipping the DB auth gate"
fi

log "checking live data against the integrity constraints the migration will add…"

# Run the preflight in a throwaway container built from the (new) API image, with
# the migrate service's env (owner DB creds). --no-deps: postgres is already up,
# and we must NOT trigger the real migrate/seed command — we override it with the
# preflight entrypoint instead.
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm -T --no-deps \
  "$MIGRATE_SERVICE" node dist/core/database/migration-preflight.js
code=$?

case "$code" in
  0) log "PASS — safe to deploy." ;;
  1) log "FAIL — fix the rows listed above, then re-run this before deploying." ;;
  *) log "could not complete (exit $code) — treat as NOT safe to deploy until resolved." ;;
esac
exit "$code"
