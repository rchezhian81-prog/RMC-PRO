#!/usr/bin/env bash
# =============================================================================
#  Mix Nova RMC — full RBAC gate verification (owner-only, self-bootstrapping)
# =============================================================================
#  The read-only smoke (smoke-prod.sh) can only prove the OWNER still sees
#  everything — the owner bypasses every gate, so a 403 can never fire for them.
#  Proving the DENY side (that a low-privilege user is correctly locked out)
#  needs a second, un-privileged login.
#
#  This script needs only the OWNER login. It uses the owner's token to
#  bootstrap a THROWAWAY, zero-permission user, runs the deny-side gate matrix
#  as that user, and then cleans up after itself. So you can "run every test
#  with the owner id" even when no low-privilege account exists yet.
#
#  IT MUTATES (briefly): it creates a temporary role + user and, at the end,
#  deactivates the user (freeing its seat) and deletes the temporary role. The
#  user row is left DEACTIVATED (the API has no hard user-delete); a re-run
#  reuses and reactivates the same account, so nothing accumulates. Both the
#  role and the user carry an obvious "smoke_verify" marker. Set KEEP=1 to skip
#  cleanup for debugging.
#
#  Gates verified as the zero-permission user (each must be DENIED / withheld):
#    C2  GET /ai/status              -> 403      (ai.use)
#    C5  GET /company                -> bank account number stripped (settings.manage)
#    C6  GET /dashboard/summary      -> receivables total withheld (reports.view)
#    -   GET /dashboard/trends       -> money (collected) series dropped
#    -   GET /billing-reports/...     -> 403      (reports.view)
#  ...and the operational surface the user SHOULD still reach:
#        GET /dashboard/summary       -> 200 (dashboard is open to every user)
#
#  USAGE:
#    API_BASE=https://api.mixnovas.com/api/v1 \
#    OWNER_LOGIN='owner@pilot1.com' OWNER_PASSWORD='********' \
#    ./scripts/ops/verify-gates-prod.sh
#
#  Optional: SMOKE_EMAIL='smoke.verify@yourdomain.com' overrides the derived
#  throwaway email; KEEP=1 leaves the temp role/user in place.
#
#  EXIT: 0 = all checks passed · 1 = one or more failed · 2 = could not run.
#  Requires: curl, python3.
# =============================================================================
set -u

API_BASE="${API_BASE:-https://api.mixnovas.com/api/v1}"
# /health is excluded from the api/v1 prefix (see apps/api/src/main.ts), so it
# lives at the domain root, not under /api/v1.
HEALTH_URL="${HEALTH_URL:-${API_BASE%/api/v1}/health}"
BODY="$(mktemp)"
pass=0; fail=0
ROLE_ID=""; USER_ID=""; OT=""

command -v curl    >/dev/null 2>&1 || { echo "ERROR: curl not on PATH";    exit 2; }
command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 not on PATH"; exit 2; }
[ -n "${OWNER_LOGIN:-}" ] && [ -n "${OWNER_PASSWORD:-}" ] || {
  echo "ERROR: set OWNER_LOGIN and OWNER_PASSWORD"; exit 2; }

# ---- helpers --------------------------------------------------------------
export SMOKE_BODY="$BODY"

# req METHOD PATH [TOKEN] [JSON_BODY]  -> echoes the HTTP status; body in $BODY
req() {
  local method="$1" path="$2" token="${3:-}" data="${4:-}"
  local args=(-sS -m 25 -o "$BODY" -w '%{http_code}' -X "$method" "$API_BASE$path"
              -H 'Content-Type: application/json')
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  [ -n "$data" ]  && args+=(--data "$data")
  curl "${args[@]}" 2>/dev/null
}

# jget a.b.c  -> value at that dotted path in $BODY, or "" if absent/not-json
jget() {
  python3 - "$1" <<'PY'
import sys, json, os
try:
    d = json.load(open(os.environ["SMOKE_BODY"]))
except Exception:
    d = None
for k in sys.argv[1].split("."):
    d = d.get(k) if isinstance(d, dict) else None
print("" if d is None else d)
PY
}

# jfind ARRAY_PATH MATCH_FIELD MATCH_VALUE RETURN_FIELD
#   -> RETURN_FIELD of the first item in the array at ARRAY_PATH whose
#      MATCH_FIELD equals MATCH_VALUE (case-insensitive), or "" if none.
jfind() {
  python3 - "$@" <<'PY'
import sys, json, os
arr_path, mfield, mval, rfield = sys.argv[1:5]
try:
    d = json.load(open(os.environ["SMOKE_BODY"]))
except Exception:
    d = None
for k in arr_path.split("."):
    d = d.get(k) if isinstance(d, dict) else None
if isinstance(d, list):
    for it in d:
        if isinstance(it, dict) and str(it.get(mfield, "")).lower() == mval.lower():
            print(it.get(rfield, "") if it.get(rfield) is not None else "")
            break
PY
}

# mkjson k v k v ...  -> a JSON object (safe for values with special chars)
mkjson() { python3 -c 'import json,sys; print(json.dumps(dict(zip(sys.argv[1::2], sys.argv[2::2]))))' "$@"; }

# do_login EMAIL PASSWORD -> sets REPLY=token ("" on failure) and LOGIN_CODE
LOGIN_CODE=""
do_login() {
  LOGIN_CODE="$(req POST /auth/login '' "$(mkjson login "$1" password "$2")")"
  if [ "$LOGIN_CODE" = "200" ] || [ "$LOGIN_CODE" = "201" ]; then REPLY="$(jget data.access_token)"; else REPLY=""; fi
}

ok() { pass=$((pass+1)); printf '  \033[32mPASS\033[0m %s\n' "$1"; }
no() { fail=$((fail+1)); printf '  \033[31mFAIL\033[0m %s  (%s)\n' "$1" "$2"; }
eq() { if [ "$1" = "$2" ]; then ok "$3"; else no "$3" "expected $2, got: $1"; fi; }
present() { if [ -n "$1" ]; then ok "$2"; else no "$2" "value was empty/null"; fi; }
empty()   { if [ -z "$1" ]; then ok "$2"; else no "$2" "value was present: $1"; fi; }

# ---- cleanup (runs on any exit) -------------------------------------------
cleanup() {
  if [ "${KEEP:-}" != "1" ] && [ -n "$OT" ]; then
    if [ -n "$USER_ID" ]; then
      # Deactivate (frees the plan seat) and clear the role, so the temp role
      # has no assignments and can be deleted.
      req PATCH "/users/$USER_ID" "$OT" "$(mkjson status inactive roleId '')" >/dev/null 2>&1
    fi
    if [ -n "$ROLE_ID" ]; then
      req DELETE "/roles/$ROLE_ID" "$OT" >/dev/null 2>&1
    fi
    echo "-- cleanup: deactivated the temp user and deleted the temp role --"
  elif [ "${KEEP:-}" = "1" ]; then
    echo "-- cleanup skipped (KEEP=1): temp user id=$USER_ID role id=$ROLE_ID left in place --"
  fi
  rm -f "$BODY"
}
trap cleanup EXIT

echo "=== Mix Nova RBAC gate verification @ $API_BASE ==="

# ---- 0. Reachability -------------------------------------------------------
HCODE="$(curl -sS -m 15 -o "$BODY" -w '%{http_code}' "$HEALTH_URL" 2>/dev/null)"
eq "$HCODE" 200 "API health is reachable ($HEALTH_URL)"

# ---- 1. Owner logs in and sees everything (bypasses every gate) ------------
echo "-- owner (should see everything) --"
do_login "$OWNER_LOGIN" "$OWNER_PASSWORD"; OT="$REPLY"
if [ -n "$OT" ]; then
  ok "owner logs in"
else
  no "owner logs in" "POST /auth/login -> HTTP $LOGIN_CODE: $(head -c 180 "$BODY")"
  echo "   -> check OWNER_LOGIN/OWNER_PASSWORD are REAL creds and API_BASE=$API_BASE"
  echo; printf '\033[31mVERIFY FAILED\033[0m: %d passed, %d failed\n' "$pass" "$fail"; exit 1
fi
eq "$(req GET /dashboard/summary "$OT")" 200 "owner dashboard summary loads"
present "$(jget data.billing.outstandingTotal)" "owner sees the receivables total (C6 owner path intact)"
eq "$(req GET /ai/status "$OT")" 200 "owner reaches the AI surface (C2 owner path intact)"
eq "$(req GET /billing-reports/outstanding "$OT")" 200 "owner reaches the receivables report (reports.view bypass)"
present "$(req GET /company "$OT" >/dev/null; jget data.companyName)" "owner GET /company returns the profile"
# E1: proves the deploy carries the new validation code (bad date -> 400, not 500).
eq "$(req GET '/billing-reports/grade-margin?from=not-a-date' "$OT")" 400 "a malformed report date returns 400 (proves the deploy took)"

# ---- 2. Bootstrap a throwaway zero-permission user (via the owner token) ----
echo "-- bootstrapping a throwaway low-privilege user (via owner) --"
SMOKE_ROLE_KEY="smoke_verify"
OWNER_DOMAIN="${OWNER_LOGIN#*@}"; [ "$OWNER_DOMAIN" = "$OWNER_LOGIN" ] && OWNER_DOMAIN="smoke.local"
SMOKE_EMAIL="${SMOKE_EMAIL:-smoke.verify@$OWNER_DOMAIN}"
# A random password that satisfies the policy (>=10 chars, a letter, a number,
# not starting with a common word). Held only in this process; never printed.
SMOKE_PW="Sk9$(python3 -c 'import secrets;print(secrets.token_hex(8))')"

# Role: find or create, then force it to hold ZERO permissions.
req GET /roles "$OT" >/dev/null
ROLE_ID="$(jfind data roleKey "$SMOKE_ROLE_KEY" id)"
if [ -z "$ROLE_ID" ]; then
  req POST /roles "$OT" "$(mkjson roleKey "$SMOKE_ROLE_KEY" roleName 'Smoke Verify (temp — no permissions)')" >/dev/null
  ROLE_ID="$(jget data.id)"
fi
present "$ROLE_ID" "temp role ready ($SMOKE_ROLE_KEY)"
if [ -n "$ROLE_ID" ]; then
  req PUT "/roles/$ROLE_ID/permissions" "$OT" '{"permissionIds":[]}' >/dev/null
fi

# User: find or create; if it already exists (a prior run), reactivate + reset
# password + re-point at the temp role so this run has a known, usable login.
req GET /users "$OT" >/dev/null
USER_ID="$(jfind data email "$SMOKE_EMAIL" id)"
if [ -z "$USER_ID" ]; then
  UCODE="$(req POST /users "$OT" "$(mkjson name 'Smoke Verify' email "$SMOKE_EMAIL" password "$SMOKE_PW" roleId "$ROLE_ID")")"
  USER_ID="$(jget data.id)"
  if [ -z "$USER_ID" ]; then no "temp user created" "POST /users -> HTTP $UCODE: $(head -c 200 "$BODY")"; fi
else
  req PATCH "/users/$USER_ID" "$OT" "$(mkjson status active password "$SMOKE_PW" roleId "$ROLE_ID")" >/dev/null
fi
present "$USER_ID" "temp user ready ($SMOKE_EMAIL)"

# ---- 3. The zero-permission user must be gated OUT everywhere that matters --
if [ -n "$USER_ID" ]; then
  echo "-- low-privilege user (should be gated OUT) --"
  do_login "$SMOKE_EMAIL" "$SMOKE_PW"; NT="$REPLY"
  if [ -n "$NT" ]; then
    ok "low-priv user logs in"
    eq "$(req GET /dashboard/summary "$NT")" 200 "low-priv user still gets the operational dashboard"
    empty "$(jget data.billing.outstandingTotal)" "receivables total is withheld (C6 gate live)"
    present "$(jget data.billing.invoicesIssued)" "operational counts are still present (dashboard shape intact)"
    req GET '/dashboard/trends?metrics=invoiced,collected' "$NT" >/dev/null
    if grep -q '"collected"' "$BODY"; then no "money trend series is dropped for low-priv user" "'collected' present"; else ok "money trend series is dropped for low-priv user (C6)"; fi
    eq "$(req GET /ai/status "$NT")" 403 "low-priv user is blocked from the AI surface (C2 gate live)"
    eq "$(req GET /billing-reports/outstanding "$NT")" 403 "low-priv user is blocked from the receivables report (reports.view gate live)"
    req GET /company "$NT" >/dev/null
    present "$(jget data.companyName)" "low-priv user can still read the company name"
    empty "$(jget data.bankAccountNo)" "bank account number is hidden from the low-priv user (C5 gate live)"
  else
    no "low-priv user logs in" "POST /auth/login -> HTTP $LOGIN_CODE (bootstrap may have failed above)"
  fi
fi

echo
if [ "$fail" -eq 0 ]; then
  printf '\033[32mVERIFY PASSED\033[0m: %d checks, 0 failures\n' "$pass"; exit 0
else
  printf '\033[31mVERIFY FAILED\033[0m: %d passed, %d failed\n' "$pass" "$fail"; exit 1
fi
