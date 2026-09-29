#!/usr/bin/env bash
# shellcheck disable=SC1090,SC2034  # functions are loaded from the installers; the variables set here are read by them
# main follows GitHub Releases (SYSTEM_DESIGN §18.6): installers/update.sh against a throwaway git
# origin with GitHub's Releases API stood in (tests/helpers/github.sh), and systemctl, npm and
# sleep as in tests/installers/update-branches.sh. The latest Release is installed, never main's
# newer commits; drafts, prereleases and no Release change nothing; main never goes backwards by
# itself, but a switch to main or Restore Defaults installs an older Release; the waiting version
# names its Release; the recovery command comes from the Release.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
T=$(mktemp -d); BIN="$T/bin"; export MOCK="$T/mock"; mkdir -p "$BIN" "$MOCK"
export MOCK_INSTALL="$T/install" GITHUB_STANDIN="$REPO/tests/helpers/github.sh"; I="$MOCK_INSTALL"
source "$GITHUB_STANDIN"
cat > "$BIN/systemctl" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  is-active) echo active ;;
  show) n=$(cat "$MOCK/pid" 2>/dev/null || echo 3999000); echo "$n"; echo $((n + 1)) > "$MOCK/pid"; echo restart >> "$MOCK/log" ;;
esac
EOF
cat > "$BIN/npm" <<'EOF'
#!/usr/bin/env bash
echo "npm-$1" >> "$MOCK/log"
[ "$1" = run ] && { [ -f BUILD_FAILS ] || [ -f "$MOCK/BUILD_FAILS_ALWAYS" ]; } && exit 1
exit 0
EOF
cat > "$BIN/curl" <<'EOF'
#!/usr/bin/env bash
case "$*" in */releases/latest*) source "$GITHUB_STANDIN"; fake_latest_release "$@"; exit $? ;; esac
exit 0
EOF
printf '#!/usr/bin/env bash\nexit 0\n' > "$BIN/sleep"; cp "$BIN/sleep" "$BIN/flock"
chmod +x "$BIN"/*
export PATH="$BIN:$PATH"

git init -q --bare -b main "$T/origin.git"
git clone -q "$T/origin.git" "$T/work" 2>/dev/null
W="$T/work"; cd "$W" && git checkout -q -b main
g() { git -c commit.gpgsign=false -c user.name=t -c user.email=t@t "$@"; }
mkdir -p installers && cp -r "$REPO/installers/update.sh" "$REPO/installers/lib" installers/ && printf 'data/\ntmp/\n' > .gitignore
commit() { echo "$1" > VERSION && git add -A && g commit -qm "$1" && git push -q origin HEAD; }
commit m1
git clone -q "$T/origin.git" "$I"
mkdir -p "$I/data" "$I/tmp"; echo '{"port":3000}' > "$I/data/config.json"

pass=0; fail=0; OUT=""; RC=0
run() { : > "$MOCK/log"; OUT=$(cd / && bash "$I/installers/update.sh" "$@" 2>&1); RC=$?; }
t() {
  if eval "$2"; then pass=$((pass+1)); echo "PASS  $1"
  else
    fail=$((fail+1)); echo "FAIL  $1    [$2]"
    echo "  out: $OUT" | head -6; echo "  on: $(ver) $(on)"
    echo "  status: $(cat "$I/data/update-status.json" 2>/dev/null)"; echo "  check: $(cat "$I/data/update-check.json" 2>/dev/null)"
  fi
}
ver()     { cat "$I/VERSION"; }
on()      { git -C "$I" symbolic-ref --short HEAD; }
setting() { sed -n 's/^NOTICEBOARD_BRANCH=//p' "$I/data/update-branch.env" 2>/dev/null; }
json()    { node -e "const s=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));process.stdout.write(String(s[process.argv[2]] ?? ''))" "$1" "$2" 2>/dev/null; }
check()   { json "$I/data/update-check.json" "$1"; }
state()   { json "$I/data/update-status.json" state; }
msg()     { json "$I/data/update-status.json" message; }
built()   { grep -q npm-run "$MOCK/log"; }
request() { echo "NOTICEBOARD_BRANCH=$1" > "$I/data/update-branch.env"; echo x > "$I/tmp/update-request"; run; }

echo "── no Release yet"
commit m2
run
t "none published: nothing installed, not an error" '[ $RC = 0 ] && [ "$(ver)" = m1 ] && ! built && [ "$(check result)" = up-to-date ] && [[ "$(check message)" == "No Release of Noticeboard has been published on GitHub yet."* ]]'
echo prerelease > "$MOCK/release-kind"; publish_release v0.1.0-rc
run
t "a prerelease counts as none" '[ $RC = 0 ] && [ "$(ver)" = m1 ] && ! built'
echo draft > "$MOCK/release-kind"
run
t "a draft counts as none" '[ $RC = 0 ] && [ "$(ver)" = m1 ] && ! built'
rm -f "$MOCK/release-kind" "$MOCK/release"

echo "── the latest Release"
publish_release v0.1.0          # m2
commit m3                       # main moves on, unreleased
run
t "installs the latest Release, not main's newer commit" '[ $RC = 0 ] && [ "$(ver)" = m2 ] && [ "$(on)" = main ] && built && [[ "$(msg)" == "Updated to Release v0.1.0 ("* ]]'
t "  … the check names the Release" '[[ "$(check message)" == "Up to date: running Release v0.1.0 ("* ]]'
t "  … the Release's tag is on the Server" '[ "$(git -C "$I" tag --points-at HEAD)" = v0.1.0 ]'
run
t "then: main's newer commits aren't installed" '[ $RC = 0 ] && [ "$(ver)" = m2 ] && ! built'
g tag -a -m "Version 0.2.0" v0.2.0 HEAD && git push -q origin refs/tags/v0.2.0 && echo v0.2.0 > "$MOCK/release"   # m3, annotated
run
t "an annotated tag's Release is installed" '[ $RC = 0 ] && [ "$(ver)" = m3 ] && built'
commit m4; publish_release v0.3.0; touch "$MOCK/github-down"
run
t "the API unreachable: offline, nothing installed" '[ $RC = 1 ] && [ "$(ver)" = m3 ] && [ "$(check result)" = offline ]'
rm -f "$MOCK/github-down"

echo "── a waiting Release names itself"
printf 'NOTICEBOARD_UPDATE_EVERY=manual\n' > "$I/data/update-schedule.env"
echo check > "$I/tmp/update-request"; run
t "manual updates: the Release waits, named in the check" '[ $RC = 0 ] && [ "$(ver)" = m3 ] && [ "$(check result)" = available ] && [ "$(check availableRelease)" = v0.3.0 ] && [ "$(check available)" = "$(git rev-parse HEAD)" ] && [[ "$(check message)" == "A new version is waiting: Release v0.3.0 ("* ]]'
echo install-now > "$I/tmp/update-request"; run
t "Update now installs it" '[ $RC = 0 ] && [ "$(ver)" = m4 ] && [ -z "$(check availableRelease)" ]'
rm -f "$I/data/update-schedule.env"

echo "── never backwards by itself"
commit m5
git -C "$I" fetch -q origin main && git -C "$I" checkout -q --force -B main origin/main   # a Server with main's newer commits
run
t "the Server has newer commits than the Release: left as it is" '[ $RC = 0 ] && [ "$(ver)" = m5 ] && ! built && [[ "$(check message)" == *"already has the latest Release, v0.3.0"* ]]'
touch "$I/data/restore-defaults"
run
t "Restore Defaults on main: the latest Release, as a new installation" '[ $RC = 0 ] && [ "$(ver)" = m4 ] && built'
rm -f "$I/data/restore-defaults"

echo "── switching to main"
git checkout -q -b feature/x && commit x1 && git checkout -q main
request feature/x
t "on feature/x" '[ "$(ver)" = x1 ] && [ "$(on)" = feature/x ]'
request main
t "a switch to main installs the latest Release, even an older one" '[ $RC = 0 ] && [ "$(ver)" = m4 ] && [ "$(on)" = main ] && [ "$(state)" = updated ] && [ "$(setting)" = main ]'
request feature/x
rm -f "$MOCK/release"
request main
t "no Release published: the switch to main is cancelled, feature/x kept" '[ "$(ver)" = x1 ] && [ "$(on)" = feature/x ] && [ "$(setting)" = feature/x ] && [ "$(state)" = cancelled ] && [[ "$(msg)" == "No Release of Noticeboard has been published on GitHub yet, so the switch to main was cancelled."* ]]'
echo "NOTICEBOARD_BRANCH=main" > "$I/data/update-branch.env"; git -C "$I" checkout -q --force -B main origin/main
touch "$I/data/restore-defaults"
run
t "no Release published, Restore Defaults: reinstalls what runs" '[ $RC = 0 ] && [ "$(ver)" = m5 ] && built'
rm -f "$I/data/restore-defaults"

echo "── the recovery command comes from the Release"
git checkout -q main && commit m6 && publish_release v0.4.0
touch "$MOCK/BUILD_FAILS_ALWAYS"
run
t "installing and putting back both fail: the command is the Release's installer" '[ $RC = 1 ] && [ "$(state)" = failed ] && [[ "$(msg)" == *"raw.githubusercontent.com/fructus-sum/noticeboard/v0.4.0/installers/install.sh"* ]]'
rm -f "$MOCK/BUILD_FAILS_ALWAYS"

echo "── files are valid JSON"
t "check parses" 'node -e "JSON.parse(require(\"fs\").readFileSync(process.argv[1]))" "$I/data/update-check.json"'

rm -rf "$T"; echo "passed=$pass failed=$fail"; [ "$fail" -eq 0 ]
