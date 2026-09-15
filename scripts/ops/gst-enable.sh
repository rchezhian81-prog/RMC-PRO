#!/usr/bin/env bash
# =============================================================================
#  Mix Nova RMC — switch live GST filing (e-invoice IRN + e-way bill) on or off
# =============================================================================
#  Until this is run the app PREPARES e-invoices and e-way bills but files
#  nothing: every value it needs is stored on the invoice, the IRN and QR print
#  once a portal answers. Filing needs a GSP (GST Suvidha Provider) account —
#  they give a sandbox URL, a client id, a client secret and the portal's public
#  key — plus the portal login for your GSTIN, entered later in Settings → GST
#  portal credentials.
#
#  USAGE (on the VPS, from the repo root):
#     ./scripts/ops/gst-enable.sh --sandbox      # your GSP's SANDBOX: turn the adapter and the worker on
#     ./scripts/ops/gst-enable.sh --production   # the live portal — only after the sandbox run passed
#     ./scripts/ops/gst-enable.sh --off          # back to prepare-only (nothing is filed)
#     ./scripts/ops/gst-enable.sh --status       # what is set now (never prints secrets)
#
#  Values are prompted (the client secret is typed hidden), or taken from the
#  environment for a non-interactive run:
#     GST_IRP_BASE_URL          https://… (from your GSP)
#     GST_EWB_BASE_URL          optional; defaults to the IRP host
#     GST_GSP_CLIENT_ID         from your GSP
#     GST_GSP_CLIENT_SECRET     from your GSP (never echoed)
#     GST_RSA_PUBLIC_KEY_FILE   path to the portal public key (.pem) your GSP gave you
#  --dry-run writes the env file only (no restart, no checks) — used by the tests.
#
#  What it does: generates GST_CRED_ENC_KEY once if missing (the key that
#  encrypts stored portal passwords; kept only in the env file), writes the GST_*
#  lines, recreates the api so it starts with them, waits for it to be healthy,
#  and prints the three steps that follow (credentials → Test → preflight).
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

MODE=""; DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --sandbox) MODE=sandbox ;; --production) MODE=production ;; --off) MODE=off ;; --status) MODE=status ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
  shift
done
[ -n "$MODE" ] || die "choose one: --sandbox | --production | --off | --status"
[ -f "$ENV_FILE" ] || die "env file not found: $ENV_FILE"

getenv() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- ; }
is_set() { local v; v="$(getenv "$1" | tr -d '[:space:]')"; [ -n "$v" ] && ! printf '%s' "$v" | grep -q '__REPLACE'; }
# set_env KEY VALUE — replace the active line or append; the value is written
# exactly as given (quote it yourself when it must be literal). Keeps the mode.
set_env() {
  local tmp; tmp="$(mktemp)"
  k="$1" v="$2" awk 'BEGIN { k = ENVIRON["k"]; v = ENVIRON["v"]; done = 0 }
    index($0, k "=") == 1 { print k "=" v; done = 1; next }
    { print }
    END { if (!done) print k "=" v }' "$ENV_FILE" > "$tmp" && cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
}
# A value that goes inside single quotes in the env file must not carry one.
literal() { printf "'%s'" "$1"; }
no_quote_or_newline() { case "$1" in *"'"*|*$'\n'*) return 1 ;; esac; return 0; }

status() {
  printf 'Live GST filing — status\n'
  local p; p="$(getenv GST_PROVIDER | tr -d '[:space:]')"
  case "${p:-disabled}" in
    nic|gsp) ok "GST_PROVIDER=$p (live adapter on) · GST_ENV=$(getenv GST_ENV | tr -d "[:space:]'\"")" ;;
    fake)    warn "GST_PROVIDER=fake — the offline simulator; never for production" ;;
    *)       warn "GST_PROVIDER=${p:-disabled} — prepare-only, nothing is filed" ;;
  esac
  for k in GST_IRP_BASE_URL GST_GSP_CLIENT_ID GST_GSP_CLIENT_SECRET GST_RSA_PUBLIC_KEY_PEM GST_CRED_ENC_KEY; do
    if is_set "$k"; then ok "$k set"; else warn "$k not set"; fi
  done
  local w; w="$(getenv GST_WORKER_ENABLED | tr -d '[:space:]')"
  if [ "$w" = "true" ]; then ok "GST_WORKER_ENABLED=true (approved actions are filed automatically)"; else warn "GST_WORKER_ENABLED=${w:-false} (approved actions wait for a manual drain)"; fi
}

ensure_enc_key() {
  if is_set GST_CRED_ENC_KEY; then ok "GST_CRED_ENC_KEY already present (kept)"; return 0; fi
  command -v openssl >/dev/null 2>&1 || die "openssl is needed to generate GST_CRED_ENC_KEY"
  local key; key="$(openssl rand -hex 32)"
  set_env GST_CRED_ENC_KEY "$key"
  ok "GST_CRED_ENC_KEY generated and written (64 hex chars; it is never printed — back the env file up)"
}

restart_api() {
  [ "$DRY_RUN" = "1" ] && { ok "dry run — not restarting the api"; return 0; }
  command -v docker >/dev/null 2>&1 || die "docker not on PATH — restart the api by hand"
  printf '[gst-enable] recreating the api with the new environment…\n'
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d "$API_SERVICE" >/dev/null 2>&1 || die "docker compose up -d $API_SERVICE failed"
  local i
  for i in $(seq 1 30); do
    if docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps --format '{{.Service}} {{.Health}}' 2>/dev/null | grep -q "^$API_SERVICE healthy"; then ok "api healthy"; break; fi
    sleep 2
  done
  local logs; logs="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail 300 "$API_SERVICE" 2>/dev/null)"
  if printf '%s' "$logs" | grep -q 'GST credential encryption: configured'; then ok "api log: GST credential encryption configured"
  else warn "api log does not (yet) show 'GST credential encryption: configured' — check: docker compose logs --tail 100 $API_SERVICE"; fi
  if printf '%s' "$logs" | grep -q 'GST execution worker: enabled'; then ok "api log: GST execution worker enabled"; fi
}

case "$MODE" in
  status) status; exit 0 ;;
  off)
    printf 'Live GST filing — switching OFF (prepare-only)\n'
    set_env GST_PROVIDER disabled
    set_env GST_WORKER_ENABLED false
    ok "GST_PROVIDER=disabled, GST_WORKER_ENABLED=false written"
    restart_api
    printf '\n%sLIVE FILING OFF%s — invoices are prepared, nothing is sent to the portal.\n' "$c_ok" "$c_off"
    exit 0 ;;
esac

# ---- sandbox / production ----------------------------------------------------
printf 'Live GST filing — switching ON (%s)\n' "$MODE"
irp="${GST_IRP_BASE_URL:-}"; ewb="${GST_EWB_BASE_URL:-}"; cid="${GST_GSP_CLIENT_ID:-}"; csec="${GST_GSP_CLIENT_SECRET:-}"; pem="${GST_RSA_PUBLIC_KEY_FILE:-}"
# Prompt only at a terminal; a scripted run must pass the values in the
# environment (a missing one is an error, never a hang on a silent prompt).
ask() { # ask VAR "label" [hidden]
  local __var="$1" __label="$2" __hidden="${3:-}" __v=""
  if [ -t 0 ]; then
    printf '%s: ' "$__label"
    if [ -n "$__hidden" ]; then read -rs __v; printf '\n'; else read -r __v; fi
  fi
  printf -v "$__var" '%s' "$__v"
}
[ -n "$irp" ]  || ask irp 'IRP base URL (from your GSP, https://…)'
[ -n "$ewb" ]  || ask ewb 'E-way base URL (Enter to use the IRP host)'
[ -n "$cid" ]  || ask cid 'Client id'
[ -n "$csec" ] || ask csec 'Client secret (hidden)' hidden
[ -n "$pem" ]  || ask pem 'Path to the portal public key file (.pem)'
[ -n "$irp" ] && [ -n "$cid" ] && [ -n "$csec" ] && [ -n "$pem" ] || die "missing values — run at a terminal to be prompted, or set GST_IRP_BASE_URL, GST_GSP_CLIENT_ID, GST_GSP_CLIENT_SECRET and GST_RSA_PUBLIC_KEY_FILE in the environment"

case "$irp" in https://*) ;; *) die "the IRP base URL must start with https://" ;; esac
[ -z "$ewb" ] || case "$ewb" in https://*) ;; *) die "the e-way base URL must start with https://" ;; esac
[ -n "$cid" ] && [ -n "$csec" ] || die "client id and client secret are both required"
no_quote_or_newline "$cid"  || die "the client id must not contain a single quote"
no_quote_or_newline "$csec" || die "the client secret must not contain a single quote — ask your GSP to reissue it"
[ -f "$pem" ] || die "public key file not found: $pem"
grep -q 'BEGIN PUBLIC KEY\|BEGIN RSA PUBLIC KEY\|BEGIN CERTIFICATE' "$pem" || die "$pem does not look like a PEM public key"
if [ "$MODE" = "production" ] && printf '%s' "$irp" | grep -qi 'sandbox\|test\|uat'; then
  die "--production with an IRP URL that looks like a sandbox ($irp) — use --sandbox, or the live URL"
fi

ensure_enc_key
# The PEM is several lines; the env file holds it as ONE double-quoted line with
# literal \n (compose expands them, and the API restores them as well).
pem_line="$(tr -d '\r' < "$pem" | sed -e ':a' -e 'N' -e '$!ba' -e 's/\n/\\n/g')"
set_env GST_PROVIDER nic
set_env GST_ENV "$MODE"
set_env GST_IRP_BASE_URL "$(literal "${irp%/}")"
if [ -n "$ewb" ]; then set_env GST_EWB_BASE_URL "$(literal "${ewb%/}")"; else set_env GST_EWB_BASE_URL ""; fi
set_env GST_GSP_CLIENT_ID "$(literal "$cid")"
set_env GST_GSP_CLIENT_SECRET "$(literal "$csec")"
set_env GST_RSA_PUBLIC_KEY_PEM "\"$pem_line\""
set_env GST_WORKER_ENABLED true
ok "GST_PROVIDER=nic, GST_ENV=$MODE, URLs, client id/secret, public key and GST_WORKER_ENABLED=true written"
chmod 600 "$ENV_FILE" 2>/dev/null || true

restart_api

cat <<NEXT

${c_ok}LIVE FILING ON (${MODE})${c_off}. Three steps remain, in this order:
  1. In the app: Settings → GST portal credentials → add the ${MODE} portal login for your GSTIN → Test.
     It must say "authenticated" (that is the real handshake with the portal).
  2. On the server, the read-only go-live check:
       LOGIN='owner@…' RMC_PASSWORD='…' ./scripts/ops/gst-go-live-preflight.sh
  3. On one test invoice: Generate IRN, print it (the IRN and the signed QR are on the page),
     then Cancel IRN — all within the sandbox. Only then run this script with --production.
NEXT
exit 0
