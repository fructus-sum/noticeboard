#!/usr/bin/env bash
# shellcheck disable=SC1090,SC2034  # the variables set here are read by update.sh
# The update schedule (SYSTEM_DESIGN §14 D41): installers/update.sh against a throwaway git origin
# (the same stand-ins as tests/installers/update.sh), with a fake clock (NOTICEBOARD_NOW) and the
# time zone fixed to UTC. Each mode installs only when due, catches up after a missed time, and
# otherwise records the waiting version; a request always installs; manual mode checks once a day
# and installs at a set time; no schedule file means every 15 minutes, as before.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
T=$(mktemp -d); BIN="$T/bin"; export MOCK="$T/mock"; mkdir -p "$BIN" "$MOCK"
export MOCK_INSTALL="$T/install" TZ=UTC

cat > "$BIN/systemctl" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  is-active) echo active ;;
  show)
    pid=$(cat "$MOCK/pid" 2>/dev/null || echo 0)
    if [ "$pid" -gt 0 ] && kill -0 "$pid" 2>/dev/null; then echo "$pid"; exit 0; fi
    /usr/bin/sleep 1000 >/dev/null 2>&1 &
    echo $! > "$MOCK/pid"; echo $! ;;
esac
EOF
printf '#!/usr/bin/env bash\nexit 0\n' > "$BIN/npm"
printf '#!/usr/bin/env bash\nexit 0\n' > "$BIN/curl"
printf '#!/usr/bin/env bash\nexit 0\n' > "$BIN/sleep"
command -v flock >/dev/null || printf '#!/usr/bin/env bash\nexit 0\n' > "$BIN/flock"
chmod +x "$BIN"/*
export PATH="$BIN:$PATH"

git init -q --bare -b main "$T/origin.git"
git clone -q "$T/origin.git" "$T/work" 2>/dev/null
cd "$T/work" && git checkout -q -b main
mkdir -p installers && cp -r "$REPO/installers/update.sh" "$REPO/installers/lib" installers/
n=1
release() { n=$((n+1)); echo "v$n" > VERSION; git add -A; git -c commit.gpgsign=false commit -qm "v$n: release"; git push -q origin main; }
echo v1 > VERSION && git add -A && git -c commit.gpgsign=false commit -qm v1 && git push -q origin main
git clone -q "$T/origin.git" "$T/install"
/usr/bin/sleep 1000 >/dev/null 2>&1 & echo $! > "$MOCK/pid"
D="$T/install/data"; mkdir -p "$D" "$T/install/tmp"
schedule() { printf '%s\n' "$@" > "$D/update-schedule.env"; }
check_field() { sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p" "$D/update-check.json" 2>/dev/null; }

pass=0; fail=0
run() {  # run "<name>" "<time now>" "<expected text>" "<expected version>"
  local name="$1" out ver
  out=$(NOTICEBOARD_NOW="$2" bash "$T/install/installers/update.sh" 2>&1)
  ver=$(cat "$T/install/VERSION")
  if grep -q -- "$3" <<<"$out" && [ "$ver" = "$4" ]; then
    pass=$((pass+1)); printf 'PASS  %-58s on=%s\n' "$name" "$ver"
  else
    fail=$((fail+1)); printf 'FAIL  %-58s on=%s (want %s)\n----\n%s\n----\n' "$name" "$ver" "$4" "$out"
  fi
}
expect() {  # expect "<name>" <condition...>
  local name="$1"; shift
  if "$@"; then pass=$((pass+1)); printf 'PASS  %s\n' "$name"; else fail=$((fail+1)); printf 'FAIL  %s\n' "$name"; fi
}

# No schedule file: every 15 minutes, as before
release
run "no schedule file: installed at once"                     "2026-09-28 10:00" "Updated to" v2

# Daily at 00:00, chosen on Monday 10:00
schedule NOTICEBOARD_UPDATE_EVERY=daily NOTICEBOARD_UPDATE_TIME=00:00 NOTICEBOARD_UPDATE_SINCE=2026-09-28T10:00:00Z
release
run "daily: a new version waits during the day"               "2026-09-28 12:00" "Update available" v2
expect "  … the check file says so, and when it installs"       [ "$(check_field result)" = available ] \
  && [ "$(check_field nextInstall)" = 2026-09-29T00:00:00Z ] && [ -n "$(check_field available)" ] \
  && [ "$(check_field availableSubject)" = "v3: release" ]
run "daily: installed at the next 00:00"                      "2026-09-29 00:05" "Updated to" v3
expect "  … installCheckedAt recorded"                          [ "$(check_field installCheckedAt)" = 2026-09-29T00:05:00Z ]
release
run "daily: waits again after installing"                     "2026-09-29 09:00" "Update available" v3
run "daily: switched off at 00:00, catches up at 08:30"       "2026-09-30 08:30" "Updated to" v4
release
run "daily: a request (Update now) installs at once"          "2026-09-30 09:00" "Update available" v4
echo install-now > "$T/install/tmp/update-request"
run "  … Update now"                                          "2026-09-30 09:05" "Updated to" v5
expect "  … the request file is taken"                          [ ! -e "$T/install/tmp/update-request" ]

# Every 2 hours
schedule NOTICEBOARD_UPDATE_EVERY=2h NOTICEBOARD_UPDATE_SINCE=2026-09-30T10:00:00Z
release
run "2h: not yet after 1 hour"                                "2026-09-30 11:00" "Update available" v5
expect "  … installs 2 hours after the schedule was chosen"     [ "$(check_field nextInstall)" = 2026-09-30T12:00:00Z ]
run "2h: installed after 2 hours"                             "2026-09-30 12:01" "Updated to" v6

# Weekly on Wednesdays (3) at 06:00; 2026-09-30 is a Wednesday
schedule NOTICEBOARD_UPDATE_EVERY=weekly NOTICEBOARD_UPDATE_DAY=3 NOTICEBOARD_UPDATE_TIME=06:00 NOTICEBOARD_UPDATE_SINCE=2026-09-30T13:00:00Z
release
run "weekly: waits on Friday"                                 "2026-10-02 12:00" "Update available" v6
expect "  … until next Wednesday 06:00"                         [ "$(check_field nextInstall)" = 2026-10-07T06:00:00Z ]
run "weekly: installed on Wednesday 06:10"                    "2026-10-07 06:10" "Updated to" v7

# Manual: checks once a day, installs only when asked or at a set time
schedule NOTICEBOARD_UPDATE_EVERY=manual NOTICEBOARD_UPDATE_SINCE=2026-10-07T07:00:00Z
release
echo check > "$T/install/tmp/update-request"   # the admin panel asks for a check when the schedule changes
run "manual: never installs by itself"                       "2026-10-07 08:00" "Update available" v7
expect "  … the note says it's manual, no install time"        grep -q "Updates are manual" "$D/update-check.json" && [ -z "$(check_field nextInstall)" ]
run "manual: checks at most once a day"                       "2026-10-07 20:00" "less than a day ago" v7
echo check > "$T/install/tmp/update-request"
run "manual: a check request checks, never installs"          "2026-10-07 20:15" "Update available" v7
run "manual: a day later it checks again"                     "2026-10-08 20:30" "Update available" v7
printf 'NOTICEBOARD_UPDATE_AT=2026-10-09T02:00:00Z\n' >> "$D/update-schedule.env"
echo check > "$T/install/tmp/update-request"   # as the admin panel does when a time is set
run "manual: a set time: waits until then"                    "2026-10-09 01:00" "Update available" v7
expect "  … the set time is the next install"                  [ "$(check_field nextInstall)" = 2026-10-09T02:00:00Z ]
run "manual: installed at the set time"                       "2026-10-09 02:05" "Updated to" v8
at_removed() { ! grep -q NOTICEBOARD_UPDATE_AT "$D/update-schedule.env" && grep -q "EVERY=manual" "$D/update-schedule.env"; }
expect "  … the set time is removed, the schedule kept"         at_removed

# A set time takes the place of the automatic install
schedule NOTICEBOARD_UPDATE_EVERY=15min NOTICEBOARD_UPDATE_AT=2026-10-09T23:00:00Z
release
run "15min with a set time: waits for the set time"           "2026-10-09 12:00" "Update available" v8
run "  … installed at it"                                     "2026-10-09 23:00" "Updated to" v9

# A garbled file: every 15 minutes
schedule NOTICEBOARD_UPDATE_EVERY=sometimes NOTICEBOARD_UPDATE_TIME=25:99
release
run "a garbled schedule counts as every 15 minutes"           "2026-10-10 12:00" "Updated to" v10

kill "$(cat "$MOCK/pid")" 2>/dev/null; rm -rf "$T"
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
