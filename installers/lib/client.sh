# shellcheck shell=bash
# installers/lib/client.sh — setting up the Client: how a device shows the slideshow on its screen
#
# Responsibilities
#   The one Client of every role that has a screen (Client + Server, Client only; SYSTEM_DESIGN
#   §18.7): Chromium (and cage when headless), the Client's files (installers/client/) in
#   /opt/noticeboard-client/current/ with their version, the /usr/local/bin/noticeboard-client
#   launcher, and how it starts: the desktop's autostart, or noticeboard-kiosk.service (cage on
#   tty1) when headless. Also the Help shortcut on a desktop, the Server's address for a Client
#   only, removing the kiosks of installers before 0.9.0, and the summary.
#
# Provides
#   ask_server_url          → SERVER_URL (offers the saved one, or the old kiosk script's)
#   install_client          everything above
#   write_client_files      the Client's files and version into CLIENT_DIR
#   write_client_launcher   /usr/local/bin/noticeboard-client (compared with tests/fixtures/installer-golden)
#   write_kiosk_service     noticeboard-kiosk.service (compared with tests/fixtures/installer-golden)
#   write_client_update_units  a Client only's noticeboard-client-update.{service,timer} (golden too)
#   pin_server_key          a new Client only trusts its Server's key (noticeboard-client trust-server)
#   remove_old_kiosks       start-kiosk.sh and noticeboard-kiosk.sh of installers before 0.9.0
#   summary_client
#
# Used by
#   install.sh main()
#
# Uses
#   system.sh (update_system, chromium_package, is_raspberry_pi), desktop.sh (write_autostart,
#   write_help_shortcut), ui.sh (ask, banner, has_server), sudo.sh (SUDO_STATUS); the Client's files read in by install.sh
#   (CLIENT_FILES, CLIENT_FILE_<name>); CLIENT_DIR, CLIENT_LAUNCHER, KIOSK_SERVICE_FILE,
#   AUTOSTART_FILE, OLD_CLIENT_KIOSK, INSTALL_DIR, ROLE, PLATFORM, DESKTOP_USER, CLIENT_UPDATE_*_FILE,
#   SERVER_KEY_FILE, INSTALL_ENV_FILE (install.sh, ui.sh); server.sh (write_root_libs)
#
# Change impact
#   What's written here only changes on an installer run: changing it means raising
#   INSTALLER_VERSION. The launcher's path is in the autostart entry and the kiosk service.

ask_server_url() {
  if [ -n "${NOTICEBOARD_SERVER_URL:-}" ]; then
    SERVER_URL=${NOTICEBOARD_SERVER_URL%/}
    return
  fi
  # Offer the address this Client already uses: saved, or in an older installer's kiosk script
  local current=${SAVED_SERVER_URL:-}
  if [ -z "$current" ] && [ -f "$OLD_CLIENT_KIOSK" ]; then
    current=$(sed -n 's/^SERVER_URL="\(.*\)"$/\1/p' "$OLD_CLIENT_KIOSK" | head -n 1)
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

install_client() {
  if ! has_server; then
    update_system   # a Client + Server's was brought up to date by install_server
  fi
  echo "▸ Installing the Client (the slideshow on this device's screen)..."
  local packages=("$(chromium_package)" curl)
  if [ "$PLATFORM" = headless ]; then packages+=(cage); fi
  if ! has_server; then packages+=(openssl); fi   # a Client only checks its Server's signature
  apt-get install -y -qq "${packages[@]}"

  write_client_files
  write_client_launcher
  if [ "$PLATFORM" = headless ]; then
    rm -f "$AUTOSTART_FILE"
    write_kiosk_service
    systemctl daemon-reload
    systemctl enable noticeboard-kiosk --quiet
    echo "  The slideshow starts full screen on this device's screen when it starts up (cage)."
  else
    if [ -f "$KIOSK_SERVICE_FILE" ]; then
      systemctl disable noticeboard-kiosk --quiet 2>/dev/null || true
      rm -f "$KIOSK_SERVICE_FILE"
      systemctl daemon-reload
    fi
    write_autostart "$CLIENT_LAUNCHER kiosk"
    # The Server keeps the guide with the app, so its shortcut works even while the server is
    # down; a Client only opens its Server's copy (no login needed)
    if has_server; then
      write_help_shortcut "file://$INSTALL_DIR/noticeboard-guide.html"
    else
      write_help_shortcut "$SERVER_URL/admin/help"
    fi
  fi
  remove_old_kiosks
  # A Client only follows its Server (SYSTEM_DESIGN §18.7 phase 3): every 15 minutes, as root; a
  # Client + Server's screen is kept up to date with its Server instead (the system step)
  if ! has_server; then
    write_root_libs
    write_client_update_units
    systemctl daemon-reload
    systemctl enable --now noticeboard-client-update.timer --quiet
    echo "  Follows its Server's version by itself: noticeboard-client check, every 15 minutes."
  fi
}

# A Client only: noticeboard-client check every 15 minutes, as root
write_client_update_units() {
  cat > "$CLIENT_UPDATE_SERVICE_FILE" <<SVC
[Unit]
Description=Noticeboard Client: install the Client files its Server runs, when they change
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
ExecStart=$CLIENT_LAUNCHER check
TimeoutStartSec=20min
SVC

  cat > "$CLIENT_UPDATE_TIMER_FILE" <<TIMER
[Unit]
Description=Check the Noticeboard Server for new Client files every 15 minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=15min
RandomizedDelaySec=120

[Install]
WantedBy=timers.target
TIMER
}

# A new Client only trusts its Server's key (shown as a fingerprint, pinned after a yes), so it can
# check what it installs. Asked once, after the answers are saved; never with --apply.
pin_server_key() {
  if [ -s "$SERVER_KEY_FILE" ]; then
    return 0
  fi
  echo ""
  if ! NOTICEBOARD_CONFIG="$INSTALL_ENV_FILE" NOTICEBOARD_SERVER_KEY="$SERVER_KEY_FILE" NOTICEBOARD_CLIENT_DIR="$CLIENT_DIR" \
       "$CLIENT_LAUNCHER" trust-server; then
    echo "  This Client won't update itself until it trusts its Server: once the Server runs 0.9.0 or"
    echo "  newer and can be reached, run: sudo noticeboard-client trust-server"
  fi
}

# The Client's files as the installer has them (the same commit as the installer), and their version
write_client_files() {
  local name var
  mkdir -p "$CLIENT_DIR/current"
  for name in "${CLIENT_FILES[@]}"; do
    var="CLIENT_FILE_${name//[.-]/_}"
    printf '%s' "${!var}" > "$CLIENT_DIR/current/$name"
    chmod 755 "$CLIENT_DIR/current/$name"
  done
  printf '%s\n' "${NOTICEBOARD_INSTALLER_SHA:-local}" > "$CLIENT_DIR/version"
  chmod 755 "$CLIENT_DIR" "$CLIENT_DIR/current"
}

write_client_launcher() {
  cat > "$CLIENT_LAUNCHER" <<LAUNCHER
#!/usr/bin/env bash
# The Noticeboard Client's command, written by the installer: the Client's files are in
# $CLIENT_DIR/current (noticeboard-client kiosk | version)
exec "$CLIENT_DIR/current/noticeboard-client" "\$@"
LAUNCHER
  chmod 755 "$CLIENT_LAUNCHER"
}

# Headless: cage shows the kiosk full screen on tty1, as the display user, from start-up
write_kiosk_service() {
  cat > "$KIOSK_SERVICE_FILE" <<SVC
[Unit]
Description=Noticeboard kiosk (the slideshow full screen, without a desktop)
After=systemd-user-sessions.service network-online.target
Wants=network-online.target
Conflicts=getty@tty1.service

[Service]
User=$DESKTOP_USER
PAMName=login
TTYPath=/dev/tty1
TTYReset=yes
TTYVHangup=yes
TTYVTDisallocate=yes
StandardInput=tty-fail
StandardOutput=journal
StandardError=journal
UtmpIdentifier=tty1
UtmpMode=user
ExecStart=/usr/bin/cage -s -- $CLIENT_LAUNCHER kiosk
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SVC
}

# The kiosk scripts of installers before 0.9.0: the Client replaces them
remove_old_kiosks() {
  rm -f "$INSTALL_DIR/start-kiosk.sh" "$OLD_CLIENT_KIOSK"
}

summary_client() {
  echo ""
  if has_server; then
    echo "  This device shows the slideshow from its own Server on its screen."
  else
    echo "  This Client shows: $SERVER_URL"
    if [ -n "$SUDO_STATUS" ]; then
      echo "  $SUDO_STATUS"
    fi
    echo "  If MAC filtering is on at the Server, the screen shows this device's MAC address"
    echo "  until the admin approves it."
  fi
  if [ "$PLATFORM" = headless ]; then
    echo "  Headless: to stop the full-screen slideshow, run: sudo systemctl stop noticeboard-kiosk"
  fi
  if is_raspberry_pi && [ "$PLATFORM" != headless ]; then
    echo "  If the screen goes blank after a while, turn off Screen Blanking in"
    echo "  Raspberry Pi Configuration (or: sudo raspi-config → Display Options)."
  fi
}
