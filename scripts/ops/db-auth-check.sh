#!/usr/bin/env bash
# =============================================================================
#  Mix Nova RMC — DB auth preflight (pre-deploy gate)
# =============================================================================
#  Verifies that BOTH database roles a deploy depends on can actually log in to
#  the live Postgres:
#    • owner (POSTGRES_USER)  — used by the one-shot `migrate` step
#    • app   (APP_DB_USER)    — used by the running API under RLS
#
#  Why: the Postgres image only applies POSTGRES_PASSWORD when it first creates
#  an EMPTY data volume. Change a password in .env.production afterwards and the
#  role's STORED password goes stale, silently. The consequences are severe:
#    • owner drift -> `migrate` fails 28P01 -> `api` (gated on migrate) never
#      starts -> hard outage, and migrations quietly stop advancing.
#    • app drift   -> API boots but every query fails auth -> "Cannot reach the
#      server" even though nginx + the page shell are up.
#  Both were real: they took app.mixnovas.com down and stalled migrations at 043.
#
#  This runs the checker (apps/api/src/core/database/db-auth-check.ts) inside a
#  throwaway container built from the NEW API image, using the `migrate` service's
#  environment (which carries BOTH role credentials). It is read-only — it opens a
#  connection and runs `select 1`; it changes nothing.
#
#  Run it BEFORE `docker compose ... up -d` on every deploy (migration-preflight.sh
#  calls it automatically). If it fails, realign the password (ALTER ROLE ... or
#  fix .env.production) BEFORE deploying — do not cut over into a role that cannot
#  authenticate.
#
#  USAGE (on the VPS, from the repo root):
#     ./scripts/ops/db-auth-check.sh
#
#  EXIT CODES:  0 = both roles authenticate · 1 = a password is out of sync (fix
#               first) · 2 = could not verify (fail closed — do not deploy).
# =============================================================================
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_ROOT/docker/docker-compose.prod.yml}"
MIGRATE_SERVICE="${MIGRATE_SERVICE:-migrate}"

log() { printf '[db-auth-check] %s\n' "$*"; }
die() { printf '[db-auth-check] ERROR: %s\n' "$*" >&2; exit 2; }

command -v docker >/dev/null 2>&1 || die "docker not on PATH"
[ -f "$COMPOSE_FILE" ] || die "compose file not found: $COMPOSE_FILE"
[ -f "$ENV_FILE" ] || die "env file not found: $ENV_FILE"

log "verifying the owner + app DB roles can authenticate…"

# --no-deps: postgres is already up, and we must NOT trigger the real migrate/seed
# command — we override it with the auth-check entrypoint instead.
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm -T --no-deps \
  "$MIGRATE_SERVICE" node dist/core/database/db-auth-check.js
code=$?

case "$code" in
  0) log "PASS — both roles authenticate." ;;
  1) log "FAIL — a role password is out of sync with the database (see above); realign it, then re-run." ;;
  *) log "could not complete (exit $code) — treat as NOT safe to deploy until resolved." ;;
esac
exit "$code"
