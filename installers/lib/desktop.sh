# shellcheck shell=bash
# installers/lib/desktop.sh — entries for the desktop
#
# Provides
#   write_autostart <command>      starts the kiosk when the desktop starts
#   write_help_shortcut <url>      a "Noticeboard Help" link on the desktop user's desktop
#
# Used by
#   client.sh
#
# Uses
#   AUTOSTART_FILE, DESKTOP_USER (install.sh)
#
# Change impact
#   Compared with tests/fixtures/installer-golden (autostart-*.desktop, help-*.desktop).

# XDG autostart entry (works with LXDE, labwc, GNOME and most Raspberry Pi OS desktops)
write_autostart() {
  cat > "$AUTOSTART_FILE" <<DESK
[Desktop Entry]
Name=Noticeboard Kiosk
Exec=$1
Type=Application
X-GNOME-Autostart-enabled=true
DESK
}

# A "Noticeboard Help" shortcut on the desktop user's desktop, opening the user guide in the
# browser. Nothing needs logging in to read it.
write_help_shortcut() {   # write_help_shortcut <url>
  local home desktop file
  home=$(getent passwd "$DESKTOP_USER" 2>/dev/null | cut -d: -f6) || true
  if [ -z "$home" ] || [ ! -d "$home" ]; then
    return 0
  fi
  desktop=$(runuser -u "$DESKTOP_USER" -- xdg-user-dir DESKTOP 2>/dev/null || true)
  if [ -z "$desktop" ] || [ "$desktop" = "$home" ]; then
    desktop="$home/Desktop"
  fi
  mkdir -p "$desktop"
  file="$desktop/noticeboard-help.desktop"
  cat > "$file" <<DESK
[Desktop Entry]
Type=Link
Name=Noticeboard Help
Comment=The Noticeboard user guide
Icon=help-browser
URL=$1
DESK
  chown "$DESKTOP_USER:" "$desktop" "$file" 2>/dev/null || true
  chmod 755 "$file"
  echo "  Added a Noticeboard Help shortcut to the desktop."
}
