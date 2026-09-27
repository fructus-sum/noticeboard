# shellcheck shell=bash
# installers/lib/display.sh — setting up a remote display Pi
#
# Provides
#   ask_server_url      → SERVER_URL (offers the one this Pi already uses)
#   install_display     packages, the kiosk script with this Pi's MAC addresses, autostart, Help
#   collect_macs_html   → MACS_HTML, this Pi's MAC addresses as table rows
#   summary_display
#
# Used by
#   install.sh main()
#
# Uses
#   system.sh, kiosk.sh (write_display_kiosk), desktop.sh, ui.sh (ask, banner); KIOSK_SCRIPT
#   (install.sh)
#
# Change impact
#   ask_server_url reads the URL back from the installed kiosk script (its SERVER_URL line):
#   the kiosk template must keep that line's form.

install_display() {
  echo "Server URL: $SERVER_URL"
  echo ""

  # ── System packages ─────────────────────────────────────────────────────────
  update_system
  echo "▸ Installing packages..."
  apt-get install -y -qq "$(chromium_package)" curl

  # ── Kiosk wrapper script ────────────────────────────────────────────────────
  echo "▸ Installing kiosk script..."

  collect_macs_html

  write_display_kiosk
  chmod +x "$KIOSK_SCRIPT"

  # ── XDG autostart ───────────────────────────────────────────────────────────
  echo "▸ Installing autostart entry..."
  write_autostart "$KIOSK_SCRIPT"
  # The server serves the guide at /admin/help, with no login
  write_help_shortcut "$SERVER_URL/admin/help"
}

# This Pi's MAC addresses, as table rows for the kiosk's waiting page (for MAC approval)
collect_macs_html() {
  local iface_path iface mac
  MACS_HTML=""
  for iface_path in /sys/class/net/*/; do
    iface=$(basename "$iface_path")
    [ "$iface" = "lo" ] && continue
    mac=$(cat "$iface_path/address" 2>/dev/null || true)
    [ -z "$mac" ] || [ "$mac" = "00:00:00:00:00:00" ] && continue
    MACS_HTML="${MACS_HTML}<tr><td class='iface'>${iface}</td><td class='mac'>${mac}</td></tr>"
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

summary_display() {
  echo ""
  banner "Installation complete"
  echo ""
  echo "  This Pi will display: $SERVER_URL"
  if [ -n "$SUDO_STATUS" ]; then
    echo "  $SUDO_STATUS"
  fi
  echo ""
  echo "  If MAC filtering is enabled on the server, the display will"
  echo "  show this device's MAC address until the admin approves it."
}
