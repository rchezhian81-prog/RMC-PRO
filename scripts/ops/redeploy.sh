#!/usr/bin/env bash
# =============================================================================
#  Mix Nova RMC — safe full redeploy  (quiet-window step)
# =============================================================================
#  Rebuilds the app images from the current checkout and rolls them out with the
#  database migrate+seed step, gated end-to-end. Postgres/Redis/MinIO data
#  volumes are untouched.
#
#  Order of operations, each gated:
#    0. pre-redeploy DB snapshot (safety net)
#    1. render-check the nginx template in a one-off container (nginx -t) so a
#       bad config can never reach the live proxy
#    2. build the api + web images
#    3. run the migrate one-shot (migrations + idempotent seed: catalogs,
#       permissions, plans) — safe to re-run
#    4. recreate api, web, nginx
#    5. health-check api + app
#
#  Run in a quiet window: recreating api/nginx is a few seconds of blip.
#
#  USAGE (on the VPS, from the repo root, after `git pull`):
#     ./scripts/ops/redeploy.sh
#     WEB_ONLY=1 ./scripts/ops/redeploy.sh   # skip api build + migrate (web/nginx only)
#
#  4 GB / no swap: the image builds (esp. web's `next build`) are the only
#  memory-heavy steps. If one OOMs, nothing running is affected (builds are
#  isolated) — retry, or build in CI and pull (see docs/deployment runbook).
# =============================================================================
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_ROOT/docker/docker-compose.prod.yml}"
WEB_ONLY="${WEB_ONLY:-0}"
DC=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

log() { printf '\n=== [redeploy %s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
die() { printf '\n[redeploy] ERROR: %s\n' "$*" >&2; exit 1; }

getenv() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- ; }

[ -f "$ENV_FILE" ]     || die "missing $ENV_FILE"
[ -f "$COMPOSE_FILE" ] || die "missing $COMPOSE_FILE"
command -v docker >/dev/null 2>&1 || die "docker not on PATH"
DOMAIN="$(getenv DOMAIN)"; DOMAIN="${DOMAIN:-mixnovas.com}"

# What we build/recreate. WEB_ONLY trims to a web+nginx-only change.
if [ "$WEB_ONLY" = "1" ]; then BUILD_SVCS=(web); RECREATE_SVCS=(web nginx); else BUILD_SVCS=(api web); RECREATE_SVCS=(api web nginx); fi

log "target domain: $DOMAIN | build: ${BUILD_SVCS[*]} | recreate: ${RECREATE_SVCS[*]}"
"${DC[@]}" config >/dev/null || die "compose config is invalid — aborting before any change"

# ---- 0. Pre-redeploy DB snapshot ----
log "0/5 pre-redeploy DB snapshot"
if [ -x "$REPO_ROOT/scripts/backup/pg-backup.sh" ]; then
  "$REPO_ROOT/scripts/backup/pg-backup.sh" --label pre-redeploy || die "pre-redeploy backup failed — not proceeding"
else
  log "WARN: pg-backup.sh not found; continuing WITHOUT a fresh snapshot"
fi

# ---- 1. Render-check nginx template BEFORE touching the live proxy ----
# One-off from the compose `nginx` service (not a bare `docker run`) so it
# inherits the real env, volumes AND the app network — `nginx -t` resolves the
# api/web upstream hostnames, which an isolated container can't.
log "1/5 validating nginx config render (compose one-off on app network, nginx -t)"
if ! "${DC[@]}" run --rm --no-deps -T nginx nginx -t; then
  die "nginx -t FAILED on the rendered template — live nginx untouched. Fix the template first."
fi
log "nginx config renders and passes -t ✓"

# ---- 2. Build images ----
log "2/5 building images: ${BUILD_SVCS[*]} (memory-heavy step)"
"${DC[@]}" build "${BUILD_SVCS[@]}" || die "image build failed (nothing recreated yet). If OOM: retry or build in CI."

# ---- 3. Migrate + seed (skipped in WEB_ONLY) ----
if [ "$WEB_ONLY" = "1" ]; then
  log "3/5 migrate: skipped (WEB_ONLY)"
else
  log "3/5 running migrate one-shot (migrations + idempotent seed)"
  "${DC[@]}" run --rm migrate || die "migrate/seed failed — api NOT recreated. Check: ${DC[*]} logs. DB unchanged beyond any applied migration; restore the pre-redeploy snapshot if needed."
fi

# ---- 4. Recreate services ----
log "4/5 recreating: ${RECREATE_SVCS[*]}"
"${DC[@]}" up -d "${RECREATE_SVCS[@]}" || die "recreate failed — check: ${DC[*]} logs ${RECREATE_SVCS[*]}"

# ---- 5. Health checks ----
log "5/5 health checks"
ok=1
for i in 1 2 3 4 5 6; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 12 "https://api.${DOMAIN}/health" || echo 000)"
  [ "$code" = "200" ] && { log "api https health: 200 ✓"; break; }
  log "api health attempt $i: HTTP $code — retrying in 5s"; sleep 5
  [ "$i" = 6 ] && ok=0
done
appcode="$(curl -s -o /dev/null -w '%{http_code}' --max-time 12 "https://app.${DOMAIN}/" || echo 000)"
case "$appcode" in 200|3??) log "app portal: HTTP $appcode ✓" ;; *) log "app portal: HTTP $appcode (check web logs)"; ok=0 ;; esac

"${DC[@]}" ps

if [ "$ok" = 1 ]; then
  log "REDEPLOY OK — current build is live."
else
  die "post-redeploy health check FAILED. Diagnose with \`${DC[*]} logs ${RECREATE_SVCS[*]}\`; if needed redeploy the prior IMAGE_TAG or restore the pre-redeploy snapshot (scripts/backup/pg-restore.sh)."
fi
