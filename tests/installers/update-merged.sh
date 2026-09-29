#!/usr/bin/env bash
# shellcheck disable=SC1090,SC2034  # functions are loaded from the installers; the variables set here are read by them
# update.sh going back to main once main's latest Release has the followed branch's work
# (SYSTEM_DESIGN §18.6): merge commit, squash, fast-forward, deleted after merging; merged into
# main without a Release yet; the cases where it must stay on the branch; and waiting for the
# installer when the Release needs a newer one. Same stand-ins as tests/installers/update-branches.sh,
# with GitHub's Releases API from tests/helpers/github.sh.
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
[ "$1" = run ] && [ -f BUILD_FAILS ] && exit 1
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
echo '{"installer":{"version":4}}' > system-requirements.json
echo main-1 > VERSION && git add -A && g commit -qm main-1 && git push -q origin main && publish_release v0.1.0
git clone -q "$T/origin.git" "$I"
mkdir -p "$I/data" "$I/tmp"; echo '{"port":3000}' > "$I/data/config.json"

pass=0; fail=0; OUT=""; RC=0
# shellcheck disable=SC2120  # run passes on update.sh arguments, though the cases here need none
run() { : > "$MOCK/log"; OUT=$(cd / && bash "$I/installers/update.sh" "$@" 2>&1); RC=$?; }
t() {
  if eval "$2"; then pass=$((pass+1)); echo "PASS  $1"
  else
    fail=$((fail+1)); echo "FAIL  $1    [$2]"
    echo "  out: $OUT" | head -6; echo "  setting: $(tr '\n' ' ' < "$I/data/update-branch.env" 2>/dev/null)"
    echo "  status: $(cat "$I/data/update-status.json" 2>/dev/null)"; echo "  notice: $(cat "$I/data/update-notice.json" 2>/dev/null)"
    echo "  check: $(cat "$I/data/update-check.json" 2>/dev/null)"
  fi
}
on()      { git -C "$I" symbolic-ref --short HEAD; }
setting() { sed -n 's/^NOTICEBOARD_BRANCH=//p' "$I/data/update-branch.env" 2>/dev/null; }
base()    { sed -n 's/^NOTICEBOARD_MAIN_AT_SWITCH=//p' "$I/data/update-branch.env" 2>/dev/null; }
json()    { node -e "const s=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));process.stdout.write(String(s[process.argv[2]]))" "$1" "$2" 2>/dev/null; }
notice()  { json "$I/data/update-notice.json" "$1"; }
state()   { json "$I/data/update-status.json" state; }
msg()     { json "$I/data/update-status.json" message; }
check()   { json "$I/data/update-check.json" "$1"; }
no_notice() { [ ! -f "$I/data/update-notice.json" ]; }
built()   { grep -q npm-run "$MOCK/log"; }
request() { echo "NOTICEBOARD_BRANCH=$1" > "$I/data/update-branch.env"; echo x > "$I/tmp/update-request"; run; }
release_sha() { git -C "$T/origin.git" rev-parse "refs/tags/$(cat "$MOCK/release")^{commit}"; }
# branch <name> <file> <content>: a branch off the current main with one commit
branch() { git checkout -q main && git pull -q origin main && git checkout -q -b "$1" && echo "$3" > "$2" && git add -A && g commit -qm "$1" && git push -q origin "$1" && git checkout -q main; }
main_commit() { git checkout -q main && git pull -q origin main && echo "$2" > "$1" && git add -A && g commit -qm "main: $1" && git push -q origin main; }
merge() { git checkout -q main && git pull -q origin main && g merge -q --no-ff -m "merge $1" "$1" 2>/dev/null && git push -q origin main; }
release() { git checkout -q main && git pull -q origin main && publish_release "$1"; }   # main's latest commit as Release <tag>
dismiss() { rm -f "$I/data/update-notice.json"; }

echo "── merged with a merge commit, then released"
branch feature/a A.txt a1
request feature/a
t "switch to feature/a records the latest Release's commit" '[ $RC = 0 ] && [ "$(on)" = feature/a ] && [ "$(base)" = "$(release_sha)" ] && no_notice'
run
t "nothing new: stays on feature/a" '[ $RC = 0 ] && [ "$(on)" = feature/a ] && no_notice'
main_commit other.txt x; release v0.2.0
run
t "a new Release without it: stays on feature/a" '[ "$(on)" = feature/a ] && [ "$(setting)" = feature/a ] && no_notice'
merge feature/a
run
t "merged into main but not released yet: stays on feature/a" '[ "$(on)" = feature/a ] && [ "$(setting)" = feature/a ] && no_notice'
release v0.3.0
run
t "released: back on main at the Release, built and restarted" '[ $RC = 0 ] && [ "$(on)" = main ] && [ "$(setting)" = main ] && [ -z "$(base)" ] && built && grep -q restart "$MOCK/log" && [ -f "$I/A.txt" ] && [ -f "$I/other.txt" ] && [ "$(git -C "$I" rev-parse HEAD)" = "$(release_sha)" ]'
t "released: notice for the home page names the Release, and the status says why" '[ "$(notice type)" = branch-merged ] && [ "$(notice branch)" = feature/a ] && [ "$(notice release)" = v0.3.0 ] && [[ "$(notice message)" == *"merged into main and published in Release v0.3.0"* ]] && [ "$(state)" = updated ] && [[ "$(msg)" == *"feature/a has been merged into main"* ]] && [[ "$(msg)" == *"Release v0.3.0 ("* ]]'
dismiss; run
t "afterwards: follows main's Releases, no new notice" '[ $RC = 0 ] && [ "$(on)" = main ] && no_notice && [[ "$(check message)" == "Up to date: running Release v0.3.0 ("* ]]'

echo "── squashed"
branch feature/b B.txt b1
request feature/b
git checkout -q main && git pull -q origin main && g merge -q --squash feature/b && g commit -qm "squash b" && git push -q origin main && publish_release v0.4.0
run
t "squash-merged and released: back on main with a notice" '[ "$(on)" = main ] && [ "$(notice branch)" = feature/b ]'
dismiss

echo "── fast-forwarded"
branch feature/c C.txt c1
request feature/c
git checkout -q main && g merge -q --ff-only feature/c && git push -q origin main && publish_release v0.5.0
run
t "fast-forwarded and released: back on main, same version so nothing rebuilt" '[ $RC = 0 ] && [ "$(on)" = main ] && [ "$(notice branch)" = feature/c ] && ! built'
dismiss

echo "── must stay"
git checkout -q main && git pull -q origin main && git push -q origin main:refs/heads/feature/d
request feature/d
run
t "new branch at the latest Release: stays until a new Release" '[ "$(on)" = feature/d ] && no_notice'
branch feature/e E.txt e1
request feature/e
main_commit other2.txt y; release v0.6.0
git push -q origin --delete feature/e
run
t "deleted without being merged: stays (its features aren't in a Release)" '[ "$(on)" = feature/e ] && [ "$(setting)" = feature/e ] && no_notice'
branch feature/g G.txt g1
request feature/g
merge feature/g; release v0.7.0
mv "$T/origin.git" "$T/away.git"
run
t "GitHub unreachable: stays, no notice" '[ "$(on)" = feature/g ] && no_notice'
mv "$T/away.git" "$T/origin.git"
touch "$MOCK/github-down"
run
t "the Releases API unreachable: stays, no notice" '[ "$(on)" = feature/g ] && no_notice'
rm -f "$MOCK/github-down"

echo "── deleted after merging and releasing"
git push -q origin --delete feature/g
run
t "deleted after being released: back on main with a notice" '[ "$(on)" = main ] && [ "$(notice branch)" = feature/g ]'
dismiss

echo "── going back fails"
branch feature/h H.txt h1
request feature/h
H_BASE=$(base)
merge feature/h; touch BUILD_FAILS && git add -A && g commit -qm "broken main" && git push -q origin main && publish_release v0.8.0
run
t "the Release fails to build: rolled back to feature/h, setting kept with its base, no notice" '[ $RC = 1 ] && [ "$(on)" = feature/h ] && [ "$(setting)" = feature/h ] && [ "$(base)" = "$H_BASE" ] && [ "$(state)" = rolled-back ] && no_notice'
run
t "next check: that Release isn't retried, still feature/h" '[ "$(on)" = feature/h ] && [ "$(setting)" = feature/h ] && ! built && no_notice'
git rm -q BUILD_FAILS && g commit -qm "fix main" && git push -q origin main && publish_release v0.8.1
run
t "fixed Release: back on main with a notice" '[ $RC = 0 ] && [ "$(on)" = main ] && [ "$(notice branch)" = feature/h ]'
dismiss

echo "── the Release needs a newer installer"
echo '{"version":4,"branch":"main","commit":"x","time":"2026-09-28T00:00:00Z"}' > "$I/data/installer.json"
branch feature/j J.txt j1
request feature/j
merge feature/j
git checkout -q main && echo '{"installer":{"version":5}}' > system-requirements.json && git add -A && g commit -qm "needs installer 5" && git push -q origin main && publish_release v0.9.0
run
t "installer 4, the Release needs 5: stays on feature/j" '[ $RC = 0 ] && [ "$(on)" = feature/j ] && [ "$(setting)" = feature/j ] && no_notice'
t "  … and the check says which Release waits for the installer" '[ "$(check installerFor)" = v0.9.0 ] && [[ "$(check message)" == *"Release v0.9.0 has feature/j"* ]]'
run
t "  … a check that doesn't look again keeps it" '[ "$(check installerFor)" = v0.9.0 ]'
echo '{"version":5,"branch":"feature/j","commit":"x","time":"2026-09-28T00:00:00Z"}' > "$I/data/installer.json"
run
t "once the installer has run: back on main, the wait cleared" '[ "$(on)" = main ] && [ "$(notice branch)" = feature/j ] && [ -z "$(check installerFor)" ]'
dismiss
rm -f "$I/data/installer.json"
branch feature/k K.txt k1
request feature/k
merge feature/k
git checkout -q main && echo '{"installer":{"version":6}}' > system-requirements.json && git add -A && g commit -qm "needs installer 6" && git push -q origin main && publish_release v0.10.0
run
t "no installer record: never waits, back on main" '[ "$(on)" = main ] && [ "$(notice branch)" = feature/k ]'
dismiss

echo "── a Pi that switched before this existed (main's commit, or nothing, recorded)"
branch feature/i I.txt i1
request feature/i
echo "NOTICEBOARD_BRANCH=feature/i" > "$I/data/update-branch.env"
git checkout -q main && g merge -q --ff-only feature/i && git push -q origin main && publish_release v0.11.0
run
t "no record, the Release is exactly the branch: stays for now" '[ "$(on)" = feature/i ] && no_notice'
main_commit other3.txt z; release v0.12.0
run
t "no record, a later Release has it: back on main" '[ "$(on)" = main ] && [ "$(notice branch)" = feature/i ]'
dismiss
branch feature/m M.txt m1
request feature/m
echo "NOTICEBOARD_BRANCH=feature/m" > "$I/data/update-branch.env"
echo "NOTICEBOARD_MAIN_AT_SWITCH=$(git -C "$T/origin.git" rev-parse main)" >> "$I/data/update-branch.env"
merge feature/m; release v0.13.0
run
t "main's commit recorded (an older update.sh switched): back on main once released" '[ "$(on)" = main ] && [ "$(notice branch)" = feature/m ]'

echo "── status files are valid JSON"
t "notice parses" 'node -e "JSON.parse(require(\"fs\").readFileSync(process.argv[1]))" "$I/data/update-notice.json"'
t "check parses" 'node -e "JSON.parse(require(\"fs\").readFileSync(process.argv[1]))" "$I/data/update-check.json"'

rm -rf "$T"; echo "passed=$pass failed=$fail"; [ "$fail" -eq 0 ]
