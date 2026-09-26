#!/usr/bin/env bash
# install.sh
# Sets up a Raspberry Pi for Noticeboard. It asks what the Pi is for:
#   1) Server + display: runs the server and shows the slideshow on this Pi's screen
#   2) Remote display:   shows the slideshow from a server Pi elsewhere on the network
#
# Run with:  sudo bash installers/install.sh
#   or:      curl -fsSL https://raw.githubusercontent.com/fructus-sum/noticeboard/main/installers/install.sh | sudo bash
set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
REPO_URL="https://github.com/fructus-sum/noticeboard.git"
INSTALL_DIR="/opt/noticeboard"
SERVICE_NAME="noticeboard"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
UPDATE_SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}-update.service"
UPDATE_TIMER_FILE="/etc/systemd/system/${SERVICE_NAME}-update.timer"
KIOSK_SCRIPT="/usr/local/bin/noticeboard-kiosk.sh"
AUTOSTART_FILE="/etc/xdg/autostart/noticeboard-kiosk.desktop"
SUDOERS_BACKUP_DIR="/root/noticeboard-sudoers-backup"

# Everything runs from main(), called on the last line, so a half-downloaded
# script (curl | bash) runs nothing.
main() {
  # ── Root check ──────────────────────────────────────────────────────────────
  if [ "$EUID" -ne 0 ]; then
    echo "ERROR: Run this script with sudo."
    exit 1
  fi

  # Identify the desktop user (the one who invoked sudo)
  DESKTOP_USER="${SUDO_USER:-pi}"

  echo ""
  echo "╔══════════════════════════════════════════════╗"
  echo "║            Noticeboard installer             ║"
  echo "╚══════════════════════════════════════════════╝"
  echo ""

  if ! has_tty; then
    echo "ERROR: This installer asks questions, so run it from a terminal."
    exit 1
  fi

  choose_mode
  if [ "$MODE" = server ] && ! id "$DESKTOP_USER" >/dev/null 2>&1; then
    echo "ERROR: User '$DESKTOP_USER' not found. Run this with sudo from the Pi's desktop user."
    exit 1
  fi
  if [ "$MODE" = display ]; then
    ask_server_url
  fi

  check_sudo_password
  echo ""

  if [ "$MODE" = server ]; then
    install_server
    summary_server
  else
    install_display
    summary_display
  fi
}

# ── Questions ─────────────────────────────────────────────────────────────────
# Answers come from the keyboard, not stdin: under `curl … | sudo bash`, stdin is this script.
has_tty() { { true </dev/tty; } 2>/dev/null; }
ask() { read -rp "$1" REPLY </dev/tty; }

choose_mode() {
  # Default to whatever this Pi already runs, so a re-run only needs Enter
  local default=""
  if [ -d "$INSTALL_DIR/.git" ]; then
    default=1
  elif [ -f "$KIOSK_SCRIPT" ]; then
    default=2
  fi

  echo "What is this Pi for?"
  echo "  1) Server + display: stores the content, runs the admin panel, shows the slideshow here"
  echo "  2) Remote display:   shows the slideshow from a server Pi on your network"
  while true; do
    ask "Choose 1 or 2${default:+ [$default]}: "
    case "${REPLY:-$default}" in
      1) MODE=server;  return ;;
      2) MODE=display; return ;;
      *) echo "Please type 1 or 2." ;;
    esac
  done
}

ask_server_url() {
  # Offer the URL this Pi already uses, if it was set up before
  local current=""
  if [ -f "$KIOSK_SCRIPT" ]; then
    current=$(sed -n 's/^SERVER_URL="\(.*\)"$/\1/p' "$KIOSK_SCRIPT" | head -n 1)
  fi

  echo ""
  while true; do
    ask "Noticeboard server URL (e.g. http://192.168.1.10:3000)${current:+ [$current]}: "
    SERVER_URL="${REPLY:-$current}"
    SERVER_URL="${SERVER_URL%/}"   # strip trailing slash
    if [ -n "$SERVER_URL" ]; then
      return
    fi
    echo "The server URL is required."
  done
}

# ── sudo password ─────────────────────────────────────────────────────────────
# Raspberry Pi OS lets the desktop user run sudo without a password. Offer to make
# it ask for one. A change is only kept once the user's password is proven to work
# through sudo, so nobody can be locked out of sudo.
SUDO_STATUS=""

sudo_asks_password() {
  # -k ignores the password typed to start this installer; -n fails instead of asking
  ! runuser -u "$DESKTOP_USER" -- sudo -k -n true >/dev/null 2>&1
}

nopasswd_rule() {
  # Matches the rule Raspberry Pi OS adds: "<user> ALL=(ALL) NOPASSWD: ALL"
  awk -v u="$DESKTOP_USER" '$1 == u && /NOPASSWD:[[:space:]]*ALL[[:space:]]*$/ { found = 1 } END { exit !found }' "$1"
}

restore_sudoers() {
  local f
  for f in "$@"; do
    install -m 0440 -o root -g root "$SUDOERS_BACKUP_DIR/$(basename "$f")" "$f"
  done
}

check_sudo_password() {
  if [ "$DESKTOP_USER" = root ] || ! id "$DESKTOP_USER" >/dev/null 2>&1 || ! command -v sudo >/dev/null; then
    return 0
  fi

  echo ""
  if sudo_asks_password; then
    SUDO_STATUS="✓ sudo asks $DESKTOP_USER for a password"
    echo "  $SUDO_STATUS"
    return 0
  fi

  SUDO_STATUS="⚠ sudo does not ask $DESKTOP_USER for a password"
  echo "sudo on this Pi doesn't ask $DESKTOP_USER for a password, so anything running"
  echo "as $DESKTOP_USER can take full control of the Pi. Making it ask is safer."
  echo "You'll then need $DESKTOP_USER's password for commands that start with sudo."
  while true; do
    ask "Make sudo ask for a password? (y/n): "
    case "$REPLY" in
      [Yy]*) break ;;
      [Nn]*) echo "  sudo left as it is."; return 0 ;;
      *) echo "Please type y or n." ;;
    esac
  done

  if [ "$(passwd -S "$DESKTOP_USER" 2>/dev/null | awk '{print $2}')" != "P" ]; then
    echo "  $DESKTOP_USER has no password yet. Set one with: passwd"
    echo "  Then run this installer again. sudo left as it is."
    return 0
  fi

  # Find the files that let this user skip the password (normally 010_pi-nopasswd)
  local files=() f tmp
  for f in /etc/sudoers.d/*; do
    [ -f "$f" ] || continue
    case "$(basename "$f")" in *~|*.*) continue ;; esac   # sudo skips these names too
    if nopasswd_rule "$f"; then
      files+=("$f")
    fi
  done
  if [ ${#files[@]} -eq 0 ]; then
    echo "  Couldn't find the rule in /etc/sudoers.d that skips the password."
    echo "  sudo left as it is. To see where it comes from: sudo -l -U $DESKTOP_USER"
    return 0
  fi

  # Back up each file, comment the rule out in a copy, and only install a copy that visudo accepts
  mkdir -p "$SUDOERS_BACKUP_DIR"
  chmod 700 "$SUDOERS_BACKUP_DIR"
  for f in "${files[@]}"; do
    cp -p "$f" "$SUDOERS_BACKUP_DIR/$(basename "$f")"
  done
  for f in "${files[@]}"; do
    tmp=$(mktemp)
    awk -v u="$DESKTOP_USER" -v backup="$SUDOERS_BACKUP_DIR/$(basename "$f")" '
      $1 == u && /NOPASSWD:[[:space:]]*ALL[[:space:]]*$/ {
        print "# Disabled by the Noticeboard installer so sudo asks for a password."
        print "# The original file is saved at " backup
        print "# " $0
        next
      }
      { print }' "$f" > "$tmp"
    if ! visudo -cf "$tmp" >/dev/null 2>&1; then
      rm -f "$tmp"
      restore_sudoers "${files[@]}"
      echo "  The change didn't pass visudo's check, so sudo was left as it is."
      return 0
    fi
    install -m 0440 -o root -g root "$tmp" "$f"
    rm -f "$tmp"
  done
  if ! visudo -c >/dev/null 2>&1; then
    restore_sudoers "${files[@]}"
    echo "  The sudo settings didn't pass visudo's check, so sudo was left as it is."
    return 0
  fi

  # Prove the password works through sudo before keeping the change
  local password="" confirmed=""
  echo "  Type $DESKTOP_USER's password to confirm sudo accepts it."
  for _ in 1 2 3; do
    read -rsp "  Password for $DESKTOP_USER: " password </dev/tty || break
    echo ""
    if printf '%s\n' "$password" | runuser -u "$DESKTOP_USER" -- sudo -k -S -p '' true >/dev/null 2>&1; then
      confirmed=1
      break
    fi
    echo "  That password didn't work."
  done
  password=""
  if [ -z "$confirmed" ]; then
    restore_sudoers "${files[@]}"
    echo "  Couldn't confirm the password, so sudo was left as it is."
    return 0
  fi

  if sudo_asks_password; then
    SUDO_STATUS="✓ sudo now asks $DESKTOP_USER for a password"
    echo "  $SUDO_STATUS"
    echo "  To undo:"
    for f in "${files[@]}"; do
      echo "    sudo cp $SUDOERS_BACKUP_DIR/$(basename "$f") $f"
    done
  else
    SUDO_STATUS="⚠ sudo still doesn't ask $DESKTOP_USER for a password (another rule allows it)"
    echo "  $SUDO_STATUS"
    echo "  To see where it comes from: sudo -l -U $DESKTOP_USER"
  fi
}

# ── Server + display ──────────────────────────────────────────────────────────
install_server() {
  echo "Install directory : $INSTALL_DIR"
  echo "Service user      : $DESKTOP_USER"
  echo ""

  # ── System packages ─────────────────────────────────────────────────────────
  echo "▸ Installing system packages..."
  apt-get update -qq
  apt-get install -y -qq git ffmpeg chromium-browser curl

  # ── Node.js 20 LTS via NodeSource ───────────────────────────────────────────
  local node_major=0
  if command -v node &>/dev/null; then
    node_major=$(node -e "process.stdout.write(process.version.slice(1).split('.')[0])")
  fi

  if [ "$node_major" -lt 18 ]; then
    echo "▸ Installing Node.js 20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
    apt-get install -y -qq nodejs
  fi

  echo "  Node.js $(node -v)  npm $(npm -v)"

  # ── Clone or update the repo ────────────────────────────────────────────────
  if [ -d "$INSTALL_DIR/.git" ]; then
    echo "▸ Updating existing installation..."
    lock_install_dir
    # Run git as the folder's owner (git refuses repos owned by someone else), and
    # force the checkout so npm's edits to package-lock.json can't block the update
    local owner
    owner=$(stat -c %U "$INSTALL_DIR")
    runuser -u "$owner" -- git -C "$INSTALL_DIR" fetch --quiet origin main
    runuser -u "$owner" -- git -C "$INSTALL_DIR" checkout --quiet --force -B main origin/main
  else
    echo "▸ Cloning repository..."
    git clone "$REPO_URL" "$INSTALL_DIR"
    lock_install_dir
  fi

  # ── Install dependencies + build SPAs ───────────────────────────────────────
  echo "▸ Installing Node dependencies..."
  cd "$INSTALL_DIR"
  npm install --silent

  echo "▸ Building display and admin SPAs..."
  npm run build --silent

  echo "▸ Removing dev dependencies..."
  npm prune --omit=dev --silent

  # ── First-run: generate data/config.json ────────────────────────────────────
  mkdir -p "$INSTALL_DIR/data"
  if [ ! -f "$INSTALL_DIR/data/config.json" ]; then
    echo "▸ Generating initial config.json..."
    cd "$INSTALL_DIR"
    node -e "
      require('./server/services/configService').init()
        .then(() => { console.log('  config.json created'); process.exit(0); })
        .catch(e => { console.error(e.message); process.exit(1); })
    "
  fi

  # ── Production .env ─────────────────────────────────────────────────────────
  if [ ! -f "$INSTALL_DIR/.env" ]; then
    cat > "$INSTALL_DIR/.env" <<ENV
NODE_ENV=production
SECURE_COOKIES=false
ENV
  fi

  # ── Systemd service ─────────────────────────────────────────────────────────
  echo "▸ Installing systemd service..."
  write_service

  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME" --quiet
  systemctl restart "$SERVICE_NAME"
  echo "  Service started."

  # ── Kiosk start script ──────────────────────────────────────────────────────
  echo "▸ Installing kiosk autostart..."
  write_server_kiosk
  chmod +x "$INSTALL_DIR/start-kiosk.sh"
  write_autostart "$INSTALL_DIR/start-kiosk.sh"

  # Fix ownership
  chown -R "$DESKTOP_USER:$DESKTOP_USER" "$INSTALL_DIR"

  # ── Optional: hide mouse cursor ─────────────────────────────────────────────
  apt-get install -y -qq unclutter 2>/dev/null || true

  # ── Auto-update ─────────────────────────────────────────────────────────────
  echo "▸ Installing auto-update timer..."
  write_update_units
  systemctl daemon-reload
  systemctl enable --now "${SERVICE_NAME}-update.timer" --quiet
  echo "  Checks GitHub for updates every 15 minutes."
}

# Hold the updater's lock (see update.sh) while this installer changes the install
# folder, so a scheduled update can't run at the same time. Released when the installer exits.
lock_install_dir() {
  mkdir -p "$INSTALL_DIR/tmp"
  touch "$INSTALL_DIR/tmp/update.lock"
  chown "$(stat -c %U "$INSTALL_DIR")" "$INSTALL_DIR/tmp" "$INSTALL_DIR/tmp/update.lock"
  exec 9>>"$INSTALL_DIR/tmp/update.lock"
  flock 9
}

write_service() {
  cat > "$SERVICE_FILE" <<SVC
[Unit]
Description=Noticeboard server
After=network.target

[Service]
Type=simple
User=$DESKTOP_USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SVC
}

write_server_kiosk() {
  cat > "$INSTALL_DIR/start-kiosk.sh" <<'KIOSK'
#!/usr/bin/env bash
# Wait for the noticeboard server to accept connections
until curl -sf http://localhost:3000/ >/dev/null 2>&1; do
  sleep 2
done

# Disable display blanking and power management
xset s off    2>/dev/null || true
xset -dpms    2>/dev/null || true
xset s noblank 2>/dev/null || true

# Hide the mouse cursor after 1 second of inactivity (requires unclutter)
command -v unclutter >/dev/null 2>&1 && unclutter -idle 1 -root &

exec chromium-browser \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-component-update \
  --check-for-update-interval=31536000 \
  --kiosk \
  http://localhost:3000/
KIOSK
}

# Runs installers/update.sh every 15 minutes as the app's user (no root needed)
write_update_units() {
  cat > "$UPDATE_SERVICE_FILE" <<SVC
[Unit]
Description=Noticeboard auto-update
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
User=$DESKTOP_USER
ExecStart=/bin/bash $INSTALL_DIR/installers/update.sh
TimeoutStartSec=30min
SVC

  cat > "$UPDATE_TIMER_FILE" <<TIMER
[Unit]
Description=Check GitHub for Noticeboard updates every 15 minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=15min
RandomizedDelaySec=60

[Install]
WantedBy=timers.target
TIMER
}

summary_server() {
  local local_ip
  local_ip=$(hostname -I | awk '{print $1}')
  echo ""
  echo "╔══════════════════════════════════════════════╗"
  echo "║            Installation complete             ║"
  echo "╚══════════════════════════════════════════════╝"
  echo ""
  echo "  Admin panel  :  http://${local_ip}:3000/admin"
  echo "  Display      :  http://${local_ip}:3000/"
  echo ""
  echo "  Default password: Admin@12345"
  echo "  ⚠  Change this immediately after first login."
  if [ -n "$SUDO_STATUS" ]; then
    echo "  $SUDO_STATUS"
  fi
  echo ""
  echo "  Service logs : sudo journalctl -u noticeboard -f"
  echo "  Auto-update  : every 15 minutes (logs: journalctl -u noticeboard-update)"
  echo ""
  echo "Reboot this Pi to start the kiosk display automatically."
  echo ""
}

# ── Remote display ────────────────────────────────────────────────────────────
install_display() {
  echo "Server URL: $SERVER_URL"
  echo ""

  # ── System packages ─────────────────────────────────────────────────────────
  echo "▸ Installing packages..."
  apt-get update -qq
  apt-get install -y -qq chromium-browser curl
  apt-get install -y -qq unclutter 2>/dev/null || true

  # ── Kiosk wrapper script ────────────────────────────────────────────────────
  echo "▸ Installing kiosk script..."

  # Collect this Pi's MAC addresses for the approval page
  MACS_HTML=""
  for iface_path in /sys/class/net/*/; do
    iface=$(basename "$iface_path")
    [ "$iface" = "lo" ] && continue
    mac=$(cat "$iface_path/address" 2>/dev/null || true)
    [ -z "$mac" ] || [ "$mac" = "00:00:00:00:00:00" ] && continue
    MACS_HTML="${MACS_HTML}<tr><td class='iface'>${iface}</td><td class='mac'>${mac}</td></tr>"
  done

  write_display_kiosk
  chmod +x "$KIOSK_SCRIPT"

  # ── XDG autostart ───────────────────────────────────────────────────────────
  echo "▸ Installing autostart entry..."
  write_autostart "$KIOSK_SCRIPT"
}

write_display_kiosk() {
  cat > "$KIOSK_SCRIPT" <<KIOSK
#!/usr/bin/env bash
# Noticeboard remote display kiosk — auto-generated by installer
SERVER_URL="${SERVER_URL}"

# Disable display blanking
xset s off    2>/dev/null || true
xset -dpms    2>/dev/null || true
xset s noblank 2>/dev/null || true
command -v unclutter >/dev/null 2>&1 && unclutter -idle 1 -root &

# Check whether this device is approved by the server
HTTP_CODE=\$(curl -o /dev/null -s -w "%{http_code}" --max-time 10 "\${SERVER_URL}" 2>/dev/null || echo "000")

if [ "\$HTTP_CODE" = "200" ]; then
  # Approved — launch display directly
  exec chromium-browser \\
    --noerrdialogs --disable-infobars --disable-session-crashed-bubble \\
    --disable-component-update --check-for-update-interval=31536000 \\
    --kiosk "\${SERVER_URL}"
fi

# Not yet approved — show a page with this device's MAC address.
# JavaScript in the page polls the server and redirects once approved.
TMPFILE=\$(mktemp /tmp/nb-pending.XXXXXX.html)
cat > "\$TMPFILE" <<'HTML'
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Waiting for approval</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0f172a; color: #e2e8f0;
      font-family: monospace;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh;
    }
    .box { text-align: center; padding: 2rem; }
    .heading { color: #94a3b8; font-size: 1rem; margin-bottom: 2rem; }
    table { margin: 0 auto; border-collapse: collapse; }
    .iface { color: #64748b; font-size: 0.85rem; padding: 4px 20px 4px 0; text-align: right; }
    .mac   { font-size: 1.6rem; letter-spacing: 0.08em; padding: 4px 0; }
    .note  { color: #475569; font-size: 0.8rem; margin-top: 2rem; line-height: 1.5; }
  </style>
  <script>
    var SERVER = "NOTICEBOARD_SERVER_URL_PLACEHOLDER";
    function poll() {
      fetch(SERVER, { method: "HEAD" })
        .then(function(r) {
          if (r.ok) { window.location.href = SERVER; }
          else { setTimeout(poll, 5000); }
        })
        .catch(function() { setTimeout(poll, 5000); });
    }
    setTimeout(poll, 5000);
  </script>
</head>
<body>
  <div class="box">
    <p class="heading">This display is waiting for MAC address approval</p>
    <table>
      MACS_PLACEHOLDER
    </table>
    <p class="note">
      Give the MAC address above to your Noticeboard admin.<br>
      This page will redirect automatically once approved.
    </p>
  </div>
</body>
</html>
HTML

# Substitute placeholders
sed -i "s|NOTICEBOARD_SERVER_URL_PLACEHOLDER|\${SERVER_URL}|g" "\$TMPFILE"
sed -i "s|MACS_PLACEHOLDER|${MACS_HTML}|g" "\$TMPFILE"

exec chromium-browser \\
  --noerrdialogs --disable-infobars --disable-session-crashed-bubble \\
  --disable-component-update --check-for-update-interval=31536000 \\
  --kiosk "file://\${TMPFILE}"
KIOSK
}

summary_display() {
  echo ""
  echo "╔══════════════════════════════════════════════╗"
  echo "║            Installation complete             ║"
  echo "╚══════════════════════════════════════════════╝"
  echo ""
  echo "  This Pi will display: $SERVER_URL"
  if [ -n "$SUDO_STATUS" ]; then
    echo "  $SUDO_STATUS"
  fi
  echo ""
  echo "  If MAC filtering is enabled on the server, the display will"
  echo "  show this device's MAC address until the admin approves it."
  echo ""
  echo "Reboot to start the kiosk automatically."
  echo ""
}

# ── Shared ────────────────────────────────────────────────────────────────────
# XDG autostart entry (works with LXDE, GNOME, and most Pi OS desktop environments)
write_autostart() {
  cat > "$AUTOSTART_FILE" <<DESK
[Desktop Entry]
Name=Noticeboard Kiosk
Exec=$1
Type=Application
X-GNOME-Autostart-enabled=true
DESK
}

main "$@"; exit
