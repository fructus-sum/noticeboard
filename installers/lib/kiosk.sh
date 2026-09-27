# shellcheck shell=bash
# installers/lib/kiosk.sh — the kiosk scripts, from installers/kiosk/
#
# Responsibilities
#   The installed kiosk scripts are the templates in installers/kiosk/ as they are: server.sh
#   (the server Pi's start-kiosk.sh), and display.sh (a remote display's noticeboard-kiosk.sh)
#   with this Pi's server URL and MAC addresses filled into its SERVER_URL="" and MACS_HTML=""
#   lines. install.sh reads the templates when it loads its parts (KIOSK_TEMPLATE_server,
#   KIOSK_TEMPLATE_display).
#
# Provides
#   write_server_kiosk    → $INSTALL_DIR/start-kiosk.sh
#   write_display_kiosk   → $KIOSK_SCRIPT, from SERVER_URL and MACS_HTML
#
# Used by
#   server.sh, display.sh
#
# Change impact
#   Installed Pis only get a changed kiosk script when the installer runs again: a change to a
#   template needs INSTALLER_VERSION raised (and "installer" in system-requirements.json). The
#   server tells an older install by its kiosk script (services/updates/installerVersion.js
#   looks for "kiosk-exit"). Compared with tests/fixtures/installer-golden.

# shellcheck disable=SC2154  # KIOSK_TEMPLATE_* are read in by install.sh (load_modules_from)
write_server_kiosk() {
  printf '%s' "$KIOSK_TEMPLATE_server" > "$INSTALL_DIR/start-kiosk.sh"
}

write_display_kiosk() {
  local line
  while IFS= read -r line; do
    case "$line" in
      'SERVER_URL=""') printf 'SERVER_URL="%s"\n' "$SERVER_URL" ;;
      'MACS_HTML=""')  printf 'MACS_HTML="%s"\n' "$MACS_HTML" ;;
      *)               printf '%s\n' "$line" ;;
    esac
  done < <(printf '%s' "$KIOSK_TEMPLATE_display") > "$KIOSK_SCRIPT"
}
