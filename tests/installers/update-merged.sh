#!/usr/bin/env bash
# shellcheck disable=SC1090,SC2034  # functions are loaded from the installers; the variables set here are read by them
# update.sh going back to main once the followed branch has been merged into it: merge commit,
# squash, fast-forward, deleted after merging; and the cases where it must stay on the branch.
# Same stand-ins as tests/installers/update-branches.sh.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
T=$(mktemp -d); BIN="$T/bin"; export MOCK="$T/mock"; mkdir -p "$BIN" "$MOCK"
export MOCK_INSTALL="$T/install"; I="$MOCK_INSTALL"
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
printf '#!/usr/bin/env bash\nexit 0\n' > "$BIN/curl"; cp "$BIN/curl" "$BIN/sleep"; cp "$BIN/curl" "$BIN/flock"
chmod +x "$BIN"/*
export PATH="$BIN:$PATH"

git init -q --bare -b main "$T/origin.git"
git clone -q "$T/origin.git" "$T/work" 2>/dev/null
W="$T/work"; cd "$W" && git checkout -q -b main
g() { git -c commit.gpgsign=false -c user.name=t -c user.email=t@t "$@"; }
mkdir -p installers && cp -r "$REPO/installers/update.sh" "$REPO/installers/lib" installers/ && printf 'data/\ntmp/\n' > .gitignore
echo main-1 > VERSION && git add -A && g commit -qm main-1 && git push -q origin main
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
  fi
}
on()      { git -C "$I" symbolic-ref --short HEAD; }
setting() { sed -n 's/^NOTICEBOARD_BRANCH=//p' "$I/data/update-branch.env" 2>/dev/null; }
base()    { sed -n 's/^NOTICEBOARD_MAIN_AT_SWITCH=//p' "$I/data/update-branch.env" 2>/dev/null; }
json()    { node -e "const s=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));process.stdout.write(String(s[process.argv[2]]))" "$1" "$2" 2>/dev/null; }
notice()  { json "$I/data/update-notice.json" "$1"; }
state()   { json "$I/data/update-status.json" state; }
msg()     { json "$I/data/update-status.json" message; }
no_notice() { [ ! -f "$I/data/update-notice.json" ]; }
built()   { grep -q npm-run "$MOCK/log"; }
request() { echo "NOTICEBOARD_BRANCH=$1" > "$I/data/update-branch.env"; echo x > "$I/tmp/update-request"; run; }
main_sha() { git -C "$T/origin.git" rev-parse main; }
# branch <name> <file> <content>: a branch off the current main with one commit
branch() { git checkout -q main && git pull -q origin main && git checkout -q -b "$1" && echo "$3" > "$2" && git add -A && g commit -qm "$1" && git push -q origin "$1" && git checkout -q main; }
main_commit() { git checkout -q main && git pull -q origin main && echo "$2" > "$1" && git add -A && g commit -qm "main: $1" && git push -q origin main; }
dismiss() { rm -f "$I/data/update-notice.json"; }

echo "── merged with a merge commit"
branch feature/a A.txt a1
request feature/a
t "switch to feature/a records where main was" '[ $RC = 0 ] && [ "$(on)" = feature/a ] && [ "$(base)" = "$(main_sha)" ] && no_notice'
run
t "nothing new: stays on feature/a" '[ $RC = 0 ] && [ "$(on)" = feature/a ] && no_notice'
main_commit other.txt x
run
t "main moves on without it: stays on feature/a" '[ "$(on)" = feature/a ] && [ "$(setting)" = feature/a ] && no_notice'
git pull -q origin main && g merge -q --no-ff -m "merge a" feature/a 2>/dev/null && git push -q origin main
run
t "merged: back on main, built and restarted" '[ $RC = 0 ] && [ "$(on)" = main ] && [ "$(setting)" = main ] && [ -z "$(base)" ] && built && grep -q restart "$MOCK/log" && [ -f "$I/A.txt" ] && [ -f "$I/other.txt" ]'
t "merged: notice for the home page, and the status says why" '[ "$(notice type)" = branch-merged ] && [ "$(notice branch)" = feature/a ] && [[ "$(notice message)" == *"merged into main"* ]] && [ "$(state)" = updated ] && [[ "$(msg)" == *"feature/a has been merged into main"* ]]'
dismiss; run
t "afterwards: follows main normally, no new notice" '[ $RC = 0 ] && [ "$(on)" = main ] && no_notice'

echo "── squashed"
branch feature/b B.txt b1
request feature/b
git checkout -q main && git pull -q origin main && g merge -q --squash feature/b && g commit -qm "squash b" && git push -q origin main
run
t "squash-merged: back on main with a notice" '[ "$(on)" = main ] && [ "$(notice branch)" = feature/b ]'
dismiss

echo "── fast-forwarded"
branch feature/c C.txt c1
request feature/c
git checkout -q main && g merge -q --ff-only feature/c && git push -q origin main
run
t "fast-forwarded: back on main, same version so nothing rebuilt" '[ $RC = 0 ] && [ "$(on)" = main ] && [ "$(notice branch)" = feature/c ] && ! built'
dismiss

echo "── must stay"
git checkout -q main && git pull -q origin main && git push -q origin main:refs/heads/feature/d
request feature/d
run
t "new branch identical to main: stays until main moves on" '[ "$(on)" = feature/d ] && no_notice'
branch feature/e E.txt e1
request feature/e
main_commit other2.txt y
git push -q origin --delete feature/e
run
t "deleted without being merged: stays (its features aren't in main)" '[ "$(on)" = feature/e ] && [ "$(setting)" = feature/e ] && no_notice'
branch feature/g G.txt g1
request feature/g
git pull -q origin main && g merge -q --no-ff -m "merge g" feature/g 2>/dev/null && git push -q origin main
mv "$T/origin.git" "$T/away.git"
run
t "GitHub unreachable: stays, no notice" '[ "$(on)" = feature/g ] && no_notice'
mv "$T/away.git" "$T/origin.git"

echo "── deleted after merging"
git push -q origin --delete feature/g
run
t "deleted after being merged: back on main with a notice" '[ "$(on)" = main ] && [ "$(notice branch)" = feature/g ]'
dismiss

echo "── going back fails"
branch feature/h H.txt h1
request feature/h
H_BASE=$(base)
git pull -q origin main && g merge -q --no-ff -m "merge h" feature/h 2>/dev/null && touch BUILD_FAILS && git add -A && g commit -qm "broken main" && git push -q origin main
run
t "main fails to build: rolled back to feature/h, setting kept with its base, no notice" '[ $RC = 1 ] && [ "$(on)" = feature/h ] && [ "$(setting)" = feature/h ] && [ "$(base)" = "$H_BASE" ] && [ "$(state)" = rolled-back ] && no_notice'
run
t "next check: that main commit isn't retried, still feature/h" '[ "$(on)" = feature/h ] && [ "$(setting)" = feature/h ] && ! built && no_notice'
git rm -q BUILD_FAILS && g commit -qm "fix main" && git push -q origin main
run
t "main fixed: back on main with a notice" '[ $RC = 0 ] && [ "$(on)" = main ] && [ "$(notice branch)" = feature/h ]'
dismiss

echo "── a Pi that switched before this existed (no record of main)"
branch feature/i I.txt i1
request feature/i
echo "NOTICEBOARD_BRANCH=feature/i" > "$I/data/update-branch.env"
git checkout -q main && g merge -q --ff-only feature/i && git push -q origin main
run
t "no record, main is exactly the branch: stays for now" '[ "$(on)" = feature/i ] && no_notice'
main_commit other3.txt z
run
t "no record, main moved on past it: back on main" '[ "$(on)" = main ] && [ "$(notice branch)" = feature/i ]'

echo "── status files are valid JSON"
t "notice parses" 'node -e "JSON.parse(require(\"fs\").readFileSync(process.argv[1]))" "$I/data/update-notice.json"'

rm -rf "$T"; echo "passed=$pass failed=$fail"; [ "$fail" -eq 0 ]
