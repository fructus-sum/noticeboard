#!/usr/bin/env bash
# shellcheck disable=SC1090,SC2034  # the variables set here are read by the kiosk and the stand-ins
# The Client's kiosk (installers/client/kiosk.sh, SYSTEM_DESIGN §18.7), run through its command
# (installers/client/noticeboard-client) with stand-ins for chromium, curl, logger, node and
# sleep, and its saved answers (/etc/noticeboard/install.env) and network interfaces in a
# temporary folder: wait for the Server with the waiting page (with this device's MAC addresses),
# restart a crashed browser, and leave kiosk mode when this screen's exit button asks (the claim
# endpoint answers {"exit":true}). A Client + Server opens the port in its settings (a stand-in node
# answers for readConfig), and 3000 when that can't be read. Headless: ?kiosk=headless, no exit.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
T=$(mktemp -d); export T
pass=0; fail=0
ok()  { pass=$((pass+1)); echo "PASS  $1"; }
bad() { fail=$((fail+1)); echo "FAIL  $1"; }
CLIENT="$REPO/installers/client/noticeboard-client"

# The device: its saved answers, the Server folder a Client + Server reads its port from, and its
# network interfaces
export NOTICEBOARD_CONFIG="$T/install.env" NOTICEBOARD_DIR="$T/server" NOTICEBOARD_SYS_NET="$T/net" \n  NOTICEBOARD_CLIENT_DIR="$T/client-files" NOTICEBOARD_KIOSK_UP="$T/kiosk-up"
mkdir -p "$T/client-files"; echo "v1" > "$T/client-files/version"
mkdir -p "$T/bin" "$T/home" "$T/server" "$T/net/lo" "$T/net/eth0" "$T/net/wlan0"
echo "00:00:00:00:00:00" > "$T/net/lo/address"
echo "dc:a6:32:01:02:03" > "$T/net/eth0/address"
echo "dc:a6:32:0a:0b:0c" > "$T/net/wlan0/address"
answers() {   # answers <role> <platform> [<server url>]
  printf 'NOTICEBOARD_ROLE=%s\nNOTICEBOARD_PLATFORM=%s\nNOTICEBOARD_SERVER_URL=%s\nNOTICEBOARD_DISPLAY_USER=pi\n' "$1" "$2" "${3:-}" > "$T/install.env"
}

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
# chromium: the first kiosk launch "crashes"; later kiosk launches and the waiting page stay open.
# The waiting page is copied when it's opened, to check what it says.
cat > "$T/bin/chromium" <<'EOF'
#!/usr/bin/env bash
echo "LAUNCH $*" >> "$T/launch.log"
case "$*" in
  *kiosk=off*) exit 0 ;;
  *file://*) cp /tmp/noticeboard-waiting.html "$T/page-$(date +%s%N).html" 2>/dev/null; exec /usr/bin/sleep 1000 ;;
  *) if [ ! -f "$T/crashed" ]; then touch "$T/crashed"; exit 1; fi; exec /usr/bin/sleep 1000 ;;
esac
EOF
printf '#!/usr/bin/env bash\necho "$*" >> "$T/logger.log"\n' > "$T/bin/logger"
printf '#!/usr/bin/env bash\n/usr/bin/sleep 0.2\n' > "$T/bin/sleep"
printf '#!/usr/bin/env bash\nexit 0\n' > "$T/bin/xset"
# A stand-in node: prints what $T/port holds, as the readConfig one-liner prints the port
printf '#!/usr/bin/env bash\ncat "$T/port" 2>/dev/null || echo 3000\n' > "$T/bin/node"
# The kiosk looks for chromium-browser first: the stand-in answers to both names (a CI runner has a real one)
cp "$T/bin/chromium" "$T/bin/chromium-browser"
chmod +x "$T/bin/"*
reset() { rm -f "$T"/curl.count "$T"/curl.log "$T"/launch.log "$T"/logger.log "$T"/crashed "$T"/exit-asked "$T"/page-*.html "$T/port"; }
# The kiosk opens its normal window in the background (nohup … &) and ends at once, so the
# launch is waited for, not just looked for
waitfor() { for _ in $(seq 150); do grep -q -- "$2" "$1" 2>/dev/null && return 0; /usr/bin/sleep 0.1; done; return 1; }
kiosk_launches() { grep -c -- "--kiosk http" "$T/launch.log" 2>/dev/null || echo 0; }
stray_kill() { for p in $(ps -ef | grep "/usr/bin/sleep 1000" | grep -v grep | awk '{print $2}'); do kill "$p" 2>/dev/null; done; }
finished() { for _ in $(seq 100); do kill -0 "$1" 2>/dev/null || return 0; /usr/bin/sleep 0.1; done; return 1; }
start() { HOME="$T/home" PATH="$T/bin:/usr/bin:/bin" bash "$CLIENT" kiosk & K=$!; }
stop() { kill "$K" 2>/dev/null; wait "$K" 2>/dev/null; stray_kill; }

# ── Client + Server, with a desktop ──
reset; answers both pi; printf '000\n000\n200\n' > "$T/answers"
start
waitfor "$T/logger.log" "starting it again" && waitfor "$T/launch.log" "LAUNCH .*--kiosk http://localhost:3000/$"
/usr/bin/sleep 1
[ "$(kiosk_launches)" -ge 2 ] && ok "Client + Server: waits for its Server, restarts a crashed browser" || { bad "both restart"; cat "$T/launch.log"; }
grep -q "Server answered HTTP 000 (000 = unreachable); showing the waiting page (server)" "$T/logger.log" \
  && grep -q "Waiting for the Noticeboard Server at http://localhost:3000" "$T"/page-*.html \
  && ok "Client + Server: the waiting page while its Server starts" || { bad "both waiting"; cat "$T/logger.log"; }
grep -- "--kiosk http" "$T/launch.log" | grep -q -- "--user-data-dir=$T/home/.config/noticeboard-kiosk" \
  && ok "Client + Server: runs in its own browser profile (desktop browsers stay normal windows)" || { bad "both profile"; cat "$T/launch.log"; }
grep -q "http://localhost:3000/api/device/kiosk-exit/claim" "$T/curl.log" && ok "Client + Server: checks for an exit request while running" || bad "both polling"
before=$(kiosk_launches)
touch "$T/exit-asked"
if finished "$K"; then wait "$K"; rc=$?; else rc=running; fi
[ "$rc" = 0 ] && ok "Client + Server: exit asked -> the kiosk ends (no more restarts)" || bad "both exit (rc=$rc)"
waitfor "$T/launch.log" "LAUNCH --no-first-run http://localhost:3000/?kiosk=off" && ! grep "kiosk=off" "$T/launch.log" | grep -q -- "--kiosk\|--user-data-dir" \
  && ok "Client + Server: reopens the viewer in a normal window of the desktop browser" || { bad "both normal window"; cat "$T/launch.log"; }
[ "$(kiosk_launches)" = "$before" ] && grep -q "Leaving kiosk mode" "$T/logger.log" && ok "Client + Server: logged, and the kiosk browser isn't relaunched" || bad "both no relaunch"
[ -z "$(ps -ef | grep '/usr/bin/sleep 1000' | grep -v grep)" ] && ok "Client + Server: the full-screen browser was closed" || { bad "both browser still running"; stray_kill; }

# ── Client + Server: the port in its settings ──
for case in "3456 3456" "not-a-port 3000"; do
  set -- $case
  reset; answers both desktop; echo "$1" > "$T/port"; touch "$T/crashed"; printf '200\n' > "$T/answers"
  start
  waitfor "$T/launch.log" "LAUNCH .*--kiosk http://localhost:$2/$" \
    && ok "Client + Server: settings say $1 -> opens http://localhost:$2/" || { bad "both port $1"; cat "$T/launch.log"; }
  stop
done

# ── Client only, with a desktop ──
reset; answers client desktop "http://192.168.1.10:3000/"; printf '000\n404\n200\n' > "$T/answers"
start
waitfor "$T/logger.log" "starting it again" && waitfor "$T/launch.log" "LAUNCH .*--kiosk http://192.168.1.10:3000/$"
/usr/bin/sleep 1
grep -q "showing the waiting page (server)" "$T/logger.log" && grep -q "showing the waiting page (approval)" "$T/logger.log" \
  && ok "Client: waiting pages while unreachable / not approved" || bad "Client waiting"
page=$(cat "$T"/page-*.html 2>/dev/null)
grep -q "dc:a6:32:01:02:03" <<<"$page" && grep -q "dc:a6:32:0a:0b:0c" <<<"$page" && ! grep -q "00:00:00:00:00:00" <<<"$page" \
  && ok "Client: the waiting page shows this device's MAC addresses (not the loopback)" || { bad "Client MACs"; echo "$page" | head -30; }
grep "LAUNCH .*--kiosk http://192.168.1.10:3000" "$T/launch.log" | grep -q -- "--user-data-dir=$T/home/.config/noticeboard-kiosk" \
  && grep "file://" "$T/launch.log" | grep -q -- "--user-data-dir=/tmp/noticeboard-waiting-profile" \
  && ok "Client: kiosk and waiting page each in their own profile" || { bad "Client profiles"; cat "$T/launch.log"; }
[ "$(grep -c -- "--kiosk http://192.168.1.10:3000" "$T/launch.log")" -ge 2 ] && ok "Client: crashed browser restarted" || bad "Client restart"
grep -q "http://192.168.1.10:3000/api/device/kiosk-exit/claim" "$T/curl.log" && ok "Client: asks its Server about exit requests" || bad "Client polling"
touch "$T/exit-asked"
if finished "$K"; then wait "$K"; rc=$?; else rc=running; fi
[ "$rc" = 0 ] && waitfor "$T/launch.log" "LAUNCH --no-first-run http://192.168.1.10:3000/?kiosk=off" && grep -q "Leaving kiosk mode" "$T/logger.log" \
  && ok "Client: exit asked -> normal window, the kiosk ends" || { bad "Client exit (rc=$rc)"; cat "$T/launch.log"; }
stray_kill

# ── Client only, headless (cage) ──
reset; answers client headless "http://192.168.1.10:3000"; touch "$T/crashed"; printf '200\n' > "$T/answers"
start
waitfor "$T/launch.log" "LAUNCH .*--kiosk http://192.168.1.10:3000/?kiosk=headless$" \
  && ok "headless: the viewer opens with ?kiosk=headless (no exit button)" || { bad "headless url"; cat "$T/launch.log"; }
grep -- "--kiosk http" "$T/launch.log" | grep -q -- "--ozone-platform-hint=auto" && ok "headless: Chromium finds cage's Wayland display" || bad "headless ozone"
/usr/bin/sleep 2
! grep -q "kiosk-exit/claim" "$T/curl.log" && ok "headless: no exit requests asked for (no desktop to go to)" || bad "headless polling"
stop

# ── New Client files: the kiosk says when it's up, and starts again from new files ──
reset; rm -f "$T/kiosk-up"; echo v1 > "$T/client-files/version"; answers client desktop "http://192.168.1.10:3000"; touch "$T/crashed"; printf '200
' > "$T/answers"
start
waitfor "$T/kiosk-up" "^v1$" && ok "the viewer up for a few seconds: the kiosk writes its version (for the Client's update)" || bad "kiosk-up"
echo v2 > "$T/client-files/version"
waitfor "$T/logger.log" "New Client files (v2): starting the kiosk again" && waitfor "$T/kiosk-up" "^v2$"   && ok "new Client files installed: the kiosk closes its browser and starts again from them" || { bad "restart"; cat "$T/logger.log"; }
stop
[ ! -e "$T/kiosk-up" ] && ok "  … and once stopped, it no longer says it's up (an update never waits for a kiosk that isn't running)" || bad "kiosk-up left behind"

# ── Client only without a Server address ──
reset; answers client desktop ""; printf '200\n' > "$T/answers"
start
waitfor "$T/logger.log" "showing the waiting page (unset)" \
  && ok "no Server address saved: the waiting page says to run the installer again" || { bad "unset"; cat "$T/logger.log"; }
stop

# ── The Client's command ──
mkdir -p "$T/client"; echo "abc1234" > "$T/client/version"
[ "$(NOTICEBOARD_CLIENT_DIR="$T/client" bash "$CLIENT" version)" = abc1234 ] && ok "noticeboard-client version: the installed version" || bad "version"
NOTICEBOARD_CLIENT_DIR="$T/client" bash "$CLIENT" nonsense >/dev/null 2>&1; [ $? = 2 ] && ok "noticeboard-client: an unknown command fails, with the usage" || bad "usage"

rm -rf "$T"; echo "passed=$pass failed=$fail"; [ $fail -eq 0 ]
