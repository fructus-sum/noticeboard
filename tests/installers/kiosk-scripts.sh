#!/usr/bin/env bash
# shellcheck disable=SC1090,SC2034  # functions are loaded from the installers; the variables set here are read by them
# The generated kiosk scripts, run with stand-ins for chromium, curl, logger and sleep:
# wait for the server, restart a crashed browser, and leave kiosk mode when this screen's exit
# button asks (the claim endpoint answers {"exit":true}).
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$REPO/tests/helpers/installer.sh"
T=$(mktemp -d); export T
pass=0; fail=0
ok()  { pass=$((pass+1)); echo "PASS  $1"; }
bad() { fail=$((fail+1)); echo "FAIL  $1"; }

( load_installer
  INSTALL_DIR="$T"; write_server_kiosk
  KIOSK_SCRIPT="$T/noticeboard-kiosk.sh"; SERVER_URL="http://192.168.1.10:3000"
  MACS_HTML="<tr><td>eth0</td><td>dc:a6:32:01:02:03</td></tr>"; write_display_kiosk )

mkdir -p "$T/bin" "$T/home"
cat > "$T/bin/curl" <<'EOF'
#!/usr/bin/env bash
echo "curl $*" >> "$T/curl.log"
case "$*" in
  *kiosk-exit/claim*)
    if [ -f "$T/exit-asked" ]; then rm -f "$T/exit-asked"; printf '{"exit":true}'; else printf '{"exit":false}'; fi
    exit 0 ;;
esac
n=$(cat "$T/curl.count" 2>/dev/null || echo 0); echo $((n+1)) > "$T/curl.count"
code=$(sed -n "$((n+1))p" "$T/answers"); [ -z "$code" ] && code=$(tail -n 1 "$T/answers")
case "$*" in *%{http_code}*) printf '%s' "$code"; [ "$code" = 000 ] && exit 7; exit 0 ;; esac
[ "$code" = 200 ] && exit 0 || exit 22
EOF
# chromium: the first kiosk launch "crashes"; later kiosk launches and the waiting page stay open
cat > "$T/bin/chromium" <<'EOF'
#!/usr/bin/env bash
echo "LAUNCH $*" >> "$T/launch.log"
case "$*" in
  *kiosk=off*) exit 0 ;;
  *file://*) exec /usr/bin/sleep 1000 ;;
  *) if [ ! -f "$T/crashed" ]; then touch "$T/crashed"; exit 1; fi; exec /usr/bin/sleep 1000 ;;
esac
EOF
printf '#!/usr/bin/env bash\necho "$*" >> "$T/logger.log"\n' > "$T/bin/logger"
printf '#!/usr/bin/env bash\n/usr/bin/sleep 0.2\n' > "$T/bin/sleep"
printf '#!/usr/bin/env bash\nexit 0\n' > "$T/bin/xset"
chmod +x "$T/bin/"*
reset() { rm -f "$T"/curl.count "$T"/curl.log "$T"/launch.log "$T"/logger.log "$T"/crashed "$T"/exit-asked; }
# The kiosk opens its normal window in the background (nohup … &) and ends at once, so the
# launch is waited for, not just looked for
waitfor() { for _ in $(seq 150); do grep -q -- "$2" "$1" 2>/dev/null && return 0; /usr/bin/sleep 0.1; done; return 1; }
kiosk_launches() { grep -c -- "--kiosk" "$T/launch.log" 2>/dev/null || echo 0; }
stray_kill() { for p in $(ps -ef | grep "/usr/bin/sleep 1000" | grep -v grep | awk '{print $2}'); do kill "$p" 2>/dev/null; done; }
finished() { for _ in $(seq 100); do kill -0 "$1" 2>/dev/null || return 0; /usr/bin/sleep 0.1; done; return 1; }

# ── Server Pi ──
reset; printf '000\n000\n200\n' > "$T/answers"
HOME="$T/home" PATH="$T/bin:/usr/bin:/bin" bash "$T/start-kiosk.sh" & K=$!
waitfor "$T/logger.log" "starting it again" && waitfor "$T/launch.log" "LAUNCH .*--kiosk http://localhost:3000/"
/usr/bin/sleep 1
[ "$(kiosk_launches)" -ge 2 ] && ok "server kiosk: waits for the server, restarts a crashed browser" || { bad "server restart"; cat "$T/launch.log"; }
grep -q -- "--user-data-dir=$T/home/.config/noticeboard-kiosk" "$T/launch.log" \
  && ok "server kiosk: runs in its own browser profile (desktop browsers stay normal windows)" || { bad "server profile"; cat "$T/launch.log"; }
grep -q "kiosk-exit/claim" "$T/curl.log" && ok "server kiosk: checks for an exit request while running" || bad "server polling"
before=$(kiosk_launches)
touch "$T/exit-asked"
if finished "$K"; then wait "$K"; rc=$?; else rc=running; fi
[ "$rc" = 0 ] && ok "server kiosk: exit asked -> the script ends (no more restarts)" || bad "server exit (rc=$rc)"
waitfor "$T/launch.log" "LAUNCH --no-first-run http://localhost:3000/?kiosk=off" && ! grep "kiosk=off" "$T/launch.log" | grep -q -- "--kiosk\|--user-data-dir" \
  && ok "server kiosk: reopens the viewer in a normal window of the desktop browser" || { bad "server normal window"; cat "$T/launch.log"; }
[ "$(kiosk_launches)" = "$before" ] && grep -q "Leaving kiosk mode" "$T/logger.log" && ok "server kiosk: logged, and the kiosk browser isn't relaunched" || bad "server no relaunch"
[ -z "$(ps -ef | grep '/usr/bin/sleep 1000' | grep -v grep)" ] && ok "server kiosk: the full-screen browser was closed" || { bad "server browser still running"; stray_kill; }

# ── Client ──
reset; printf '000\n404\n200\n' > "$T/answers"
HOME="$T/home" PATH="$T/bin:/usr/bin:/bin" bash "$T/noticeboard-kiosk.sh" & K=$!
waitfor "$T/logger.log" "starting it again" && waitfor "$T/launch.log" "LAUNCH .*--kiosk http://192.168.1.10:3000$"
/usr/bin/sleep 1
grep -q "showing the waiting page (server)" "$T/logger.log" && grep -q "showing the waiting page (approval)" "$T/logger.log" \
  && ok "remote: waiting pages while unreachable / not approved" || bad "remote waiting"
grep "LAUNCH .*--kiosk http://192.168.1.10:3000" "$T/launch.log" | grep -q -- "--user-data-dir=$T/home/.config/noticeboard-kiosk" \
  && grep "file://" "$T/launch.log" | grep -q -- "--user-data-dir=/tmp/noticeboard-waiting-profile" \
  && ok "remote: kiosk and waiting page each in their own profile" || { bad "remote profiles"; cat "$T/launch.log"; }
[ "$(grep -c -- "--kiosk http://192.168.1.10:3000" "$T/launch.log")" -ge 2 ] && ok "remote: crashed browser restarted" || bad "remote restart"
grep -q "http://192.168.1.10:3000/api/device/kiosk-exit/claim" "$T/curl.log" && ok "remote: asks its server about exit requests" || bad "remote polling"
touch "$T/exit-asked"
if finished "$K"; then wait "$K"; rc=$?; else rc=running; fi
[ "$rc" = 0 ] && waitfor "$T/launch.log" "LAUNCH --no-first-run http://192.168.1.10:3000/?kiosk=off" && grep -q "Leaving kiosk mode" "$T/logger.log" \
  && ok "remote: exit asked -> normal window, script ends" || { bad "remote exit (rc=$rc)"; cat "$T/launch.log"; }
stray_kill

rm -rf "$T"; echo "passed=$pass failed=$fail"; [ $fail -eq 0 ]
