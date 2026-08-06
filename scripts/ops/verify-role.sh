#!/usr/bin/env bash
# RMC Plant SaaS — verify what one user can actually reach (READ-ONLY).
#
# Signs in as a staff member and probes each guarded endpoint, checking that the
# API's answer matches the permissions that user genuinely holds: a 200 where
# they have the permission, a 403 where they do not. That is the real question
# behind "does the role work" — clicking around a menu only shows what the UI
# chose to draw, not what the server would allow.
#
# READ-ONLY: every probe is a GET, plus the one POST to /auth/login for a token.
# It creates nothing and changes nothing, so it is safe against production.
#
# Usage (on the VPS):
#   read -rs RMC_PASSWORD; export RMC_PASSWORD     # run this line ALONE
#   LOGIN='operator@plant.com' bash scripts/ops/verify-role.sh
#   unset RMC_PASSWORD
#
#   # optionally assert the role they should hold:
#   LOGIN='operator@plant.com' EXPECT_ROLE=batching_operator bash scripts/ops/verify-role.sh
#
# The password is read from the environment only — never printed, never logged.
set -uo pipefail

DOMAIN="${DOMAIN:-mixnovas.com}"
API="https://api.${DOMAIN}"
LOGIN="${LOGIN:-${RMC_LOGIN:-}}"
PASSWORD="${RMC_PASSWORD:-}"
EXPECT_ROLE="${EXPECT_ROLE:-}"

PASS=0; FAIL=0
c_ok=$'\033[32m'; c_bad=$'\033[31m'; c_dim=$'\033[2m'; c_off=$'\033[0m'
[ -t 1 ] || { c_ok=''; c_bad=''; c_dim=''; c_off=''; }
ok()  { PASS=$((PASS+1)); printf '  %s✓%s %-26s %s\n' "$c_ok"  "$c_off" "$1" "${2:-}"; }
bad() { FAIL=$((FAIL+1)); printf '  %s✗%s %-26s %s\n' "$c_bad" "$c_off" "$1" "${2:-}"; }

[ -n "$LOGIN" ]    || { echo "Set LOGIN=<the staff member's email>." >&2; exit 2; }
[ -n "$PASSWORD" ] || { echo "Set RMC_PASSWORD in the environment (never printed)." >&2; exit 2; }

json() { printf '%s' "$1" | python3 -c '
import sys, json
try: d = json.load(sys.stdin)
except Exception: sys.exit(0)
for k in sys.argv[1].split("."):
    if isinstance(d, dict) and k in d: d = d[k]
    else: sys.exit(0)
print(json.dumps(d) if isinstance(d, (dict, list)) else ("" if d is None else d))
' "$2" 2>/dev/null; }

printf '%s\n' "Role check — ${LOGIN} @ ${DOMAIN}    $(date -u '+%Y-%m-%d %H:%M:%SZ')"
printf '%sread-only: GETs plus one login POST; nothing is modified%s\n\n' "$c_dim" "$c_off"

body=$(curl -sS --max-time 25 -X POST "${API}/api/v1/auth/login" \
        -H 'content-type: application/json' \
        -d "{\"login\":$(printf '%s' "$LOGIN" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))'),\"password\":$(printf '%s' "$PASSWORD" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')}" 2>/dev/null)

TOKEN=$(json "$body" 'data.access_token')
if [ -z "$TOKEN" ]; then
  bad "sign in" "$(json "$body" 'error.message' | head -c 70)"
  echo; echo "Cannot continue without a token."; exit 1
fi

ROLES=$(json "$body" 'data.roles' | tr -d '[]"')
PERMS_JSON=$(json "$body" 'data.permissions')
NPERM=$(printf '%s' "$PERMS_JSON" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))' 2>/dev/null || echo 0)
ok "sign in" "role: ${ROLES:-none} · ${NPERM} permission(s)"

if [ -z "${ROLES}" ]; then
  bad "has a role" "none assigned — this user cannot use the app"
elif [ -n "$EXPECT_ROLE" ]; then
  case ",$ROLES," in
    *",$EXPECT_ROLE,"*) ok "role is $EXPECT_ROLE" ;;
    *) bad "role is $EXPECT_ROLE" "actually: $ROLES" ;;
  esac
fi

# Owner and super-admin bypass every permission check, by design.
OWNER=0
case ",$ROLES," in *",company_owner,"*) OWNER=1 ;; esac
[ "$OWNER" = 1 ] && printf '\n%sThis user is the company owner — permission checks are bypassed, so every probe should allow.%s\n' "$c_dim" "$c_off"

has_perm() { printf '%s' "$PERMS_JSON" | python3 -c '
import sys, json
try: perms = set(json.load(sys.stdin))
except Exception: perms = set()
sys.exit(0 if sys.argv[1] in perms else 1)
' "$1" 2>/dev/null; }

# endpoint|permission the API requires for a GET (verified against the controllers)
PROBES=(
  "/users|users.manage"
  "/roles|roles.manage"
  "/customers|masters.view"
  "/materials|masters.view"
  "/plants|masters.view"
  "/leads|leads.view"
  "/quotations|quotations.view"
  "/rate-contracts|rate_contracts.view"
  "/order-drafts|orders.view"
  "/orders|orders.view"
  "/credit-holds|orders.view"
)

printf '\n%s── What the server actually allows %s\n' "$c_dim" "$c_off"
for entry in "${PROBES[@]}"; do
  path="${entry%%|*}"; perm="${entry##*|}"
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 \
          -H "authorization: Bearer $TOKEN" "${API}/api/v1${path}" 2>/dev/null || echo 000)
  if [ "$OWNER" = 1 ] || has_perm "$perm"; then
    want="allow"; [ "$code" = "200" ] && ok "$path" "200 — allowed ($perm)" \
      || bad "$path" "HTTP $code but the user HOLDS $perm"
  else
    want="deny";  [ "$code" = "403" ] && ok "$path" "403 — correctly blocked (no $perm)" \
      || bad "$path" "HTTP $code — expected 403, user lacks $perm"
  fi
done

# These carry no permission requirement: everyone signed in should reach them.
printf '\n%s── Open to every signed-in user %s\n' "$c_dim" "$c_off"
for path in "/dashboard/summary" "/alerts" "/message-templates"; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 \
          -H "authorization: Bearer $TOKEN" "${API}/api/v1${path}" 2>/dev/null || echo 000)
  [ "$code" = "200" ] && ok "$path" "200" || bad "$path" "HTTP $code — expected 200"
done

printf '\n────────────────────────────────────────\n'
printf '%s%d passed%s · %s%d failed%s\n' "$c_ok" "$PASS" "$c_off" "$c_bad" "$FAIL" "$c_off"
if [ "$FAIL" -gt 0 ]; then
  printf '%sROLE CHECK FAILED — the server is not enforcing this role as configured.%s\n' "$c_bad" "$c_off"
  exit 1
fi
printf '%sROLE OK — access matches this user'"'"'s permissions exactly.%s\n' "$c_ok" "$c_off"
