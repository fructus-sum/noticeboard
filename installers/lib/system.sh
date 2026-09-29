# shellcheck shell=bash
# installers/lib/system.sh — the device's system: what it is, packages, Node.js, the install folder's lock, the port
#
# Provides
#   update_system        apt update, then a full upgrade (non-interactive, waits for apt's lock; with
#                        --apply, APPLY set, only the update)
#   chromium_package     chromium-browser where apt still has it, else chromium
#   is_raspberry_pi      the device tree says Raspberry Pi
#   detect_platform      pi | desktop | headless, to preselect choose_platform
#   node_new_enough      the installed Node.js is new enough (system-requirements.json)
#   lock_install_dir     holds update.sh's lock (tmp/update.lock) until the installer exits
#   slideshow_port       the port in data/config.json (read by the server's own code), or 3000
#
# Used by
#   server.sh, client.sh, firewall.sh, ui.sh (detect_platform), install.sh main (is_raspberry_pi)
#
# Uses
#   INSTALL_DIR, DEVICE_MODEL_FILE, DISPLAY_MANAGER_UNIT (install.sh); systemctl
#
# Change impact
#   node_new_enough must accept the same versions as system-requirements.json, which the admin
#   panel checks: server/test/node-version.test.js keeps them in step. update.sh reads the port
#   the same way (its server_port), through server/utils/configIO.js.

# Bring the device fully up to date before installing anything. dist-upgrade is apt-get's
# name for Raspberry Pi's recommended `apt full-upgrade`, which a plain upgrade isn't:
# that can hold back kernel and firmware updates. It keeps existing config files,
# never stops to ask, and waits if another update (e.g. the desktop's) holds the lock.
update_system() {
  local apt_opts=(-o DPkg::Lock::Timeout=300)
  echo "▸ Updating the package list..."
  apt-get "${apt_opts[@]}" update
  # The system step (--apply) only adds what a Release needs: upgrading the whole system unattended
  # is left to the device's owner (the README says how)
  if [ -n "${APPLY:-}" ]; then
    return 0
  fi
  echo "▸ Upgrading installed packages (can take a while if it hasn't been updated recently)..."
  DEBIAN_FRONTEND=noninteractive apt-get "${apt_opts[@]}" -y \
    -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold \
    dist-upgrade
}

# Newer Raspberry Pi OS ships Debian's chromium package; older releases called it
# chromium-browser. Keep the old name where apt still has it (on releases in between
# it just pulls in chromium); the kiosk scripts launch whichever command exists.
chromium_package() {
  if apt-cache show chromium-browser >/dev/null 2>&1; then
    echo chromium-browser
  else
    echo chromium
  fi
}

# A Raspberry Pi: its device tree says so
is_raspberry_pi() {
  grep -qa "Raspberry Pi" "$DEVICE_MODEL_FILE" 2>/dev/null
}

# How this device can show the slideshow, to preselect the answer (choose_platform): pi (a
# Raspberry Pi with a desktop), desktop (another machine with one), headless (no desktop)
detect_platform() {
  local desktop=""
  if [ -e "$DISPLAY_MANAGER_UNIT" ] || [ "$(systemctl get-default 2>/dev/null)" = graphical.target ]; then
    desktop=1
  fi
  if [ -z "$desktop" ]; then
    echo headless
  elif is_raspberry_pi; then
    echo pi
  else
    echo desktop
  fi
}

# The Node.js the server needs (system-requirements.json): 20.19 or newer on the 20 line, or
# 22.12 or newer. Older versions can't load some of its modules.
node_new_enough() {
  command -v node >/dev/null 2>&1 && node -e "
    const [major, minor] = process.versions.node.split('.').map(Number);
    process.exit((major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major >= 23 ? 0 : 1)" >/dev/null 2>&1
}

# Hold the updater's lock (see update.sh) while this installer changes the install
# folder, so a scheduled update can't run at the same time. Released when the installer exits.
lock_install_dir() {
  mkdir -p "$INSTALL_DIR/tmp"
  touch "$INSTALL_DIR/tmp/update.lock"
  chown "$(stat -c %U "$INSTALL_DIR")" "$INSTALL_DIR/tmp" "$INSTALL_DIR/tmp/update.lock"
  exec 9>>"$INSTALL_DIR/tmp/update.lock"
  flock 9
}

# The port the server listens on, read the way the server reads it; 3000 if that fails
slideshow_port() {
  local port=""
  port=$(cd "$INSTALL_DIR" 2>/dev/null && node -e "require('./server/utils/configIO').readConfig('data/config.json')
    .then((c) => console.log(c.port || 3000), () => console.log(3000))" 2>/dev/null) || true
  [[ "$port" =~ ^[0-9]+$ ]] || port=3000
  echo "$port"
}
