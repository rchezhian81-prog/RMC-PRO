#!/usr/bin/env bash
# =============================================================================
#  Mix Nova RMC — prove the alert channel works, on both paths
# =============================================================================
#  Sends ONE test message the way the on-box scripts send theirs (health
#  monitor, backups, restore drill) and ONE the way the running API sends its
#  5xx alerts — from inside the api container, with the container's own env —
#  and says whether each arrived. Two messages in your channel = alerts wired.
#
#  Nothing else is touched. No credentials are needed: the API path calls the
#  alerter directly inside the container rather than logging in.
#
#  USAGE (on the VPS, from the repo root):
#     ./scripts/ops/alert-test.sh
#
#  Setup first: in .env.production set ONE line —
#     RMC_ALERT_WEBHOOK=https://…      (Discord, Slack, Google Chat or any incoming webhook)
#  then recreate the api so it picks the value up:
#     docker compose --env-file .env.production -f docker/docker-compose.prod.yml up -d api
# =============================================================================
set -u
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_ROOT/docker/docker-compose.prod.yml}"
API_SERVICE="${API_SERVICE:-api}"
# shellcheck source=scripts/ops/lib-args.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib-args.sh"
reject_positional_args "$@"
# shellcheck source=scripts/ops/lib-alert.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib-alert.sh"

c_ok=$'\033[32m'; c_bad=$'\033[31m'; c_off=$'\033[0m'
[ -t 1 ] || { c_ok=''; c_bad=''; c_off=''; }
ok()  { printf '  %s✓%s %s\n' "$c_ok" "$c_off" "$*"; }
bad() { printf '  %s✗%s %s\n' "$c_bad" "$c_off" "$*"; }

hook="$(rmc_alert_webhook)"
src="$(rmc_alert_webhook_source)"
if [ -z "$hook" ]; then
  bad "no alert webhook is set (neither RMC_ALERT_WEBHOOK nor ALERT_WEBHOOK_URL in $ENV_FILE)"
  cat <<'HOW'

  Add ONE line to .env.production and run this again:
     RMC_ALERT_WEBHOOK=https://…
  Where to get the URL (free, with a phone app that buzzes):
     Discord: your server → channel → Edit channel → Integrations → Webhooks → New webhook → Copy URL
     Slack:   api.slack.com/apps → your app → Incoming Webhooks → Add to workspace → copy the URL
  Then recreate the api so it sees the new value:
     docker compose --env-file .env.production -f docker/docker-compose.prod.yml up -d api
HOW
  exit 1
fi
host="$(printf '%s' "$hook" | sed -E 's#^https?://([^/]+).*#\1#')"
ok "webhook set via $src → $host (the full URL is never printed)"

failed=0
stamp="$(date '+%Y-%m-%d %H:%M:%S %Z')"

# 1) the scripts' path (health monitor, backups, restore drill)
if rmc_alert "🔔 Test alert from Mix Nova RMC (server scripts) — alerts are wired. $stamp"; then
  ok "server scripts → sent (HTTP $RMC_ALERT_HTTP)"
else
  case "${RMC_ALERT_HTTP:-}" in
    no-curl) bad "server scripts → curl is not installed on this box" ;;
    000|'')  bad "server scripts → no answer from $host (network, DNS or a typo in the URL)" ;;
    *)       bad "server scripts → the webhook refused it (HTTP $RMC_ALERT_HTTP) — wrong URL, or a deleted webhook" ;;
  esac
  failed=1
fi

# 2) the API's path, from inside the running container with its own env
if command -v docker >/dev/null 2>&1 && [ -f "$COMPOSE_FILE" ]; then
  out="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T "$API_SERVICE" node -e '
    const { ErrorAlertService } = require("/app/dist/common/error-alert.service.js");
    new ErrorAlertService().sendTest("api container")
      .then((r) => { console.log(JSON.stringify(r)); process.exit(r.delivered ? 0 : 1); })
      .catch((e) => { console.log(JSON.stringify({ delivered: false, error: String(e) })); process.exit(1); });
  ' 2>/dev/null)"
  rc=$?
  line="$(printf '%s\n' "$out" | grep -E '^\{' | tail -1)"
  if [ "$rc" = "0" ]; then
    ok "api container → sent (the API's 5xx alerts and the daily digest use this path)"
  elif printf '%s' "$line" | grep -q '"configured":false'; then
    bad "api container → the running api has NO webhook in its environment"
    printf '     It was started before the line was added. Recreate it and run this again:\n'
    printf '       docker compose --env-file .env.production -f docker/docker-compose.prod.yml up -d api\n'
    failed=1
  elif [ -n "$line" ]; then
    err="$(printf '%s' "$line" | sed -E 's/.*"error":"([^"]*)".*/\1/')"
    bad "api container → not delivered: ${err:-unknown}"
    failed=1
  else
    bad "api container → could not run the check (is the api container up? docker ps)"
    failed=1
  fi
else
  bad "api container → docker or the compose file is not available here (run this on the server)"
  failed=1
fi

if [ "$failed" = "0" ]; then
  printf '\n%sALERTS OK%s — two test messages should now be in your channel.\n' "$c_ok" "$c_off"
  exit 0
fi
printf '\n%sALERTS NOT FULLY WIRED%s — see the ✗ line(s) above.\n' "$c_bad" "$c_off"
exit 1
