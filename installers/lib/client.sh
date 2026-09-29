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
#   AUTOSTART_FILE, OLD_CLIENT_KIOSK, INSTALL_DIR, ROLE, PLATFORM, DESKTOP_USER (install.sh, ui.sh)
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
