#!/usr/bin/env bash
# =============================================================================
#  Mix Nova RMC — nightly backup of uploaded FILES (MinIO data) + off-box copy
# =============================================================================
#  The database dumps carry every record, but the photos, scans and logos live
#  in MinIO's data volume, which no dump touches. This archives that volume
#  every night beside the dumps and copies it to the same off-box target
#  (under files/), so a lost server loses no documents either.
#
#  How: `docker cp <minio>:/data -` streams a tar of the data directory out of
#  the RUNNING container — no extra image, no MinIO credentials, read-only.
#  Restore: docs/deployment/restore-runbook.md §6.
#
#  USAGE (on the VPS, from the repo root):
#     ./scripts/backup/files-backup.sh                  # nightly (keeps 7)
#     ./scripts/backup/files-backup.sh --label weekly   # any label; pruned per label
#
#  Env: FILES_BACKUP_DIR (default backups/files), MINIO_CONTAINER
#  (default rmc-pilot-minio-1), KEEP_FILES (default 7), and the same
#  RMC_OFFBOX_RCLONE / RMC_OFFBOX_SCP / RMC_ALERT_WEBHOOK as pg-backup.sh.
# =============================================================================
set -u
set -o pipefail
umask 077
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.production}"
# shellcheck source=scripts/backup/lib-offbox.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib-offbox.sh"
# shellcheck source=scripts/ops/lib-alert.sh
. "$(dirname "${BASH_SOURCE[0]}")/../ops/lib-alert.sh"
BACKUP_DIR="${FILES_BACKUP_DIR:-$REPO_ROOT/backups/files}"
MINIO_CONTAINER="${MINIO_CONTAINER:-rmc-pilot-minio-1}"
KEEP="${KEEP_FILES:-7}"
LABEL="daily"
[ "${1:-}" = "--label" ] && { LABEL="${2:?--label needs a value}"; }
log() { printf '[files-backup %s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }
getenv() { [ -f "$ENV_FILE" ] && grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '[:space:]' | sed -e "s/^[\"']//" -e "s/[\"']\$//" || true; }

command -v docker >/dev/null 2>&1 || die "docker not found on PATH"
docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$MINIO_CONTAINER" || die "MinIO container $MINIO_CONTAINER is not running — nothing to archive"
mkdir -p "$BACKUP_DIR" || die "cannot create $BACKUP_DIR"

OUT="$BACKUP_DIR/rmc-files-$LABEL-$(date +%Y%m%d-%H%M%S).tgz"
log "archiving $MINIO_CONTAINER:/data -> $(basename "$OUT")"
if ! docker cp "$MINIO_CONTAINER:/data" - | gzip -1 > "$OUT"; then
  rm -f "$OUT"
  die "docker cp failed — the archive was not written"
fi
[ -s "$OUT" ] || { rm -f "$OUT"; die "empty archive"; }
( cd "$BACKUP_DIR" && sha256sum "$(basename "$OUT")" > "$(basename "$OUT").sha256" )
log "done: $(basename "$OUT") ($(du -h "$OUT" | cut -f1)) + .sha256"

# ---- OFF-BOX copy: the same target as the database dumps, under files/ ----
RMC_OFFBOX_RCLONE="${RMC_OFFBOX_RCLONE:-$(getenv RMC_OFFBOX_RCLONE)}"
RMC_OFFBOX_SCP="${RMC_OFFBOX_SCP:-$(getenv RMC_OFFBOX_SCP)}"
offbox_alert() {
  log "WARN: $1"
  [ -n "$(rmc_alert_webhook)" ] && { rmc_alert "RMC files backup off-box FAILED: $1" || log "WARN: alert webhook POST failed (HTTP ${RMC_ALERT_HTTP:-none})"; }
}
if [ -n "$RMC_OFFBOX_RCLONE" ]; then
  target="${RMC_OFFBOX_RCLONE%/}/files"
  if ! command -v rclone >/dev/null 2>&1; then
    offbox_alert "rclone not installed but RMC_OFFBOX_RCLONE is set (local archive kept)"
  elif ! offbox_target_has_bucket "$RMC_OFFBOX_RCLONE"; then
    offbox_alert "RMC_OFFBOX_RCLONE='$RMC_OFFBOX_RCLONE' names no bucket (local archive kept)"
  elif ! offbox_bucket_exists "$RMC_OFFBOX_RCLONE"; then
    offbox_alert "off-box bucket $(offbox_bucket_root "$RMC_OFFBOX_RCLONE") does not exist or is unreachable (local archive kept)"
  elif rclone copy "$OUT" "$target" && rclone copy "$OUT.sha256" "$target"; then
    if rclone lsf "$target" 2>/dev/null | grep -qF "$(basename "$OUT")"; then
      log "off-box copy verified -> rclone:$target"
    else
      offbox_alert "off-box copy not found on read-back at $target (local archive kept)"
    fi
  else
    offbox_alert "off-box rclone copy failed to $target (local archive kept)"
  fi
elif [ -n "$RMC_OFFBOX_SCP" ]; then
  if scp -q "$OUT" "$OUT.sha256" "$RMC_OFFBOX_SCP"/; then log "off-box copy ok -> scp:$RMC_OFFBOX_SCP"
  else offbox_alert "off-box scp copy failed to $RMC_OFFBOX_SCP (local archive kept)"; fi
else
  log "note: no off-box target set (RMC_OFFBOX_RCLONE / RMC_OFFBOX_SCP) — on-box copy only"
fi

# ---- retention: newest KEEP per label ----
n=0
ls -1t "$BACKUP_DIR"/rmc-files-"$LABEL"-*.tgz 2>/dev/null | while read -r f; do
  n=$((n+1))
  if [ "$n" -gt "$KEEP" ]; then rm -f "$f" "$f.sha256"; log "pruned old $LABEL: $(basename "$f")"; fi
done
log "retention applied ($LABEL keeps $KEEP)"
