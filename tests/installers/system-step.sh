#!/usr/bin/env bash
# shellcheck disable=SC1090,SC2016,SC2034  # the variables set here are read by the scripts and stand-ins
# Installations that update themselves (SYSTEM_DESIGN §18.7 phase 2), with stand-ins for curl,
# systemctl, npm, sleep and logger, and GitHub's Releases API (tests/helpers/github.sh):
#   1. root's system step (installers/root/noticeboard-system): refuses anything but main's latest
#      Release (a bad request, a Server on a branch, no Release, another commit), reports GitHub or
#      a download failing, and runs that Release's installer with --apply;
#   2. the noticeboard command (installers/root/noticeboard): update, update --full, status;
#   3. update.sh asking for the system step on main: needed, not needed, failing (the Release is
#      skipped, the code untouched), no answer, not set up; a Full update, and one on a branch.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
T=$(mktemp -d); BIN="$T/bin"; export MOCK="$T/mock" T; mkdir -p "$BIN" "$MOCK"
export GITHUB_STANDIN="$REPO/tests/helpers/github.sh"
source "$GITHUB_STANDIN"
pass=0; fail=0
ok()  { pass=$((pass+1)); echo "PASS  $1"; }
bad() { fail=$((fail+1)); echo "FAIL  $1"; [ -n "${2:-}" ] && sed 's/^/        /' <<<"$2" | head -12; }
json() { node -e "try{const v=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))[process.argv[2]];process.stdout.write(String(v??''))}catch{}" "$1" "$2"; }

# ── Stand-ins ──
# curl: the Releases API (github.sh), a commit's sha (MOCK/release-sha), a downloaded installer that
# records how it was run (MOCK/apply.log; it fails when MOCK/apply-fails exists), and the health check
cat > "$BIN/curl" <<'EOF'
#!/usr/bin/env bash
case "$*" in */releases/latest*) source "$GITHUB_STANDIN"; fake_latest_release "$@"; exit $? ;; esac
case "$*" in
  *api.github.com*/commits/*) [ -f "$MOCK/github-down" ] && exit 6; cat "$MOCK/release-sha" 2>/dev/null || exit 22 ;;
  *raw.githubusercontent.com*/installers/install.sh*)
    [ -f "$MOCK/raw-down" ] && exit 22
    out=""; prev=""; for a; do [ "$prev" = -o ] && out=$a; prev=$a; done
    printf '#!/usr/bin/env bash\necho "APPLY args=$* sha=$NOTICEBOARD_INSTALLER_SHA release=$NOTICEBOARD_INSTALLER_RELEASE" >> "$MOCK/apply.log"\n[ -f "$MOCK/apply-fails" ] && { echo "E: Unable to locate package cage"; exit 100; }\necho "Done: installer version 6 applied."\n' > "$out" ;;
esac
exit 0
EOF
printf '#!/usr/bin/env bash\nexit 0\n' > "$BIN/logger"
chmod +x "$BIN"/*
export PATH="$BIN:$PATH"

# ═══ 1. Root's system step ═══
O="$T/opt"; mkdir -p "$O/tmp" "$O/data"
SHA_A=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
step() {   # step [<request>]: runs noticeboard-system with that request
  rm -f "$O/tmp/system-result" "$MOCK/apply.log"
  if [ -n "${1:-}" ]; then echo "$1" > "$O/tmp/system-request"; fi
  OUT=$(NOTICEBOARD_ROOT_LIB="$REPO/installers/lib" NOTICEBOARD_DIR="$O" bash "$REPO/installers/root/noticeboard-system" 2>&1); RC=$?
}
res() { json "$O/tmp/system-result" "$1"; }
echo v0.9.0 > "$MOCK/release"; echo "$SHA_A" > "$MOCK/release-sha"

step
[ $RC -eq 0 ] && [ ! -f "$O/tmp/system-result" ] && ok "no request: nothing happens" || bad "no request" "$OUT"
step "not a commit"
[ $RC -ne 0 ] && [ "$(res result)" = refused ] && [ ! -f "$O/tmp/system-request" ] && [ ! -f "$MOCK/apply.log" ] \
  && ok "a request without a commit: refused, the request taken, nothing run" || bad "bad request" "$OUT"
echo "NOTICEBOARD_BRANCH=feature/x" > "$O/data/update-branch.env"
step "$SHA_A"
[ "$(res result)" = refused ] && [[ "$(res message)" == *"follows feature/x"* ]] && [ ! -f "$MOCK/apply.log" ] \
  && ok "a Server on a branch: refused (its installer is run by hand)" || bad "branch" "$OUT"
rm -f "$O/data/update-branch.env"
rm -f "$MOCK/release"
step "$SHA_A"
[ "$(res result)" = refused ] && [[ "$(res message)" == *"No Release"* ]] && ok "no Release published: refused" || bad "no release" "$OUT"
echo v0.9.0 > "$MOCK/release"; touch "$MOCK/github-down"
step "$SHA_A"
[ "$(res result)" = failed ] && [ ! -f "$MOCK/apply.log" ] && ok "GitHub can't be asked: failed, nothing run" || bad "github down" "$OUT"
rm -f "$MOCK/github-down"
step "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
[ "$(res result)" = refused ] && [[ "$(res message)" == *"isn't main's latest Release (v0.9.0"* ]] && [ ! -f "$MOCK/apply.log" ] \
  && ok "a commit that isn't the latest Release's: refused, nothing run (a fork's commit can't get root)" || bad "other commit" "$OUT"
touch "$MOCK/raw-down"
step "$SHA_A"
[ "$(res result)" = failed ] && [[ "$(res message)" == *"Couldn't download the installer"* ]] && ok "the installer can't be downloaded: failed" || bad "raw down" "$OUT"
rm -f "$MOCK/raw-down"
step "$SHA_A"
[ $RC -eq 0 ] && [ "$(res result)" = done ] && [ "$(res commit)" = "$SHA_A" ] && [ "$(res release)" = v0.9.0 ] \
  && grep -q "APPLY args=--apply sha=$SHA_A release=v0.9.0" "$MOCK/apply.log" && [ ! -f "$O/tmp/system-request" ] \
  && ok "main's latest Release: its installer runs with --apply, pinned to its commit; done reported" || bad "done" "$OUT"
touch "$MOCK/apply-fails"
step "$SHA_A"
[ "$(res result)" = failed ] && [[ "$(res message)" == *"Unable to locate package cage"* ]] && ok "the installer fails: failed, with its last lines" || bad "apply fails" "$OUT"
rm -f "$MOCK/apply-fails"

# ═══ 2. The noticeboard command ═══
C="$T/cmd"; mkdir -p "$C"; git -C "$C" init -q -b main
git -C "$C" -c user.name=t -c user.email=t@t commit -q --allow-empty -m one && git -C "$C" tag v0.3.0
mkdir -p "$C/data" "$C/tmp"
printf '{"state":"updated","message":"Updated to Release v0.3.0 (abc1234), fine.","time":"2026-09-29T08:00:00Z"}\n' > "$C/data/update-status.json"
printf '{"version":6,"branch":"main","commit":"x","time":"2026-09-29T07:00:00Z"}\n' > "$C/data/installer.json"
printf '{"commit":"%s","release":"v0.3.0","result":"done","message":"All set.","time":"2026-09-29T07:30:00Z"}\n' "$SHA_A" > "$C/tmp/system-result"
cmd() { OUT=$(NOTICEBOARD_DIR="$C" bash "$REPO/installers/root/noticeboard" "$@" 2>&1); RC=$?; }
cmd update
[ $RC -eq 0 ] && [ "$(cat "$C/tmp/update-request")" = install-now ] && ok "noticeboard update: asks for an update now" || bad "update" "$OUT"
cmd update --full
[ $RC -eq 0 ] && [ "$(cat "$C/tmp/update-request")" = full ] && ok "noticeboard update --full: asks for a Full update" || bad "full" "$OUT"
rm -f "$C/tmp/update-request"; echo "NOTICEBOARD_BRANCH=feature/x" > "$C/data/update-branch.env"
cmd update --full
[ $RC -ne 0 ] && [ ! -f "$C/tmp/update-request" ] && grep -q "feature/x/installers/install.sh | sudo NOTICEBOARD_INSTALL_BRANCH=feature/x bash" <<<"$OUT" && ok "noticeboard update --full on a branch: refused, with the installer command (naming the branch)" || bad "full branch" "$OUT"
rm -f "$C/data/update-branch.env"
cmd status
grep -q "^Last check   : not yet" <<<"$OUT" && ok "noticeboard status before the first check: says not yet (found in a Debian VM)" || bad "status not yet" "$OUT"
printf '{"result":"up-to-date","message":"Up to date.","time":"2026-09-29T08:30:00Z"}
' > "$C/data/update-check.json"
cmd status
grep -q "^Last check   : 2026-09-29T08:30:00Z Up to date." <<<"$OUT" && ok "  … and the last check once there is one" || bad "status check" "$OUT"
grep -q "^Running      : Release v0.3.0, " <<<"$OUT" && grep -q "Updated to Release v0.3.0 (abc1234), fine." <<<"$OUT" && grep -q "^Installer    : version 6" <<<"$OUT" \
  && grep -q "^System step  : .*done: All set." <<<"$OUT" && ok "noticeboard status: the Release, the last update (commas and all), the installer, the system step" || bad "status" "$OUT"
cmd nonsense
[ $RC -eq 2 ] && grep -q "Usage" <<<"$OUT" && ok "noticeboard: an unknown command fails, with the usage" || bad "usage" "$OUT"

# ═══ 3. update.sh and the system step ═══
cat > "$BIN/systemctl" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  is-active) echo active ;;
  is-enabled) [ -f "$MOCK/system-ready" ] ;;
  show) n=$(cat "$MOCK/pid" 2>/dev/null || echo 3999000); echo "$n"; echo $((n + 1)) > "$MOCK/pid"; echo restart >> "$MOCK/log" ;;
esac
EOF
cat > "$BIN/npm" <<'EOF'
#!/usr/bin/env bash
echo "npm-$1" >> "$MOCK/log"
exit 0
EOF
# sleep plays root's system step: it answers a request with MOCK/system-answer (done or failed),
# unless MOCK/system-silent exists
cat > "$BIN/sleep" <<'EOF'
#!/usr/bin/env bash
I="$MOCK_INSTALL"
if [ -f "$I/tmp/system-request" ] && [ ! -f "$MOCK/system-silent" ]; then
  commit=$(head -n 1 "$I/tmp/system-request"); rm -f "$I/tmp/system-request"
  echo "system step for $commit" >> "$MOCK/system.log"
  answer=$(cat "$MOCK/system-answer" 2>/dev/null || echo done)
  printf '{"commit":"%s","release":"v","result":"%s","message":"The answer was %s.","time":"t"}\n' "$commit" "$answer" "$answer" > "$I/tmp/system-result"
fi
exit 0
EOF
printf '#!/usr/bin/env bash\nexit 0\n' > "$BIN/flock"
chmod +x "$BIN"/*
export MOCK_INSTALL="$T/install"; I="$MOCK_INSTALL"
git init -q --bare -b main "$T/origin.git"
git clone -q "$T/origin.git" "$T/work" 2>/dev/null
W="$T/work"; cd "$W" && git checkout -q -b main
g() { git -c commit.gpgsign=false -c user.name=t -c user.email=t@t "$@"; }
mkdir -p installers && cp -r "$REPO/installers/update.sh" "$REPO/installers/lib" installers/ && printf 'data/\ntmp/\n' > .gitignore
release() {   # release <tag> <installer version>: a commit of main needing that installer, published
  echo "{\"installer\":{\"version\":$2}}" > system-requirements.json; echo "$1" > VERSION
  git add -A && g commit -qm "$1" && git push -q origin HEAD && publish_release "$1"
}
release v1 5
git clone -q "$T/origin.git" "$I"
mkdir -p "$I/data" "$I/tmp"; echo '{"port":3000}' > "$I/data/config.json"
record() { echo "{\"version\":$1,\"branch\":\"main\",\"commit\":\"x\",\"time\":\"t\"}" > "$I/data/installer.json"; }
run() { : > "$MOCK/log"; rm -f "$MOCK/system.log"; OUT=$(cd / && bash "$I/installers/update.sh" "$@" 2>&1); RC=$?; }
ver() { cat "$I/VERSION"; }
state() { json "$I/data/update-status.json" state; }
msg() { json "$I/data/update-status.json" message; }
request() { echo "$1" > "$I/tmp/update-request"; run; }

record 5; touch "$MOCK/system-ready"
release v2 6
run
[ $RC -eq 0 ] && [ "$(ver)" = v2 ] && grep -q "system step for $(git rev-parse HEAD)" "$MOCK/system.log" && grep -q npm-run "$MOCK/log" \
  && ok "a Release needing a newer installer: the system step first, then the code" || bad "system step needed" "$OUT"
record 6
release v3 6
run
[ $RC -eq 0 ] && [ "$(ver)" = v3 ] && [ ! -f "$MOCK/system.log" ] && ok "the installer is up to date: no system step" || bad "not needed" "$OUT"
release v4 7; echo failed > "$MOCK/system-answer"
run
[ $RC -eq 1 ] && [ "$(ver)" = v3 ] && ! grep -q npm-run "$MOCK/log" && [ "$(state)" = failed ] && [[ "$(msg)" == *"system step, which didn't work: The answer was failed."* ]] \
  && [ "$(cat "$I/tmp/update-failed-commit")" = "$(git rev-parse HEAD)" ] && ok "the system step fails: the code untouched, the Release skipped, the status says why" || bad "fails" "$OUT"
run
[ "$(ver)" = v3 ] && [ ! -f "$MOCK/system.log" ] && ok "  … and not tried again until a new Release" || bad "retried" "$OUT"
rm -f "$MOCK/system-answer"
release v5 7; touch "$MOCK/system-silent"
run
[ $RC -eq 1 ] && [ "$(ver)" = v3 ] && [[ "$(msg)" == *"didn't answer within 45 minutes"* ]] && [ ! -f "$I/tmp/system-request" ] \
  && ok "no answer from the system step: the code untouched, the request withdrawn" || bad "silent" "$OUT"
rm -f "$MOCK/system-silent" "$MOCK/system-ready"
release v6 8
run
[ $RC -eq 0 ] && [ "$(ver)" = v6 ] && [ ! -f "$MOCK/system.log" ] && ok "the system step not set up (a Server from before 0.9.0): the code installs as before" || bad "not set up" "$OUT"
touch "$MOCK/system-ready"; record 8
request full
[ $RC -eq 0 ] && [ "$(ver)" = v6 ] && grep -q "system step for" "$MOCK/system.log" && grep -q npm-run "$MOCK/log" && [[ "$(msg)" == "Full update done"* ]] \
  && ok "a Full update: the system step, then the same Release installed again" || bad "full" "$OUT"
rm -f "$MOCK/system-ready"
request full
[ $RC -eq 1 ] && [[ "$(msg)" == *"isn't set up on this Server yet"* ]] && ! grep -q npm-run "$MOCK/log" && ok "a Full update without the system step: refused, says to run the installer once" || bad "full not set up" "$OUT"
touch "$MOCK/system-ready"
git checkout -q -b feature/x && echo x > X.txt && git add -A && g commit -qm x && git push -q origin feature/x && git checkout -q main
echo "NOTICEBOARD_BRANCH=feature/x" > "$I/data/update-branch.env"; echo x > "$I/tmp/update-request"; run
request full
[ $RC -eq 1 ] && [[ "$(msg)" == *"only runs by itself for main's Releases"* ]] && [ ! -f "$MOCK/system.log" ] && ok "a Full update on a branch: refused, says to run the installer by hand" || bad "full branch" "$OUT"

cd /; rm -rf "$T"; echo "passed=$pass failed=$fail"; [ "$fail" -eq 0 ]
