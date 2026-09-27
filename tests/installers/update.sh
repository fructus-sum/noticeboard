#!/usr/bin/env bash
# shellcheck disable=SC1090,SC2034  # functions are loaded from the installers; the variables set here are read by them
# Exercise installers/update.sh against a throwaway git origin, with systemctl, npm,
# curl and sleep replaced by stand-ins. A background `sleep` plays the server process.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
T=$(mktemp -d); BIN="$T/bin"; export MOCK="$T/mock"; mkdir -p "$BIN" "$MOCK"
export MOCK_INSTALL="$T/install"

cat > "$BIN/systemctl" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  is-active) echo "${MOCK_STATE:-active}"; [ "${MOCK_STATE:-active}" = active ] ;;
  show)
    pid=$(cat "$MOCK/pid" 2>/dev/null || echo 0)
    if [ "$pid" -gt 0 ] && kill -0 "$pid" 2>/dev/null; then echo "$pid"; exit 0; fi
    /usr/bin/sleep 1000 >/dev/null 2>&1 &     # Restart=always: systemd starts a new server
    echo $! > "$MOCK/pid"; echo "server restarted" >> "$MOCK/log"; echo $! ;;
esac
EOF
cat > "$BIN/npm" <<'EOF'
#!/usr/bin/env bash
echo "npm $1" >> "$MOCK/log"
[ "$1" = run ] && [ -f BUILD_FAILS ] && exit 1
exit 0
EOF
cat > "$BIN/curl" <<'EOF'
#!/usr/bin/env bash
[ -f "$MOCK_INSTALL/START_FAILS" ] && exit 7    # the checked-out version never answers
exit 0
EOF
printf '#!/usr/bin/env bash\nexit 0\n' > "$BIN/sleep"
command -v flock >/dev/null || printf '#!/usr/bin/env bash\nexit 0\n' > "$BIN/flock"
chmod +x "$BIN"/*
export PATH="$BIN:$PATH"

git init -q --bare -b main "$T/origin.git"
git clone -q "$T/origin.git" "$T/work" 2>/dev/null
cd "$T/work" && git checkout -q -b main
mkdir -p installers && cp -r "$REPO/installers/update.sh" "$REPO/installers/lib" installers/
commit() { git -c commit.gpgsign=false commit -qm "$1" && git push -q origin main; }
echo v1 > VERSION && git add -A && commit v1
git clone -q "$T/origin.git" "$T/install"
/usr/bin/sleep 1000 >/dev/null 2>&1 & echo $! > "$MOCK/pid"

pass=0; fail=0
check() {  # check "<name>" <expected exit> "<expected text>" "<expected HEAD file content>"
  local name="$1" want_rc="$2" want_text="$3" want_ver="$4" out rc ver
  : > "$MOCK/log"
  out=$(bash "$T/install/installers/update.sh" ${ARGS:-} 2>&1); rc=$?
  ver=$(cat "$T/install/VERSION")
  if [ "$rc" = "$want_rc" ] && grep -q -- "$want_text" <<<"$out" && [ "$ver" = "$want_ver" ]; then
    pass=$((pass+1)); printf 'PASS  %-40s rc=%s on=%s  [%s]\n' "$name" "$rc" "$ver" "$(tr '\n' ',' < "$MOCK/log")"
  else
    fail=$((fail+1)); printf 'FAIL  %-40s rc=%s (want %s) on=%s (want %s)\n----\n%s\n----\n' "$name" "$rc" "$want_rc" "$ver" "$want_ver" "$out"
  fi
}
failed_marker() { cat "$T/install/tmp/update-failed-commit" 2>/dev/null || echo none; }

check "1 nothing new"                     0 "Up to date"            v1
echo v2 > VERSION && git add -A && commit v2
check "2 new commit is deployed"          0 "Updated to"            v2
echo v3 > VERSION && touch BUILD_FAILS && git add -A && commit v3
check "3 build fails -> restore, no restart" 1 "Couldn't install"   v2
[ "$(failed_marker)" = "$(git rev-parse HEAD)" ] && echo "      marker set to v3" || { echo "FAIL marker"; fail=$((fail+1)); }
check "4 failed commit is skipped"        0 "Skipping"              v2
ARGS=--force check "5 --force retries it"  1 "Couldn't install"     v2
git rm -q BUILD_FAILS && echo v4 > VERSION && touch START_FAILS && git add -A && commit v4
check "6 won't start -> roll back"        1 "Rolled back"           v2
git rm -q START_FAILS && echo v5 > VERSION && echo "# changed" >> installers/update.sh && git add -A && commit v5
check "7 fix deploys, script replaced"    0 "Updated to"            v5
[ "$(failed_marker)" = none ] && echo "      marker cleared" || { echo "FAIL marker not cleared"; fail=$((fail+1)); }
echo v6 > VERSION && git add -A && commit v6
MOCK_STATE=inactive check "8 service stopped -> no update" 0 "isn't updated" v5
mkdir -p "$T/install/tmp/noticeboard-uploads" && touch "$T/install/tmp/noticeboard-uploads/upload-123"
check "9 upload in progress -> wait"      0 "upload is being processed" v5
rm "$T/install/tmp/noticeboard-uploads/upload-123"
check "10 after the upload -> deployed"   0 "Updated to"            v6

kill "$(cat "$MOCK/pid")" 2>/dev/null; rm -rf "$T"
echo "passed=$pass failed=$fail"; [ "$fail" -eq 0 ]
