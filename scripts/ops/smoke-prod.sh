#!/usr/bin/env bash
# =============================================================================
#  Mix Nova RMC — post-deploy production smoke
# =============================================================================
#  Confirms the RBAC / dashboard / input-validation behaviour shipped in the
#  gap-scan campaign is LIVE and correct, and that valid read flows are unbroken.
#
#  READ-ONLY: it only logs in and GETs. It creates nothing, changes nothing,
#  and pokes no dispatch/batch state — safe to run against production any time,
#  and after every deploy.
#
#  It checks two things per gate:
#    - the OWNER still sees everything (owner bypasses every gate — a failure
#      here is a real regression for the person who runs the plant), and
#    - a LOW-privilege user is correctly gated OUT (optional; needs a second
#      login — use a batching/dispatch/store operator, NOT a manager).
#
#  Mutating checks (dispatch transition graph D5, over-plan cap D2, QC grade
#  match D3, rejected-load block D1) are deliberately NOT automated here — poking
#  live dispatches/batches in prod is not a smoke. Do those from the UI checklist.
#
#  USAGE:
#    API_BASE=https://api.mixnovas.com/api/v1 \
#    OWNER_LOGIN='owner@pilot1.com' OWNER_PASSWORD='********' \
#    [ NONADMIN_LOGIN='dispatch@pilot1.com' NONADMIN_PASSWORD='********' ] \
#    ./scripts/ops/smoke-prod.sh
#
#  API_BASE must include the /api/v1 prefix. HEALTH_URL is derived from it (the
#  /health route is unprefixed, at the domain root) but can be overridden.
#
#  EXIT: 0 = all checks passed · 1 = one or more failed · 2 = could not run.
#  Requires: curl, python3.
# =============================================================================
set -u

API_BASE="${API_BASE:-https://api.mixnovas.com/api/v1}"
# /health, /health/ready and /metrics are excluded from the api/v1 prefix (see
# apps/api/src/main.ts), so health lives at the domain root, not under /api/v1.
HEALTH_URL="${HEALTH_URL:-${API_BASE%/api/v1}/health}"
BODY="$(mktemp)"; trap 'rm -f "$BODY"' EXIT
pass=0; fail=0

command -v curl    >/dev/null 2>&1 || { echo "ERROR: curl not on PATH";    exit 2; }
command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 not on PATH"; exit 2; }
[ -n "${OWNER_LOGIN:-}" ] && [ -n "${OWNER_PASSWORD:-}" ] || {
  echo "ERROR: set OWNER_LOGIN and OWNER_PASSWORD"; exit 2; }

# ---- helpers --------------------------------------------------------------
# req METHOD PATH [TOKEN] [JSON_BODY]  -> echoes the HTTP status; body in $BODY
req() {
  local method="$1" path="$2" token="${3:-}" data="${4:-}"
  local args=(-sS -m 25 -o "$BODY" -w '%{http_code}' -X "$method" "$API_BASE$path"
              -H 'Content-Type: application/json')
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  [ -n "$data" ]  && args+=(--data "$data")
  # curl's -w already prints 000 when it can't connect, so no fallback echo here.
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
export SMOKE_BODY="$BODY"

# mkjson k v k v ...  -> a JSON object (safe for passwords with special chars)
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

echo "=== Mix Nova production smoke @ $API_BASE ==="

# ---- 0. Reachability (health is at the domain root, not under /api/v1) -----
HCODE="$(curl -sS -m 15 -o "$BODY" -w '%{http_code}' "$HEALTH_URL" 2>/dev/null)"
eq "$HCODE" 200 "API health is reachable ($HEALTH_URL)"

# ---- 1. Owner: everything still works (owner bypasses every gate) ----------
echo "-- owner (should see everything) --"
do_login "$OWNER_LOGIN" "$OWNER_PASSWORD"; OT="$REPLY"
if [ -n "$OT" ]; then
  ok "owner logs in"
else
  no "owner logs in" "POST /auth/login -> HTTP $LOGIN_CODE: $(head -c 180 "$BODY")"
  echo "   -> check OWNER_LOGIN/OWNER_PASSWORD are REAL creds (not the ******** placeholder) and API_BASE=$API_BASE"
  echo; printf '\033[31mSMOKE FAILED\033[0m: %d passed, %d failed\n' "$pass" "$fail"; exit 1
fi

eq "$(req GET /dashboard/summary "$OT")" 200 "owner dashboard summary loads"
present "$(jget data.billing.outstandingTotal)" "owner sees the receivables total (C6 owner path intact)"

req GET '/dashboard/trends?metrics=invoiced,collected' "$OT" >/dev/null
if grep -q '"collected"' "$BODY"; then ok "owner sees the collections trend series"; else no "owner sees the collections trend series" "no 'collected' series"; fi

eq "$(req GET /company "$OT")" 200 "owner GET /company loads"
present "$(jget data.companyName)" "owner sees the company profile"

eq "$(req GET /ai/status "$OT")" 200 "owner reaches the AI surface (C2 owner path intact)"
eq "$(req GET /billing-reports/outstanding "$OT")" 200 "owner reaches the receivables report (reports.view bypass)"

# ---- 2. Input validation is live (bad date -> 400, valid -> 200) ----------
echo "-- input validation (E1: the new code must be live) --"
eq "$(req GET '/billing-reports/grade-margin?from=not-a-date' "$OT")" 400 "a malformed report date returns 400 (not a 500) — proves the deploy took"
eq "$(req GET '/billing-reports/grade-margin?from=2020-01-01&to=2035-01-01' "$OT")" 200 "a valid report date range still returns 200"

# ---- 3. Optional: a low-privilege user is correctly gated OUT --------------
if [ -n "${NONADMIN_LOGIN:-}" ] && [ -n "${NONADMIN_PASSWORD:-}" ]; then
  echo "-- low-privilege user (should be gated OUT; use a REAL batching/dispatch/store operator login) --"
  echo "   NOTE: if this account happens to hold reports.view/ai.use, those checks will 'fail' — not a regression, pick a narrower account."
  do_login "$NONADMIN_LOGIN" "$NONADMIN_PASSWORD"; NT="$REPLY"
  if [ -n "$NT" ]; then
    ok "low-priv user logs in"
    eq "$(req GET /dashboard/summary "$NT")" 200 "low-priv user still gets the operational dashboard"
    empty "$(jget data.billing.outstandingTotal)" "receivables total is withheld from the low-priv user (C6 gate live)"
    eq "$(req GET /ai/status "$NT")" 403 "low-priv user is blocked from the AI surface (C2 gate live)"
    eq "$(req GET /billing-reports/outstanding "$NT")" 403 "low-priv user is blocked from the receivables report (reports.view gate live)"
    req GET /company "$NT" >/dev/null
    empty "$(jget data.bankAccountNo)" "bank account number is hidden from the low-priv user (C5 gate live)"
  else
    no "low-priv user logs in" "POST /auth/login -> HTTP $LOGIN_CODE (check NONADMIN_LOGIN/NONADMIN_PASSWORD are real)"
  fi
else
  echo "-- (skipping low-privilege gate checks — set NONADMIN_LOGIN/NONADMIN_PASSWORD to run them) --"
fi

echo
if [ "$fail" -eq 0 ]; then
  printf '\033[32mSMOKE PASSED\033[0m: %d checks, 0 failures\n' "$pass"; exit 0
else
  printf '\033[31mSMOKE FAILED\033[0m: %d passed, %d failed\n' "$pass" "$fail"; exit 1
fi
