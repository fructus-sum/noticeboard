#!/usr/bin/env bash
# installers/client/kiosk.sh — the Noticeboard Client: the slideshow full screen on this device's screen
#
# Responsibilities
#   One kiosk for every Client (SYSTEM_DESIGN §18.7): a Client + Server shows its own Server
#   (http://localhost:<port in its settings>), a Client only the Server it was given. Until the
#   Server answers it shows a waiting page with this device's MAC addresses (for MAC filtering)
#   and why it's waiting; then the viewer, in a browser profile of its own, started again if it
#   exits or crashes, and started again from new Client files as soon as they're installed (a
#   Client only following its Server). With a desktop, the viewer's exit button leaves the kiosk for an ordinary
#   browser window; headless (cage, no desktop) the viewer opens with ?kiosk=headless, which hides
#   that button. See what it did: journalctl -t noticeboard-kiosk
#
# Run by
#   /usr/local/bin/noticeboard-client kiosk: the desktop's autostart, or noticeboard-kiosk.service
#   (cage) when headless. Installed into /opt/noticeboard-client/current/ by the installer
#   (installers/lib/client.sh), and from phase 3 by the Client's updates.
#
# Uses
#   /etc/noticeboard/install.env (lib/answers.sh: NOTICEBOARD_ROLE, _PLATFORM, _SERVER_URL); the
#   Server's config through its own code (/opt/noticeboard/server/utils/configIO.js) for a Client +
#   Server; Chromium, curl, logger; GET / and POST /api/device/kiosk-exit/claim on the Server.
#   /opt/noticeboard-client/version (new files: start again) and /tmp/noticeboard-kiosk-up (the
#   version, once the viewer is up). NOTICEBOARD_CONFIG, NOTICEBOARD_DIR, NOTICEBOARD_SYS_NET,
#   NOTICEBOARD_CLIENT_DIR and NOTICEBOARD_KIOSK_UP replace those paths in the tests.
#
# Change impact
#   The kiosk-exit answer ({"exit":true}, exactly), GET / answering 200 or 404, and ?kiosk=off and
#   ?kiosk=headless in the viewer are contracts with the Server (SYSTEM_DESIGN §15).

CONFIG=${NOTICEBOARD_CONFIG:-/etc/noticeboard/install.env}
SERVER_DIR=${NOTICEBOARD_DIR:-/opt/noticeboard}
SYS_NET=${NOTICEBOARD_SYS_NET:-/sys/class/net}
HERE=$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)
CLIENT_DIR=${NOTICEBOARD_CLIENT_DIR:-/opt/noticeboard-client}
# Written once the viewer has been up a few seconds: the Client's update waits for its version
# before it counts an update as working (noticeboard-client check, SYSTEM_DESIGN §18.7 phase 3)
KIOSK_UP=${NOTICEBOARD_KIOSK_UP:-/tmp/noticeboard-kiosk-up}
START_VERSION=$(cat "$CLIENT_DIR/version" 2>/dev/null)
PAGE=/tmp/noticeboard-waiting.html
# The waiting page runs in its own browser profile, so it can't hand over to the real one
WAITING_PROFILE=/tmp/noticeboard-waiting-profile
# So does the kiosk itself, so a browser opened from the desktop is an ordinary window
KIOSK_PROFILE="$HOME/.config/noticeboard-kiosk"
log() { logger -t noticeboard-kiosk "$*" 2>/dev/null || true; }
setting() { sed -n "s/^NOTICEBOARD_$1=//p" "$CONFIG" 2>/dev/null | head -n 1; }

ROLE=$(setting ROLE)
PLATFORM=$(setting PLATFORM)

# Newer Raspberry Pi OS calls the browser chromium; older releases chromium-browser
BROWSER=$(command -v chromium-browser || command -v chromium || true)
if [ -z "$BROWSER" ]; then
  log "Chromium isn't installed; run the Noticeboard installer again"
  exit 1
fi
FLAGS=(--noerrdialogs --disable-infobars --disable-session-crashed-bubble
       --disable-component-update --check-for-update-interval=31536000
       --no-first-run --no-default-browser-check --disable-search-engine-choice-screen
       --password-store=basic
       --autoplay-policy=no-user-gesture-required)   # background audio plays without a click
if [ "$PLATFORM" = headless ]; then
  FLAGS+=(--ozone-platform-hint=auto)   # cage is a Wayland compositor
else
  # Disable display blanking (X11 desktops; ignored under Wayland)
  xset s off    2>/dev/null || true
  xset -dpms    2>/dev/null || true
  xset s noblank 2>/dev/null || true
fi

# The Server's address, without a slash at the end. A Client + Server: its own, on the port in its
# settings (read the way the server reads it; 3000 if that fails), read again whenever the browser
# starts, so a new port is followed.
server_base() {
  if [ "$ROLE" = both ]; then
    local port=""
    port=$(cd "$SERVER_DIR" 2>/dev/null && node -e "require('./server/utils/configIO').readConfig('data/config.json')
      .then((c) => console.log(c.port || 3000), () => console.log(3000))" 2>/dev/null) || true
    [[ "$port" =~ ^[0-9]+$ ]] || port=3000
    echo "http://localhost:$port"
  else
    local url
    url=$(setting SERVER_URL)
    echo "${url%/}"
  fi
}

# This device's MAC addresses, as table rows for the waiting page
macs_html() {
  local iface_path iface mac rows=""
  for iface_path in "$SYS_NET"/*/; do
    iface=$(basename "$iface_path")
    [ "$iface" = lo ] && continue
    mac=$(cat "$iface_path/address" 2>/dev/null || true)
    { [ -z "$mac" ] || [ "$mac" = "00:00:00:00:00:00" ]; } && continue
    rows="${rows}<tr><td class='iface'>${iface}</td><td class='mac'>${mac}</td></tr>"
  done
  echo "$rows"
}

# The local page shown until the Server answers: this device's MAC addresses and why it's waiting.
# It reloads itself every 10 s, so rewriting the file changes what's on screen.
write_page() {   # write_page <heading> <note>
  cat > "$PAGE" <<HTML
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="10">
  <title>Noticeboard Client</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0f172a; color: #e2e8f0;
      font-family: monospace;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh;
    }
    .box { text-align: center; padding: 2rem; }
    .heading { color: #94a3b8; font-size: 1rem; margin-bottom: 2rem; }
    table { margin: 0 auto; border-collapse: collapse; }
    .iface { color: #64748b; font-size: 0.85rem; padding: 4px 20px 4px 0; text-align: right; }
    .mac   { font-size: 1.6rem; letter-spacing: 0.08em; padding: 4px 0; }
    .note  { color: #475569; font-size: 0.8rem; margin-top: 2rem; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="box">
    <p class="heading">$1</p>
    <table>$(macs_html)</table>
    <p class="note">$2</p>
  </div>
</body>
</html>
HTML
}

WAITING_PID=""
stop_waiting_page() {
  if [ -n "$WAITING_PID" ]; then
    kill "$WAITING_PID" 2>/dev/null
    wait "$WAITING_PID" 2>/dev/null
    WAITING_PID=""
    sleep 2
  fi
}

# The waiting page until the Server answers GET / with 200 (404: not approved by MAC filtering)
wait_for_server() {
  local state="" new code
  while true; do
    BASE=$(server_base)
    if [ -n "$BASE" ]; then
      # curl prints 000 itself when it can't connect (and fails): don't add another
      code=$(curl -o /dev/null -s -w "%{http_code}" --max-time 10 "$BASE/" 2>/dev/null) || true
      [ -n "$code" ] || code=000
    else
      code=none
    fi
    [ "$code" = 200 ] && return 0
    case "$code" in
      404) new=approval ;;
      none) new=unset ;;
      *) new=server ;;
    esac
    if [ "$new" != "$state" ]; then
      state=$new
      case "$state" in
        approval) write_page "This Client is waiting for MAC address approval" \
          "Give the MAC address above to your Noticeboard admin.<br>The noticeboard appears by itself once this Client is approved." ;;
        unset) write_page "This Client doesn't know its Server's address" \
          "Run the Noticeboard installer again on this device and give it the Server's address." ;;
        *) write_page "Waiting for the Noticeboard Server at $BASE" \
          "Checking every 10 seconds.<br>The noticeboard appears by itself as soon as the Server answers." ;;
      esac
      log "Server answered HTTP $code (000 = unreachable); showing the waiting page ($state)"
    fi
    if [ -z "$WAITING_PID" ] || ! kill -0 "$WAITING_PID" 2>/dev/null; then
      "$BROWSER" "${FLAGS[@]}" --user-data-dir="$WAITING_PROFILE" --kiosk "file://$PAGE" &
      WAITING_PID=$!
    fi
    sleep 10
    if new_files; then
      stop_waiting_page
      start_again
    fi
  done
}

# New Client files were installed (their version changed): start again from them
new_files() {
  [ "$(cat "$CLIENT_DIR/version" 2>/dev/null)" != "$START_VERSION" ]
}
start_again() {
  log "New Client files ($(cat "$CLIENT_DIR/version" 2>/dev/null)): starting the kiosk again"
  exec bash "$HERE/kiosk.sh"
}

# The exit button in the viewer's top-right corner asks the Server; the answer is for this device
# only, so other screens are never affected
exit_requested() {
  [ "$(curl -s -X POST --max-time 3 "$BASE/api/device/kiosk-exit/claim" 2>/dev/null)" = '{"exit":true}' ]
}

# Close the full-screen browser, open the viewer in an ordinary window of the desktop's own
# browser, and stop. This screen goes back to kiosk mode the next time it starts up.
leave_kiosk() {   # leave_kiosk <browser pid>
  log "Leaving kiosk mode, as asked on this screen; opening a normal browser window"
  kill "$1" 2>/dev/null
  wait "$1" 2>/dev/null
  sleep 1
  nohup "$BROWSER" --no-first-run "$BASE/?kiosk=off" >/dev/null 2>&1 &
  exit 0
}

VIEW=""
if [ "$PLATFORM" = headless ]; then VIEW="?kiosk=headless"; fi
while true; do
  wait_for_server
  stop_waiting_page
  log "Server $BASE answered; starting $BROWSER"
  "$BROWSER" "${FLAGS[@]}" --user-data-dir="$KIOSK_PROFILE" --kiosk "$BASE/$VIEW" &
  pid=$!
  seconds=0
  while kill -0 "$pid" 2>/dev/null; do
    sleep 3
    seconds=$((seconds + 3))
    if [ "$seconds" = 12 ]; then
      printf '%s\n' "$START_VERSION" > "$KIOSK_UP" 2>/dev/null || true
    fi
    if new_files; then
      kill "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null
      start_again
    fi
    if [ "$PLATFORM" != headless ] && exit_requested; then
      leave_kiosk "$pid"
    fi
  done
  wait "$pid"
  log "Browser exited (code $?); starting it again"
  sleep 5
done
