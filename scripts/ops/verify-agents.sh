#!/usr/bin/env bash
# RMC Plant SaaS — multi-agent / inbuilt-AI deployment preflight (READ-ONLY).
#
# Runs ON the VPS after deploy. Confirms the agent stack is wired the way you
# intend: the reasoning backend (inbuilt local model vs opt-in Anthropic vs off),
# the local model server's reachability, and the GST transmission mode. Prints a
# single pass/fail report. Paste it as the evidence the agent layer is ready.
#
# READ-ONLY GUARANTEE: every request is a GET, except the one POST to /auth/login
# to obtain a token. Nothing is created/updated/deleted; no container/migration
# action is taken. The password is read from the environment only — never printed.
#
# Usage:
#   LOGIN='owner@example.com' RMC_PASSWORD='…' bash scripts/ops/verify-agents.sh
#   (the login must hold `agents.manage` — Company Owner / Admin)
#
# Env: DOMAIN (default mixnovas.com), LOGIN, RMC_PASSWORD.
set -uo pipefail

DOMAIN="${DOMAIN:-mixnovas.com}"
API="https://api.${DOMAIN}"
LOGIN="${LOGIN:-${RMC_LOGIN:-}}"
PASSWORD="${RMC_PASSWORD:-}"

PASS=0; FAIL=0; WARN=0; SKIP=0
c_ok=$'\033[32m'; c_bad=$'\033[31m'; c_warn=$'\033[33m'; c_dim=$'\033[2m'; c_off=$'\033[0m'
[ -t 1 ] || { c_ok=''; c_bad=''; c_warn=''; c_dim=''; c_off=''; }
section() { printf '\n%s── %s %s\n' "$c_dim" "$1" "$c_off"; }
ok()   { PASS=$((PASS+1)); printf '  %s✓%s %-46s %s\n' "$c_ok"  "$c_off" "$1" "${2:-}"; }
bad()  { FAIL=$((FAIL+1)); printf '  %s✗%s %-46s %s\n' "$c_bad" "$c_off" "$1" "${2:-}"; }
warn() { WARN=$((WARN+1)); printf '  %s!%s %-46s %s\n' "$c_warn" "$c_off" "$1" "${2:-}"; }
skip() { SKIP=$((SKIP+1)); printf '  %s·%s %-46s %s\n' "$c_dim" "$c_off" "$1" "${2:-}"; }

json_field() { # json path -> value | ''
  printf '%s' "$1" | python3 -c '
import sys, json
try: d = json.load(sys.stdin)
except Exception: sys.exit(0)
for k in sys.argv[1].split("."):
    if isinstance(d, dict) and k in d: d = d[k]
    elif isinstance(d, list) and k.isdigit() and int(k) < len(d): d = d[int(k)]
    else: sys.exit(0)
print("" if d is None else (json.dumps(d) if isinstance(d, (dict, list)) else d))
' "$2" 2>/dev/null
}

printf '%s\n' "RMC agent-layer preflight — ${DOMAIN}    $(date -u '+%Y-%m-%d %H:%M:%SZ')"
printf '%sread-only: GETs plus one login POST; nothing is modified%s\n' "$c_dim" "$c_off"

# ---- auth ----
section "1. Auth"
if [ -z "$LOGIN" ] || [ -z "$PASSWORD" ]; then
  skip "login" "set LOGIN and RMC_PASSWORD (needs agents.manage)"
  TOKEN=''
else
  body=$(curl -sS --max-time 25 -X POST "${API}/api/v1/auth/login" \
    -H 'Content-Type: application/json' -d "{\"login\":\"${LOGIN}\",\"password\":\"${PASSWORD}\"}" 2>/dev/null)
  TOKEN=$(json_field "$body" 'data.access_token')
  if [ -n "$TOKEN" ]; then ok "login" "token acquired"; else bad "login" "no token (check creds / agents.manage)"; fi
fi
auth=(-H "Authorization: Bearer ${TOKEN}")

# ---- reasoning backend ----
section "2. Reasoning backend (/agents/llm)"
if [ -z "$TOKEN" ]; then
  skip "llm status" "needs login"
else
  llm=$(curl -sS --max-time 20 "${auth[@]}" "${API}/api/v1/agents/llm" 2>/dev/null)
  llm=$(json_field "$llm" 'data')
  provider=$(json_field "$llm" 'provider'); configured=$(json_field "$llm" 'configured'); model=$(json_field "$llm" 'model')
  case "$provider" in
    local)     ok "backend" "INBUILT local model (no subscription)" ;;
    anthropic) warn "backend" "hosted Anthropic (metered/paid, opt-in)" ;;
    '')        bad "backend" "could not read provider" ;;
    *)         warn "backend" "provider '$provider'" ;;
  esac
  if [ "$configured" = "true" ]; then ok "reasoning layer" "ON  (model: ${model:-?})"
  else warn "reasoning layer" "OFF → deterministic agents only (set AGENT_LLM_LOCAL_BASE_URL to enable)"; fi
fi

# ---- inbuilt model server reachability (if configured) ----
section "3. Inbuilt model server"
BASE="${AGENT_LLM_LOCAL_BASE_URL:-}"
if [ -z "$BASE" ]; then
  skip "local model endpoint" "AGENT_LLM_LOCAL_BASE_URL not set in THIS shell (informational)"
else
  # /models is the OpenAI-compatible listing; Ollama and llama.cpp both serve it.
  got=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "${BASE%/}/models" 2>/dev/null)
  case "$got" in
    2*) ok "local model endpoint" "reachable ($BASE, HTTP $got)" ;;
    000|'') bad "local model endpoint" "unreachable at $BASE (is the model server running?)" ;;
    *) warn "local model endpoint" "$BASE returned HTTP $got" ;;
  esac
fi

# ---- GST transmission mode ----
section "4. GST transmission (/agents/gst)"
if [ -z "$TOKEN" ]; then
  skip "gst status" "needs login"
else
  g=$(curl -sS --max-time 20 "${auth[@]}" "${API}/api/v1/agents/gst" 2>/dev/null)
  g=$(json_field "$g" 'data'); gp=$(json_field "$g" 'provider'); gc=$(json_field "$g" 'configured')
  case "$gp" in
    disabled|'') ok "gst mode" "prepare-only (no transmission) — default" ;;
    fake)        bad "gst mode" "FAKE provider in production! set GST_PROVIDER=disabled or nic" ;;
    nic|gsp)     if [ "$gc" = "true" ]; then ok "gst mode" "live NIC/GSP configured"; else warn "gst mode" "nic selected but not fully configured"; fi ;;
    *)           warn "gst mode" "provider '$gp'" ;;
  esac
fi

# ---- summary ----
printf '\n%s────────────────────────%s\n' "$c_dim" "$c_off"
printf 'agent preflight: %s%d pass%s, %s%d fail%s, %s%d warn%s, %d skip\n' \
  "$c_ok" "$PASS" "$c_off" "$c_bad" "$FAIL" "$c_off" "$c_warn" "$WARN" "$c_off" "$SKIP"
[ "$FAIL" -eq 0 ]
