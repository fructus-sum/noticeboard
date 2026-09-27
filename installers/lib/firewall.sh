# shellcheck shell=bash
# installers/lib/firewall.sh — the optional firewall step
#
# Responsibilities
#   The last step before the reboot. Many Pis already have a firewall set up the way their
#   owner wants, so nothing is installed or changed without a yes. Setting one up uses ufw, the
#   firewall Raspberry Pi's documentation recommends, and only opens the ports the user
#   confirms, allowing SSH before anything could block it. Over SSH, the firewall turns itself
#   off again unless the user confirms a new SSH login works.
#
# Provides
#   check_firewall    ufw or firewalld on: allow the slideshow port; other rules: left alone;
#                     none: offer to set up ufw (setup_ufw)
#   firewall_reminder <port, or empty>   what to allow when nothing was changed
#
# Used by
#   install.sh main() (never allowed to stop the installer)
#
# Uses
#   ui.sh (ask_yes_no, ask_port, ask_yes_in_time), system.sh (slideshow_port); MODE (install.sh)
#
# Change impact
#   A mistake here can cut off SSH access: tests/installers/firewall.sh covers each case.

FIREWALL_UNDO_UNIT="noticeboard-firewall-undo"   # turns ufw off again unless the user confirms SSH works

check_firewall() {
  local port=""   # the slideshow port; a remote display serves nothing, so it has none
  if [ "$MODE" = server ]; then
    port=$(slideshow_port)
  fi

  echo ""
  echo "── Firewall (optional) ─────────────────────────"
  if [ -n "$port" ]; then
    echo "The installer can check this Pi's firewall and make sure other devices can reach"
    echo "the slideshow and admin panel on port $port."
  else
    echo "The installer can check this Pi's firewall and, if it has none, set one up."
  fi
  echo "Nothing is changed unless you say yes. Skip this if you look after the firewall yourself."
  if ! ask_yes_no "Check this Pi's firewall? (y/n): "; then
    echo "  Firewall not checked; nothing was changed."
    firewall_reminder "$port"
    return 0
  fi

  if ufw_active; then
    echo "  The ufw firewall is on; its rules are kept."
    if [ -z "$port" ]; then
      echo "  A remote display needs no incoming port, so nothing was changed."
    elif ufw allow "$port/tcp" >/dev/null; then
      echo "  ✓ The slideshow port $port/tcp is allowed."
    else
      echo "  Couldn't add the rule. Add it yourself: sudo ufw allow $port/tcp"
    fi
    return 0
  fi

  if command -v firewall-cmd >/dev/null && [ "$(firewall-cmd --state 2>/dev/null)" = running ]; then
    echo "  The firewalld firewall is on; its rules are kept."
    if [ -z "$port" ]; then
      echo "  A remote display needs no incoming port, so nothing was changed."
    elif firewall-cmd --quiet --permanent --add-port="$port/tcp" && firewall-cmd --quiet --reload; then
      echo "  ✓ The slideshow port $port/tcp is allowed."
    else
      echo "  Couldn't add the rule. Add it yourself: sudo firewall-cmd --permanent --add-port=$port/tcp && sudo firewall-cmd --reload"
    fi
    return 0
  fi

  if other_firewall_rules; then
    echo "  This Pi has firewall rules that weren't made with ufw or firewalld (nftables or"
    echo "  iptables). They're someone's own setup, so they're left exactly as they are."
    firewall_reminder "$port"
    return 0
  fi

  echo ""
  if command -v ufw >/dev/null; then
    echo "The ufw firewall is installed but turned off."
  else
    echo "This Pi has no firewall turned on."
  fi
  echo "The installer can set up ufw, the firewall Raspberry Pi recommends: it blocks incoming"
  echo "connections except the ones you choose next. This is recommended only for a Pi that is"
  echo "a dedicated slideshow machine running Raspberry Pi OS. If this Pi does other jobs too,"
  echo "say no and set up its firewall yourself."
  if ! ask_yes_no "Set up a firewall now? (y/n): "; then
    echo "  Nothing was changed."
    firewall_reminder "$port"
    return 0
  fi
  setup_ufw "$port"
}

ufw_active() {
  local status=""
  command -v ufw >/dev/null || return 1
  status=$(ufw status 2>/dev/null) || true
  [[ "$status" == *"Status: active"* ]]
}

# What to allow when the installer doesn't (or can't) change the firewall itself
firewall_reminder() {   # firewall_reminder <slideshow port, or empty on a remote display>
  if [ -n "$1" ]; then
    echo "  If this Pi has a firewall, allow TCP port $1 through it so other devices can reach"
    echo "  the slideshow and the admin panel. With ufw: sudo ufw allow $1/tcp"
  else
    echo "  A remote display only connects out to its server, so it needs no incoming port."
  fi
}

# Rules loaded by something other than ufw or firewalld: an nftables input chain that drops
# or has rules, or iptables INPUT rules (an empty, accept-everything chain doesn't count)
other_firewall_rules() {
  local rules=""
  if command -v nft >/dev/null; then
    rules=$(nft list ruleset 2>/dev/null) || true
    if awk '
      /^[[:space:]]*chain .*\{/  { inchain = 1; hook = 0; drop = 0; count = 0; next }
      inchain && /hook input/    { hook = 1; if (/policy drop/) drop = 1; next }
      inchain && /^[[:space:]]*}/ { if (hook && (drop || count)) found = 1; inchain = 0; next }
      inchain && NF              { count++ }
      END { exit !found }' <<<"$rules"; then
      return 0
    fi
  fi
  if command -v iptables >/dev/null; then
    rules=$(iptables -S INPUT 2>/dev/null) || true
    if [ -n "$rules" ] && [ "$rules" != "-P INPUT ACCEPT" ]; then
      return 0
    fi
  fi
  return 1
}

# The port SSH listens on: socket activation's, else sshd's effective config; 22 if unknown
ssh_port_detected() {
  local port=""
  if systemctl is-active --quiet ssh.socket 2>/dev/null; then
    port=$(systemctl show -p Listen ssh.socket 2>/dev/null | grep -oE '[0-9]+ \(Stream\)' | head -n 1 | cut -d' ' -f1) || true
  fi
  if [ -z "$port" ]; then
    port=$(sshd -T 2>/dev/null | awk '$1 == "port" { print $2; exit }') || true
  fi
  [[ "$port" =~ ^[0-9]+$ ]] || port=22
  echo "$port"
}

ssh_running() {
  systemctl is-active --quiet ssh 2>/dev/null || systemctl is-active --quiet ssh.socket 2>/dev/null
}

# Is someone using SSH right now: this installer runs inside an SSH session, or anyone
# has an SSH connection open
ssh_in_use() {   # ssh_in_use <ssh port>
  local pid=$$ comm conns=""
  for _ in $(seq 30); do   # walk up at most 30 parent processes
    comm=$(ps -o comm= -p "$pid" 2>/dev/null) || break
    if [[ "$comm" == sshd* ]]; then
      return 0
    fi
    pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ') || break
    if [ -z "$pid" ] || [ "$pid" -le 1 ]; then
      break
    fi
  done
  conns=$(ss -Htn state established "( sport = :$1 )" 2>/dev/null) || true
  [ -n "$conns" ]
}

vnc_running() {
  local listening=""
  listening=$(ss -Hltn 2>/dev/null) || true
  [[ "$listening" == *":5900 "* ]] || systemctl is-active --quiet wayvnc 2>/dev/null
}

# Ask which ports to keep reachable, allow them, then turn ufw on. SSH is only opened if
# the user needs it, and always before the firewall starts blocking.
setup_ufw() {   # setup_ufw <slideshow port, or empty on a remote display>
  local port=$1 detected over_ssh="" ssh_port="" vnc_port="" rule failed="" undo=""
  local rules=()
  detected=$(ssh_port_detected)
  if ssh_in_use "$detected"; then
    over_ssh=1
  fi

  # SSH: only if it's needed. An SSH port nobody uses is better closed.
  echo ""
  if ssh_running; then
    echo "SSH (logging in from another computer) is turned on for this Pi, on port $detected."
  else
    echo "SSH (logging in from another computer) isn't turned on for this Pi."
  fi
  while true; do
    if ask_yes_no "Do you need SSH access to this Pi? (y/n): "; then
      ask_port "SSH port" "$detected"
      ssh_port=$PORT_ANSWER
      break
    fi
    if [ -z "$over_ssh" ]; then
      break
    fi
    echo "  ⚠ You're connected over SSH right now. This session keeps working, but once the"
    echo "    firewall is on, you won't be able to connect over SSH again."
    if ask_yes_no "Block SSH anyway? (y/n): "; then
      break
    fi
  done

  if [ -n "$port" ]; then
    ask_port "Slideshow port" "$port"
    port=$PORT_ANSWER
  fi

  if vnc_running; then
    if ask_yes_no "Remote desktop (VNC) is running. Do you need remote desktop access? (y/n): "; then
      ask_port "VNC port" 5900
      vnc_port=$PORT_ANSWER
    fi
  fi

  # Over SSH, the firewall must turn itself off again if the user can't get back in
  if [ -n "$over_ssh" ] && [ -n "$ssh_port" ] && ! command -v systemd-run >/dev/null; then
    echo "  Can't set up the automatic undo that protects your SSH access, so the firewall"
    echo "  wasn't set up. Run the installer from the Pi's own screen and keyboard instead."
    return 0
  fi

  echo ""
  echo "▸ Setting up the ufw firewall..."
  if ! command -v ufw >/dev/null && ! apt-get install -y -qq ufw; then
    echo "  Couldn't install ufw, so nothing was changed."
    firewall_reminder "$port"
    return 0
  fi

  # Existing ufw rules are kept; these are added to them
  if [ -n "$ssh_port" ]; then rules+=("$ssh_port/tcp"); fi
  if [ -n "$vnc_port" ]; then rules+=("$vnc_port/tcp"); fi
  if [ -n "$port" ]; then rules+=("$port/tcp"); fi
  rules+=("5353/udp")   # mDNS, so <hostname>.local keeps working
  for rule in "${rules[@]}"; do
    ufw allow "$rule" >/dev/null || failed=1
  done
  ufw default deny incoming >/dev/null || failed=1
  ufw default allow outgoing >/dev/null || failed=1
  if [ -n "$failed" ]; then
    echo "  Couldn't add the firewall rules, so the firewall wasn't turned on."
    return 0
  fi

  if [ -n "$over_ssh" ] && [ -n "$ssh_port" ]; then
    systemctl stop "$FIREWALL_UNDO_UNIT.timer" >/dev/null 2>&1 || true
    if ! systemd-run --quiet --unit="$FIREWALL_UNDO_UNIT" --on-active=3min "$(command -v ufw)" disable >/dev/null 2>&1; then
      echo "  Couldn't set up the automatic undo that protects your SSH access, so the firewall"
      echo "  wasn't turned on. Its rules are ready: turn it on from the Pi itself with: sudo ufw enable"
      return 0
    fi
    undo=1
  fi

  if ! ufw --force enable >/dev/null; then
    ufw disable >/dev/null 2>&1 || true
    if [ -n "$undo" ]; then systemctl stop "$FIREWALL_UNDO_UNIT.timer" >/dev/null 2>&1 || true; fi
    echo "  Couldn't turn the firewall on, so it was left off."
    return 0
  fi

  if [ -n "$undo" ]; then
    echo ""
    echo "The firewall is on. Check you can still log in: open a NEW SSH connection to this Pi"
    echo "(port $ssh_port) and keep this one open. If there's no yes within 3 minutes, the"
    echo "firewall turns itself off again, so you can't be locked out."
    if ask_yes_in_time 170 "Could you log in over a new SSH connection? (y/n): "; then
      systemctl stop "$FIREWALL_UNDO_UNIT.timer" >/dev/null 2>&1 || true
    else
      echo ""
      ufw disable >/dev/null 2>&1 || true
      systemctl stop "$FIREWALL_UNDO_UNIT.timer" >/dev/null 2>&1 || true
      echo "  The firewall was turned off again (its rules are kept). Check the SSH port, then"
      echo "  run the installer again, or turn the firewall on with: sudo ufw enable"
      return 0
    fi
  fi

  echo "  ✓ The firewall is on, and starts with the Pi. Incoming connections are blocked except:"
  ufw status 2>/dev/null | sed -n '/^--/,$p' | sed '1d; s/^/      /'
  echo "  To see it later: sudo ufw status. To turn it off: sudo ufw disable"
}
