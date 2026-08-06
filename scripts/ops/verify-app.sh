#!/usr/bin/env bash
# RMC Plant SaaS — live smoke test (READ-ONLY).
#
# Runs ON the VPS, where the live site is reachable, and prints a single
# pass/fail report covering the edge, the API, the data endpoints, auth
# enforcement, and container health. Paste the output anywhere a second pair of
# eyes is needed — it is the evidence a browser session would otherwise give.
#
# READ-ONLY GUARANTEE: every request is a GET, except the one POST to
# /auth/login needed to obtain a token. Nothing is created, updated, or deleted,
# and no migration or container action is taken.
#
# Usage:
#   read -rs RMC_PASSWORD; export RMC_PASSWORD     # run this line ALONE
#   LOGIN='owner@example.com' bash scripts/ops/verify-app.sh
#   unset RMC_PASSWORD
#
# Without a login it still runs every unauthenticated check and clearly marks
# the authenticated ones as skipped.
#
# The password is read from the environment only: never printed, never logged,
# never written to disk. The access token is likewise never displayed.
#
# Env: DOMAIN (default mixnovas.com), LOGIN, RMC_PASSWORD,
#      COMPOSE_FILE, ENV_FILE, CERT_WARN_DAYS (default 21).
set -uo pipefail

DOMAIN="${DOMAIN:-mixnovas.com}"
APP="https://app.${DOMAIN}"
API="https://api.${DOMAIN}"
ADMIN="https://admin.${DOMAIN}"
LOGIN="${LOGIN:-${RMC_LOGIN:-}}"
PASSWORD="${RMC_PASSWORD:-}"
ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-docker/docker-compose.prod.yml}"
CERT_WARN_DAYS="${CERT_WARN_DAYS:-21}"

PASS=0; FAIL=0; WARN=0; SKIP=0
TOKEN=''

c_ok=$'\033[32m'; c_bad=$'\033[31m'; c_warn=$'\033[33m'; c_dim=$'\033[2m'; c_off=$'\033[0m'
[ -t 1 ] || { c_ok=''; c_bad=''; c_warn=''; c_dim=''; c_off=''; }

section() { printf '\n%s── %s %s\n' "$c_dim" "$1" "$c_off"; }
ok()   { PASS=$((PASS+1)); printf '  %s✓%s %-46s %s\n' "$c_ok"  "$c_off" "$1" "${2:-}"; }
bad()  { FAIL=$((FAIL+1)); printf '  %s✗%s %-46s %s\n' "$c_bad" "$c_off" "$1" "${2:-}"; }
warn() { WARN=$((WARN+1)); printf '  %s!%s %-46s %s\n' "$c_warn" "$c_off" "$1" "${2:-}"; }
skip() { SKIP=$((SKIP+1)); printf '  %s·%s %-46s %s\n' "$c_dim" "$c_off" "$1" "${2:-}"; }

# HTTP status of a URL. curl already writes 000 and exits non-zero when the
# connection never completes, so take its output as-is — appending our own
# fallback would produce "000000".
code_of() {
  local out
  out=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$@" 2>/dev/null)
  printf '%s' "${out:-000}"
}

# Expect a specific status code.
expect() { # label url expected [curl args...]
  local label="$1" url="$2" want="$3"; shift 3
  local got; got=$(code_of "$@" "$url")
  if [ "$got" = "$want" ]; then ok "$label" "HTTP $got"; else bad "$label" "HTTP $got (expected $want)"; fi
}

# Read a field out of the API's { success, data } envelope without printing secrets.
json_field() { # json path -> value | ''
  printf '%s' "$1" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for k in sys.argv[1].split("."):
    if isinstance(d, dict) and k in d:
        d = d[k]
    elif isinstance(d, list) and k.isdigit() and int(k) < len(d):
        d = d[int(k)]
    else:
        sys.exit(0)
print("" if d is None else (json.dumps(d) if isinstance(d, (dict, list)) else d))
' "$2" 2>/dev/null
}

printf '%s\n' "RMC live verification — ${DOMAIN}    $(date -u '+%Y-%m-%d %H:%M:%SZ')"
printf '%sread-only: GETs plus one login POST; nothing is modified%s\n' "$c_dim" "$c_off"

# ---------------------------------------------------------------- edge / TLS --
section "1. Edge & TLS"
for host in "app.${DOMAIN}" "api.${DOMAIN}" "admin.${DOMAIN}"; do
  got=$(code_of "https://${host}/")
  case "$got" in
    000|'')  bad "$host reachable" "connection failed (DNS, TLS, or firewall)" ;;
    5*)      bad "$host reachable" "HTTP $got — server error" ;;
    2*|3*|4*) ok "$host reachable" "HTTP $got" ;;
    *)       bad "$host reachable" "unexpected response '$got'" ;;
  esac
done

if command -v openssl >/dev/null 2>&1; then
  end=$(echo | openssl s_client -servername "app.${DOMAIN}" -connect "app.${DOMAIN}:443" 2>/dev/null \
        | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  if [ -n "${end:-}" ]; then
    days=$(( ( $(date -d "$end" +%s) - $(date +%s) ) / 86400 ))
    if   [ "$days" -lt 0 ]; then bad "TLS certificate" "EXPIRED ${days#-} days ago"
    elif [ "$days" -lt "$CERT_WARN_DAYS" ]; then warn "TLS certificate" "expires in $days days"
    else ok "TLS certificate" "valid $days more days"; fi
  else
    warn "TLS certificate" "could not read expiry"
  fi
else
  skip "TLS certificate" "openssl not installed"
fi

# HTTP should redirect to HTTPS, and the apex should land on the app.
got=$(code_of --max-redirs 0 "http://${DOMAIN}/")
case "$got" in 30*) ok "http → https redirect" "HTTP $got" ;; *) warn "http → https redirect" "HTTP $got" ;; esac

# ---------------------------------------------------------------- web routes --
section "2. Web app"
expect "login page"     "${APP}/login"          200
expect "app shell"      "${APP}/app/dashboard"  200
expect "admin portal"   "${ADMIN}/admin/tenants" 200
expect "unknown route 404s" "${APP}/app/definitely-not-a-page" 404

# ---------------------------------------------------------------------- API --
section "3. API health & auth enforcement"
expect "health endpoint"            "${API}/health"                 200
expect "protected route needs auth" "${API}/api/v1/dashboard/summary" 401
expect "alerts route needs auth"    "${API}/api/v1/alerts"          401
expect "bad token rejected"         "${API}/api/v1/dashboard/summary" 401 \
  -H 'authorization: Bearer not-a-real-token'

# ------------------------------------------------------------------- login  --
section "4. Authenticated checks"
if [ -z "$LOGIN" ] || [ -z "$PASSWORD" ]; then
  skip "login" "set LOGIN and RMC_PASSWORD to include these"
  for s in "dashboard summary" "alerts" "message templates" "outstanding report" "permission catalogue"; do
    skip "$s" "needs login"
  done
else
  body=$(curl -sS --max-time 25 -X POST "${API}/api/v1/auth/login" \
          -H 'content-type: application/json' \
          -d "{\"login\":$(printf '%s' "$LOGIN" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))'),\"password\":$(printf '%s' "$PASSWORD" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')}" 2>/dev/null)
  TOKEN=$(json_field "$body" 'data.access_token')
  if [ -z "$TOKEN" ]; then
    bad "login" "no token returned — check the login/password"
  else
    tenant=$(json_field "$body" 'data.tenant.name')
    nperm=$(json_field "$body" 'data.permissions' | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))' 2>/dev/null || echo '?')
    roles=$(json_field "$body" 'data.roles' | tr -d '[]"' )
    ok "login" "tenant: ${tenant:-?} · roles: ${roles:-none} · ${nperm} permission(s)"

    auth=(-H "authorization: Bearer $TOKEN")

    # Each check confirms a 200 AND that the payload has the expected shape,
    # so an empty-but-successful response can't masquerade as healthy.
    probe() { # label path field
      local label="$1" path="$2" field="$3" out val
      out=$(curl -sS --max-time 25 "${auth[@]}" "${API}/api/v1${path}" 2>/dev/null)
      if [ "$(json_field "$out" 'success')" != "True" ] && [ "$(json_field "$out" 'success')" != "true" ]; then
        bad "$label" "$(json_field "$out" 'error.message' | head -c 60)"
        return
      fi
      val=$(json_field "$out" "$field")
      if [ -n "$val" ]; then ok "$label" "${4:-$field}=$(printf '%s' "$val" | head -c 40)"
      else warn "$label" "responded, but '$field' was empty"; fi
    }

    probe "dashboard summary"   "/dashboard/summary"          'data.billing.invoicesIssued' 'invoices'
    probe "operations funnel"   "/dashboard/operations-funnel" 'data.quotations'            'quotations'
    probe "alerts (rule-based)" "/alerts"                      'data.alerts.0.key'          'first alert'
    probe "message templates"   "/message-templates"           'data.templates.0.key'       'first template'
    probe "outstanding report"  "/billing-reports/outstanding" 'data.totals.total'          'total'
    probe "reports catalog"     "/reports/catalog"             'data.groups.0.module'       'group'
    probe "customers master"    "/customers"                   'data.0.customerCode'        'code'

    # AI is optional — report its state rather than failing on it.
    ai=$(curl -sS --max-time 20 "${auth[@]}" "${API}/api/v1/ai/status" 2>/dev/null)
    case "$(json_field "$ai" 'data.enabled')" in
      True|true) ok   "AI features" "enabled" ;;
      *)         skip "AI features" "switched off (optional)" ;;
    esac

    # Permission catalogue — confirms the sales keys are seeded and assignable.
    perms=$(curl -sS --max-time 20 "${auth[@]}" "${API}/api/v1/roles/permissions-catalog" 2>/dev/null)
    missing=$(printf '%s' "$perms" | python3 -c '
import sys, json
want = ["leads.view","leads.manage","quotations.view","quotations.approve",
        "rate_contracts.view","rate_contracts.create","rate_contracts.approve",
        "masters.view","masters.create","masters.edit","masters.delete"]
try:
    rows = json.load(sys.stdin).get("data", [])
except Exception:
    print("unreadable"); raise SystemExit
have = {r.get("permissionKey") or r.get("permission_key") for r in rows if isinstance(r, dict)}
miss = [w for w in want if w not in have]
print(",".join(miss) if miss else "")
' 2>/dev/null)
    if [ -z "$missing" ]; then ok "permission catalogue" "all 11 RBAC keys present"
    elif [ "$missing" = "unreadable" ]; then warn "permission catalogue" "endpoint shape unrecognised"
    else bad "permission catalogue" "missing: $missing"; fi
  fi
fi

# ------------------------------------------------------------- containers  --
section "5. Containers & logs"
if [ -f "$COMPOSE_FILE" ] && [ -f "$ENV_FILE" ] && command -v docker >/dev/null 2>&1; then
  DC=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
  unhealthy=$("${DC[@]}" ps --format '{{.Service}} {{.State}} {{.Status}}' 2>/dev/null \
              | grep -viE 'running|exited \(0\)' | head -5)
  if [ -z "$unhealthy" ]; then ok "containers" "all running/healthy"
  else bad "containers" "$(printf '%s' "$unhealthy" | tr '\n' ';')"; fi

  errs=$("${DC[@]}" logs --since 1h api 2>/dev/null | grep -ciE '\bERROR\b' || true)
  if   [ "${errs:-0}" -eq 0 ]; then ok   "api errors (last hour)" "none"
  elif [ "${errs:-0}" -lt 10 ]; then warn "api errors (last hour)" "$errs — check the log"
  else bad "api errors (last hour)" "$errs — check the log"; fi

  # Disk headroom: the images and Postgres volume live here.
  used=$(df -P / | awk 'NR==2{gsub("%","",$5); print $5}')
  if   [ "${used:-0}" -lt 80 ]; then ok   "disk usage" "${used}% used"
  elif [ "${used:-0}" -lt 90 ]; then warn "disk usage" "${used}% used"
  else bad "disk usage" "${used}% used"; fi
else
  skip "containers" "run from the repo root on the server"
  skip "api errors"  "run from the repo root on the server"
  skip "disk usage"  "run from the repo root on the server"
fi

# ------------------------------------------------------------------ verdict --
printf '\n────────────────────────────────────────\n'
printf '%s%d passed%s · %s%d failed%s · %s%d warning(s)%s · %d skipped\n' \
  "$c_ok" "$PASS" "$c_off" "$c_bad" "$FAIL" "$c_off" "$c_warn" "$WARN" "$c_off" "$SKIP"
if [ "$FAIL" -gt 0 ]; then
  printf '%sVERIFY FAILED — see the ✗ lines above.%s\n' "$c_bad" "$c_off"; exit 1
fi
if [ "$WARN" -gt 0 ]; then
  printf '%sVERIFY OK with warnings.%s\n' "$c_warn" "$c_off"; exit 0
fi
printf '%sVERIFY OK — the live system is healthy.%s\n' "$c_ok" "$c_off"
