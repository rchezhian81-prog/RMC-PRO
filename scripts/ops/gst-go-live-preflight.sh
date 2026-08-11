#!/usr/bin/env bash
# RMC Plant SaaS — GST live-integration go-live preflight (READ-ONLY).
#
# Runs ON the VPS to check the runbook-03 go-live gates in one command, once the
# live NIC/GSP adapter has been switched on. It verifies the deployment is wired
# and healthy WITHOUT transmitting anything itself: the provider mode, that the
# credential-encryption key is usable, that each tenant GSTIN has credentials
# whose last connectivity /test SUCCEEDED, and that the durable execution queue
# is not stuck or dead-lettering. Prints a single pass/fail report.
#
# READ-ONLY GUARANTEE: every request is a GET, except the one POST to /auth/login
# to obtain a token. It never stores credentials, never runs /test, never drains
# the queue, never files anything. The password is read from the environment only
# — never printed. (Run the actual /test + prepare→approve→execute steps yourself
# per runbook 03 §5; this script checks the recorded results.)
#
# Usage:
#   LOGIN='owner@example.com' RMC_PASSWORD='…' bash scripts/ops/gst-go-live-preflight.sh
#   (the login must hold `settings.manage` + `agents.approve` — Company Owner / Admin)
#
# Env: DOMAIN (default mixnovas.com), or API (full base URL, e.g. http://localhost:4000);
#      LOGIN, RMC_PASSWORD; STUCK_MIN (queued-job age that warns, default 15).
set -uo pipefail

DOMAIN="${DOMAIN:-mixnovas.com}"
API="${API:-https://api.${DOMAIN}}"
LOGIN="${LOGIN:-${RMC_LOGIN:-}}"
PASSWORD="${RMC_PASSWORD:-}"
STUCK_MIN="${STUCK_MIN:-15}"

PASS=0; FAIL=0; WARN=0; SKIP=0
c_ok=$'\033[32m'; c_bad=$'\033[31m'; c_warn=$'\033[33m'; c_dim=$'\033[2m'; c_off=$'\033[0m'
[ -t 1 ] || { c_ok=''; c_bad=''; c_warn=''; c_dim=''; c_off=''; }
section() { printf '\n%s── %s %s\n' "$c_dim" "$1" "$c_off"; }
ok()   { PASS=$((PASS+1)); printf '  %s✓%s %-46s %s\n' "$c_ok"  "$c_off" "$1" "${2:-}"; }
bad()  { FAIL=$((FAIL+1)); printf '  %s✗%s %-46s %s\n' "$c_bad" "$c_off" "$1" "${2:-}"; }
warn() { WARN=$((WARN+1)); printf '  %s!%s %-46s %s\n' "$c_warn" "$c_off" "$1" "${2:-}"; }
skip() { SKIP=$((SKIP+1)); printf '  %s·%s %-46s %s\n' "$c_dim" "$c_off" "$1" "${2:-}"; }

json_field() { # json path -> value | ''
  printf '%s' "$1" | python3 -c '
import sys, json
try: d = json.load(sys.stdin)
except Exception: sys.exit(0)
for k in sys.argv[1].split("."):
    if isinstance(d, dict) and k in d: d = d[k]
    elif isinstance(d, list) and k.isdigit() and int(k) < len(d): d = d[int(k)]
    else: sys.exit(0)
if d is None: print("")
elif isinstance(d, bool): print("true" if d else "false")   # JSON-style, not Python True/False
elif isinstance(d, (dict, list)): print(json.dumps(d))
else: print(d)
' "$2" 2>/dev/null
}

# Route "VERDICT\tlabel\tdetail" lines (from a python summariser) to the tally fns.
route() {
  while IFS=$'\t' read -r v label detail; do
    case "$v" in
      OK)   ok   "$label" "$detail" ;;
      WARN) warn "$label" "$detail" ;;
      BAD)  bad  "$label" "$detail" ;;
      *)    skip "$label" "$detail" ;;
    esac
  done
}

printf '%s\n' "RMC GST go-live preflight — ${API}    $(date -u '+%Y-%m-%d %H:%M:%SZ')"
printf '%sread-only: GETs plus one login POST; nothing is transmitted or modified%s\n' "$c_dim" "$c_off"

# ---- auth ----
section "1. Auth"
if [ -z "$LOGIN" ] || [ -z "$PASSWORD" ]; then
  skip "login" "set LOGIN and RMC_PASSWORD (needs settings.manage + agents.approve)"
  TOKEN=''
else
  body=$(curl -sS --max-time 25 -X POST "${API}/api/v1/auth/login" \
    -H 'Content-Type: application/json' -d "{\"login\":\"${LOGIN}\",\"password\":\"${PASSWORD}\"}" 2>/dev/null)
  TOKEN=$(json_field "$body" 'data.access_token')
  if [ -n "$TOKEN" ]; then ok "login" "token acquired"; else bad "login" "no token (check creds / permissions)"; fi
fi
auth=(-H "Authorization: Bearer ${TOKEN}")

# ---- provider mode ----
section "2. Provider mode (/agents/gst)"
if [ -z "$TOKEN" ]; then
  skip "gst mode" "needs login"
  GST_LIVE=0
else
  g=$(curl -sS --max-time 20 "${auth[@]}" "${API}/api/v1/agents/gst" 2>/dev/null)
  g=$(json_field "$g" 'data'); gp=$(json_field "$g" 'provider'); gc=$(json_field "$g" 'configured')
  GST_LIVE=0
  case "$gp" in
    nic|gsp)     if [ "$gc" = "true" ]; then ok "gst mode" "live ${gp^^} configured"; GST_LIVE=1
                 else bad "gst mode" "${gp} selected but not configured — set GST_IRP_BASE_URL / GST_GSP_CLIENT_ID / _SECRET / GST_RSA_PUBLIC_KEY_PEM"; fi ;;
    fake)        bad "gst mode" "FAKE provider — never in production! set GST_PROVIDER=nic" ;;
    disabled|'') warn "gst mode" "prepare-only (GST_PROVIDER=disabled) — flip to nic when going live" ;;
    *)           warn "gst mode" "provider '$gp'" ;;
  esac
fi

# ---- credential-encryption key (informational: it lives in the container env) ----
section "3. Credential encryption (GST_CRED_ENC_KEY)"
if [ -n "${GST_CRED_ENC_KEY:-}" ]; then
  klen=${#GST_CRED_ENC_KEY}
  if printf '%s' "$GST_CRED_ENC_KEY" | grep -Eq '^[0-9a-fA-F]{64}$'; then ok "enc key (this shell)" "present, 64 hex chars"
  elif [ "$klen" -ge 44 ]; then ok "enc key (this shell)" "present (${klen} chars — base64 32B?)"
  else warn "enc key (this shell)" "present but ${klen} chars — expected 64 hex or base64 of 32 bytes"; fi
else
  skip "enc key (this shell)" "GST_CRED_ENC_KEY not in THIS shell (it belongs to the container env; §4 proves it works)"
fi

# ---- per-tenant credentials + last connectivity test ----
section "4. Portal credentials (/compliance/gst-credentials)"
if [ -z "$TOKEN" ]; then
  skip "credentials" "needs login"
else
  code=$(curl -sS -o /tmp/gst_creds.$$ -w '%{http_code}' --max-time 20 "${auth[@]}" "${API}/api/v1/compliance/gst-credentials" 2>/dev/null)
  cbody=$(cat /tmp/gst_creds.$$ 2>/dev/null); rm -f /tmp/gst_creds.$$
  if [ "$code" = "403" ]; then warn "credentials" "403 — login lacks settings.manage or billing module is off"
  elif [ "${code:0:1}" != "2" ]; then bad "credentials" "HTTP ${code:-000} from the credentials endpoint"
  else
    creds=$(json_field "$cbody" 'data')
    # Capture then route via a here-string so ok/warn/bad tally in THIS shell
    # (a `… | route` pipe would run route in a subshell and lose the counters).
    cred_out=$(CREDS_JSON="$creds" python3 - <<'PY'
import os, json
try: rows = json.loads(os.environ.get("CREDS_JSON") or "[]")
except Exception: rows = []
if not isinstance(rows, list): rows = []
if not rows:
    print("BAD\tconfigured GSTINs\tnone — POST credentials for each seller GSTIN (runbook 03 §4)")
else:
    for r in rows:
        g = r.get("gstin", "?"); ts = r.get("lastTestSuccess"); msg = (r.get("lastTestMessage") or "").strip()
        if ts is True:   print(f"OK\tGSTIN {g}\tlast /test succeeded ({r.get('lastTestedAt') or '?'})")
        elif ts is False:print(f"BAD\tGSTIN {g}\tlast /test FAILED: {msg[:60] or 'see audit'}")
        else:            print(f"WARN\tGSTIN {g}\tconfigured but never /tested — run POST …/{g}/test")
PY
)
    route <<< "$cred_out"
  fi
fi

# ---- durable execution queue health ----
section "5. Execution queue (/agents/gst/jobs)"
if [ -z "$TOKEN" ]; then
  skip "queue" "needs login"
else
  code=$(curl -sS -o /tmp/gst_jobs.$$ -w '%{http_code}' --max-time 20 "${auth[@]}" "${API}/api/v1/agents/gst/jobs" 2>/dev/null)
  jbody=$(cat /tmp/gst_jobs.$$ 2>/dev/null); rm -f /tmp/gst_jobs.$$
  if [ "$code" = "403" ]; then warn "queue" "403 — login lacks agents.approve"
  elif [ "${code:0:1}" != "2" ]; then bad "queue" "HTTP ${code:-000} from the jobs endpoint"
  else
    jobs=$(json_field "$jbody" 'data')
    jobs_out=$(JOBS_JSON="$jobs" STUCK_MIN="$STUCK_MIN" NOW_TS="$(date -u +%s)" python3 - <<'PY'
import os, json
from datetime import datetime, timezone
try: rows = json.loads(os.environ.get("JOBS_JSON") or "[]")
except Exception: rows = []
if not isinstance(rows, list): rows = []
now = int(os.environ.get("NOW_TS") or 0); stuck_min = int(os.environ.get("STUCK_MIN") or 15)
by = {}
for r in rows: by[r.get("status","?")] = by.get(r.get("status","?"), 0) + 1
counts = ", ".join(f"{k}={v}" for k, v in sorted(by.items())) or "no jobs yet"
dead = by.get("dead", 0)
def age_min(r):
    t = r.get("createdAt")
    if not t: return 0
    try: return (now - int(datetime.fromisoformat(str(t).replace("Z","+00:00")).timestamp())) / 60
    except Exception: return 0
stuck = [r for r in rows if r.get("status") == "queued" and age_min(r) > stuck_min]
print(f"OK\tqueue snapshot\t{counts}")
if dead: print(f"BAD\tdead-lettered jobs\t{dead} exhausted retries — inspect lastError + re-approve")
else:    print("OK\tdead-lettered jobs\tnone")
if stuck: print(f"WARN\tstuck queued jobs\t{len(stuck)} queued > {stuck_min}m — is the worker running (GST_WORKER_ENABLED) or drain them?")
else:     print("OK\tstuck queued jobs\tnone")
PY
)
    route <<< "$jobs_out"
  fi
fi

# ---- reminder: GSP-specific wire confirmation ----
section "6. Before trusting a live run"
skip "TODO(deploy) seams" "confirm endpoint paths + field names vs your GSP (runbook 03 §6)"
skip "worker" "auto-drain needs GST_WORKER_ENABLED=true, else drain via POST /agents/gst/jobs/drain"

# ---- summary ----
printf '\n%s────────────────────────%s\n' "$c_dim" "$c_off"
printf 'gst go-live preflight: %s%d pass%s, %s%d fail%s, %s%d warn%s, %d skip\n' \
  "$c_ok" "$PASS" "$c_off" "$c_bad" "$FAIL" "$c_off" "$c_warn" "$WARN" "$c_off" "$SKIP"
[ "$FAIL" -eq 0 ]
