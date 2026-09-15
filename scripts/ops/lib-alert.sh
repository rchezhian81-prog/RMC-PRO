#!/usr/bin/env bash
# =============================================================================
#  Mix Nova RMC — one alert channel for every on-box script  (sourced, not run)
# =============================================================================
#  Defines functions only — sourcing this file runs nothing.
#
#  WHY THIS EXISTS: four scripts each had their own curl that POSTed {"text":…}
#  to RMC_ALERT_WEBHOOK. That body renders in Slack and Google Chat but is
#  rejected by Discord (which wants "content"), and none of them escaped quotes
#  or newlines, so a message carrying either silently failed to send — the
#  alert that mattered most was the one most likely to have odd characters in it.
#  The API's alerter already sends both fields; this makes the scripts match.
#
#  The webhook is ONE setting for the whole box: RMC_ALERT_WEBHOOK (the name the
#  scripts always used), with ALERT_WEBHOOK_URL (the API's name) accepted too.
#  The API reads either as well, so a single line in .env.production wires the
#  health monitor, the backups, the restore drill and the API's 5xx alerts.
#
#  Callers set ENV_FILE before sourcing (default: <repo>/.env.production).
# =============================================================================

# rmc_alert_webhook
#   Echoes the configured webhook URL: environment first (RMC_ALERT_WEBHOOK, then
#   ALERT_WEBHOOK_URL), else the same keys from ENV_FILE. Empty when none is set.
rmc_alert_webhook() {
  local v="${RMC_ALERT_WEBHOOK:-${ALERT_WEBHOOK_URL:-}}"
  if [ -z "$v" ] && [ -n "${ENV_FILE:-}" ] && [ -f "$ENV_FILE" ]; then
    v="$(grep -E '^(RMC_ALERT_WEBHOOK|ALERT_WEBHOOK_URL)=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '[:space:]')"
    # A value written with quotes around it (either style) is the same value.
    v="${v#\"}"; v="${v%\"}"; v="${v#\'}"; v="${v%\'}"
  fi
  printf '%s' "$v"
}

# rmc_alert_webhook_source
#   Which setting supplied the webhook: RMC_ALERT_WEBHOOK, ALERT_WEBHOOK_URL, or "".
rmc_alert_webhook_source() {
  if [ -n "${RMC_ALERT_WEBHOOK:-}" ]; then printf 'RMC_ALERT_WEBHOOK'; return; fi
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then printf 'ALERT_WEBHOOK_URL'; return; fi
  if [ -n "${ENV_FILE:-}" ] && [ -f "$ENV_FILE" ]; then
    grep -E '^(RMC_ALERT_WEBHOOK|ALERT_WEBHOOK_URL)=' "$ENV_FILE" | head -1 | cut -d= -f1 | tr -d '[:space:]'
  fi
}

# rmc_json_escape <text>
#   Echoes the text as the inside of a JSON string: backslashes, double quotes,
#   tabs, carriage returns and newlines escaped. No surrounding quotes.
rmc_json_escape() {
  printf '%s' "${1:-}" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\t/\\t/g' -e 's/\r/\\r/g' | sed -e ':a' -e 'N' -e '$!ba' -e 's/\n/\\n/g'
}

# rmc_alert <message>
#   POSTs the message to the webhook as {"text":…,"content":…} — "text" is what
#   Slack and Google Chat render, "content" what Discord renders; a generic relay
#   reads either. Sets RMC_ALERT_HTTP to the response code. Returns:
#     0 sent (2xx)   1 no webhook configured   2 the POST failed or was refused
rmc_alert() {
  local msg="${1:-}" hook esc
  hook="$(rmc_alert_webhook)"
  RMC_ALERT_HTTP=""
  [ -n "$hook" ] || return 1
  command -v curl >/dev/null 2>&1 || { RMC_ALERT_HTTP="no-curl"; return 2; }
  esc="$(rmc_json_escape "$msg")"
  RMC_ALERT_HTTP="$(curl -sS --max-time 12 -o /dev/null -w '%{http_code}' -X POST "$hook" \
    -H 'Content-Type: application/json' \
    --data "{\"text\":\"$esc\",\"content\":\"$esc\"}" 2>/dev/null)"
  # curl writes "000" itself when nothing answered; an empty capture means it
  # could not even start (no DNS, no route) — say 000 for that too.
  [ -n "$RMC_ALERT_HTTP" ] || RMC_ALERT_HTTP="000"
  case "$RMC_ALERT_HTTP" in 2??) return 0 ;; *) return 2 ;; esac
}
