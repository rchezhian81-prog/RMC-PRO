#!/usr/bin/env bash
# =============================================================================
#  Mix Nova RMC — off-box target helpers  (sourced by pg-backup.sh)
# =============================================================================
#  Defines functions only — sourcing this file runs nothing.
#
#  WHY THIS EXISTS: `rclone copy` CREATES a missing destination bucket. A typo in
#  RMC_OFFBOX_RCLONE therefore *succeeds*: rclone makes an empty bucket, uploads
#  into it, and the read-back check passes — so every backup lands in a bucket
#  nobody monitors while the log cheerfully reports "off-box copy verified".
#  The read-back cannot catch this; it is self-consistent with the typo. Proving
#  the bucket already exists is the only check that does.
# =============================================================================

# offbox_bucket_root <target>
#   Echoes the container rclone would create: "b2:bucket/sub/dir" -> "b2:bucket".
#   A target with no remote prefix (a local/NFS path) is returned unchanged.
offbox_bucket_root() {
  local target="${1:-}"
  case "$target" in
    *:*) printf '%s\n' "${target%%/*}" ;;
    *)   printf '%s\n' "$target" ;;
  esac
}

# offbox_target_has_bucket <target>
#   False for a bare remote root ("b2:") — there is no container to upload into.
offbox_target_has_bucket() {
  case "$(offbox_bucket_root "${1:-}")" in
    *:) return 1 ;;
    '') return 1 ;;
    *)  return 0 ;;
  esac
}

# offbox_bucket_exists <target> [rclone_bin]
#   READ-ONLY existence probe: `lsf` lists, it never creates, so a missing bucket
#   exits non-zero instead of being conjured. Returns 0 only when it is there.
offbox_bucket_exists() {
  local root bin
  root="$(offbox_bucket_root "${1:-}")"
  bin="${2:-rclone}"
  "$bin" lsf --max-depth 1 "$root" >/dev/null 2>&1
}
