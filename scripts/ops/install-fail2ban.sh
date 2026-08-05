#!/usr/bin/env bash
# =============================================================================
#  Mix Nova RMC — brute-force protection for SSH (fail2ban), server-only
# =============================================================================
#  The zero-effort alternative to key-only SSH: fail2ban watches auth logs and
#  temporarily bans any IP that fails to log in too many times, which stops
#  password brute-force attacks outright. It changes NOTHING about how you log
#  in — you keep using your password — and it runs entirely on the server.
#
#  Idempotent and reversible:
#     disable:  sudo systemctl disable --now fail2ban
#
#  USAGE (on the VPS, as root, from the repo root):
#     sudo ./scripts/ops/install-fail2ban.sh
#     IGNORE_IP="203.0.113.4" sudo -E ./scripts/ops/install-fail2ban.sh   # whitelist your home IP
# =============================================================================
set -u

JAIL="/etc/fail2ban/jail.local"

log() { printf '[fail2ban-setup] %s\n' "$*"; }
die() { printf '[fail2ban-setup] ERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "run as root — use: sudo $0"
command -v apt-get >/dev/null 2>&1 || die "this installer targets Debian/Ubuntu (apt-get)."

# ---- 1. Install the package if missing ----
if ! command -v fail2ban-client >/dev/null 2>&1; then
  log "installing fail2ban…"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq || die "apt-get update failed"
  apt-get install -y -qq fail2ban || die "apt-get install fail2ban failed"
else
  log "fail2ban already installed"
fi

# ---- 2. Config: enable the sshd jail with sane limits ----
# Whitelist loopback and (optionally) an operator IP so you can never lock
# yourself out with a fat-fingered password. bantime/findtime/maxretry are
# forgiving enough for a human, strict enough to kill bots.
IGNORE="127.0.0.1/8 ::1${IGNORE_IP:+ $IGNORE_IP}"
cat > "$JAIL" <<EOF
# Mix Nova RMC — managed by scripts/ops/install-fail2ban.sh (edit there).
[DEFAULT]
ignoreip = $IGNORE
bantime  = 1h
findtime = 10m
maxretry = 5
backend  = systemd

[sshd]
enabled = true
EOF
log "wrote $JAIL (sshd jail: 5 tries / 10 min -> 1 h ban; ignore: $IGNORE)"

# ---- 3. Enable + (re)start, then show status ----
systemctl enable fail2ban >/dev/null 2>&1 || true
systemctl restart fail2ban || die "fail2ban failed to start — check: journalctl -u fail2ban -n 50"
sleep 2

log "fail2ban is active. Current sshd jail status:"
fail2ban-client status sshd 2>/dev/null || log "(status not ready yet; check again in a moment)"

cat <<EOF

[fail2ban-setup] DONE — SSH brute-force protection is live. You log in exactly
as before (password still works); attackers get banned after 5 failures.
  see banned IPs:   sudo fail2ban-client status sshd
  unban an IP:      sudo fail2ban-client set sshd unbanip <ip>
  turn it off:      sudo systemctl disable --now fail2ban
EOF
