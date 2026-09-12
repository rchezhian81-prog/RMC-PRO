#!/usr/bin/env bash
# =============================================================================
#  Mix Nova RMC — argument guard for the deploy-path scripts (sourced, not run)
# =============================================================================
#  Defines one function; sourcing this file does nothing on its own.
#
#  WHY THIS EXISTS: redeploy.sh, migration-preflight.sh and verify-app.sh all act
#  on the CURRENT CHECKOUT. None of them takes a positional argument — and bash
#  silently ignores the ones it is given, so `./scripts/ops/redeploy.sh a1b2c3d`
#  ran happily and built whatever the working tree happened to contain, while
#  reading as though it had deployed a1b2c3d. That is a dangerous illusion: it
#  can rebuild and relabel stale code, and every downstream check still passes
#  because the app works fine — it is simply the wrong commit.
#
#  A commit-ish argument is the specific case worth naming in the error, because
#  it is the one a runbook reader is most likely to invent.
# =============================================================================

# reject_positional_args "$@"
#   Exits 2 with a usable explanation when the caller passed any argument.
reject_positional_args() {
  [ "$#" -eq 0 ] && return 0

  local me root
  me="${0##*/}"
  root="$(cd "$(dirname "${BASH_SOURCE[1]:-$0}")/../.." && pwd 2>/dev/null || echo /opt/rmc)"

  printf '\n[%s] ERROR: this script takes no positional arguments, but got: %s\n' "$me" "$*" >&2

  if printf '%s' "$1" | grep -qE '^[0-9a-f]{7,40}$'; then
    printf '
It looks like you passed a commit (%s). These scripts act on the CURRENT
CHECKOUT and never on a commit you name — the argument would be ignored and you
would act on whatever the working tree contains, which is how stale code gets
rebuilt under a fresh-looking label.

To act on %s, check it out FIRST:

    cd %s
    git pull --ff-only origin main
    git log --oneline -1                 # confirm this shows %s
    sudo sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$(git rev-parse --short=7 HEAD)/" .env.production
    ./scripts/ops/%s                     # no argument

' "$1" "$1" "$root" "$1" "$me" >&2
  else
    printf '\nRun it with no arguments:\n\n    ./scripts/ops/%s\n\n' "$me" >&2
  fi

  exit 2
}
