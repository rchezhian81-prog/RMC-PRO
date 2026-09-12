#!/usr/bin/env bash
# =============================================================================
#  Mix Nova RMC — onboard a new tenant, interactively
# =============================================================================
#  One command, plain questions, no shell assembly required. Use this instead of
#  provision-tenant.mjs unless you are scripting: it asks for what it needs,
#  generates passwords that satisfy the policy, shows you a summary before
#  creating anything, and offers to prove the new tenant is isolated afterwards.
#
#  USAGE (on the VPS):
#     cd /opt/rmc
#     bash scripts/setup/onboard-tenant.sh
#
#  Nothing is created until you confirm. Safe to re-run: an existing tenant code
#  is reused rather than duplicated and an existing owner is left alone, so a
#  run that failed halfway can simply be repeated.
# =============================================================================
set -uo pipefail

# shellcheck source=scripts/ops/lib-args.sh
. "$(dirname "${BASH_SOURCE[0]}")/../ops/lib-args.sh"
reject_positional_args "$@"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
API_URL="${API_URL:-https://api.mixnovas.com}"
API_URL="${API_URL%/}"

c_b=$'\033[1m'; c_ok=$'\033[32m'; c_bad=$'\033[31m'; c_dim=$'\033[2m'; c_off=$'\033[0m'
say()  { printf '%s\n' "$*"; }
head1(){ printf '\n%s── %s %s\n' "$c_b" "$*" "$c_off"; }
good() { printf '  %s✓%s %s\n' "$c_ok" "$c_off" "$*"; }
bad()  { printf '  %s✗%s %s\n' "$c_bad" "$c_off" "$*"; }
die()  { printf '\n%s✗ %s%s\n' "$c_bad" "$*" "$c_off" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "node is not on PATH."
[ -f "$REPO_ROOT/scripts/setup/provision-tenant.mjs" ] ||
  die "provision-tenant.mjs is missing — run: cd $REPO_ROOT && git pull --ff-only origin main"

# A password that satisfies the shared policy: >= 10 chars, a letter, a digit,
# and not starting with a common word. 16 letters + 4 digits clears all of them.
gen_password() {
  printf '%s%s\n' \
    "$(LC_ALL=C tr -dc 'A-Za-z' </dev/urandom | head -c 16)" \
    "$(LC_ALL=C tr -dc '0-9'   </dev/urandom | head -c 4)"
}

ask() {  # ask <var> <prompt> [default]
  local __v="$1" __p="$2" __d="${3:-}" __in=''
  if [ -n "$__d" ]; then read -r -p "  $__p [$__d]: " __in; __in="${__in:-$__d}"
  else read -r -p "  $__p: " __in; fi
  printf -v "$__v" '%s' "$__in"
}

ask_secret() {  # ask_secret <var> <prompt>
  local __v="$1" __in=''
  read -rs -p "  $2: " __in; echo
  printf -v "$__v" '%s' "$__in"
}

# Sets LOGIN_TOKEN and LAST_LOGIN_CODE rather than printing the token: called in
# a command substitution it would run in a SUBSHELL, and the status code would
# never reach the caller — which turned "wrong password" into "HTTP ?".
api_login() {  # api_login <email> <password>
  local body
  body="$(curl -s -m 20 -w '\n%{http_code}' -X POST "$API_URL/api/v1/auth/login" \
    -H 'Content-Type: application/json' \
    --data-binary "$(node -e 'const [e,p]=process.argv.slice(1);process.stdout.write(JSON.stringify({login:e,password:p}))' "$1" "$2")" 2>/dev/null)"
  LAST_LOGIN_CODE="$(printf '%s' "$body" | tail -1)"
  LOGIN_TOKEN=''
  [ "$LAST_LOGIN_CODE" = "200" ] || return 1
  LOGIN_TOKEN="$(printf '%s' "$body" | head -n -1 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).data.access_token||"")}catch{}})')"
  [ -n "$LOGIN_TOKEN" ]
}

say ""
say "${c_b}Mix Nova — new tenant${c_off}"
say "${c_dim}  Server: $API_URL${c_dim}${c_off}"
say "${c_dim}  Nothing is created until you confirm.${c_off}"

# ---------------------------------------------------------------- super admin
head1 "1. Sign in as the platform super admin"
say "${c_dim}  This is the account that manages tenants, not a plant login.${c_off}"
ask ADMIN_EMAIL "Super-admin email" "admin@mixnovas.com"

TOKEN=''
for attempt in 1 2 3; do
  ask_secret ADMIN_PW "Password for $ADMIN_EMAIL"
  if [ -z "$ADMIN_PW" ]; then bad "no password entered"; continue; fi
  if api_login "$ADMIN_EMAIL" "$ADMIN_PW"; then TOKEN="$LOGIN_TOKEN"; good "signed in"; break; fi
  TOKEN=''
  case "${LAST_LOGIN_CODE:-}" in
    401) bad "that password is not right for $ADMIN_EMAIL" ;;
    429) die "too many sign-in attempts (the brute-force guard allows 5 a minute). Wait a minute and run this again." ;;
    000) die "cannot reach $API_URL — is the stack up? Try: ./scripts/ops/health-check.sh" ;;
    *)   bad "sign-in failed (HTTP ${LAST_LOGIN_CODE:-?})" ;;
  esac
done

if [ -z "$TOKEN" ]; then
  say ""
  say "  Forgotten it? Reset it without signing in, then run this script again:"
  say "      ${c_b}cd $REPO_ROOT${c_off}"
  say "      ${c_b}bash scripts/setup/recover-login.sh${c_off}                       ${c_dim}# lists every account${c_off}"
  say "      ${c_b}bash scripts/setup/recover-login.sh --set-password $ADMIN_EMAIL${c_off}"
  die "could not sign in."
fi

# ---------------------------------------------------------------- the company
head1 "2. The company you are onboarding"
ask TENANT_NAME "Company name (as it should appear on invoices)"
[ -n "$TENANT_NAME" ] || die "the company name is required."
ask TENANT_CODE "Short code for it (letters/numbers, no spaces)" "PILOT2"
TENANT_CODE="$(printf '%s' "$TENANT_CODE" | tr '[:lower:]' '[:upper:]' | tr -cd 'A-Z0-9_-')"
[ -n "$TENANT_CODE" ] || die "the short code is required."

head1 "3. Their first login (the company owner)"
ask OWNER_NAME "Owner's full name"
[ -n "$OWNER_NAME" ] || die "the owner's name is required."
ask OWNER_EMAIL "Owner's email address"
case "$OWNER_EMAIL" in *@*.*) : ;; *) die "\"$OWNER_EMAIL\" does not look like an email address." ;; esac

OWNER_PW=''
ask GEN "Generate a password for them? (recommended)" "y"
if [ "${GEN:0:1}" = "y" ] || [ "${GEN:0:1}" = "Y" ]; then
  OWNER_PW="$(gen_password)"
  good "generated — it is shown once at the end"
else
  while :; do
    ask_secret OWNER_PW "Password for $OWNER_EMAIL (min 10 chars, must contain a number)"
    [ "${#OWNER_PW}" -ge 10 ] || { bad "too short"; continue; }
    case "$OWNER_PW" in *[0-9]*) : ;; *) bad "must contain a number"; continue ;; esac
    break
  done
fi

# ---------------------------------------------------------------- plan/modules
head1 "4. Plan and modules"
PLANS_RAW="$(curl -s -m 20 "$API_URL/api/v1/platform/plans" -H "Authorization: Bearer $TOKEN")"
mapfile -t PLAN_CODES < <(printf '%s' "$PLANS_RAW" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{for(const p of JSON.parse(s).data)console.log(`${p.planCode??p.code}\t${p.planName??p.name}`)}catch{}})')
[ "${#PLAN_CODES[@]}" -gt 0 ] || die "could not read the plan list from $API_URL."
i=1; for row in "${PLAN_CODES[@]}"; do printf '    %d) %s\n' "$i" "$(printf '%s' "$row" | tr '\t' ' ')"; i=$((i+1)); done
ask PLAN_PICK "Choose a plan by number" "1"
PLAN_ROW="${PLAN_CODES[$((PLAN_PICK-1))]:-}"
[ -n "$PLAN_ROW" ] || die "that is not one of the choices."
PLAN_CODE="$(printf '%s' "$PLAN_ROW" | cut -f1)"

say ""
say "${c_dim}  Extra modules beyond what the plan includes. Press Enter for the default,${c_off}"
say "${c_dim}  or type 'none' if the plan already covers everything.${c_off}"
ask MODULES "Extra modules" "qc,purchase,weighbridge"
[ "$MODULES" = "none" ] && MODULES=""

# ---------------------------------------------------------------- confirm
head1 "5. Check this before anything is created"
printf '    Company      %s (%s)\n' "$TENANT_NAME" "$TENANT_CODE"
printf '    Owner        %s <%s>\n' "$OWNER_NAME" "$OWNER_EMAIL"
printf '    Plan         %s\n' "$PLAN_CODE"
printf '    Modules      %s\n' "${MODULES:-plan defaults only}"
say ""
case "$TENANT_NAME$OWNER_NAME$OWNER_EMAIL" in
  *'<'*|*'>'*) die "one of those values still contains < > — go back and enter the real details." ;;
esac
ask CONFIRM "Create it? (yes/no)" "no"
case "$CONFIRM" in y|Y|yes|YES) : ;; *) say ""; say "  Nothing was created."; exit 0 ;; esac

# ---------------------------------------------------------------- do it
head1 "6. Creating"
API_URL="$API_URL" \
LOGIN="$ADMIN_EMAIL" RMC_PASSWORD="$ADMIN_PW" \
TENANT_CODE="$TENANT_CODE" TENANT_NAME="$TENANT_NAME" \
OWNER_NAME="$OWNER_NAME" OWNER_EMAIL="$OWNER_EMAIL" OWNER_PASSWORD="$OWNER_PW" \
PLAN_CODE="$PLAN_CODE" MODULES="$MODULES" \
  node "$REPO_ROOT/scripts/setup/provision-tenant.mjs" || die "provisioning failed — nothing else was changed. Fix the error above and re-run this script."

# ---------------------------------------------------------------- hand over
head1 "7. Give these to $OWNER_NAME"
say ""
printf '    Sign-in page   %s\n' "${WEB_URL:-https://app.mixnovas.com}"
printf '    Email          %s\n' "$OWNER_EMAIL"
printf '    Password       %s%s%s\n' "$c_b" "$OWNER_PW" "$c_off"
say ""
say "  ${c_b}Write the password down now — it is not stored anywhere and will not be shown again.${c_off}"
say "  ${c_dim}Ask them to change it after their first sign-in.${c_off}"

# ---------------------------------------------------------------- isolation
head1 "8. Prove the two companies cannot see each other"
say "${c_dim}  This is the check worth doing: it signs in as each company and confirms${c_off}"
say "${c_dim}  neither can read the other's records. Needs an existing company's login.${c_off}"
ask RUN_ISO "Run it now?" "y"
if [ "${RUN_ISO:0:1}" = "y" ] || [ "${RUN_ISO:0:1}" = "Y" ]; then
  ask EXIST_EMAIL "An existing company owner's email" "owner@pilot1.com"
  ask_secret EXIST_PW "Password for $EXIST_EMAIL"
  say ""
  say "${c_dim}  (waiting 60s — sign-in allows 5 attempts a minute)${c_off}"
  sleep "${ISO_WAIT:-60}"
  API_URL="$API_URL" \
  LOGIN_A="$EXIST_EMAIL" PASSWORD_A="$EXIST_PW" \
  LOGIN_B="$OWNER_EMAIL" PASSWORD_B="$OWNER_PW" \
    node "$REPO_ROOT/scripts/ops/verify-tenant-isolation.mjs"
else
  say ""
  say "  Run it later with:"
  say "      ${c_b}cd $REPO_ROOT && bash scripts/setup/onboard-tenant.sh${c_off}  ${c_dim}# or see scripts/ops/README.md${c_off}"
fi

say ""
good "done."
