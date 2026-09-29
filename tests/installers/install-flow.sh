#!/usr/bin/env bash
# shellcheck disable=SC1090,SC2034  # functions are loaded from the installers; the variables set here are read by them
# install.sh's real questions and steps in order (run_installer) for each role and platform
# (SYSTEM_DESIGN §8, §18.7), with system commands (apt-get, npm, systemctl, chown, ...) replaced by
# stand-ins that record their calls, and every path the installer writes in a temporary folder:
# Client + Server re-run on a Raspberry Pi, a fresh headless Client only, its re-run with the saved
# answers, a different role refused, Server only, and the answers an older installer hands over.
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
  apt-cache() { return 1; }                               # no chromium-browser package: chromium
  npm()       { echo "npm $*" >> "$T/calls.log"; }
  systemctl() { if [ "$1" = get-default ]; then echo multi-user.target; return; fi; echo "systemctl $*" >> "$T/calls.log"; }
  chown()     { echo "chown $*" >> "$T/calls.log"; }
  flock()     { :; }
  hostname()  { echo "192.168.1.50"; }
  curl()      { echo "curl $*" >> "$T/calls.log"; }
  runuser()   { shift 3; "$@"; }                         # -u <user> -- cmd...
  getent()    { echo "pi:x:1000:1000::$T/home:/bin/bash"; }
  xdg-user-dir() { echo "$T/home/Desktop"; }               # not this machine's own desktop (a CI runner has one)
  node()      { case "$*" in *process.version*) printf 24 ;; *) echo "node (config init)" >> "$T/calls.log" ;; esac; }
  has_tty()   { return 0; }
  ask()       { REPLY="${ANSWERS[0]-}"; ANSWERS=("${ANSWERS[@]:1}"); echo "  [answered: '${REPLY}']"; }
  # The sudo check has its own test (sudo-password.sh); here it mustn't depend on this machine's
  # sudoers rules (a CI runner's user has NOPASSWD, as a Pi's does)
  check_sudo_password() { echo "check_sudo_password" >> "$T/calls.log"; SUDO_STATUS=""; }
}
# Every path the installer writes, inside $T/root (a fresh device: nothing there yet)
paths() {
  local r="$T/root"
  mkdir -p "$r/etc" "$r/bin" "$r/autostart" "$T/home"
  SERVICE_FILE="$r/etc/noticeboard.service"; UPDATE_SERVICE_FILE="$r/etc/noticeboard-update.service"
  UPDATE_TIMER_FILE="$r/etc/noticeboard-update.timer"; UPDATE_PATH_FILE="$r/etc/noticeboard-update.path"
  AUTOSTART_FILE="$r/autostart/noticeboard-kiosk.desktop"; INSTALL_ENV_FILE="$r/etc/noticeboard/install.env"
  CLIENT_DIR="$r/opt-noticeboard-client"; CLIENT_LAUNCHER="$r/bin/noticeboard-client"
  KIOSK_SERVICE_FILE="$r/etc/noticeboard-kiosk.service"; OLD_CLIENT_KIOSK="$r/bin/noticeboard-kiosk.sh"
  DEVICE_MODEL_FILE="$r/model"; DISPLAY_MANAGER_UNIT="$r/etc/display-manager.service"
  SYSTEM_SERVICE_FILE="$r/etc/noticeboard-system.service"; SYSTEM_PATH_FILE="$r/etc/noticeboard-system.path"
  SYSTEM_STEP="$r/sbin/noticeboard-system"; SERVER_COMMAND="$r/bin/noticeboard"; ROOT_LIB_DIR="$r/lib-noticeboard"
  mkdir -p "$r/sbin"
  CLIENT_UPDATE_SERVICE_FILE="$r/etc/noticeboard-client-update.service"; CLIENT_UPDATE_TIMER_FILE="$r/etc/noticeboard-client-update.timer"
  SERVER_KEY_FILE="$r/etc/noticeboard/server.pub"
  export SUDO_USER; SUDO_USER=$(id -un)
}
# run_installer with the answers given; the output in $T/<name>.out, the exit code in RC
install() {   # install <name> <install folder> <answers...>
  local name=$1 dir=$2; shift 2
  : > "$T/calls.log"
  (
    load_installer; stubs; paths
    INSTALL_DIR=$dir; BRANCH_FILE="$dir/data/update-branch.env"
    ANSWERS=("$@")
    run_installer
  ) > "$T/$name.out" 2>&1
  RC=$?
}
# The Client's command runs as its own process: its curl can't reach any Server here (at once)
mkdir -p "$T/bin"; printf '#!/usr/bin/env bash
exit 7
' > "$T/bin/curl"; chmod +x "$T/bin/curl"; export PATH="$T/bin:$PATH"
saved() { sed -n "s/^NOTICEBOARD_$1=//p" "$T/root/etc/noticeboard/install.env" 2>/dev/null; }
R="$T/root"
V=$(sed -n 's/^INSTALLER_VERSION=//p' "$REPO/installers/install.sh")   # the installer's version

# Its GitHub: a bare copy of this repository whose main is the commit checked out here (a CI
# checkout has no local main branch)
git clone -q --bare "$REPO" "$T/origin.git" 2>/dev/null
git -C "$T/origin.git" update-ref refs/heads/main "$(git -C "$REPO" rev-parse HEAD)"
git clone -q "$T/origin.git" "$T/opt-noticeboard" 2>/dev/null

# ── Client + Server, re-run on a Raspberry Pi installed before 0.9.0 (Enter keeps everything) ──
mkdir -p "$R/etc" "$R/autostart"
echo "Raspberry Pi 4 Model B Rev 1.5" > "$R/model"; touch "$R/etc/display-manager.service"
echo "old kiosk" > "$T/opt-noticeboard/start-kiosk.sh"
printf '[Desktop Entry]\nExec=/opt/noticeboard/start-kiosk.sh\n' > "$R/autostart/noticeboard-kiosk.desktop"
install both "$T/opt-noticeboard" "" "" n n
[ $RC -eq 0 ] && ok "Client + Server runs to the end under set -euo pipefail" || { bad "Client + Server exited $RC"; tail -20 "$T/both.out"; }
grep -q "\[answered: ''\]" "$T/both.out" && [ "$(saved ROLE)" = both ] && [ "$(saved PLATFORM)" = pi ] \
  && ok "re-run: Enter takes Client + Server (a Server folder) and Raspberry Pi (detected)" || { bad "defaults"; grep -A1 "Choose" "$T/both.out"; }
first_two_are_update_then_upgrade && ok "apt update, then full upgrade, before anything else" || bad "upgrade order"
grep -q 'dist-upgrade \[DEBIAN_FRONTEND=noninteractive\]' "$T/calls.log" && ok "upgrade is non-interactive" || bad "noninteractive"
[ "$(grep -c ' dist-upgrade ' "$T/calls.log")" = 1 ] && ok "the system is upgraded once (the Client doesn't do it again)" || bad "upgraded twice"
grep -q "apt-get install -y -qq git ffmpeg curl " "$T/calls.log" && grep -q "apt-get install -y -qq chromium curl " "$T/calls.log" \
  && ok "the Server's packages, then the Client's (Chromium)" || { bad "packages"; grep "install" "$T/calls.log"; }
[ "$(git -C "$T/opt-noticeboard" branch --show-current)" = main ] && ok "install folder updated to main (git as owner, forced checkout)" || bad "git update"
missing=0
for f in "$R/etc/noticeboard.service" "$R/etc/noticeboard-update.service" "$R/etc/noticeboard-update.timer" "$T/opt-noticeboard/.env" \
         "$R/opt-noticeboard-client/current/kiosk.sh" "$R/opt-noticeboard-client/current/noticeboard-client" "$R/opt-noticeboard-client/version" "$R/bin/noticeboard-client"; do
  [ -e "$f" ] || { bad "missing ${f#"$T"/}"; missing=1; }
done
[ $missing -eq 0 ] && ok "service, update units, .env, the Client's files, version and launcher written"
cmp -s "$R/opt-noticeboard-client/current/kiosk.sh" "$REPO/installers/client/kiosk.sh" && cmp -s "$R/opt-noticeboard-client/current/noticeboard-client" "$REPO/installers/client/noticeboard-client" \
  && ok "the Client's files are installed exactly as in installers/client/" || bad "client files differ"
grep -q "^Exec=$R/bin/noticeboard-client kiosk$" "$R/autostart/noticeboard-kiosk.desktop" && ok "the desktop's autostart runs noticeboard-client kiosk" || { bad "autostart"; cat "$R/autostart/noticeboard-kiosk.desktop"; }
[ ! -e "$T/opt-noticeboard/start-kiosk.sh" ] && [ ! -e "$R/etc/noticeboard-kiosk.service" ] && ok "the old start-kiosk.sh removed; no headless service" || bad "old kiosk left"
grep -q "file://$T/opt-noticeboard/noticeboard-guide.html" "$T/home/Desktop/noticeboard-help.desktop" && ok "Help shortcut to the guide on the Server" || bad "help shortcut"
grep -q "^check_sudo_password" "$T/calls.log" && ok "a Raspberry Pi: the sudo check is offered" || bad "sudo check on a Pi"
node -e "const r=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.exit(r.version===Number(process.argv[2])?0:1)" "$T/opt-noticeboard/data/installer.json" "$V" \
  && ok "the installer record says INSTALLER_VERSION" || bad "installer record"
grep -q "Auto-update  : every 15 minutes" "$T/both.out" && grep -q "shows the slideshow from its own Server" "$T/both.out" && grep -q "Screen Blanking" "$T/both.out" \
  && ok "the summary: the Server's lines, the Client's, and the Pi's screen-blanking advice" || bad "summary"
grep -q "Reboot later with" "$T/both.out" && ok "a Client: the reboot is offered" || bad "reboot offer"
grep -q "^PathExists=$T/opt-noticeboard/tmp/system-request$" "$R/etc/noticeboard-system.path" && grep -q "^ExecStart=$R/sbin/noticeboard-system$" "$R/etc/noticeboard-system.service"   && grep -q "systemctl enable --now noticeboard-system.path" "$T/calls.log" && ok "the system step's units written and its path unit enabled" || bad "system units"
[ ! -e "$R/etc/noticeboard-client-update.timer" ] && ok "a Client + Server's screen doesn't follow its own Server (the system step keeps it up to date)" || bad "both has client timer"
cmp -s "$R/sbin/noticeboard-system" "$REPO/installers/root/noticeboard-system" && cmp -s "$R/bin/noticeboard" "$REPO/installers/root/noticeboard"   && cmp -s "$R/lib-noticeboard/release.sh" "$REPO/installers/lib/release.sh" && cmp -s "$R/lib-noticeboard/branch.sh" "$REPO/installers/lib/branch.sh"   && cmp -s "$R/lib-noticeboard/json.sh" "$REPO/installers/lib/json.sh" && ok "root's files (the system step, the noticeboard command and the parts they load) installed as they are" || bad "root files"

# ── --apply (the system step): the saved answers, no questions, never the code ──
before=$(git -C "$T/opt-noticeboard" rev-parse HEAD)
: > "$T/calls.log"
( load_installer; stubs; paths; INSTALL_DIR="$T/opt-noticeboard"; BRANCH_FILE="$INSTALL_DIR/data/update-branch.env"
  ask() { echo "ASKED"; REPLY=""; }; APPLY=1
  apply_saved_installation ) > "$T/apply.out" 2>&1
RC=$?
[ $RC -eq 0 ] && ! grep -q ASKED "$T/apply.out" && grep -q "Done: installer version $V applied" "$T/apply.out" && ok "--apply: runs with the saved answers, asking nothing" || { bad "apply"; tail -12 "$T/apply.out"; }
! grep -q "^npm |dist-upgrade|systemctl restart noticeboard|^check_sudo_password" "$T/calls.log" && [ "$(git -C "$T/opt-noticeboard" rev-parse HEAD)" = "$before" ]   && ok "--apply: no code, build, system upgrade, restart or sudo check" || { bad "apply did too much"; grep -E "^npm |dist-upgrade|restart|sudo" "$T/calls.log"; }
grep -q "apt-get -o DPkg::Lock::Timeout=300 update" "$T/calls.log" && grep -q "apt-get install -y -qq git ffmpeg curl" "$T/calls.log" && grep -q "apt-get install -y -qq chromium curl" "$T/calls.log"   && ok "--apply: the package list updated, the Server's and the Client's packages installed" || { bad "apply packages"; grep apt "$T/calls.log"; }
node -e "const r=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.exit(r.version===Number(process.argv[2])?0:1)" "$T/opt-noticeboard/data/installer.json" "$V" && [ "$(saved ROLE)" = both ]   && ok "--apply: the installer record written, the answers kept" || bad "apply record"
( load_installer; stubs; paths; INSTALL_ENV_FILE="$T/none.env"; APPLY=1; apply_saved_installation ) > "$T/apply-none.out" 2>&1
[ $? -ne 0 ] && grep -q "no saved answers" "$T/apply-none.out" && ok "--apply without saved answers: stops, says to run the installer by hand" || bad "apply without answers"

# ── Client only, a fresh headless device (not a Pi): Enter and '4' refused, then 2; the URL ──
rm -rf "$T/home"
rm -rf "$R"
install client "$T/nothing-here" "" "4" "2" "" "" "http://10.0.0.5:3000/" n n
[ $RC -eq 0 ] && ok "Client only (headless) runs to the end" || { bad "Client exited $RC"; tail -20 "$T/client.out"; }
[ "$(grep -c "Please type 1 to 3" "$T/client.out")" = 2 ] && ok "a fresh device: no default role, re-asks on Enter and on '4'" || bad "role prompt"
grep -q "The server URL is required" "$T/client.out" && [ "$(saved SERVER_URL)" = "http://10.0.0.5:3000" ] \
  && [ "$(saved ROLE)" = client ] && [ "$(saved PLATFORM)" = headless ] && ok "answers saved: Client only, headless (detected: no desktop), the URL without its slash" || { bad "saved answers"; cat "$R/etc/noticeboard/install.env"; }
grep -q "^User=$(id -un)$" "$R/etc/noticeboard-kiosk.service" && grep -q "^ExecStart=/usr/bin/cage -s -- $R/bin/noticeboard-client kiosk$" "$R/etc/noticeboard-kiosk.service" \
  && grep -q "systemctl enable noticeboard-kiosk" "$T/calls.log" && ok "headless: noticeboard-kiosk.service (cage on tty1) enabled" || { bad "kiosk service"; cat "$R/etc/noticeboard-kiosk.service"; }
grep -q "apt-get install -y -qq chromium curl cage " "$T/calls.log" && ok "headless: cage installed with Chromium" || { bad "cage"; grep install "$T/calls.log"; }
[ ! -e "$R/autostart/noticeboard-kiosk.desktop" ] && [ ! -e "$T/home/Desktop/noticeboard-help.desktop" ] && ok "headless: no autostart or desktop shortcut" || bad "desktop pieces"
! grep -q "^check_sudo_password" "$T/calls.log" && ok "not a Raspberry Pi: no sudo offer" || bad "sudo offer off a Pi"
first_two_are_update_then_upgrade && ok "Client only also updates, then upgrades, first" || bad "client upgrade order"
[ ! -e "$T/nothing-here" ] && ok "Client only: no Server folder" || bad "server folder made"
[ ! -e "$R/etc/noticeboard-system.path" ] && [ ! -e "$R/bin/noticeboard" ] && ok "Client only: no system step or noticeboard command" || bad "client-only system step"
grep -q "^ExecStart=$R/bin/noticeboard-client check$" "$R/etc/noticeboard-client-update.service" && grep -q "OnUnitActiveSec=15min" "$R/etc/noticeboard-client-update.timer"   && grep -q "systemctl enable --now noticeboard-client-update.timer" "$T/calls.log" && ok "Client only: follows its Server (noticeboard-client check every 15 minutes)" || bad "client update units"
grep -q "apt-get install -y -qq chromium curl cage openssl" "$T/calls.log" && cmp -s "$R/lib-noticeboard/release.sh" "$REPO/installers/lib/release.sh"   && ok "Client only: openssl (to check signatures) and the parts reinstall-stable loads" || bad "client openssl or libs"
grep -q "won't update itself until it trusts its Server" "$T/client.out" && [ ! -e "$R/etc/noticeboard/server.pub" ]   && ok "Client only: its Server's key asked for; the Server out of reach, so nothing pinned and it says what to run" || { bad "pin"; tail -5 "$T/client.out"; }

# ── Re-run on that Client: Enter keeps role, platform and URL ──
# (its Server's key pinned meanwhile, so it takes the Client's files from the Server straight away)
mkdir -p "$R/etc/noticeboard"; echo "KEY" > "$R/etc/noticeboard/server.pub"
install rerun "$T/nothing-here" "" "" "" n n
[ $RC -eq 0 ] && [ "$(saved ROLE)" = client ] && [ "$(saved PLATFORM)" = headless ] && [ "$(saved SERVER_URL)" = "http://10.0.0.5:3000" ] \
  && ! grep -qE "Please type|is required" "$T/rerun.out" && ok "Client re-run: Enter keeps role, platform and URL (the saved answers)" || { bad "client re-run"; tail -20 "$T/rerun.out"; }
grep -q "Taking the Client's files from the Server" "$T/rerun.out" && grep -q "Couldn't reach the Server at http://10.0.0.5:3000" "$T/rerun.out" \
  && ! grep -q "won't update itself" "$T/rerun.out" && ok "Client with its Server's key: takes the Client's files from the Server at once (it follows only its Server)" || { bad "first check"; tail -8 "$T/rerun.out"; }

# ── A different role: refused before anything changes ──
install other "$T/nothing-here" "1"
[ $RC -ne 0 ] && grep -q 'set up as "Client only"' "$T/other.out" && ! grep -q "^apt-get" "$T/calls.log" \
  && ok "choosing another role than the saved one: refused, nothing changed" || { bad "role change"; tail -8 "$T/other.out"; }

# ── Server only, over an older Client + Server (its kiosk goes) ──
rm -rf "$R"; mkdir -p "$R/autostart"
printf '[Desktop Entry]\nExec=/opt/noticeboard/start-kiosk.sh\n' > "$R/autostart/noticeboard-kiosk.desktop"
echo "old kiosk" > "$T/opt-noticeboard/start-kiosk.sh"
install server "$T/opt-noticeboard" "3" n
[ $RC -eq 0 ] && ok "Server only runs to the end" || { bad "Server only exited $RC"; tail -20 "$T/server.out"; }
grep -q "What should this device do" "$T/server.out" && ! grep -q "How does this device show the slideshow" "$T/server.out" && ! grep -qE "Reboot later|Rebooting" "$T/server.out" \
  && ok "Server only: no platform question, no reboot" || bad "server-only questions"
! grep -q "chromium" "$T/calls.log" && [ ! -e "$R/opt-noticeboard-client" ] && [ ! -e "$R/autostart/noticeboard-kiosk.desktop" ] && [ ! -e "$T/opt-noticeboard/start-kiosk.sh" ] \
  && ok "Server only: no Chromium or Client; the old kiosk and its autostart removed" || bad "server-only client pieces"
[ "$(saved ROLE)" = server ] && [ -z "$(saved PLATFORM)" ] && ok "Server only: the role saved" || bad "server-only saved"

# ── The answers an older installer hands over (NOTICEBOARD_MODE only) ──
( load_installer; stubs; paths; INSTALL_DIR="$T/none"; ask() { echo ASKED; REPLY=1; }
  NOTICEBOARD_MODE=display; choose_role; echo "ROLE=$ROLE MODE=$MODE"
  NOTICEBOARD_MODE=server; choose_role; echo "ROLE=$ROLE MODE=$MODE"
  unset NOTICEBOARD_MODE; NOTICEBOARD_ROLE=server; choose_role; echo "ROLE=$ROLE MODE=$MODE"
  NOTICEBOARD_PLATFORM=headless; choose_platform; echo "PLATFORM=$PLATFORM"
  NOTICEBOARD_SERVER_URL=http://10.0.0.9:3000/; ask_server_url; echo "URL=$SERVER_URL" ) > "$T/handed.out" 2>&1
! grep -q ASKED "$T/handed.out" && grep -q "ROLE=client MODE=display" "$T/handed.out" && grep -q "ROLE=both MODE=server" "$T/handed.out" \
  && grep -q "ROLE=server MODE=server" "$T/handed.out" && grep -q "PLATFORM=headless" "$T/handed.out" && grep -q "URL=http://10.0.0.9:3000$" "$T/handed.out" \
  && ok "handed-over answers used, not asked: an older installer's mode, and the new role, platform and URL" || { bad "handed over"; cat "$T/handed.out"; }

# ── A Client installed before 0.9.0: its kiosk script gives the defaults ──
rm -rf "$R"; mkdir -p "$R/bin"
printf '#!/usr/bin/env bash\nSERVER_URL="http://10.0.0.7:3000"\n' > "$R/bin/noticeboard-kiosk.sh"
install oldclient "$T/nothing-here-either" "" "2" "" n n
[ $RC -eq 0 ] && [ "$(saved ROLE)" = client ] && [ "$(saved SERVER_URL)" = "http://10.0.0.7:3000" ] && [ "$(saved PLATFORM)" = desktop ] && [ ! -e "$R/bin/noticeboard-kiosk.sh" ] \
  && ok "an older Client: Enter keeps Client only and its Server; the old kiosk script removed" || { bad "older client"; tail -12 "$T/oldclient.out"; }

rm -rf "$T"; echo "passed=$pass failed=$fail"; [ $fail -eq 0 ]
