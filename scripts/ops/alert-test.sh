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
#     ./scripts/ops/alert-test.sh                    # test what is configured
#     ./scripts/ops/alert-test.sh --set webhook.txt  # set it first, then test
#
#  --set FILE reads the webhook URL from FILE (paste it there with nano — one
#  line, nothing else — so it never sits in your shell history), refuses
#  anything that is not a real https webhook URL (a placeholder with "…" or a
#  truncated copy included), writes RMC_ALERT_WEBHOOK to .env.production as the
#  single alert setting, deletes FILE, recreates the api so it starts with the
#  value, waits for it to be healthy, and then runs the test.
# =============================================================================
set -u
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_ROOT/docker/docker-compose.prod.yml}"
API_SERVICE="${API_SERVICE:-api}"
SET_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --set) SET_FILE="${2:?--set needs the file holding the URL}"; shift 2 ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) break ;;
  esac
done
# shellcheck source=scripts/ops/lib-args.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib-args.sh"
reject_positional_args "$@"
# shellcheck source=scripts/ops/lib-alert.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib-alert.sh"

c_ok=$'\033[32m'; c_bad=$'\033[31m'; c_off=$'\033[0m'
[ -t 1 ] || { c_ok=''; c_bad=''; c_off=''; }
ok()  { printf '  %s✓%s %s\n' "$c_ok" "$c_off" "$*"; }
bad() { printf '  %s✗%s %s\n' "$c_bad" "$c_off" "$*"; }

# set_env KEY VALUE — replace the active line or append; keeps the file's mode.
set_env() {
  local tmp; tmp="$(mktemp)"
  k="$1" v="$2" awk 'BEGIN { k = ENVIRON["k"]; v = ENVIRON["v"]; done = 0 }
    index($0, k "=") == 1 { print k "=" v; done = 1; next }
    { print }
    END { if (!done) print k "=" v }' "$ENV_FILE" > "$tmp" && cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
}

if [ -n "$SET_FILE" ]; then
  [ -f "$ENV_FILE" ] || { bad "env file not found: $ENV_FILE"; exit 1; }
  [ -f "$SET_FILE" ] || { bad "no such file: $SET_FILE — create it with: nano $SET_FILE (paste the URL as the only line)"; exit 1; }
  url="$(tr -d '[:space:]' < "$SET_FILE")"
  case "$url" in
    *…*|*'...'*) bad "the file holds a placeholder ('…'), not a URL — copy the real one from the channel's webhook page"; exit 1 ;;
    https://hooks.slack.com/services/T*/B*/*) kind="Slack" ;;
    https://discord.com/api/webhooks/*/*|https://discordapp.com/api/webhooks/*/*) kind="Discord" ;;
    https://chat.googleapis.com/v1/spaces/*) kind="Google Chat" ;;
    https://*/*) kind="a generic" ;;
    *) bad "the file does not hold an https webhook URL"; exit 1 ;;
  esac
  if [ "${#url}" -lt 60 ]; then bad "the URL is only ${#url} characters — a copy this short is truncated (Slack ≈ 80, Discord ≈ 120); copy it again with the page's Copy button"; exit 1; fi
  set_env RMC_ALERT_WEBHOOK "$url"
  # One setting for the whole box — an older ALERT_WEBHOOK_URL line would only confuse.
  sed -i '/^ALERT_WEBHOOK_URL=/d' "$ENV_FILE"
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  rm -f "$SET_FILE"
  ok "RMC_ALERT_WEBHOOK written to $ENV_FILE ($kind webhook, ${#url} characters); $SET_FILE deleted"
  if command -v docker >/dev/null 2>&1 && [ -f "$COMPOSE_FILE" ]; then
    printf '[alert-test] recreating the api so it starts with the webhook…\n'
    if docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d "$API_SERVICE" >/dev/null 2>&1; then
      for i in $(seq 1 30); do
        docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps --format '{{.Service}} {{.Health}}' 2>/dev/null | grep -q "^$API_SERVICE healthy" && break
        sleep 2
      done
      ok "api recreated"
    else
      bad "docker compose up -d $API_SERVICE failed — recreate it by hand, then run this script again"
    fi
  else
    bad "docker or the compose file is not available here — the api was not recreated"
  fi
fi

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
