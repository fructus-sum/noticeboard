#!/usr/bin/env bash
# shellcheck disable=SC1090,SC2034  # the variables set here are read by update.sh
# Restore Defaults in installers/update.sh (SYSTEM_DESIGN §14 D42), against a throwaway git origin
# with the same stand-ins as tests/installers/update.sh: the followed branch's commit is reinstalled
# even when it's the one running, into a clean folder that keeps exactly RESTORE_KEEP; a failed
# reinstall still restarts the server (which resets its data at start-up); and every file the
# installer writes into the install folder is on the keep list.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
T=$(mktemp -d); BIN="$T/bin"; export MOCK="$T/mock"; mkdir -p "$BIN" "$MOCK"
export MOCK_INSTALL="$T/install" GITHUB_STANDIN="$REPO/tests/helpers/github.sh"
source "$GITHUB_STANDIN"   # main follows Releases: each commit to main is published as one

cat > "$BIN/systemctl" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  is-active) echo active ;;
  show)
    pid=$(cat "$MOCK/pid" 2>/dev/null || echo 0)
    if [ "$pid" -gt 0 ] && kill -0 "$pid" 2>/dev/null; then echo "$pid"; exit 0; fi
    /usr/bin/sleep 1000 >/dev/null 2>&1 9>&- &
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
case "$*" in */releases/latest*) source "$GITHUB_STANDIN"; fake_latest_release "$@"; exit $? ;; esac
exit 0
EOF
printf '#!/usr/bin/env bash\nexit 0\n' > "$BIN/sleep"
command -v flock >/dev/null || printf '#!/usr/bin/env bash\nexit 0\n' > "$BIN/flock"
chmod +x "$BIN"/*
export PATH="$BIN:$PATH"

git init -q --bare -b main "$T/origin.git"
git clone -q "$T/origin.git" "$T/work" 2>/dev/null
cd "$T/work" && git checkout -q -b main
mkdir -p installers server client/admin && cp -r "$REPO/installers/update.sh" "$REPO/installers/lib" installers/
echo "tracked" > server/app.js && echo "tracked" > client/admin/main.js
echo v1 > VERSION && git add -A && git -c commit.gpgsign=false commit -qm v1 && git push -q origin main && publish_release v1
git clone -q "$T/origin.git" "$T/install"
/usr/bin/sleep 1000 >/dev/null 2>&1 & echo $! > "$MOCK/pid"
I="$T/install"

pass=0; fail=0
ok() { pass=$((pass+1)); printf 'PASS  %s\n' "$1"; }
bad() { fail=$((fail+1)); printf 'FAIL  %s\n' "$1"; [ -n "${2:-}" ] && printf -- '----\n%s\n----\n' "$2"; }

# What the folder holds before the restore: kept files, and strays the clean must delete
KEPT=(data/config.json data/installer.json data/update-branch.env tmp/update.lock logs/app.log .env start-kiosk.sh
      node_modules/pkg/index.js client/admin/dist/index.html client/display/dist/index.html)
STRAYS=(junk.txt server/stray.js scratch/notes.md client/admin/old-build.js)
seed() {
  for f in "${KEPT[@]}" "${STRAYS[@]}"; do mkdir -p "$I/$(dirname "$f")"; echo x > "$I/$f"; done
  echo "changed by hand" > "$I/server/app.js"
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) test" > "$I/data/restore-defaults"
  echo restore-defaults > "$I/tmp/update-request"
}
status_message() { sed -n 's/.*"message":"\([^"]*\)".*/\1/p' "$I/data/update-status.json"; }

# 1. The running commit is reinstalled into a clean folder
seed; : > "$MOCK/log"
out=$(bash "$I/installers/update.sh" 2>&1); rc=$?
[ $rc -eq 0 ] && grep -q "Updated to" <<<"$out" && ok "restore: runs although the branch is up to date" || bad "restore ran" "$out"
missing=""; for f in "${KEPT[@]}"; do [ -e "$I/$f" ] || missing+=" $f"; done
[ -z "$missing" ] && ok "every file on the keep list is kept (${#KEPT[@]})" || bad "kept files deleted:$missing"
left=""; for f in "${STRAYS[@]}"; do [ -e "$I/$f" ] && left+=" $f"; done
[ -z "$left" ] && ok "stray files are deleted (${#STRAYS[@]})" || bad "strays left:$left"
[ "$(cat "$I/server/app.js")" = tracked ] && ok "program files changed by hand are put back" || bad "tracked file not restored"
grep -q "npm install" "$MOCK/log" && grep -q "npm run" "$MOCK/log" && grep -q "server restarted" "$MOCK/log" \
  && ok "reinstalled (npm install, build) and restarted" || bad "reinstall/restart" "$(cat "$MOCK/log")"
grep -q "Restored to defaults" <<<"$(status_message)" && ok "the status says it was restored" || bad "status" "$(status_message)"
rm -f "$I/data/restore-defaults"   # the server deletes it at start-up

# 2. A failed reinstall still restarts the server, so the reset happens
seed; : > "$MOCK/log"
touch "$I/BUILD_FAILS_MARK"
( cd "$T/work" && touch BUILD_FAILS && echo v2 > VERSION && git add -A && git -c commit.gpgsign=false commit -qm v2 && git push -q origin main && publish_release v2 )
out=$(bash "$I/installers/update.sh" 2>&1); rc=$?
[ $rc -eq 1 ] && [ "$(cat "$I/VERSION")" = v1 ] && ok "a failed reinstall puts the previous version back" || bad "rollback" "$out"
grep -q "server restarted" "$MOCK/log" && ok "  … and still restarts the server (it resets its data at start-up)" || bad "no restart" "$(cat "$MOCK/log")"
grep -q "settings and content were reset" <<<"$(status_message)" && ok "  … and says what happened" || bad "status" "$(status_message)"
rm -f "$I/data/restore-defaults"

# 3. Every file the installer writes into the install folder is on the keep list
eval "$(sed -n '/^RESTORE_KEEP=/p' "$REPO/installers/update.sh")"
uncovered=""
while read -r target; do
  top=${target%%/*}
  covered=""
  for k in "${RESTORE_KEEP[@]}"; do
    k=${k#/}; k=${k%/}
    [ "$top" = "$k" ] && covered=1
  done
  [ -n "$covered" ] || uncovered+=" $target"
done < <(grep -ohE '>>? *"\$INSTALL_DIR/[^"]+"' "$REPO"/installers/install.sh "$REPO"/installers/lib/*.sh | sed -E 's/.*"\$INSTALL_DIR\/([^"]+)"/\1/' | sort -u)
[ -z "$uncovered" ] && ok "every file the installer writes into the folder survives a restore" || bad "not on RESTORE_KEEP:$uncovered"

kill "$(cat "$MOCK/pid")" 2>/dev/null; rm -rf "$T"
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
