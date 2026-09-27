#!/usr/bin/env bash
# shellcheck disable=SC1090,SC2034  # functions are loaded from the installers; the variables set here are read by them
# install.sh on a server Pi that follows another branch: keep it, go back to main, or fall back
# to main when the branch is gone. Real git against a local origin; system commands are stand-ins.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
T=$(mktemp -d); export T
pass=0; fail=0
ok()  { pass=$((pass+1)); echo "PASS  $1"; }
bad() { fail=$((fail+1)); echo "FAIL  $1"; }
stubs() {
  apt-get()   { echo "apt-get $*" >> "$T/calls.log"; }
  npm()       { echo "npm $*" >> "$T/calls.log"; }
  systemctl() { echo "systemctl $*" >> "$T/calls.log"; }
  chown()     { :; }
  flock()     { :; }
  hostname()  { echo "192.168.1.50"; }
  curl()      { :; }
  runuser()   { shift 3; "$@"; }
  node()      { case "$*" in *process.version*) printf 24 ;; *) : ;; esac; }
  has_tty()   { return 0; }
  ask()       { REPLY="${ANSWERS[0]}"; ANSWERS=("${ANSWERS[@]:1}"); echo "  [answered: '${REPLY}']"; }
}
# An origin with main and feature/good (both from this repo's working tree, so the new scripts)
git init -q --bare -b main "$T/origin.git"
git clone -q "$T/origin.git" "$T/work" 2>/dev/null
cp -r "$REPO/installers" "$T/work/" && printf 'data/\ntmp/\n' > "$T/work/.gitignore"
( cd "$T/work" && git checkout -q -b main && echo main > VERSION && git add -A && git -c user.name=t -c user.email=t@t commit -qm main \
  && git push -q origin main && git checkout -q -b feature/good && echo good > VERSION && git add -A \
  && git -c user.name=t -c user.email=t@t commit -qm good && git push -q origin feature/good ) 2>/dev/null

scenario() {   # scenario <name> <branch setting or ""> <answers...>
  local name=$1 setting=$2; shift 2
  rm -rf "$T/opt"; git clone -q "$T/origin.git" "$T/opt" 2>/dev/null
  mkdir -p "$T/opt/data" "$T/opt/tmp"; echo '{"x":1}' > "$T/opt/data/config.json"; echo x > "$T/opt/tmp/update-request"
  [ -n "$setting" ] && echo "NOTICEBOARD_BRANCH=$setting" > "$T/opt/data/update-branch.env"
  : > "$T/calls.log"
  (
    source <(sed '$d' "$REPO/installers/install.sh"); stubs; set -euo pipefail
    INSTALL_DIR="$T/opt"; BRANCH_FILE="$T/opt/data/update-branch.env"; SERVICE_FILE="$T/svc"
    UPDATE_SERVICE_FILE="$T/upd.service"; UPDATE_TIMER_FILE="$T/upd.timer"; UPDATE_PATH_FILE="$T/upd.path"
    AUTOSTART_FILE="$T/autostart.desktop"; KIOSK_SCRIPT="$T/none.sh"; DESKTOP_USER=$(id -un); ANSWERS=("$@")
    choose_mode; choose_branch; echo "INSTALL_BRANCH=$INSTALL_BRANCH"
    install_server; summary_server
  ) > "$T/$name.out" 2>&1
  RC=$?
  ON=$(git -C "$T/opt" branch --show-current); VER=$(cat "$T/opt/VERSION")
  SETTING=$(sed -n 's/^NOTICEBOARD_BRANCH=//p' "$T/opt/data/update-branch.env" 2>/dev/null)
  STATUS_BRANCH=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).branch)" "$T/opt/data/update-status.json" 2>/dev/null)
}

scenario plain "" ""
[ $RC = 0 ] && [ "$ON" = main ] && [ -z "$SETTING" ] && ! grep -q "follows the branch" "$T/plain.out" \
  && ok "following main: no branch question, installs main, no setting file written" || { bad "plain"; tail -5 "$T/plain.out"; }
[ "$STATUS_BRANCH" = main ] && ok "status file records the installer run" || bad "status ($STATUS_BRANCH)"
node -e "const r=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.exit(r.version===2&&r.branch==='main'&&/^[0-9a-f]{40}$/.test(r.commit)&&!isNaN(Date.parse(r.time))?0:1)" "$T/opt/data/installer.json" \
  && ok "data/installer.json records installer version 2, the branch and commit" || { bad "installer record"; cat "$T/opt/data/installer.json"; }
[ ! -f "$T/opt/tmp/update-request" ] && ok "a pending admin request is cleared" || bad "request left"
grep -q "PathExists=$T/opt/tmp/update-request" "$T/upd.path" && grep -q "Unit=noticeboard-update.service" "$T/upd.path" \
  && ok "path unit watches tmp/update-request" || bad "path unit"
grep -q "enable --now noticeboard-update.path" "$T/calls.log" && grep -q "enable --now noticeboard-update.timer" "$T/calls.log" \
  && ok "timer and path unit enabled" || bad "enable"
grep -q "TimeoutStartSec=60min" "$T/upd.service" && ok "update service allows 60 min" || bad "timeout"

scenario keep feature/good "" ""
[ $RC = 0 ] && [ "$ON" = feature/good ] && [ "$VER" = good ] && [ "$SETTING" = feature/good ] && [ "$STATUS_BRANCH" = feature/good ] \
  && grep -q 'follows the branch "feature/good"' "$T/keep.out" && grep -q "Branch       : feature/good" "$T/keep.out" \
  && ok "re-run with Enter keeps feature/good" || { bad "keep"; tail -8 "$T/keep.out"; }

scenario back feature/good "" "2"
[ $RC = 0 ] && [ "$ON" = main ] && [ "$VER" = main ] && [ "$SETTING" = main ] && [ "$STATUS_BRANCH" = main ] \
  && ok "choosing 2 goes back to main and saves it" || { bad "back"; tail -8 "$T/back.out"; }

scenario wrong feature/good "" "5" "1"
[ $RC = 0 ] && [ "$ON" = feature/good ] && grep -q "Please type 1 or 2" "$T/wrong.out" && ok "re-asks on a wrong answer" || bad "wrong answer"

scenario gone deleted-branch "" ""
[ $RC = 0 ] && [ "$ON" = main ] && [ "$SETTING" = main ] && grep -q "Couldn't download deleted-branch" "$T/gone.out" \
  && ok "a branch that's gone falls back to main" || { bad "gone"; tail -8 "$T/gone.out"; }

scenario invalid 'bad name!' ""
[ $RC = 0 ] && [ "$ON" = main ] && grep -q "isn't valid" "$T/invalid.out" && ok "an invalid setting installs main" || { bad "invalid"; tail -8 "$T/invalid.out"; }
[ "$(cat "$T/opt/data/config.json")" = '{"x":1}' ] && ok "data/config.json untouched" || bad "data changed"

rm -rf "$T"; echo "passed=$pass failed=$fail"; [ $fail -eq 0 ]
