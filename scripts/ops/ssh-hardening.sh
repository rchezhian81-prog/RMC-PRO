#!/usr/bin/env bash
# =============================================================================
#  Mix Nova RMC — SSH key-only hardening  (lockout-guarded)
# =============================================================================
#  Disables SSH password login (key-only) and forbids root password login. This
#  is the single biggest server-access win: brute-force password attacks stop
#  working entirely.
#
#  LOCKOUT SAFETY — the script REFUSES to proceed unless a usable public key is
#  already installed for a login account, so you can't lock yourself out. It
#  reloads sshd (never restarts), so your current session stays open, and it
#  prints a mandatory test-before-you-close step.
#
#  BEFORE running this, from YOUR computer:
#     ssh-keygen -t ed25519 -C "mixnova-admin"        # if you don't have a key
#     ssh-copy-id root@65.20.69.69                     # installs your PUBLIC key
#     ssh root@65.20.69.69                             # confirm key login works
#
#  THEN, on the VPS as root:
#     sudo ./scripts/ops/ssh-hardening.sh --confirm
#
#  ROLLBACK (re-enable passwords):
#     sudo rm /etc/ssh/sshd_config.d/99-rmc-hardening.conf && sudo systemctl reload ssh
# =============================================================================
set -u

DROPIN="/etc/ssh/sshd_config.d/99-rmc-hardening.conf"
MAIN_CFG="/etc/ssh/sshd_config"

log() { printf '[ssh-hardening] %s\n' "$*"; }
die() { printf '[ssh-hardening] ERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "run as root — use: sudo $0 --confirm"

# ---- Lockout guard: at least one login account must already have a key ----
key_accounts=()
check_keys() {
  local user="$1" home akf
  home="$(getent passwd "$user" | cut -d: -f6)"
  [ -n "$home" ] || return 0
  akf="$home/.ssh/authorized_keys"
  if [ -s "$akf" ] && grep -Eq '^(ssh-(ed25519|rsa|dss)|ecdsa-)' "$akf"; then
    local n; n="$(grep -Ec '^(ssh-(ed25519|rsa|dss)|ecdsa-)' "$akf")"
    key_accounts+=("$user ($n key(s))")
  fi
}
check_keys root
# any sudo-group member too
if getent group sudo >/dev/null; then
  for u in $(getent group sudo | cut -d: -f4 | tr ',' ' '); do [ -n "$u" ] && check_keys "$u"; done
fi

if [ "${#key_accounts[@]}" -eq 0 ]; then
  cat >&2 <<EOF
[ssh-hardening] ABORT: no login account has an SSH public key installed.
Disabling passwords now would lock everyone out. Install your key first:
    (from your computer)  ssh-copy-id root@<server-ip>
    then confirm:         ssh root@<server-ip>
and re-run this script.
EOF
  exit 1
fi
log "key-based login is available for: ${key_accounts[*]}"

# ---- sshd must Include the drop-in dir (Ubuntu 22.04 default: yes) ----
if ! grep -Eq '^[[:space:]]*Include[[:space:]]+/etc/ssh/sshd_config\.d/\*\.conf' "$MAIN_CFG"; then
  die "$MAIN_CFG has no 'Include /etc/ssh/sshd_config.d/*.conf' — a drop-in won't take effect. Add that line (at the top) first, then re-run."
fi

# ---- Require explicit confirmation ----
if [ "${1:-}" != "--confirm" ]; then
  cat <<EOF
[ssh-hardening] DRY RUN — nothing changed.
This will write $DROPIN with:
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    PermitRootLogin prohibit-password
Re-run with --confirm to apply (your current session stays open):
    sudo $0 --confirm
EOF
  exit 0
fi

# ---- Apply via drop-in, validate, reload ----
mkdir -p "$(dirname "$DROPIN")"
cat > "$DROPIN" <<'EOF'
# Mix Nova RMC SSH hardening (managed by scripts/ops/ssh-hardening.sh).
# Remove this file and `systemctl reload ssh` to re-enable password login.
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PermitRootLogin prohibit-password
EOF
chmod 644 "$DROPIN"

if ! sshd -t 2>/tmp/sshd-test.err; then
  cat /tmp/sshd-test.err >&2
  rm -f "$DROPIN"
  die "sshd config test FAILED — reverted the drop-in, no change applied."
fi
log "sshd -t passed ✓"

systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || service ssh reload 2>/dev/null \
  || die "could not reload sshd — drop-in written but not active; reload manually."

cat <<EOF

[ssh-hardening] APPLIED. Password login is now OFF (key-only); root is key-only.
Your current session is still open (reload doesn't drop it).

  >>> MANDATORY TEST — do this NOW, before closing this session: <<<
      Open a NEW terminal and run:  ssh root@<server-ip>
      It must log in via your key WITHOUT asking for a password.

  If the new session works, you're done.
  If it does NOT, roll back in THIS still-open session:
      rm $DROPIN && systemctl reload ssh
EOF
