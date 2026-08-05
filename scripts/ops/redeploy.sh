#!/usr/bin/env bash
# =============================================================================
#  Mix Nova RMC — safe redeploy of web + nginx  (quiet-window step)
# =============================================================================
#  Activates the pending web-only auth fix and the nginx envsubst cleanup. The
#  API, Postgres, Redis and MinIO are NOT touched (nothing changed there), so
#  this is a light recreate, not a full-stack rebuild.
#
#  Order of operations, each gated:
#    0. take a pre-redeploy DB snapshot (safety net)
#    1. render-check the nginx template in a THROWAWAY container (nginx -t) so a
#       bad config can never reach the live proxy
#    2. build the new web image (api image is unchanged)
#    3. recreate web then nginx
#    4. health-check api + app; report clearly
#
#  Run this in a quiet window: recreating nginx is a few seconds of blip.
#
#  USAGE (on the VPS, from the repo root, after `git pull`):
#     ./scripts/ops/redeploy.sh
#
#  4 GB / no swap: the web build (next build) is the only memory-heavy step. If
#  it OOMs, nothing running is affected (builds are isolated) — retry, or build
#  the image in CI and pull it (see docs/deployment runbook).
# =============================================================================
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_ROOT/docker/docker-compose.prod.yml}"
DC=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

log() { printf '\n=== [redeploy %s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
die() { printf '\n[redeploy] ERROR: %s\n' "$*" >&2; exit 1; }

getenv() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- ; }

[ -f "$ENV_FILE" ]     || die "missing $ENV_FILE"
[ -f "$COMPOSE_FILE" ] || die "missing $COMPOSE_FILE"
command -v docker >/dev/null 2>&1 || die "docker not on PATH"
DOMAIN="$(getenv DOMAIN)"; DOMAIN="${DOMAIN:-mixnovas.com}"

log "target domain: $DOMAIN | compose: $COMPOSE_FILE"
"${DC[@]}" config >/dev/null || die "compose config is invalid — aborting before any change"

# ---- 0. Pre-redeploy DB snapshot ----
log "0/4 pre-redeploy DB snapshot"
if [ -x "$REPO_ROOT/scripts/backup/pg-backup.sh" ]; then
  "$REPO_ROOT/scripts/backup/pg-backup.sh" --label pre-redeploy || die "pre-redeploy backup failed — not proceeding"
else
  log "WARN: pg-backup.sh not found; continuing WITHOUT a fresh snapshot"
fi

# ---- 1. Render-check nginx template BEFORE touching the live proxy ----
# Use a one-off container from the compose `nginx` service (not a bare
# `docker run`) so it inherits the real env, volumes AND the app network. That
# matters because `nginx -t` resolves the api/web upstream hostnames at test
# time — an isolated container can't and fails with "host not found in upstream".
# --no-deps: api/web are already running, don't restart them.
log "1/4 validating nginx config render (compose one-off on app network, nginx -t)"
if ! "${DC[@]}" run --rm --no-deps -T nginx nginx -t; then
  die "nginx -t FAILED on the rendered template — live nginx untouched. Fix the template first."
fi
log "nginx config renders and passes -t ✓"

# ---- 2. Build the new web image (api unchanged) ----
log "2/4 building web image (this is the memory-heavy step)"
"${DC[@]}" build web || die "web image build failed (nothing recreated yet). If OOM: retry or build in CI."

# ---- 3. Recreate web then nginx ----
log "3/4 recreating web, then nginx"
"${DC[@]}" up -d web  || die "web recreate failed"
"${DC[@]}" up -d nginx || die "nginx recreate failed — check: ${DC[*]} logs nginx"

# ---- 4. Health checks ----
log "4/4 health checks"
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
  log "REDEPLOY OK — auth fix + nginx envsubst are live."
  log "verify in a browser: sign in at https://app.${DOMAIN} (no demo creds prefilled), leave it idle 20 min, confirm you're NOT kicked out."
else
  die "post-redeploy health check FAILED. Rollback: previous web image is still in Docker — \`${DC[*]} logs web nginx\` to diagnose; if needed redeploy the prior IMAGE_TAG or restore the pre-redeploy snapshot (scripts/backup/pg-restore.sh)."
fi
