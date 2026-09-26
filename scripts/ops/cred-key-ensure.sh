#!/usr/bin/env bash
# =============================================================================
#  Mix Nova RMC — make sure the credential master key exists
# =============================================================================
#  GST_CRED_ENC_KEY is the AES-256 key that seals every secret a company stores
#  through the app: GST-portal passwords AND the WhatsApp Business access token.
#  Without it the Settings screen refuses to store them ("This server has no
#  credential key"). This script generates the key once if it is missing, writes
#  it to .env.production, recreates the api so it starts with it, and checks the
#  api log says encryption is configured. Running it again changes nothing.
#
#  USAGE (on the VPS, from the repo root):
#     sudo ./scripts/ops/cred-key-ensure.sh            # generate if missing + restart api
#     sudo ./scripts/ops/cred-key-ensure.sh --status   # say whether it is set (never prints it)
#     sudo ./scripts/ops/cred-key-ensure.sh --dry-run  # write the env file only, no restart
#
#  Back the env file up afterwards: a lost key means stored secrets cannot be
#  opened and must be entered again.
# =============================================================================
set -u
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_ROOT/docker/docker-compose.prod.yml}"
API_SERVICE="${API_SERVICE:-api}"

c_ok=$'\033[32m'; c_bad=$'\033[31m'; c_warn=$'\033[33m'; c_off=$'\033[0m'
[ -t 1 ] || { c_ok=''; c_bad=''; c_warn=''; c_off=''; }
ok()   { printf '  %s✓%s %s\n' "$c_ok" "$c_off" "$*"; }
warn() { printf '  %s!%s %s\n' "$c_warn" "$c_off" "$*"; }
bad()  { printf '  %s✗%s %s\n' "$c_bad" "$c_off" "$*"; }
die()  { bad "$*"; exit 1; }

MODE=ensure; DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --status) MODE=status ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
  shift
done
[ -f "$ENV_FILE" ] || die "env file not found: $ENV_FILE"

getenv() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- ; }
is_set() { local v; v="$(getenv "$1" | tr -d "[:space:]'\"")"; [ -n "$v" ] && ! printf '%s' "$v" | grep -q '__REPLACE'; }
valid_key() { local v; v="$(getenv GST_CRED_ENC_KEY | tr -d "[:space:]'\"")"; printf '%s' "$v" | grep -Eq '^[0-9a-fA-F]{64}$'; }
set_env() {
  local tmp; tmp="$(mktemp)"
  k="$1" v="$2" awk 'BEGIN { k = ENVIRON["k"]; v = ENVIRON["v"]; done = 0 }
    index($0, k "=") == 1 { print k "=" v; done = 1; next }
    { print }
    END { if (!done) print k "=" v }' "$ENV_FILE" > "$tmp" && cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
}

printf 'Credential master key (GST_CRED_ENC_KEY)\n'
if [ "$MODE" = "status" ]; then
  if is_set GST_CRED_ENC_KEY; then
    if valid_key; then ok "set (64 hex characters) — stored secrets can be sealed and opened"; else warn "set but not 64 hex characters — the api will refuse it; run without --status to inspect"; fi
  else
    warn "not set — Settings → WhatsApp Business / GST portal credentials cannot store a secret yet"
  fi
  exit 0
fi

if is_set GST_CRED_ENC_KEY; then
  if valid_key; then ok "already present (kept, never printed)"; else die "GST_CRED_ENC_KEY is present but not 64 hex characters. Fix or remove that line by hand (nano $ENV_FILE), then run again."; fi
else
  command -v openssl >/dev/null 2>&1 || die "openssl is needed to generate the key"
  key="$(openssl rand -hex 32)"
  set_env GST_CRED_ENC_KEY "$key"
  ok "generated and written to $ENV_FILE (64 hex characters; it is never printed — back the file up)"
fi

if [ "$DRY_RUN" = "1" ]; then ok "dry run — not restarting the api"; exit 0; fi
command -v docker >/dev/null 2>&1 || die "docker not on PATH — restart the api by hand: docker compose --env-file $ENV_FILE -f $COMPOSE_FILE up -d $API_SERVICE"
printf '[cred-key] recreating the api with the key…\n'
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d "$API_SERVICE" >/dev/null 2>&1 || die "docker compose up -d $API_SERVICE failed"
for i in $(seq 1 30); do
  if docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps --format '{{.Service}} {{.Health}}' 2>/dev/null | grep -q "^$API_SERVICE healthy"; then ok "api healthy"; break; fi
  sleep 2
done
logs="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail 300 "$API_SERVICE" 2>/dev/null)"
if printf '%s' "$logs" | grep -q 'GST credential encryption: configured'; then
  ok "api log: credential encryption configured"
  printf '\n%sKEY READY%s — Settings → WhatsApp Business and GST portal credentials can now store secrets.\n' "$c_ok" "$c_off"
else
  warn "api log does not (yet) show 'GST credential encryption: configured' — check: docker compose logs --tail 100 $API_SERVICE"
fi
