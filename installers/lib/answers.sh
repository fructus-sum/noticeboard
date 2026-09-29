# shellcheck shell=bash disable=SC2034  # SAVED_* are read by ui.sh and client.sh
# installers/lib/answers.sh — the installer's saved answers (/etc/noticeboard/install.env)
#
# Responsibilities
#   What this device was set up as, so a re-run offers the same answers and later steps (the
#   Client's kiosk, and from phase 2 of SYSTEM_DESIGN §18.7 the installer's --apply) can run
#   without asking. Only functions: loading it runs nothing.
#
# Provides
#   load_answers          → SAVED_ROLE, SAVED_PLATFORM, SAVED_SERVER_URL, SAVED_DISPLAY_USER (empty
#                           when there's no file: a device set up before 0.9.0, or a new one)
#   refuse_role_change    stops the installer, before anything changes, when a role was saved and
#                         another was chosen (changing roles is out of scope)
#   save_answers          writes ROLE, PLATFORM, SERVER_URL and DESKTOP_USER, in one step, root's, 644
#
# Used by
#   install.sh main()
#
# Uses
#   INSTALL_ENV_FILE (install.sh); ROLE, PLATFORM, SERVER_URL, DESKTOP_USER (ui.sh, client.sh)
#
# Change impact
#   The file is read by the Client's kiosk (installers/client/kiosk.sh: ROLE, SERVER_URL,
#   PLATFORM) on every start: its names and format (NOTICEBOARD_<NAME>=<value> lines) are a
#   contract with the Client files installed on each device.

SAVED_ROLE=""
SAVED_PLATFORM=""
SAVED_SERVER_URL=""
SAVED_DISPLAY_USER=""

saved_value() {   # saved_value <NAME>
  sed -n "s/^NOTICEBOARD_$1=//p" "$INSTALL_ENV_FILE" 2>/dev/null | head -n 1 || true
}

load_answers() {
  SAVED_ROLE=$(saved_value ROLE)
  SAVED_PLATFORM=$(saved_value PLATFORM)
  SAVED_SERVER_URL=$(saved_value SERVER_URL)
  SAVED_DISPLAY_USER=$(saved_value DISPLAY_USER)
  case "$SAVED_ROLE" in both|client|server) ;; *) SAVED_ROLE="" ;; esac
  case "$SAVED_PLATFORM" in pi|desktop|headless) ;; *) SAVED_PLATFORM="" ;; esac
}

role_name() {   # role_name both|client|server
  case "$1" in
    both) echo "Client + Server" ;;
    client) echo "Client only" ;;
    *) echo "Server only" ;;
  esac
}

refuse_role_change() {
  if [ -n "$SAVED_ROLE" ] && [ "$ROLE" != "$SAVED_ROLE" ]; then
    echo ""
    echo "ERROR: This device was set up as \"$(role_name "$SAVED_ROLE")\". The installer can't change it to"
    echo "\"$(role_name "$ROLE")\". To do that, remove the Noticeboard from this device first (see the README),"
    echo "then run the installer again. Nothing was changed."
    exit 1
  fi
}

save_answers() {
  mkdir -p "$(dirname "$INSTALL_ENV_FILE")"
  {
    printf 'NOTICEBOARD_ROLE=%s\n' "$ROLE"
    printf 'NOTICEBOARD_PLATFORM=%s\n' "${PLATFORM:-}"
    printf 'NOTICEBOARD_SERVER_URL=%s\n' "${SERVER_URL:-}"
    printf 'NOTICEBOARD_DISPLAY_USER=%s\n' "$DESKTOP_USER"
  } > "$INSTALL_ENV_FILE.tmp"
  chmod 644 "$INSTALL_ENV_FILE.tmp"
  mv "$INSTALL_ENV_FILE.tmp" "$INSTALL_ENV_FILE"
}
