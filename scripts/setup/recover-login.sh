#!/usr/bin/env bash
#
# Mix Nova — recover a login that cannot sign in.
#
# Every other way to fix an account needs you to be signed in already: the
# Users screen resets passwords, and create-staff-user.mjs calls the API as the
# owner. Neither helps when the owner is the one locked out. This talks to the
# database directly, so it works when nobody can get in.
#
# Run from the repo root on the server (default is read-only):
#
#   cd /opt/rmc
#   bash scripts/setup/recover-login.sh                       # show every account
#   bash scripts/setup/recover-login.sh --activate a@b.com    # let them sign in again
#   bash scripts/setup/recover-login.sh --set-password a@b.com
#
# Use a real address from the email column, not the example above.
#
# --set-password asks for the password and does not echo it. It is never
# printed, never logged, never written to disk, and never passed as a command
# argument (which would show up in `ps`) — it is piped to the hasher on stdin.
# Only a bcrypt hash reaches the database, which is what the API stores anyway.
# Set NEW_PASSWORD in the environment instead if you need it unattended.
#
# Env overrides: ENV_FILE (default .env.production),
#                COMPOSE_FILE (default docker/docker-compose.prod.yml),
#                PG_SERVICE (default postgres), API_SERVICE (default api).
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-docker/docker-compose.prod.yml}"
PG_SERVICE="${PG_SERVICE:-postgres}"
API_SERVICE="${API_SERVICE:-api}"

MODE=status
EMAIL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --status)       MODE=status ;;
    # Guard the extra shift: `--activate` with no email must reach the friendly
    # error below, not die on "shift count out of range" under `set -e`.
    --activate)     MODE=activate;     EMAIL="${2:-}"; [ $# -ge 2 ] && shift ;;
    --set-password) MODE=set_password; EMAIL="${2:-}"; [ $# -ge 2 ] && shift ;;
    -h|--help)      sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)              echo "✗ unknown option: $1  (try --help)" >&2; exit 1 ;;
  esac
  shift
done

[ -f "$ENV_FILE" ]     || { echo "✗ $ENV_FILE not found — run from the repo root." >&2; exit 1; }
[ -f "$COMPOSE_FILE" ] || { echo "✗ $COMPOSE_FILE not found — run from the repo root." >&2; exit 1; }

dc() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

# psql inside the container as the OWNER over the local socket, so no password
# crosses the network and none is needed here. SQL arrives on stdin.
psql_owner() {
  dc exec -T "$PG_SERVICE" sh -c \
    'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"' _ "$@"
}

# ------------------------------------------------------------------ status --
# Always shown: after any change you want to see the result, and on its own it
# answers "why can this person not sign in" without touching anything.
show_status() {
  echo
  echo "Companies"
  printf '%s\n' "
    SELECT t.tenant_code AS code, t.tenant_name AS company, t.status,
           (SELECT count(*) FROM tenant_modules m WHERE m.tenant_id = t.id) AS modules
      FROM tenants t ORDER BY t.tenant_code;" | psql_owner -X

  echo "Logins  (sign-in needs: user status 'active' AND company status active/trial/grace)"
  printf '%s\n' "
    SELECT u.email, u.status AS user_status, u.user_type,
           -- A platform admin holding no tenant role is normal, not a fault;
           -- saying '— none —' there would send you fixing the wrong thing.
           coalesce(string_agg(r.role_key, ', '),
                    CASE WHEN u.user_type = 'super_admin' THEN '— n/a —' ELSE '— none —' END) AS roles,
           t.status AS company_status,
           to_char(u.last_login_at, 'YYYY-MM-DD HH24:MI') AS last_login
      FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id
      LEFT JOIN roles r       ON r.id = ur.role_id
      LEFT JOIN tenants t     ON t.id = u.tenant_id
     GROUP BY u.email, u.status, u.user_type, t.status, u.last_login_at
     ORDER BY u.email;" | psql_owner -X
}

# Validate the email AFTER show_status exists, so a wrong one can answer itself:
# the tool knows every address that would have worked, and withholding them just
# forces another round trip.
if [ "$MODE" != "status" ]; then
  bad_email() {
    echo "✗ $1" >&2
    echo "  Copy an address from the email column below and run it again." >&2
    show_status >&2
    exit 1
  }
  case "$EMAIL" in
    '')       bad_email "give the email: --$MODE someone@company.com" ;;
    *[\'\"\\]*|*' '*)
              bad_email "that email contains characters this tool will not pass to SQL." ;;
    *@*.*)    ;;
    *)        bad_email "'$EMAIL' does not look like an email address." ;;
  esac
fi

case "$MODE" in
  status)
    show_status
    cat <<'NOTE'
Reading this:
  • user_status not 'active'      → deactivated; fix with --activate <email>
  • roles '— none —'              → they can sign in but see nothing; set a role
                                    in Setup → Users, or with create-staff-user.mjs
  • company_status suspended/cancelled
                                  → the whole company is blocked; change it in the
                                    admin portal under the tenant's Subscription status
  • everything looks right        → it is the password; fix with --set-password <email>

NOTE
    ;;

  activate)
    n=$(printf '%s\n' \
      "UPDATE users SET status='active', updated_at=now()
        WHERE lower(email)=lower('$EMAIL') AND status <> 'active';" \
      | psql_owner -tAX | tr -dc '0-9')
    changed="${n:-0}"
    if [ "$changed" = "0" ]; then
      exists=$(printf '%s\n' "SELECT count(*) FROM users WHERE lower(email)=lower('$EMAIL');" \
               | psql_owner -tAX | tr -dc '0-9')
      if [ "${exists:-0}" = "0" ]; then
        echo "✗ no user with that email. The list below shows the ones that exist." >&2
        show_status
        exit 1
      fi
      echo "• $EMAIL was already active — nothing changed."
    else
      echo "✓ $EMAIL can sign in again."
    fi
    show_status
    ;;

  set_password)
    # Ask for it here rather than making you export it first. A `read -rs` line
    # pasted together with the lines below it silently swallows the next line as
    # the password — a trap that has no upside, so it is removed. NEW_PASSWORD
    # from the environment still works for unattended use.
    if [ -z "${NEW_PASSWORD:-}" ]; then
      if [ -t 0 ]; then
        printf 'New password for %s (not shown as you type): ' "$EMAIL" >&2
        IFS= read -rs NEW_PASSWORD; echo >&2
        printf 'Type it again to confirm: ' >&2
        IFS= read -rs CONFIRM; echo >&2
        [ "$NEW_PASSWORD" = "$CONFIRM" ] || {
          echo "✗ The two passwords do not match. Nothing changed." >&2; exit 1; }
      else
        echo "✗ No password given. Run this on a terminal, or set NEW_PASSWORD." >&2
        exit 1
      fi
    fi
    [ -n "$NEW_PASSWORD" ] || { echo "✗ The password was empty. Nothing changed." >&2; exit 1; }

    exists=$(printf '%s\n' "SELECT count(*) FROM users WHERE lower(email)=lower('$EMAIL');" \
             | psql_owner -tAX | tr -dc '0-9')
    if [ "${exists:-0}" = "0" ]; then
      echo "✗ no user with that email. The list below shows the ones that exist." >&2
      show_status
      exit 1
    fi

    # Hash inside the API container: it already carries bcryptjs and the shared
    # password policy, so this cannot accept a password the app would reject.
    # The password goes in on stdin — never as an argument, which `ps` can read.
    # Holds only the policy message from stderr — never the password. mktemp
    # rather than a predictable name, so nothing can be pre-created in its path.
    errf=$(mktemp)
    trap 'rm -f "$errf"' EXIT
    set +e
    hash=$(printf '%s' "$NEW_PASSWORD" | dc exec -T "$API_SERVICE" node -e '
      let pw = "";
      process.stdin.on("data", (c) => (pw += c)).on("end", () => {
        const { passwordProblemMessage } = require("@rmc/shared");
        const bcrypt = require("bcryptjs");
        const problem = passwordProblemMessage(pw);
        if (problem) { console.error(problem); process.exit(2); }
        process.stdout.write(bcrypt.hashSync(pw, 10));
      });
    ' 2>"$errf")
    rc=$?
    set -e
    problem=$(cat "$errf" 2>/dev/null || true)
    rm -f "$errf"; trap - EXIT
    if [ "$rc" -eq 2 ]; then
      # passwordProblemMessage returns a complete sentence — print it as it is
      # rather than wrapping it in another one.
      echo "✗ ${problem:-That password does not meet the policy.} Nothing changed." >&2
      exit 1
    fi
    case "${hash:-}" in
      \$2*) ;;
      *) echo "✗ could not hash the password (is the '$API_SERVICE' container running?). Nothing changed." >&2; exit 1 ;;
    esac

    printf '%s\n' \
      "UPDATE users SET password_hash='$hash', updated_at=now()
        WHERE lower(email)=lower('$EMAIL');" | psql_owner -tAX >/dev/null
    echo "✓ password set for $EMAIL."
    echo "  Tell them directly — it is not stored anywhere you can read it back."
    echo "  Existing sessions keep working until their tokens expire."
    show_status
    ;;
esac
