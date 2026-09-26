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
GITHUB_REPO="fructus-sum/noticeboard"
REPO_URL="https://github.com/${GITHUB_REPO}.git"
INSTALL_DIR="/opt/noticeboard"
SERVICE_NAME="noticeboard"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
UPDATE_SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}-update.service"
UPDATE_TIMER_FILE="/etc/systemd/system/${SERVICE_NAME}-update.timer"
UPDATE_PATH_FILE="/etc/systemd/system/${SERVICE_NAME}-update.path"
BRANCH_FILE="$INSTALL_DIR/data/update-branch.env"   # the branch chosen in the admin panel (see update.sh)
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

  use_latest_installer "$@"

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
  if [ "$MODE" = server ]; then
    choose_branch
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
  # Optional, and never allowed to stop the installer before the reboot prompt
  check_firewall || echo "  The firewall step ran into a problem; nothing more was changed."
  offer_reboot
}

# ── Latest installer ──────────────────────────────────────────────────────────
# Whatever copy was started (an old one on the Pi, or GitHub's main/ link, which can
# serve a stale copy for a few minutes after a push), switch to the installer from
# main's latest commit. A link pinned to a commit is never stale. If GitHub can't be
# reached, carry on with this copy. To run a local copy as it is (e.g. to test changes):
#   sudo NOTICEBOARD_INSTALLER_SHA=local bash installers/install.sh
use_latest_installer() {
  if [ -n "${NOTICEBOARD_INSTALLER_SHA:-}" ]; then
    return 0
  fi
  local sha file
  if ! sha=$(curl -fsSL --max-time 20 -H 'Accept: application/vnd.github.sha' \
               "https://api.github.com/repos/$GITHUB_REPO/commits/main") \
     || [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Couldn't check GitHub for a newer installer; carrying on with this one."
    return 0
  fi
  file=$(mktemp /tmp/noticeboard-install.XXXXXX)
  if ! curl -fsSL --max-time 60 -o "$file" \
         "https://raw.githubusercontent.com/$GITHUB_REPO/$sha/installers/install.sh" \
     || ! bash -n "$file"; then
    rm -f "$file"
    echo "Couldn't download the latest installer; carrying on with this one."
    return 0
  fi
  echo "Running the latest installer (${sha:0:7})..."
  export NOTICEBOARD_INSTALLER_SHA="$sha"
  exec bash "$file" "$@"
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

# A server Pi follows main unless another branch was chosen in the admin panel
# (Settings → Software updates). A re-run offers to keep that branch or go back to main.
INSTALL_BRANCH=main

choose_branch() {
  local current
  current=$(sed -n 's/^NOTICEBOARD_BRANCH=//p' "$BRANCH_FILE" 2>/dev/null | head -n 1 || true)
  if [ -z "$current" ] || [ "$current" = main ]; then
    return
  fi
  if [[ ! "$current" =~ ^[A-Za-z0-9._/-]{1,100}$ ]]; then
    echo "The branch setting \"$current\" isn't valid, so this installs main."
    return
  fi

  echo ""
  echo "This noticeboard follows the branch \"$current\" (chosen in Settings → Software updates)."
  echo "  1) Keep $current"
  echo "  2) Go back to main, the stable version"
  while true; do
    ask "Choose 1 or 2 [1]: "
    case "${REPLY:-1}" in
      1) INSTALL_BRANCH=$current; return ;;
      2) INSTALL_BRANCH=main; return ;;
      *) echo "Please type 1 or 2." ;;
    esac
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
  update_system
  echo "▸ Installing system packages..."
  apt-get install -y -qq git ffmpeg "$(chromium_package)" curl

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
    echo "▸ Updating existing installation ($INSTALL_BRANCH)..."
    lock_install_dir
    # This installs the branch the admin panel asked for, so its pending request is done
    rm -f "$INSTALL_DIR/tmp/update-request"
    # Run git as the folder's owner (git refuses repos owned by someone else), and
    # force the checkout so npm's edits to package-lock.json can't block the update
    local owner
    owner=$(stat -c %U "$INSTALL_DIR")
    if ! fetch_branch "$owner" "$INSTALL_BRANCH"; then
      if [ "$INSTALL_BRANCH" = main ]; then
        echo "ERROR: Couldn't download main from GitHub. Check the internet connection and run the installer again."
        exit 1
      fi
      echo "  Couldn't download $INSTALL_BRANCH from GitHub, so this installs main instead."
      INSTALL_BRANCH=main
      if ! fetch_branch "$owner" main; then
        echo "ERROR: Couldn't download main from GitHub. Check the internet connection and run the installer again."
        exit 1
      fi
    fi
    runuser -u "$owner" -- git -C "$INSTALL_DIR" checkout --quiet --force -B "$INSTALL_BRANCH" "origin/$INSTALL_BRANCH"
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

  save_branch_setting

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
  systemctl enable --now "${SERVICE_NAME}-update.path" --quiet
  echo "  Checks GitHub for updates every 15 minutes, and straight away after a branch switch."
}

# Download a branch from GitHub, as the install folder's owner
fetch_branch() {   # fetch_branch <owner> <branch>
  runuser -u "$1" -- git -C "$INSTALL_DIR" fetch --quiet --no-tags origin "+refs/heads/$2:refs/remotes/origin/$2"
}

# Record the branch this installed, for update.sh and the admin panel's Software updates card
save_branch_setting() {
  # Only when the branch changed: the file also remembers where main was at the switch (update.sh)
  local current
  current=$(sed -n 's/^NOTICEBOARD_BRANCH=//p' "$BRANCH_FILE" 2>/dev/null | head -n 1 || true)
  if [ "$INSTALL_BRANCH" != "${current:-main}" ]; then
    printf 'NOTICEBOARD_BRANCH=%s\n' "$INSTALL_BRANCH" > "$BRANCH_FILE"
  fi
  local commit
  commit=$(git -c safe.directory="$INSTALL_DIR" -C "$INSTALL_DIR" rev-parse HEAD)
  printf '{"state":"updated","branch":"%s","commit":"%s","message":"Installed %s from %s with the installer.","time":"%s"}\n' \
    "$INSTALL_BRANCH" "$commit" "${commit:0:7}" "$INSTALL_BRANCH" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    > "$INSTALL_DIR/data/update-status.json"
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
# Noticeboard kiosk — auto-generated by installer. See what it did: journalctl -t noticeboard-kiosk
URL=http://localhost:3000/
# The kiosk browser has a profile of its own, so a browser opened from the desktop (e.g. for
# the admin panel) is an ordinary window, never part of the full-screen kiosk
PROFILE="$HOME/.config/noticeboard-kiosk"
log() { logger -t noticeboard-kiosk "$*" 2>/dev/null || true; }

# Newer Raspberry Pi OS calls the browser chromium; older releases chromium-browser
BROWSER=$(command -v chromium-browser || command -v chromium || true)
if [ -z "$BROWSER" ]; then
  log "Chromium isn't installed; run the Noticeboard installer again"
  exit 1
fi
FLAGS=(--noerrdialogs --disable-infobars --disable-session-crashed-bubble
       --disable-component-update --check-for-update-interval=31536000
       --no-first-run --no-default-browser-check --disable-search-engine-choice-screen
       --password-store=basic --user-data-dir="$PROFILE")

# Opening the browser before the server answers would leave it on an error page
wait_for_server() {
  log "Waiting for the server at $URL"
  until curl -sf "$URL" >/dev/null 2>&1; do
    sleep 2
  done
}
wait_for_server

# Disable display blanking and power management (X11 desktops; ignored under Wayland)
xset s off    2>/dev/null || true
xset -dpms    2>/dev/null || true
xset s noblank 2>/dev/null || true

# Hide the mouse cursor after 1 second of inactivity (requires unclutter)
command -v unclutter >/dev/null 2>&1 && unclutter -idle 1 -root &

# The exit button in the viewer's top-right corner asks the server; the answer is for this
# device only, so other screens are never affected
exit_requested() {
  [ "$(curl -s -X POST --max-time 3 "${URL}api/device/kiosk-exit/claim" 2>/dev/null)" = '{"exit":true}' ]
}

# Close the full-screen browser, open the viewer in an ordinary window of the desktop's own
# browser, and stop. This screen goes back to kiosk mode the next time it starts up.
leave_kiosk() {
  log "Leaving kiosk mode, as asked on this screen; opening a normal browser window"
  kill "$1" 2>/dev/null
  wait "$1" 2>/dev/null
  sleep 1
  nohup "$BROWSER" --no-first-run "${URL}?kiosk=off" >/dev/null 2>&1 &
  exit 0
}

# Keep the browser running: if it ever exits or crashes, start it again. To leave the kiosk,
# use the exit button in the viewer's top-right corner (move the mouse to show it).
while true; do
  log "Starting $BROWSER"
  "$BROWSER" "${FLAGS[@]}" --kiosk "$URL" &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    sleep 3
    if exit_requested; then
      leave_kiosk "$pid"
    fi
  done
  wait "$pid"
  log "Browser exited (code $?); starting it again"
  sleep 5
  wait_for_server
done
KIOSK
}

# Runs installers/update.sh every 15 minutes as the app's user (no root needed), and
# straight away when the admin panel asks for a branch switch (it writes tmp/update-request)
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
TimeoutStartSec=60min
SVC

  cat > "$UPDATE_PATH_FILE" <<PATHUNIT
[Unit]
Description=Start a Noticeboard update when the admin panel asks for one

[Path]
PathExists=$INSTALL_DIR/tmp/update-request
Unit=${SERVICE_NAME}-update.service

[Install]
WantedBy=paths.target
PATHUNIT

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
  local local_ip port
  local_ip=$(hostname -I | awk '{print $1}')
  port=$(slideshow_port)
  echo ""
  echo "╔══════════════════════════════════════════════╗"
  echo "║            Installation complete             ║"
  echo "╚══════════════════════════════════════════════╝"
  echo ""
  echo "  Admin panel  :  http://${local_ip}:${port}/admin"
  echo "  Display      :  http://${local_ip}:${port}/"
  echo ""
  echo "  Default password: Admin@12345"
  echo "  ⚠  Change this immediately after first login."
  if [ -n "$SUDO_STATUS" ]; then
    echo "  $SUDO_STATUS"
  fi
  echo ""
  echo "  Service logs : sudo journalctl -u noticeboard -f"
  echo "  Auto-update  : every 15 minutes (logs: journalctl -u noticeboard-update)"
  echo "  Branch       : $INSTALL_BRANCH (change it in the admin panel: Settings → Software updates)"
}

# ── Remote display ────────────────────────────────────────────────────────────
install_display() {
  echo "Server URL: $SERVER_URL"
  echo ""

  # ── System packages ─────────────────────────────────────────────────────────
  update_system
  echo "▸ Installing packages..."
  apt-get install -y -qq "$(chromium_package)" curl
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
# Noticeboard remote display kiosk — auto-generated by installer. See what it did: journalctl -t noticeboard-kiosk
SERVER_URL="${SERVER_URL}"
MACS_HTML="${MACS_HTML}"
PAGE=/tmp/noticeboard-waiting.html
# The waiting page runs in its own browser profile, so it can't hand over to the real one
WAITING_PROFILE=/tmp/noticeboard-waiting-profile
# So does the kiosk itself, so a browser opened from the desktop is an ordinary window
KIOSK_PROFILE="\$HOME/.config/noticeboard-kiosk"
log() { logger -t noticeboard-kiosk "\$*" 2>/dev/null || true; }

# Newer Raspberry Pi OS calls the browser chromium; older releases chromium-browser
BROWSER=\$(command -v chromium-browser || command -v chromium || true)
if [ -z "\$BROWSER" ]; then
  log "Chromium isn't installed; run the Noticeboard installer again"
  exit 1
fi
FLAGS=(--noerrdialogs --disable-infobars --disable-session-crashed-bubble
       --disable-component-update --check-for-update-interval=31536000
       --no-first-run --no-default-browser-check --disable-search-engine-choice-screen
       --password-store=basic)

# Disable display blanking
xset s off    2>/dev/null || true
xset -dpms    2>/dev/null || true
xset s noblank 2>/dev/null || true
command -v unclutter >/dev/null 2>&1 && unclutter -idle 1 -root &

# The local page shown until the server answers: this Pi's MAC address and why it's waiting.
# It reloads itself every 10 s, so rewriting the file changes what's on screen.
write_page() {   # write_page <heading> <note>
  cat > "\$PAGE" <<HTML
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="10">
  <title>Noticeboard display</title>
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
</head>
<body>
  <div class="box">
    <p class="heading">\$1</p>
    <table>\$MACS_HTML</table>
    <p class="note">\$2</p>
  </div>
</body>
</html>
HTML
}

WAITING_PID=""
stop_waiting_page() {
  if [ -n "\$WAITING_PID" ]; then
    kill "\$WAITING_PID" 2>/dev/null
    wait "\$WAITING_PID" 2>/dev/null
    WAITING_PID=""
    sleep 2
  fi
}

# Show the noticeboard as soon as the server answers, and until then the local page, checking
# every 10 s. Nobody needs to restart this display: not while it waits for approval, not while
# the server is down or restarting, and not if the browser exits or crashes.
while true; do
  STATE=""
  while true; do
    HTTP_CODE=\$(curl -o /dev/null -s -w "%{http_code}" --max-time 10 "\$SERVER_URL" 2>/dev/null || echo "000")
    [ "\$HTTP_CODE" = "200" ] && break
    if [ "\$HTTP_CODE" = "404" ]; then NEW=approval; else NEW=server; fi
    if [ "\$NEW" != "\$STATE" ]; then
      STATE=\$NEW
      if [ "\$STATE" = approval ]; then
        write_page "This display is waiting for MAC address approval" \\
          "Give the MAC address above to your Noticeboard admin.<br>The noticeboard appears by itself once this display is approved."
      else
        write_page "Waiting for the Noticeboard server at \$SERVER_URL" \\
          "Checking every 10 seconds.<br>The noticeboard appears by itself as soon as the server answers."
      fi
      log "Server answered HTTP \$HTTP_CODE (000 = unreachable); showing the waiting page (\$STATE)"
    fi
    if [ -z "\$WAITING_PID" ] || ! kill -0 "\$WAITING_PID" 2>/dev/null; then
      "\$BROWSER" "\${FLAGS[@]}" --user-data-dir="\$WAITING_PROFILE" --kiosk "file://\$PAGE" &
      WAITING_PID=\$!
    fi
    sleep 10
  done
  stop_waiting_page
  log "Server \$SERVER_URL answered; starting \$BROWSER"
  "\$BROWSER" "\${FLAGS[@]}" --user-data-dir="\$KIOSK_PROFILE" --kiosk "\$SERVER_URL" &
  pid=\$!
  # The exit button in the viewer's top-right corner asks the server; the answer is for this
  # device only. Then: an ordinary browser window, and no more kiosk until the next start-up.
  while kill -0 "\$pid" 2>/dev/null; do
    sleep 3
    if [ "\$(curl -s -X POST --max-time 3 "\$SERVER_URL/api/device/kiosk-exit/claim" 2>/dev/null)" = '{"exit":true}' ]; then
      log "Leaving kiosk mode, as asked on this screen; opening a normal browser window"
      kill "\$pid" 2>/dev/null
      wait "\$pid" 2>/dev/null
      sleep 1
      nohup "\$BROWSER" --no-first-run "\$SERVER_URL/?kiosk=off" >/dev/null 2>&1 &
      exit 0
    fi
  done
  wait "\$pid"
  log "Browser exited (code \$?); starting it again"
  sleep 5
done
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
}

# ── Shared ────────────────────────────────────────────────────────────────────
# The port the server listens on, read the way the server reads it; 3000 if that fails
slideshow_port() {
  local port=""
  port=$(cd "$INSTALL_DIR" 2>/dev/null && node -e "require('./server/utils/configIO').readConfig('data/config.json')
    .then((c) => console.log(c.port || 3000), () => console.log(3000))" 2>/dev/null) || true
  [[ "$port" =~ ^[0-9]+$ ]] || port=3000
  echo "$port"
}

# ── Firewall (optional) ───────────────────────────────────────────────────────
# The last step before the reboot. Many Pis already have a firewall set up the way their
# owner wants, so nothing is installed or changed without a yes. Setting one up uses ufw,
# the firewall Raspberry Pi's documentation recommends, and only opens the ports the user
# confirms, allowing SSH before anything could block it.
FIREWALL_UNDO_UNIT="noticeboard-firewall-undo"   # turns ufw off again unless the user confirms SSH works
PORT_ANSWER=""

ask_yes_no() {   # ask_yes_no "<question> (y/n): " succeeds on y; asks again until y or n
  while true; do
    ask "$1"
    case "$REPLY" in
      [Yy]*) return 0 ;;
      [Nn]*) return 1 ;;
      *) echo "Please type y or n." ;;
    esac
  done
}

ask_port() {   # ask_port "<name>" <default> sets PORT_ANSWER; Enter keeps the default
  while true; do
    ask "$1 [$2]: "
    PORT_ANSWER="${REPLY:-$2}"
    if [[ "$PORT_ANSWER" =~ ^[0-9]{1,5}$ ]] && [ "$((10#$PORT_ANSWER))" -ge 1 ] && [ "$((10#$PORT_ANSWER))" -le 65535 ]; then
      PORT_ANSWER=$((10#$PORT_ANSWER))
      return 0
    fi
    echo "Please type a port number from 1 to 65535."
  done
}

# Waits at most <seconds>; fails on no, or if nobody answers in time
ask_yes_in_time() {   # ask_yes_in_time <seconds> "<question>"
  read -r -t "$1" -p "$2" REPLY </dev/tty && [[ "$REPLY" == [Yy]* ]]
}

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
# The kiosk only starts when the desktop starts, so finish by offering to reboot
offer_reboot() {
  echo ""
  ask "Reboot now to start the display? (Y/n): "
  case "$REPLY" in
    [Nn]*) echo "Reboot later with: sudo reboot"; echo "" ;;
    *)     echo "Rebooting..."; systemctl reboot ;;
  esac
}

# Bring the Pi fully up to date before installing anything. dist-upgrade is apt-get's
# name for Raspberry Pi's recommended `apt full-upgrade`, which a plain upgrade isn't:
# that can hold back kernel and firmware updates. It keeps existing config files,
# never stops to ask, and waits if another update (e.g. the desktop's) holds the lock.
update_system() {
  local apt_opts=(-o DPkg::Lock::Timeout=300)
  echo "▸ Updating the package list..."
  apt-get "${apt_opts[@]}" update
  echo "▸ Upgrading installed packages (can take a while if the Pi hasn't been updated recently)..."
  DEBIAN_FRONTEND=noninteractive apt-get "${apt_opts[@]}" -y \
    -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold \
    dist-upgrade
}

# Newer Raspberry Pi OS ships Debian's chromium package; older releases called it
# chromium-browser. Keep the old name where apt still has it (on releases in between
# it just pulls in chromium); the kiosk scripts launch whichever command exists.
chromium_package() {
  if apt-cache show chromium-browser >/dev/null 2>&1; then
    echo chromium-browser
  else
    echo chromium
  fi
}

# XDG autostart entry (works with LXDE, labwc, GNOME and most Pi OS desktops)
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
