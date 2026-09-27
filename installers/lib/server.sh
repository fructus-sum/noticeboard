# shellcheck shell=bash
# installers/lib/server.sh — setting up a server Pi (server + display)
#
# Responsibilities
#   System packages and Node.js, the install folder (a clone, or the chosen branch fetched and
#   checked out), dependencies and the build, the first config.json, .env, the branch setting and
#   update status, the service, the kiosk start-up, the Help shortcut, the update timer and path
#   units, and last the installer record. Then the summary.
#
# Provides
#   install_server, summary_server
#   write_service, write_update_units   the systemd units (compared with tests/fixtures/installer-golden)
#   save_branch_setting                 data/update-branch.env (only if the branch changed) and
#                                       data/update-status.json
#   write_installer_record              data/installer.json, written last: a run that stopped
#                                       part way doesn't count
#   fetch_branch <owner> <branch>
#
# Used by
#   install.sh main()
#
# Uses
#   system.sh, branch.sh, json.sh, kiosk.sh (write_server_kiosk), desktop.sh, ui.sh (banner);
#   the configuration in install.sh (INSTALL_DIR, INSTALL_BRANCH, the unit file paths, ...)
#
# Change impact
#   The units, .env, installer.json and update-status.json are read by systemd, update.sh and
#   the server on every Pi: their names and formats must not change (CURRENT_SYSTEM_DESIGN §6).
#   Changing what's written here that updates can't change means raising INSTALLER_VERSION.

install_server() {
  echo "Install directory : $INSTALL_DIR"
  echo "Service user      : $DESKTOP_USER"
  echo ""

  # ── System packages ─────────────────────────────────────────────────────────
  update_system
  echo "▸ Installing system packages..."
  apt-get install -y -qq git ffmpeg "$(chromium_package)" curl

  # ── Node.js 20 LTS via NodeSource, when the Pi's is missing or too old ──────
  if ! node_new_enough; then
    echo "▸ Installing Node.js 20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
    apt-get install -y -qq nodejs
  fi
  if ! node_new_enough; then
    echo "ERROR: Node.js $(node -v 2>/dev/null || echo "isn't installed") is too old for Noticeboard,"
    echo "which needs 20.19 or newer (see system-requirements.json). Update Node.js, then run the installer again."
    exit 1
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
  cd "$INSTALL_DIR" || exit 1
  npm install --silent

  echo "▸ Building display and admin SPAs..."
  npm run build --silent

  echo "▸ Removing dev dependencies..."
  npm prune --omit=dev --silent

  # ── First-run: generate data/config.json ────────────────────────────────────
  mkdir -p "$INSTALL_DIR/data"
  if [ ! -f "$INSTALL_DIR/data/config.json" ]; then
    echo "▸ Generating initial config.json..."
    cd "$INSTALL_DIR" || exit 1
    node -e "
      require('./server/services/configService').init()
        .then(() => { console.log('  config.json created'); process.exit(0); })
        .catch(e => { console.error(e.message); process.exit(1); })
    "
  fi

  # ── .env (the service's environment; noticeboard.service needs the file) ───────
  # An older install's file keeps its NODE_ENV=production line, which nothing reads any more
  if [ ! -f "$INSTALL_DIR/.env" ]; then
    cat > "$INSTALL_DIR/.env" <<ENV
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
  # The guide ships with the app, so the shortcut works even while the server is down
  write_help_shortcut "file://$INSTALL_DIR/noticeboard-guide.html"

  # Fix ownership
  chown -R "$DESKTOP_USER:$DESKTOP_USER" "$INSTALL_DIR"

  # ── Auto-update ─────────────────────────────────────────────────────────────
  echo "▸ Installing auto-update timer..."
  write_update_units
  systemctl daemon-reload
  systemctl enable --now "${SERVICE_NAME}-update.timer" --quiet
  systemctl enable --now "${SERVICE_NAME}-update.path" --quiet
  echo "  Checks GitHub for updates every 15 minutes, and straight away after a branch switch."

  write_installer_record
}

# What this installer run set up, so the admin panel can tell when a newer version needs the
# installer run again (see "installer" in system-requirements.json). Written last: a run that
# stopped part way doesn't count.
write_installer_record() {
  local commit
  commit=$(git -c safe.directory="$INSTALL_DIR" -C "$INSTALL_DIR" rev-parse HEAD 2>/dev/null || true)
  printf '{"version":%s,"branch":"%s","commit":"%s","time":"%s"}\n' \
    "$INSTALLER_VERSION" "$INSTALL_BRANCH" "$commit" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    > "$INSTALL_DIR/data/installer.json"
  chown "$DESKTOP_USER:$DESKTOP_USER" "$INSTALL_DIR/data/installer.json" 2>/dev/null || true
}

# Download a branch from GitHub, as the install folder's owner
fetch_branch() {   # fetch_branch <owner> <branch>
  runuser -u "$1" -- git -C "$INSTALL_DIR" fetch --quiet --no-tags origin "+refs/heads/$2:refs/remotes/origin/$2"
}

# Record the branch this installed, for update.sh and the admin panel's Software updates card
save_branch_setting() {
  # Only when the branch changed: the file also remembers where main was at the switch (update.sh)
  local current
  current=$(read_branch_setting)
  if [ "$INSTALL_BRANCH" != "${current:-main}" ]; then
    write_branch_setting "$INSTALL_BRANCH"
  fi
  local commit
  commit=$(git -c safe.directory="$INSTALL_DIR" -C "$INSTALL_DIR" rev-parse HEAD)
  write_json "$INSTALL_DIR/data/update-status.json" state updated branch "$INSTALL_BRANCH" commit "$commit" \
    message "Installed ${commit:0:7} from $INSTALL_BRANCH with the installer." time "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
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
  banner "Installation complete"
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
