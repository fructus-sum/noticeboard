#!/usr/bin/env bash
# shellcheck disable=SC1090,SC2034  # functions are loaded from the installers; the variables set here are read by them
# Run install.sh's real functions end to end for both modes, with system commands
# (apt-get, npm, systemctl, chown, ...) replaced by stand-ins that record their calls.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$REPO/tests/helpers/installer.sh"
T=$(mktemp -d); export T
pass=0; fail=0
ok()  { pass=$((pass+1)); echo "PASS  $1"; }
bad() { fail=$((fail+1)); echo "FAIL  $1"; }
first_two_are_update_then_upgrade() {
  local first second
  first=$(grep -E '^(apt-get|npm|systemctl)' "$T/calls.log" | sed -n 1p)
  second=$(grep -E '^(apt-get|npm|systemctl)' "$T/calls.log" | sed -n 2p)
  [[ "$first" == *" update "* && "$second" == *" dist-upgrade "* ]]
}

stubs() {
  apt-get()   { echo "apt-get $* [DEBIAN_FRONTEND=${DEBIAN_FRONTEND:-}]" >> "$T/calls.log"; }
  npm()       { echo "npm $*" >> "$T/calls.log"; }
  systemctl() { echo "systemctl $*" >> "$T/calls.log"; }
  chown()     { echo "chown $*" >> "$T/calls.log"; }
  flock()     { :; }
  hostname()  { echo "192.168.1.50"; }
  curl()      { echo "curl $*" >> "$T/calls.log"; }
  runuser()   { shift 3; "$@"; }                         # -u <user> -- cmd...
  node()      { case "$*" in *process.version*) printf 24 ;; *) echo "node (config init)" >> "$T/calls.log" ;; esac; }
  has_tty()   { return 0; }
  ask()       { REPLY="${ANSWERS[0]}"; ANSWERS=("${ANSWERS[@]:1}"); echo "  [answered: '${REPLY}']"; }
}

# ── Server, re-run on an existing install (Enter accepts the default) ──
git clone -q "$REPO" "$T/opt-noticeboard" 2>/dev/null
(
  load_installer
  stubs
  INSTALL_DIR="$T/opt-noticeboard"; SERVICE_FILE="$T/noticeboard.service"
  UPDATE_SERVICE_FILE="$T/noticeboard-update.service"; UPDATE_TIMER_FILE="$T/noticeboard-update.timer"; UPDATE_PATH_FILE="$T/noticeboard-update.path"; BRANCH_FILE="$T/opt-noticeboard/data/update-branch.env"
  AUTOSTART_FILE="$T/autostart-server.desktop"; KIOSK_SCRIPT="$T/not-installed.sh"
  DESKTOP_USER=$(id -un); ANSWERS=("")
  choose_mode && echo "MODE=$MODE"
  check_sudo_password
  install_server
  summary_server
) > "$T/server.out" 2>&1
rc=$?
[ $rc -eq 0 ] && ok "server mode runs to the end under set -euo pipefail" || { bad "server mode exited $rc"; tail -20 "$T/server.out"; }
grep -q "MODE=server" "$T/server.out" && ok "re-run defaults to 'Server' (Enter)" || bad "default mode"
grep -E '^(apt-get|npm|systemctl)' "$T/calls.log" | cut -c1-72 | sed 's/^/      /'
first_two_are_update_then_upgrade && ok "apt update, then full upgrade, before anything else" || bad "upgrade order"
grep -q 'dist-upgrade \[DEBIAN_FRONTEND=noninteractive\]' "$T/calls.log" && ok "upgrade is non-interactive" || bad "noninteractive"
[ "$(git -C "$T/opt-noticeboard" branch --show-current)" = main ] && ok "install folder updated to main (git as owner, forced checkout)" || bad "git update"
missing=0
for f in noticeboard.service noticeboard-update.service noticeboard-update.timer autostart-server.desktop opt-noticeboard/start-kiosk.sh opt-noticeboard/.env; do
  [ -s "$T/$f" ] || { bad "missing $f"; missing=1; }
done
[ $missing -eq 0 ] && ok "service, update timer, kiosk script, autostart and .env written"
grep -q "Auto-update  : every 15 minutes" "$T/server.out" && ok "summary shows the auto-update line" || bad "summary"

# ── Client, fresh device: Enter (no default) and '3' are refused, then 2; empty URL, then one with a slash ──
: > "$T/calls.log"
(
  load_installer
  stubs
  INSTALL_DIR="$T/nothing-here"; KIOSK_SCRIPT="$T/noticeboard-kiosk.sh"; AUTOSTART_FILE="$T/autostart-display.desktop"
  DESKTOP_USER=$(id -un); ANSWERS=("" "3" "2" "" "http://10.0.0.5:3000/")
  choose_mode && echo "MODE=$MODE"
  ask_server_url && echo "SERVER_URL=$SERVER_URL"
  install_display
  summary_display
) > "$T/display.out" 2>&1
rc=$?
[ $rc -eq 0 ] && ok "display mode runs to the end" || { bad "display mode exited $rc"; tail -20 "$T/display.out"; }
[ "$(grep -c "Please type 1 or 2" "$T/display.out")" = 2 ] && grep -q "MODE=display" "$T/display.out" && ok "fresh Pi: no default, re-asks on Enter and on '3', accepts '2'" || bad "mode prompt"
grep -q "The server URL is required" "$T/display.out" && grep -q "SERVER_URL=http://10.0.0.5:3000$" "$T/display.out" && ok "URL: re-asks when empty, strips the trailing slash" || bad "url prompt"
grep -q 'SERVER_URL="http://10.0.0.5:3000"' "$T/noticeboard-kiosk.sh" && ok "kiosk script points at the server" || bad "kiosk url"
first_two_are_update_then_upgrade && ok "display mode also updates, then upgrades, first" || bad "display upgrade order"

# ── Re-run on that Client: Enter, Enter keeps mode and URL ──
(
  load_installer; stubs
  INSTALL_DIR="$T/nothing-here"; KIOSK_SCRIPT="$T/noticeboard-kiosk.sh"; ANSWERS=("" "")
  choose_mode && ask_server_url && echo "MODE=$MODE SERVER_URL=$SERVER_URL"
) > "$T/rerun.out" 2>&1
grep -q "MODE=display SERVER_URL=http://10.0.0.5:3000$" "$T/rerun.out" && ok "display re-run: Enter, Enter keeps mode and URL" || { bad "display re-run defaults"; cat "$T/rerun.out"; }

rm -rf "$T"; echo "passed=$pass failed=$fail"; [ $fail -eq 0 ]
