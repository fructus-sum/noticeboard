#!/usr/bin/env bash
# shellcheck disable=SC1090,SC2034  # functions are loaded from the installers; the variables set here are read by them
# The upgrade rehearsal (CURRENT_SYSTEM_DESIGN §17): proves an installed Pi takes the code under test
# through its normal update and keeps working, with nothing but the update.
#
#   1. An "installed Pi" on the baseline (NB_BASELINE, default fc4ba53) with realistic data made
#      through its own API, a logged-in admin, and its server kept running by a systemd stand-in
#      (restarted whenever it stops, like Restart=always).
#   2. The BASELINE's update.sh installs the code under test (the working tree): real git, real
#      npm run build, real restart and health check. Then data, API, playlist, login and kiosk
#      answer must be exactly as before.
#   3. The NEW update.sh (now on disk) installs a following commit.
#   4. Going back: the baseline is installed again, and everything is still as before.
# npm install/prune are skipped (node_modules is linked from this repository, and must not be
# changed); FFMPEG_PATH/FFPROBE_PATH are passed on to the server when set.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASELINE="${NB_BASELINE:-fc4ba53}"
PORT=3930
BASE="http://localhost:$PORT"
T=$(mktemp -d); BIN="$T/bin"; MOCK="$T/mock"; PI="$T/pi"; STATE="$REPO/tests/upgrade/state.js"
mkdir -p "$BIN" "$MOCK"
export MOCK
pass=0; fail=0
ok()  { pass=$((pass+1)); echo "PASS  $1"; }
bad() { fail=$((fail+1)); echo "FAIL  $1"; [ -n "${2:-}" ] && sed 's/^/        /' <<<"$2" | tail -25; }

# ── Stand-ins: systemd reports the supervised server; npm only builds ──
REAL_NPM=$(command -v npm)
export REAL_NPM
cat > "$BIN/systemctl" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  is-active) echo active ;;
  show) cat "$MOCK/pid" 2>/dev/null || echo 0 ;;
esac
EOF
cat > "$BIN/npm" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = run ]; then exec "$REAL_NPM" "$@"; fi
echo "npm $* (skipped)" >> "$MOCK/log"
EOF
command -v flock >/dev/null || printf '#!/usr/bin/env bash\nexit 0\n' > "$BIN/flock"
chmod +x "$BIN"/*
export PATH="$BIN:$PATH"

link_modules() {   # the repository's node_modules, never modified (npm install/prune are skipped)
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) cmd //c mklink //J "$(cygpath -w "$1/node_modules")" "$(cygpath -w "$REPO/node_modules")" >/dev/null ;;
    *) ln -s "$REPO/node_modules" "$1/node_modules" ;;
  esac
}

unlink_modules() {
  [ -e "$1/node_modules" ] || return 0
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) cmd //c rmdir "$(cygpath -w "$1/node_modules")" >/dev/null ;;
    *) rm -f "$1/node_modules" ;;
  esac
}

supervise() {   # systemd's Restart=always for noticeboard.service
  while [ ! -f "$MOCK/stop" ]; do
    # NODE_ENV is for the baseline: older code read it (the .env on a real Pi sets it)
    ( cd "$PI" && NODE_ENV=production exec node server/index.js ) >> "$MOCK/server.log" 2>&1 &
    echo $! > "$MOCK/pid"
    wait $!
    sleep 1
  done
}
wait_up() {
  for _ in $(seq 120); do curl -sf -o /dev/null "$BASE/api/auth/status" && return 0; sleep 0.5; done
  return 1
}
cleanup() {
  touch "$MOCK/stop"
  kill "$(cat "$MOCK/pid" 2>/dev/null)" 2>/dev/null
  [ -n "${SUPERVISOR:-}" ] && wait "$SUPERVISOR" 2>/dev/null
  unlink_modules "$PI"   # the link first, so deleting the folder can never reach this repository's node_modules
  rm -rf "$T"
}
trap cleanup EXIT

update() {   # update <expected commit> <name>
  local out rc head
  out=$(bash "$PI/installers/update.sh" 2>&1); rc=$?
  head=$(git -C "$PI" rev-parse HEAD)
  if [ "$rc" -eq 0 ] && grep -q "Updated to" <<<"$out" && [ "$head" = "$1" ]; then
    ok "$2: update.sh installed ${1:0:7}, restarted the server and it answered"
  else
    bad "$2: update.sh (exit $rc, now on ${head:0:7}, wanted ${1:0:7})" "$out"
    return 1
  fi
}
same_as_before() {   # same_as_before <name>
  node "$STATE" snapshot "$BASE" "$PI" "$T/cookie" > "$T/after.json" || { bad "$1: couldn't take a snapshot"; return; }
  local diff
  if diff=$(node "$STATE" compare "$T/before.json" "$T/after.json"); then
    ok "$1: data files, slideshows, slides, settings, logo, playlist, old login and kiosk answer all unchanged"
  else
    bad "$1: something changed" "$diff"
  fi
}

# ── The GitHub stand-in: main = the baseline; the code under test as its own commit ──
git init -q --bare -b main "$T/origin.git"
git -C "$REPO" push -q "$T/origin.git" "$BASELINE:refs/heads/main" || { bad "baseline $BASELINE not found"; exit 1; }
git -c core.autocrlf=false clone -q "$REPO" "$T/cand"
( cd "$REPO" && git ls-files -z --modified --others --exclude-standard ) | while IFS= read -r -d '' f; do
  [ -e "$REPO/$f" ] || continue   # deleted: removed below (git lists it as modified too)
  mkdir -p "$T/cand/$(dirname "$f")"; cp "$REPO/$f" "$T/cand/$f"
done
( cd "$REPO" && git ls-files -z --deleted ) | while IFS= read -r -d '' f; do rm -f "$T/cand/$f"; done
git -C "$T/cand" -c core.autocrlf=false add -A
git -C "$T/cand" -c user.name=t -c user.email=t@t commit -qm "code under test" --allow-empty
CANDIDATE=$(git -C "$T/cand" rev-parse HEAD)
BASELINE_SHA=$(git -C "$REPO" rev-parse "$BASELINE")

# ── The installed Pi, on the baseline ──
git clone -q "$T/origin.git" "$PI"
link_modules "$PI"
mkdir -p "$PI/data/slideshows"
node -e "
  const bcrypt = require(process.argv[1] + '/node_modules/bcrypt');
  require('fs').writeFileSync(process.argv[2], JSON.stringify({ port: $PORT, passwordHash: bcrypt.hashSync('Admin@12345', 4),
    jwtSecret: 'r'.repeat(64), macFiltering: { enabled: false, approved: [{ mac: 'localhost', label: 'Server itself' }] },
    display: { defaultSlideDurationSeconds: 10, showDeviceInfo: true, logo: { enabled: true } }, slideshows: [] }, null, 2));
" "$REPO" "$PI/data/config.json"
echo "Building the baseline (${BASELINE_SHA:0:7})..."
( cd "$PI" && "$REAL_NPM" run build >/dev/null 2>&1 ) || { bad "the baseline doesn't build"; exit 1; }
supervise & SUPERVISOR=$!
wait_up || { bad "the baseline server didn't start" "$(tail -20 "$MOCK/server.log")"; exit 1; }
node "$STATE" seed "$BASE" "$PI" "$T/cookie" || { bad "couldn't seed the data"; exit 1; }
node "$STATE" snapshot "$BASE" "$PI" "$T/cookie" > "$T/before.json" || { bad "couldn't take the first snapshot"; exit 1; }
ok "baseline ${BASELINE_SHA:0:7} installed, with 4 slideshows (incl. the sample), a logo, settings and a logged-in admin"

# ── 1. The baseline's own update.sh installs the code under test ──
git -C "$T/cand" push -q -f "$T/origin.git" HEAD:refs/heads/main
if update "$CANDIDATE" "1. old updater → code under test"; then
  same_as_before "1. after the update"
fi

# ── 2. The new update.sh installs the next commit ──
git -C "$T/cand" -c user.name=t -c user.email=t@t commit -qm "a later commit" --allow-empty
NEXT=$(git -C "$T/cand" rev-parse HEAD)
git -C "$T/cand" push -q -f "$T/origin.git" HEAD:refs/heads/main
if update "$NEXT" "2. new updater → next commit"; then
  same_as_before "2. after the next update"
fi

# ── 3. Going back to the baseline ──
git -C "$REPO" push -q -f "$T/origin.git" "$BASELINE:refs/heads/main"
if update "$BASELINE_SHA" "3. back to the baseline"; then
  same_as_before "3. after going back"
fi

echo "passed=$pass failed=$fail"; [ "$fail" -eq 0 ]
