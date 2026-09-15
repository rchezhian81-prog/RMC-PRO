#!/usr/bin/env bash
# =============================================================================
#  Mix Nova RMC — off-box backup target: set it up, or verify it (Backblaze B2)
# =============================================================================
#  On-box copies die with the box. This wires every pg-backup.sh dump to be
#  copied to a private bucket that lives elsewhere, and proves it works with a
#  trial dump that is read back from the bucket.
#
#  USAGE (on the VPS, from the repo root, as the user the backup cron runs as —
#  root on the pilot box — because rclone keeps its config in that user's home):
#     ./scripts/backup/offbox-setup.sh --bucket rmc-offbox-backups
#         Backblaze B2 (default). Prompts for the keyID and applicationKey of an
#         application key you created in the B2 console, scoped to that bucket.
#         The applicationKey is typed hidden and never printed or logged.
#     ./scripts/backup/offbox-setup.sh --type s3 --endpoint https://… --bucket NAME
#         Any S3-compatible store (Wasabi, Cloudflare R2, MinIO elsewhere, AWS).
#     ./scripts/backup/offbox-setup.sh --verify
#         Read-only: is a target set, is the bucket reachable, how old is the
#         newest dump there. Exit 0 only when a dump under 48h is in the bucket.
#
#  Options: --remote NAME (rclone remote name, default b2) · --replace (rewrite
#  an existing remote) · --no-backup (skip the trial dump) · --dry-run (tests).
#  Non-interactive: OFFBOX_KEY_ID and OFFBOX_KEY_SECRET in the environment.
#
#  The bucket must ALREADY EXIST (create it private in the provider's console):
#  rclone would silently create a mistyped name and every backup would land in a
#  bucket nobody looks at, so this script refuses to create one.
# =============================================================================
set -u
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.production}"
BACKUP_SH="${BACKUP_SH:-$REPO_ROOT/scripts/backup/pg-backup.sh}"
RCLONE="${RCLONE:-rclone}"
# shellcheck source=scripts/backup/lib-offbox.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib-offbox.sh"

c_ok=$'\033[32m'; c_bad=$'\033[31m'; c_warn=$'\033[33m'; c_off=$'\033[0m'
[ -t 1 ] || { c_ok=''; c_bad=''; c_warn=''; c_off=''; }
ok()   { printf '  %s✓%s %s\n' "$c_ok" "$c_off" "$*"; }
warn() { printf '  %s!%s %s\n' "$c_warn" "$c_off" "$*"; }
bad()  { printf '  %s✗%s %s\n' "$c_bad" "$c_off" "$*"; }
die()  { bad "$*"; exit 1; }
log()  { printf '[offbox-setup] %s\n' "$*"; }

MODE=setup; TYPE=b2; REMOTE=b2; BUCKET=""; ENDPOINT=""; REPLACE=0; NO_BACKUP=0; DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --verify)    MODE=verify ;;
    --type)      TYPE="${2:?--type needs b2 or s3}"; shift ;;
    --remote)    REMOTE="${2:?--remote needs a name}"; shift ;;
    --bucket)    BUCKET="${2:?--bucket needs a name}"; shift ;;
    --endpoint)  ENDPOINT="${2:?--endpoint needs a URL}"; shift ;;
    --replace)   REPLACE=1 ;;
    --no-backup) NO_BACKUP=1 ;;
    --dry-run)   DRY_RUN=1; NO_BACKUP=1 ;;
    -h|--help)   sed -n '2,32p' "$0"; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
  shift
done

getenv() { [ -f "$ENV_FILE" ] && grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '[:space:]' | sed -e "s/^[\"']//" -e "s/[\"']\$//" || true; }
# set_env KEY VALUE — replace the active line or append; keeps the file's mode.
set_env() {
  local tmp; tmp="$(mktemp)"
  k="$1" v="$2" awk 'BEGIN { k = ENVIRON["k"]; v = ENVIRON["v"]; done = 0 }
    index($0, k "=") == 1 { print k "=" v; done = 1; next }
    { print }
    END { if (!done) print k "=" v }' "$ENV_FILE" > "$tmp" && cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
}

# ---- verify: read-only ------------------------------------------------------
verify() {
  local target root newest ts name size epoch age_h count rc=0
  printf 'Off-box backup — verify\n'
  target="$(getenv RMC_OFFBOX_RCLONE)"
  if [ -z "$target" ]; then
    if [ -n "$(getenv RMC_OFFBOX_SCP)" ]; then warn "RMC_OFFBOX_SCP is set (ssh copy) — this check covers rclone targets only"; return 0; fi
    bad "no RMC_OFFBOX_RCLONE in $ENV_FILE — every backup lives only on this box"; return 1
  fi
  ok "target: $target"
  command -v "$RCLONE" >/dev/null 2>&1 || { bad "rclone is not installed — run this script without --verify to set it up"; return 1; }
  offbox_target_has_bucket "$target" || { bad "target names no bucket (expected remote:bucket)"; return 1; }
  root="$(offbox_bucket_root "$target")"
  "$RCLONE" listremotes 2>/dev/null | grep -qx "${root%%:*}:" || { bad "rclone has no remote named '${root%%:*}' (for this user) — run the setup"; return 1; }
  offbox_bucket_exists "$target" "$RCLONE" || { bad "bucket $root is not reachable (wrong name, key or network)"; return 1; }
  ok "bucket $root reachable (read-only probe)"
  newest="$("$RCLONE" lsf --files-only --format tsp --include 'rmc-*.dump' "$target" 2>/dev/null | sort | tail -1)"
  count="$("$RCLONE" lsf --files-only --include 'rmc-*.dump' "$target" 2>/dev/null | wc -l | tr -d ' ')"
  if [ -z "$newest" ]; then
    bad "no dump in the bucket yet — run one: ./scripts/backup/pg-backup.sh --label offbox-check"; return 1
  fi
  ts="${newest%%;*}"; rest="${newest#*;}"; size="${rest%%;*}"; name="${rest#*;}"
  epoch="$(date -d "${ts%%.*}" +%s 2>/dev/null || echo 0)"
  age_h=$(( ( $(date +%s) - epoch ) / 3600 ))
  if [ "$epoch" = "0" ]; then warn "$count dump(s); newest $name ($size bytes) — age unreadable"
  elif [ "$age_h" -le 48 ]; then ok "$count dump(s); newest $name ($size bytes), ${age_h}h old"
  else bad "$count dump(s); newest $name is ${age_h}h old — recent backups are not reaching the bucket"; rc=1; fi
  return $rc
}

# ---- setup -------------------------------------------------------------------
setup() {
  [ -f "$ENV_FILE" ] || die "env file not found: $ENV_FILE"
  [ -n "$BUCKET" ]   || die "--bucket NAME is required (create it, private, in the provider console first)"
  case "$TYPE" in b2|s3) ;; *) die "--type must be b2 or s3" ;; esac
  [ "$TYPE" = "s3" ] && [ -z "$ENDPOINT" ] && die "--endpoint https://… is required for --type s3"
  printf 'Off-box backup — setup (%s, remote "%s", bucket "%s")\n' "$TYPE" "$REMOTE" "$BUCKET"

  if ! command -v "$RCLONE" >/dev/null 2>&1; then
    if [ "$DRY_RUN" = "1" ]; then die "rclone is not installed (dry run: not installing)"; fi
    log "installing rclone…"
    if command -v apt-get >/dev/null 2>&1; then
      (apt-get update -qq && apt-get install -y -qq rclone) >/dev/null 2>&1 || curl -fsS https://rclone.org/install.sh | bash >/dev/null 2>&1
    else
      curl -fsS https://rclone.org/install.sh | bash >/dev/null 2>&1
    fi
    command -v "$RCLONE" >/dev/null 2>&1 || die "could not install rclone — install it by hand (https://rclone.org/install/) and re-run"
  fi
  ok "rclone $("$RCLONE" version 2>/dev/null | head -1 | awk '{print $2}')"

  if "$RCLONE" listremotes 2>/dev/null | grep -qx "$REMOTE:" && [ "$REPLACE" = "0" ]; then
    ok "remote '$REMOTE' already configured — keeping it (use --replace to re-enter the key)"
  else
    local id secret
    id="${OFFBOX_KEY_ID:-}"; secret="${OFFBOX_KEY_SECRET:-}"
    if [ -z "$id" ] && [ -t 0 ]; then
      if [ "$TYPE" = "b2" ]; then printf 'Backblaze keyID: '; else printf 'Access key ID: '; fi
      read -r id
    fi
    if [ -z "$secret" ] && [ -t 0 ]; then
      if [ "$TYPE" = "b2" ]; then printf 'Backblaze applicationKey (hidden): '; else printf 'Secret access key (hidden): '; fi
      read -rs secret; printf '\n'
    fi
    [ -n "$id" ] && [ -n "$secret" ] || die "both the key id and the secret are needed (run at a terminal to be prompted, or set OFFBOX_KEY_ID and OFFBOX_KEY_SECRET)"
    # rclone prints the new section (secret included) on success — silence it.
    if [ "$TYPE" = "b2" ]; then
      "$RCLONE" config create "$REMOTE" b2 account "$id" key "$secret" >/dev/null 2>&1 || die "rclone could not store the remote"
    else
      "$RCLONE" config create "$REMOTE" s3 provider Other access_key_id "$id" secret_access_key "$secret" endpoint "$ENDPOINT" >/dev/null 2>&1 || die "rclone could not store the remote"
    fi
    ok "remote '$REMOTE' stored in $("$RCLONE" config file 2>/dev/null | tail -1) (readable by this user only)"
  fi

  local target="$REMOTE:$BUCKET"
  if ! offbox_bucket_exists "$target" "$RCLONE"; then
    die "bucket '$BUCKET' is not reachable with this key. Create it (private) in the provider console, check the key is scoped to it, then re-run. Refusing to create it: a mistyped bucket would swallow every backup unseen."
  fi
  ok "bucket $REMOTE:$BUCKET reachable"

  set_env RMC_OFFBOX_RCLONE "$target"
  ok "RMC_OFFBOX_RCLONE=$target written to $ENV_FILE"
  [ "$DRY_RUN" = "1" ] && { ok "dry run — stopping before the trial backup"; return 0; }

  if [ "$NO_BACKUP" = "0" ]; then
    log "trial backup: a dump is taken now, copied to the bucket and read back…"
    local out
    out="$("$BACKUP_SH" --label offbox-check 2>&1)"; local brc=$?
    printf '%s\n' "$out" | grep -E 'off-box|done:|ERROR' | sed 's/^/     /'
    if [ "$brc" = "0" ] && printf '%s' "$out" | grep -q 'off-box copy verified'; then ok "trial dump copied and read back from $target"
    else die "the trial backup did not reach the bucket — see the lines above"; fi
  fi
  verify
}

case "$MODE" in
  verify) verify; rc=$? ;;
  setup)  setup;  rc=$? ;;
esac
if [ "${rc:-1}" = "0" ]; then printf '\n%sOFF-BOX BACKUP OK%s — every nightly dump is copied to the bucket and checked there.\n' "$c_ok" "$c_off"
else printf '\n%sOFF-BOX BACKUP NOT READY%s — see the ✗ line(s) above.\n' "$c_bad" "$c_off"; fi
exit "${rc:-1}"
