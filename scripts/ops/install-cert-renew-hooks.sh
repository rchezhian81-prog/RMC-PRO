#!/usr/bin/env bash
# =============================================================================
#  Mix Nova RMC — install Let's Encrypt renewal hooks (idempotent)
# =============================================================================
#  The pilot's TLS cert (mixnovas.com + subdomains) is issued with certbot's
#  STANDALONE authenticator, which binds port 80 itself to answer the ACME
#  challenge. In production that port is held by the nginx CONTAINER, so an
#  unaided `certbot renew` would fail ("port 80 in use") and the cert would
#  silently lapse. These hooks make renewal work hands-off:
#
#     pre-hook   -> stop the nginx container   (frees :80 for standalone)
#     post-hook  -> start the nginx container  (loads the freshly-issued cert)
#
#  certbot runs pre/post hooks ONLY when a certificate is actually due for
#  renewal (within ~30 days of expiry), so nginx is untouched on the routine
#  twice-daily timer checks — a few seconds of downtime roughly every 60 days.
#
#  SAFE + IDEMPOTENT: re-running overwrites the same two hook files and changes
#  nothing else. It does NOT edit the certbot timer or the renewal config, and
#  it REFUSES to install unless a cert using the standalone authenticator exists
#  (for a webroot/nginx authenticator these hooks would be WRONG — stopping
#  nginx breaks a webroot challenge).
#
#  USAGE (on the VPS, as root, from the repo root):
#     sudo ./scripts/ops/install-cert-renew-hooks.sh            # install
#     sudo ./scripts/ops/install-cert-renew-hooks.sh --verify   # install + dry-run test
#
#  --verify runs `certbot renew --dry-run` against Let's Encrypt STAGING, which
#  briefly stops+starts nginx (~10-15s HTTPS blip) to prove the path end to end.
# =============================================================================
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-docker/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
NGINX_SERVICE="${NGINX_SERVICE:-nginx}"
HOOK_DIR="/etc/letsencrypt/renewal-hooks"
PRE_HOOK="$HOOK_DIR/pre/10-rmc-stop-nginx.sh"
POST_HOOK="$HOOK_DIR/post/10-rmc-start-nginx.sh"
RENEWAL_DIR="/etc/letsencrypt/renewal"

log() { printf '[cert-renew-hooks] %s\n' "$*"; }
die() { printf '[cert-renew-hooks] ERROR: %s\n' "$*" >&2; exit 1; }

VERIFY=0
[ "${1:-}" = "--verify" ] && VERIFY=1

[ "$(id -u)" = "0" ] || die "run as root (writes $HOOK_DIR) — use: sudo $0"
command -v docker  >/dev/null 2>&1 || die "docker not found on PATH"
command -v certbot >/dev/null 2>&1 || die "certbot not found on PATH (host certbot expected)"
[ -d /etc/letsencrypt ] || die "/etc/letsencrypt not found — issue the cert first (see the deploy runbook)"
[ -f "$REPO_ROOT/$COMPOSE_FILE" ] || die "compose file not found: $REPO_ROOT/$COMPOSE_FILE"

# These hooks are correct ONLY for the standalone authenticator. For a webroot /
# nginx authenticator, stopping nginx would BREAK renewal — refuse to install.
if ! grep -rslE '^authenticator[[:space:]]*=[[:space:]]*standalone' "$RENEWAL_DIR" >/dev/null 2>&1; then
  die "no cert using the 'standalone' authenticator found under $RENEWAL_DIR.
     These hooks free port 80 by stopping nginx, which is correct for STANDALONE
     only. If your cert renews via webroot/nginx, do NOT install these — stopping
     nginx would break the challenge. Aborting without changes."
fi

log "repo:    $REPO_ROOT"
log "compose: $COMPOSE_FILE   env: $ENV_FILE   service: $NGINX_SERVICE"

mkdir -p "$HOOK_DIR/pre" "$HOOK_DIR/post" || die "cannot create $HOOK_DIR/{pre,post}"

# Migrate any earlier hand-installed hooks (same purpose, generic names) so we
# never end up stopping/starting nginx twice per renewal.
for legacy in "$HOOK_DIR/pre/10-stop-nginx.sh" "$HOOK_DIR/post/10-start-nginx.sh"; do
  if [ -f "$legacy" ] && grep -q 'docker-compose.prod.yml' "$legacy" 2>/dev/null; then
    rm -f "$legacy" && log "removed legacy hook (superseded by rmc-managed hook): $legacy"
  fi
done

write_hook() {  # $1=path  $2=action(stop|start)
  cat > "$1" <<EOF
#!/usr/bin/env bash
# Managed by scripts/ops/install-cert-renew-hooks.sh — edit there, not here.
# Renewal $2-nginx hook: frees/restores port 80 for the standalone ACME challenge.
set -e
cd "$REPO_ROOT"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" $2 "$NGINX_SERVICE"
EOF
  chmod +x "$1" || die "cannot chmod $1"
}

write_hook "$PRE_HOOK"  stop
write_hook "$POST_HOOK" start
log "installed pre-hook:  $PRE_HOOK  (stop $NGINX_SERVICE)"
log "installed post-hook: $POST_HOOK  (start $NGINX_SERVICE)"

if [ "$VERIFY" = "1" ]; then
  log "running 'certbot renew --dry-run' (staging) — briefly stops+starts nginx…"
  certbot renew --dry-run || die "dry-run FAILED — inspect the output above; hooks are installed but unproven"
  log "dry-run OK — automatic renewal is proven end to end."
else
  log "installed. To prove it end to end (briefly blips nginx), run:"
  log "    sudo $0 --verify        # or:  certbot renew --dry-run"
fi
