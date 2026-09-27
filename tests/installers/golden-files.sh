#!/usr/bin/env bash
# shellcheck disable=SC1090,SC2034  # functions are loaded from the installers; the variables set here are read by them
# The files the installer writes onto a Pi (systemd units, both kiosk scripts, the autostart entry,
# the Help shortcut), generated for fixed answers and compared with tests/fixtures/installer-golden/,
# which was recorded from the baseline installer. Restructuring the installer must not change
# them (SYSTEM_DESIGN §8, §14 D30). NB_UPDATE_SNAPSHOT=1 records them again (only for a deliberate,
# reviewed change, together with INSTALLER_VERSION).
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$REPO/tests/helpers/installer.sh"
GOLDEN="$REPO/tests/fixtures/installer-golden"
T=$(mktemp -d); OUT="$T/out"; mkdir -p "$OUT" "$T/opt" "$T/home/pi"
pass=0; fail=0

(
  load_installer
  getent()  { echo "pi:x:1000:1000::$T/home/pi:/bin/bash"; }
  runuser() { return 1; }                 # no xdg-user-dir: the shortcut goes in ~/Desktop
  chown()   { :; }
  DESKTOP_USER=pi; INSTALL_DIR=/opt/noticeboard; SERVICE_NAME=noticeboard
  SERVICE_FILE="$OUT/noticeboard.service"
  UPDATE_SERVICE_FILE="$OUT/noticeboard-update.service"
  UPDATE_TIMER_FILE="$OUT/noticeboard-update.timer"
  UPDATE_PATH_FILE="$OUT/noticeboard-update.path"
  write_service
  write_update_units
  AUTOSTART_FILE="$OUT/autostart-server.desktop"; write_autostart /opt/noticeboard/start-kiosk.sh
  AUTOSTART_FILE="$OUT/autostart-display.desktop"; write_autostart /usr/local/bin/noticeboard-kiosk.sh
  write_help_shortcut "file:///opt/noticeboard/noticeboard-guide.html" >/dev/null
  cp "$T/home/pi/Desktop/noticeboard-help.desktop" "$OUT/help-server.desktop"
  write_help_shortcut "http://192.168.1.10:3000/admin/help" >/dev/null
  cp "$T/home/pi/Desktop/noticeboard-help.desktop" "$OUT/help-display.desktop"
  INSTALL_DIR="$T/opt"; write_server_kiosk; cp "$T/opt/start-kiosk.sh" "$OUT/start-kiosk.sh"
  KIOSK_SCRIPT="$OUT/noticeboard-kiosk.sh"; SERVER_URL="http://192.168.1.10:3000"
  MACS_HTML="<tr><td class='iface'>eth0</td><td class='mac'>dc:a6:32:01:02:03</td></tr>"
  write_display_kiosk
) || { echo "FAIL  couldn't generate the files"; exit 1; }

if [ ! -d "$GOLDEN" ] || [ "${NB_UPDATE_SNAPSHOT:-}" = 1 ]; then
  rm -rf "$GOLDEN"; mkdir -p "$GOLDEN"; cp "$OUT"/* "$GOLDEN"/
  echo "PASS  recorded $(ls "$GOLDEN" | wc -l) files in tests/fixtures/installer-golden"
else
  for f in "$GOLDEN"/*; do
    name=$(basename "$f")
    if diff -u "$f" "$OUT/$name" > "$T/diff"; then
      pass=$((pass+1))
    else
      fail=$((fail+1)); echo "FAIL  $name differs:"; sed 's/^/        /' "$T/diff" | head -40
    fi
  done
  extra=$(comm -13 <(ls "$GOLDEN") <(ls "$OUT"))
  if [ -n "$extra" ]; then fail=$((fail+1)); echo "FAIL  files not in the golden set: $extra"; fi
  echo "PASS  $pass of $(ls "$GOLDEN" | wc -l) generated files identical to the baseline's"
fi
rm -rf "$T"; echo "passed=$pass failed=$fail"; [ "$fail" -eq 0 ]
