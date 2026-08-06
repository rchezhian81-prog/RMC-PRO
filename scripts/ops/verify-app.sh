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
#   LOGIN='owner@example.com' bash scripts/ops/verify-app.sh
#
# Use a real address — `bash scripts/setup/recover-login.sh` lists them. The
# password is asked for and not echoed; set RMC_PASSWORD instead for cron/CI.
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

# Ask for the password rather than making you export it first. A `read -rs` line
# pasted together with the lines below it silently swallows the next line as the
# password, and then this reports a login failure that never happened.
# RMC_PASSWORD from the environment still works for cron and CI.
if [ -n "$LOGIN" ] && [ -z "$PASSWORD" ] && [ -t 0 ]; then
  printf 'Password for %s (not shown as you type): ' "$LOGIN" >&2
  IFS= read -rs PASSWORD; echo >&2
fi

# A placeholder left in the command line is indistinguishable from a wrong
# password once it reaches the API — both answer AUTH_REQUIRED, by design. Catch
# it here, where we can still say which mistake it was.
LOGIN_PROBLEM=''
case "${LOGIN:-}" in
  ''|*@*.*) ;;
  *) LOGIN_PROBLEM="LOGIN='$LOGIN' is not an email address — use a real one" ;;
esac

if [ -n "$LOGIN_PROBLEM" ]; then
  bad "login" "$LOGIN_PROBLEM"
  printf '  %s\n' "  list the accounts that exist: bash scripts/setup/recover-login.sh" >&2
  for s in "dashboard summary" "alerts" "message templates" "outstanding report" "permission catalogue"; do
    skip "$s" "needs login"
  done
elif [ -z "$LOGIN" ] || [ -z "$PASSWORD" ]; then
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
    # Say WHY. "Check the login/password" is only one of the reasons a login can
    # fail, and it sends someone hunting for a typo when the server may have
    # said the account is inactive or the company is suspended. The server's own
    # code and message are shown; neither contains anything secret.
    why=$(json_field "$body" 'error.code')
    what=$(json_field "$body" 'error.message' | head -c 90)
    case "$why" in
      TENANT_SUSPENDED) bad "login" "credentials are fine — the COMPANY is blocked: $what" ;;
      AUTH_REQUIRED)    bad "login" "rejected — wrong login/password, or the user is deactivated" ;;
      RATE_LIMITED)     bad "login" "throttled (5 attempts/minute) — wait a minute and re-run" ;;
      '')               bad "login" "no token and no error code — is this API build current?" ;;
      *)                bad "login" "$why: $what" ;;
    esac
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

    # Stock is the thing most likely to be wrong after a reset: the reset clears
    # the balances and the seeder is what puts them back. "No low-stock alert"
    # is NOT evidence of healthy stock — zero rows looks identical to full
    # shelves — so assert on the rows themselves.
    stock=$(curl -sS --max-time 25 "${auth[@]}" "${API}/api/v1/stock/balances" 2>/dev/null)
    stock_out=$(printf '%s' "$stock" | python3 -c '
import sys, json
try:
    rows = json.load(sys.stdin).get("data", [])
except Exception:
    print("BAD|unreadable response"); raise SystemExit
if not isinstance(rows, list) or not rows:
    print("BAD|no stock rows — opening stock has not been seeded"); raise SystemExit
neg  = [r for r in rows if float(r.get("currentQuantity") or 0) < 0]
zero = [r for r in rows if float(r.get("currentQuantity") or 0) == 0]
low  = min(rows, key=lambda r: float(r.get("currentQuantity") or 0))
label = low.get("materialLabel") or low.get("materialId")
qty   = float(low.get("currentQuantity") or 0)
uom   = low.get("uom") or ""
summary = f"{len(rows)} material(s), lowest {label} {qty:g} {uom}".strip()
if neg:
    print(f"BAD|{len(neg)} material(s) at NEGATIVE stock — {summary}")
elif zero:
    print(f"WARN|{len(zero)} material(s) at zero — {summary}")
else:
    print(f"OK|{summary}")
' 2>/dev/null)
    case "${stock_out%%|*}" in
      OK)   ok   "stock balances" "${stock_out#*|}" ;;
      WARN) warn "stock balances" "${stock_out#*|}" ;;
      BAD)  bad  "stock balances" "${stock_out#*|}" ;;
      *)    bad  "stock balances" "could not read /stock/balances" ;;
    esac

    # Roles: staff onboarding depends on these existing AND carrying the right
    # permissions. A role that exists but is empty silently locks its holders
    # out of everything, so assert the contents, not just the names — including
    # the separations of duty the business relies on.
    tmp=$(mktemp -d)
    curl -sS --max-time 25 "${auth[@]}" "${API}/api/v1/roles" -o "$tmp/roles.json" 2>/dev/null
    curl -sS --max-time 25 "${auth[@]}" "${API}/api/v1/roles/permissions-catalog" -o "$tmp/catalog.json" 2>/dev/null
    # Fetch each role's granted permission ids into its own file.
    while IFS=$'\t' read -r rkey rid; do
      [ -n "${rid:-}" ] || continue
      curl -sS --max-time 20 "${auth[@]}" "${API}/api/v1/roles/${rid}/permissions" \
        -o "$tmp/perm_${rkey}.json" 2>/dev/null
    done < <(python3 - "$tmp/roles.json" 2>/dev/null <<'PY'
import sys, json
try:
    rows = json.load(open(sys.argv[1])).get("data", [])
except Exception:
    raise SystemExit
for r in rows:
    if isinstance(r, dict) and r.get("roleKey") and r.get("id"):
        print(r["roleKey"] + "\t" + r["id"])
PY
)

    roles_out=$(python3 - "$tmp" 2>/dev/null <<'PY'
import sys, json, os
tmp = sys.argv[1]

def load(p, default=None):
    try:
        return json.load(open(p)).get("data", default)
    except Exception:
        return default

roles = load(os.path.join(tmp, "roles.json"))
catalog = load(os.path.join(tmp, "catalog.json"))
if roles is None or catalog is None:
    print("BAD|could not read the roles endpoints"); raise SystemExit

key_of = {p["id"]: p["permissionKey"] for p in catalog if isinstance(p, dict) and p.get("id")}
have = {r["roleKey"]: r for r in roles if isinstance(r, dict) and r.get("roleKey")}

OPERATIONAL = ["plant_manager","sales_manager","sales_executive","dispatch_manager",
               "batching_operator","store_staff","qc_engineer","accounts_manager",
               "fleet_manager","auditor"]
EXPECTED = ["company_owner","company_admin"] + OPERATIONAL

missing = [k for k in EXPECTED if k not in have]
if missing:
    print("BAD|%d role(s) missing: %s" % (len(missing), ",".join(missing)))
    raise SystemExit

# Resolve each role to the permission KEYS it actually holds.
perms = {}
for k in EXPECTED:
    ids = load(os.path.join(tmp, f"perm_{k}.json"), [])
    perms[k] = {key_of.get(i) for i in (ids or []) if key_of.get(i)}

empty = [k for k in OPERATIONAL if not perms[k]]
if empty:
    print("BAD|role(s) with no permissions - holders locked out: %s" % ",".join(empty))
    raise SystemExit

problems = []
def deny(role, key, why):
    if key in perms[role]:
        problems.append(why)
def need(role, key, why):
    if key not in perms[role]:
        problems.append(why)

need("sales_manager", "quotations.approve", "sales manager cannot approve quotations")
need("sales_manager", "rate_contracts.approve", "sales manager cannot approve rate contracts")
deny("sales_executive", "quotations.approve", "SALES EXECUTIVE CAN APPROVE QUOTATIONS")
deny("sales_executive", "rate_contracts.approve", "SALES EXECUTIVE CAN APPROVE RATE CONTRACTS")
need("plant_manager", "credit_hold.approve", "plant manager cannot release credit holds")
need("qc_engineer", "mix_design.approve", "QC engineer cannot approve mix designs")

extra_qc = [k for k in OPERATIONAL if k != "qc_engineer" and "mix_design.approve" in perms[k]]
if extra_qc:
    problems.append("mix approval leaked to " + ",".join(extra_qc))

for admin_key in ("users.manage", "roles.manage", "settings.manage"):
    leaked = [k for k in OPERATIONAL if admin_key in perms[k]]
    if leaked:
        problems.append(admin_key + " leaked to " + ",".join(leaked))

# Checked across EVERY role, not just the operational ones. The keys that
# govern the SaaS platform — creating tenants, editing plans, granting support
# access — belong to Mix Nova, and the role that used to be handed all of them
# was the tenant's own Company Admin, which the operational-only check missed.
plat = [k for k in EXPECTED if any(p.startswith("platform.") for p in perms[k])]
if plat:
    problems.append("platform.* held by " + ",".join(plat))

if problems:
    print("BAD|" + "; ".join(problems))
else:
    total = sum(len(perms[k]) for k in OPERATIONAL)
    print("OK|%d roles, all populated (%d operational grants), duties separated"
          % (len(EXPECTED), total))
PY
)
    rm -rf "$tmp"
    case "${roles_out%%|*}" in
      OK)   ok   "roles & separation of duties" "${roles_out#*|}" ;;
      WARN) warn "roles & separation of duties" "${roles_out#*|}" ;;
      BAD)  bad  "roles & separation of duties" "${roles_out#*|}" ;;
      *)    bad  "roles & separation of duties" "could not evaluate roles" ;;
    esac

    # Subscription: the API now refuses a module the tenant is not entitled to.
    # The dangerous state is a tenant with NO module rows at all — the guard
    # lets that through on purpose (a provisioning gap must not take a plant off
    # the air) but it means nothing is actually being enforced, so say so
    # loudly. The module list comes from /auth/me, which reports what the guard
    # itself would use.
    subs=$(curl -sS --max-time 20 "${auth[@]}" "${API}/api/v1/auth/me" 2>/dev/null)
    subs_out=$(printf '%s' "$subs" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin).get("data") or {}
except Exception:
    print("BAD|unreadable /auth/me response"); raise SystemExit
tenant = d.get("tenant") or {}
status = tenant.get("status") or "?"
mods = d.get("modules")
if mods is None:
    print("BAD|/auth/me did not report modules — the API predates module gating"); raise SystemExit
CORE = ["masters","sales","orders","production","dispatch","inventory","billing","reports"]
missing = [m for m in CORE if m not in mods]
if status not in ("active","trial","grace"):
    print(f"BAD|tenant status is {status} — every user of this company is blocked"); raise SystemExit
gap = ", ".join(missing)
if len(mods) >= 19:
    print(f"WARN|status {status}, every module reported enabled — check the tenant has real module rows")
elif missing:
    print(f"BAD|status {status}, core module(s) not enabled: {gap}")
else:
    print(f"OK|status {status}, {len(mods)} module(s) enabled")
' 2>/dev/null)
    case "${subs_out%%|*}" in
      OK)   ok   "subscription & modules" "${subs_out#*|}" ;;
      WARN) warn "subscription & modules" "${subs_out#*|}" ;;
      BAD)  bad  "subscription & modules" "${subs_out#*|}" ;;
      *)    bad  "subscription & modules" "could not read /auth/me" ;;
    esac

    # Plan limits: how many seats and plants the subscription sells, against
    # what is in use. A tenant with no plan is unlimited by design — the same
    # reasoning as modules — so that is reported, not treated as healthy.
    lim=$(curl -sS --max-time 20 "${auth[@]}" "${API}/api/v1/plan-usage" 2>/dev/null)
    lim_out=$(printf '%s' "$lim" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin).get("data") or {}
except Exception:
    print("BAD|unreadable /plan-usage response"); raise SystemExit
u, p = d.get("users") or {}, d.get("plants") or {}
if "used" not in u:
    print("BAD|/plan-usage did not report usage — the API predates plan limits"); raise SystemExit
plan = d.get("planName")
def fmt(x, noun):
    used, cap = x.get("used", 0), x.get("limit")
    # Nested quotes inside an f-string expression need Python 3.12; build the
    # parts first so this parses on the 3.9/3.11 a server is likely to have.
    return "%d %s (uncapped)" % (used, noun) if cap is None else "%d/%d %s" % (used, cap, noun)
summary = fmt(u, "users") + ", " + fmt(p, "plants")
if u.get("limit") is None:
    print(f"WARN|no plan assigned — nothing is capped ({summary})")
elif u["used"] > u["limit"] or (p.get("limit") is not None and p["used"] > p["limit"]):
    print(f"WARN|over the plan on {plan} ({summary}) — existing users keep working, no more can be added")
else:
    print(f"OK|{plan}: {summary}")
' 2>/dev/null)
    case "${lim_out%%|*}" in
      OK)   ok   "plan limits" "${lim_out#*|}" ;;
      WARN) warn "plan limits" "${lim_out#*|}" ;;
      BAD)  bad  "plan limits" "${lim_out#*|}" ;;
      *)    bad  "plan limits" "could not read /plan-usage" ;;
    esac

    # A refusal must be machine-readable, or the web app cannot tell a role
    # problem from a subscription problem and shows the wrong advice.
    envl=$(curl -sS --max-time 20 "${API}/api/v1/dashboard/summary" \
             -H 'authorization: Bearer not-a-real-token' 2>/dev/null)
    case "$(json_field "$envl" 'error.code')" in
      AUTH_REQUIRED|INVALID_TOKEN) ok "error envelope" "refusals carry a code" ;;
      '')   bad  "error envelope" "errors have no error.code — the web shows generic wording" ;;
      *)    warn "error envelope" "unexpected code $(json_field "$envl" 'error.code')" ;;
    esac

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
