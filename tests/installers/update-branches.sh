#!/usr/bin/env bash
# shellcheck disable=SC1090,SC2034  # functions are loaded from the installers; the variables set here are read by them
# Exercise installers/update.sh's branch switching against a throwaway git origin, with
# systemctl, npm, curl, sleep and flock replaced by stand-ins. A background `sleep` plays the
# server process. Every path of a switch: success, each refusal, each failure and rollback.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
T=$(mktemp -d); BIN="$T/bin"; export MOCK="$T/mock"; mkdir -p "$BIN" "$MOCK"
export MOCK_INSTALL="$T/install" GITHUB_STANDIN="$REPO/tests/helpers/github.sh"; I="$MOCK_INSTALL"
source "$GITHUB_STANDIN"   # main follows Releases: main-1 is published as one

cat > "$BIN/systemctl" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  is-active) echo "${MOCK_STATE:-active}"; [ "${MOCK_STATE:-active}" = active ] ;;
  show)
    pid=$(cat "$MOCK/pid" 2>/dev/null || echo 0)
    if [ "$pid" -gt 0 ] && kill -0 "$pid" 2>/dev/null; then echo "$pid"; exit 0; fi
    /usr/bin/sleep 1000 >/dev/null 2>&1 9>&- &     # Restart=always: systemd starts a new server
    echo $! > "$MOCK/pid"; echo "restart" >> "$MOCK/log"; echo $! ;;
esac
EOF
cat > "$BIN/npm" <<'EOF'
#!/usr/bin/env bash
echo "npm-$1" >> "$MOCK/log"
[ "$1" = run ] && [ -f BUILD_FAILS ] && exit 1
[ "$1" = run ] && [ -f "$MOCK/BUILD_FAILS_ALWAYS" ] && exit 1
exit 0
EOF
cat > "$BIN/curl" <<'EOF'
#!/usr/bin/env bash
case "$*" in */releases/latest*) source "$GITHUB_STANDIN"; fake_latest_release "$@"; exit $? ;; esac
[ -f "$MOCK_INSTALL/START_FAILS" ] && exit 7    # the checked-out version never answers
exit 0
EOF
printf '#!/usr/bin/env bash\nexit 0\n' > "$BIN/sleep"
printf '#!/usr/bin/env bash\n[ -z "${MOCK_LOCKED:-}" ]\n' > "$BIN/flock"
chmod +x "$BIN"/*
export PATH="$BIN:$PATH"

# ── origin: main plus a branch for every case ──
git init -q --bare -b main "$T/origin.git"
git clone -q "$T/origin.git" "$T/work" 2>/dev/null
W="$T/work"; cd "$W" && git checkout -q -b main
g() { git -c commit.gpgsign=false -c user.name=t -c user.email=t@t "$@"; }
mkdir -p installers && cp -r "$REPO/installers/update.sh" "$REPO/installers/lib" installers/ && printf 'data/\ntmp/\n' > .gitignore
echo main-1 > VERSION && git add -A && g commit -qm main-1 && git push -q origin main && publish_release v1
branch() {   # branch <name> <setup command>: a branch off main with one commit
  git checkout -q -b "$1" main && eval "$2" && git add -A && g commit -qm "$1" && git push -q origin "$1" && git checkout -q main
}
branch feature/good 'echo good-1 > VERSION'
branch old          'echo old-1 > VERSION && sed -i "s/update-branch\.env/branch-settings/g" installers/update.sh'
branch tracks-data  'echo data-1 > VERSION && mkdir -p data && echo "{\"evil\":true}" > data/config.json && git add -f data/config.json'
branch broken       'echo broken-1 > VERSION && touch BUILD_FAILS'
branch wontstart    'echo wontstart-1 > VERSION && touch START_FAILS'
git push -q origin main:refs/heads/same    # the same commit as main

git clone -q "$T/origin.git" "$I"
mkdir -p "$I/data/slideshows/s1/slides" "$I/tmp"
echo '{"port":3000,"passwordHash":"x"}' > "$I/data/config.json"
echo '{"name":"S1"}' > "$I/data/slideshows/s1/slideshow.json"
echo 'jpeg' > "$I/data/slideshows/s1/slides/a.jpg"
DATA_SUM=$(cd "$I/data" && find . -path ./backups -prune -o -path ./update-\* -prune -o -type f -print | sort | xargs cat | md5sum)
/usr/bin/sleep 1000 >/dev/null 2>&1 & echo $! > "$MOCK/pid"

# ── helpers ──
pass=0; fail=0; OUT=""; RC=0
# shellcheck disable=SC2120  # run passes on update.sh arguments, though the cases here need none
run() { : > "$MOCK/log"; OUT=$(cd / && bash "$I/installers/update.sh" "$@" 2>&1); RC=$?; }
t() {   # t "<name>" "<condition>"
  if eval "$2"; then pass=$((pass+1)); echo "PASS  $1"
  else
    fail=$((fail+1)); echo "FAIL  $1    [$2]"
    echo "  out: $OUT" | head -5; echo "  status: $(cat "$I/data/update-status.json" 2>/dev/null)"
    echo "  check: $(cat "$I/data/update-check.json" 2>/dev/null)"; echo "  log: $(tr '\n' ' ' < "$MOCK/log")"
  fi
}
on()      { git -C "$I" symbolic-ref --short HEAD; }
ver()     { cat "$I/VERSION"; }
setting() { sed -n 's/^NOTICEBOARD_BRANCH=//p' "$I/data/update-branch.env" 2>/dev/null; }
json()    { node -e "const s=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));process.stdout.write(String(s[process.argv[2]]))" "$1" "$2"; }
state()   { json "$I/data/update-status.json" state; }
msg()     { json "$I/data/update-status.json" message; }
result()  { json "$I/data/update-check.json" result; }
request() { echo "NOTICEBOARD_BRANCH=$1" > "$I/data/update-branch.env"; echo x > "$I/tmp/update-request"; }
data_ok() { [ "$(cd "$I/data" && find . -path ./backups -prune -o -path ./update-\* -prune -o -type f -print | sort | xargs cat | md5sum)" = "$DATA_SUM" ]; }
built()   { grep -q npm-run "$MOCK/log"; }
commit_of() { git -C "$T/origin.git" rev-parse "$1"; }

echo "── following main"
run
t "1 no setting: follows main, up to date" '[ $RC = 0 ] && [ "$(on)" = main ] && [ "$(result)" = up-to-date ] && [ ! -f "$I/data/update-status.json" ]'

echo "── a successful switch"
request feature/good; run
t "2 switch: now on feature/good" '[ $RC = 0 ] && [ "$(on)" = feature/good ] && [ "$(ver)" = good-1 ] && built && grep -q restart "$MOCK/log"'
t "2 switch: status says so, setting kept" '[ "$(state)" = updated ] && [[ "$(msg)" == *"Switched from main to feature/good"* ]] && [ "$(setting)" = feature/good ]'
t "2 switch: request taken, data untouched" '[ ! -f "$I/tmp/update-request" ] && data_ok'
BK=$(ls -d "$I"/data/backups/*-from-main 2>/dev/null | head -1)
t "2 switch: settings backed up first" '[ -n "$BK" ] && [ -f "$BK/config.json" ] && [ -f "$BK/slideshows/s1/slideshow.json" ] && [ ! -e "$BK/slideshows/s1/slides" ] && [[ "$(msg)" == *"data/backups/"* ]]'
t "2 switch: status JSON has the recovery details" '[ "$(json "$I/data/update-status.json" previousBranch)" = main ] && [ "$(json "$I/data/update-status.json" previousCommit)" = "$(commit_of main)" ] && [ "$(json "$I/data/update-status.json" target)" = "$(commit_of feature/good)" ]'
run
t "3 later checks keep using feature/good" '[ $RC = 0 ] && [ "$(on)" = feature/good ] && [ "$(result)" = up-to-date ] && ! built'
cd "$W" && git checkout -q feature/good && echo good-2 > VERSION && git add -A && g commit -qm good-2 && git push -q origin feature/good && git checkout -q main
run
t "4 a new commit on feature/good is installed" '[ $RC = 0 ] && [ "$(on)" = feature/good ] && [ "$(ver)" = good-2 ] && [ "$(state)" = updated ] && [[ "$(msg)" == "Updated to"* ]]'
request main; run
t "5 switch back to main" '[ $RC = 0 ] && [ "$(on)" = main ] && [ "$(ver)" = main-1 ] && [ "$(setting)" = main ] && data_ok'

echo "── refused before anything changes"
request old; run
t "6 branch without branch switching: cancelled" '[ $RC = 1 ] && [ "$(on)" = main ] && [ "$(ver)" = main-1 ] && [ "$(state)" = cancelled ] && [[ "$(msg)" == *"older than branch switching"* ]] && [ "$(setting)" = main ] && ! built'
request tracks-data; run
t "7 branch with files in data/: cancelled, data untouched" '[ $RC = 1 ] && [ "$(on)" = main ] && [ "$(state)" = cancelled ] && [[ "$(msg)" == *"data/"* ]] && [ "$(setting)" = main ] && data_ok && ! built'
request nope; run
t "8 branch that doesn't exist: cancelled" '[ $RC = 1 ] && [ "$(on)" = main ] && [ "$(state)" = cancelled ] && [[ "$(msg)" == *"doesn'"'"'t exist"* ]] && [ "$(setting)" = main ]'
request 'bad..name'; run
t "9 invalid name: ignored, setting restored" '[ $RC = 1 ] && [ "$(on)" = main ] && [ "$(state)" = cancelled ] && [ "$(setting)" = main ]'
request 'bad"quote\name'; run
t "10 a name with quotes still gives valid JSON" '[ $RC = 1 ] && [ "$(state)" = cancelled ] && [ "$(setting)" = main ]'
mv "$T/origin.git" "$T/origin.away"
request feature/good; run
t "11 GitHub unreachable during a switch: cancelled" '[ $RC = 1 ] && [ "$(on)" = main ] && [ "$(state)" = cancelled ] && [[ "$(msg)" == *"Couldn'"'"'t download"* ]] && [ "$(setting)" = main ]'
run
t "12 GitHub unreachable on a normal check: reported" '[ $RC = 1 ] && [ "$(result)" = offline ] && [ "$(on)" = main ]'
mv "$T/origin.away" "$T/origin.git"

echo "── failures roll back"
request broken; run
t "13 build fails: rolled back to main" '[ $RC = 1 ] && [ "$(on)" = main ] && [ "$(ver)" = main-1 ] && [ "$(state)" = rolled-back ] && [ "$(setting)" = main ] && data_ok && ! grep -q restart "$MOCK/log"'
t "13 failed commit remembered" '[ "$(cat "$I/tmp/update-failed-commit")" = "$(commit_of broken)" ]'
run
t "14 next check stays on main" '[ $RC = 0 ] && [ "$(on)" = main ] && [ "$(result)" = up-to-date ] && ! built'
request broken; run
t "15 asking again retries it (and rolls back again)" '[ $RC = 1 ] && [ "$(on)" = main ] && [ "$(state)" = rolled-back ] && built'
echo "NOTICEBOARD_BRANCH=broken" > "$I/data/update-branch.env"; run
t "16 setting changed without a request: known-bad commit, cancelled" '[ $RC = 0 ] && [ "$(on)" = main ] && [ "$(state)" = cancelled ] && [ "$(setting)" = main ] && ! built'
request wontstart; run
t "17 won't start: rolled back and restarted" '[ $RC = 1 ] && [ "$(on)" = main ] && [ "$(ver)" = main-1 ] && [ "$(state)" = rolled-back ] && [ "$(grep -c restart "$MOCK/log")" -ge 2 ] && [ "$(setting)" = main ]'
touch "$MOCK/BUILD_FAILS_ALWAYS"; request feature/good; run
t "18 rollback fails too: failed, with recovery steps" '[ $RC = 1 ] && [ "$(state)" = failed ] && [[ "$(msg)" == *"run the installer"* ]] && [[ "$(msg)" == *"curl -fsSL"* ]] && [ "$(setting)" = main ] && data_ok'
rm "$MOCK/BUILD_FAILS_ALWAYS"; rm -f "$I/tmp/update-failed-commit"
git -C "$I" checkout -q --force -B main "$(commit_of main)"; run
t "19 recovered: main again" '[ $RC = 0 ] && [ "$(on)" = main ] && [ "$(ver)" = main-1 ]'

echo "── waiting"
request same; run
t "20 same version on another branch: nothing rebuilt" '[ $RC = 0 ] && [ "$(on)" = same ] && [ "$(state)" = updated ] && [[ "$(msg)" == *"same version"* ]] && ! built && ! grep -q restart "$MOCK/log"'
request main; run
t "20 and back" '[ $RC = 0 ] && [ "$(on)" = main ]'
request feature/good; MOCK_LOCKED=1 run
t "21 lock busy: request taken, status says when" '[ $RC = 0 ] && [ "$(on)" = main ] && [ "$(state)" = requested ] && [[ "$(msg)" == *"next check"* ]] && [ ! -f "$I/tmp/update-request" ] && [ "$(setting)" = feature/good ]'
mkdir -p "$I/tmp/noticeboard-uploads" && touch "$I/tmp/noticeboard-uploads/u1"; run
t "22 upload in progress: switch waits" '[ $RC = 0 ] && [ "$(on)" = main ] && [ "$(state)" = requested ] && [ "$(result)" = waiting ]'
rm "$I/tmp/noticeboard-uploads/u1"; MOCK_STATE=inactive run
t "23 service stopped: switch waits" '[ $RC = 0 ] && [ "$(on)" = main ] && [ "$(state)" = requested ] && [ "$(result)" = waiting ]'
run
t "24 the next check does the switch" '[ $RC = 0 ] && [ "$(on)" = feature/good ] && [ "$(state)" = updated ]'
request main; run

echo "── a one-off test run"
NOTICEBOARD_BRANCH=feature/good run
t "25 NOTICEBOARD_BRANCH switches once, setting untouched" '[ $RC = 0 ] && [ "$(on)" = feature/good ] && [ "$(setting)" = main ]'
run
t "25 next check returns to the setting" '[ $RC = 0 ] && [ "$(on)" = main ]'
NOTICEBOARD_BRANCH=broken run
t "26 failed one-off run leaves the setting alone" '[ $RC = 1 ] && [ "$(on)" = main ] && [ "$(setting)" = main ]'

echo "── every status file is valid JSON"
t "27 status and check files parse" 'node -e "JSON.parse(require(\"fs\").readFileSync(process.argv[1]));JSON.parse(require(\"fs\").readFileSync(process.argv[2]))" "$I/data/update-status.json" "$I/data/update-check.json"'

kill "$(cat "$MOCK/pid")" 2>/dev/null; rm -rf "$T"
echo "passed=$pass failed=$fail"; [ "$fail" -eq 0 ]
