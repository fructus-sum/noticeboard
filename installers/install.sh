#!/usr/bin/env bash
# shellcheck disable=SC2034  # the configuration is read by the modules in installers/lib
# install.sh
# Sets up a Noticeboard device, on Raspberry Pi OS or Debian, with a desktop or headless. It asks
# what the device does (SYSTEM_DESIGN §8, §18.7):
#   1) Client + Server: runs the Noticeboard and shows the slideshow on its own screen
#   2) Client only: shows the slideshow from a Server elsewhere on the network
#   3) Server only: runs the Noticeboard, with no screen of its own
# and, with a Client, how it shows the slideshow (a Raspberry Pi's desktop, another desktop, or
# headless with cage). The answers are saved in /etc/noticeboard/install.env for the next run.
#
# Run with:  sudo bash installers/install.sh
#   or:      curl -fsSL https://raw.githubusercontent.com/fructus-sum/noticeboard/main/installers/install.sh | sudo bash
#
# This file holds the configuration, the switch to the latest installer, the loading of its
# parts, and the order of the steps (run_installer; with --apply, apply_saved_installation). The
# steps are in installers/lib/*.sh, the Client's files it installs in installers/client/ and root's
# own files (the system step, the noticeboard command) in installers/root/ (see load_modules).
#   sudo bash install.sh --apply   no questions: the saved answers, only what updates can't do (run
#                                  by root's system step at main's latest Release, §18.7 phase 2,
#                                  and on a Client only by noticeboard-client check, phase 3)
# Older installers hand over by
# downloading only this file, so it must keep its name, pass bash -n and keep the line
# starting INSTALLER_VERSION=.
#
# Used by
#   people (the README's command); older installers and other branches' installers, which hand
#   over to it (use_latest_installer, use_branch_installer); root's system step (--apply)
# Uses
#   installers/lib/*.sh, installers/client/* and installers/root/* of the same commit (load_modules); GitHub's API
#   and raw.githubusercontent.com
# Change impact
#   What it installs that updates can't change (the Client, units, root's files, shortcuts,
#   packages) only reaches a Server or Client when the installer runs again (by hand, or on main by
#   the system step): raise INSTALLER_VERSION with such a change
#   (SYSTEM_DESIGN §8, §15). tests/installers compares what it writes with golden files.
set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
GITHUB_REPO="fructus-sum/noticeboard"
REPO_URL="https://github.com/${GITHUB_REPO}.git"
INSTALL_DIR="/opt/noticeboard"
SERVICE_NAME="noticeboard"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
UPDATE_SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}-update.service"
UPDATE_TIMER_FILE="/etc/systemd/system/${SERVICE_NAME}-update.timer"
UPDATE_PATH_FILE="/etc/systemd/system/${SERVICE_NAME}-update.path"
BRANCH_FILE="$INSTALL_DIR/data/update-branch.env"   # the branch chosen in the admin panel (see update.sh)
AUTOSTART_FILE="/etc/xdg/autostart/noticeboard-kiosk.desktop"
INSTALL_ENV_FILE="/etc/noticeboard/install.env"   # the saved answers (lib/answers.sh)
CLIENT_DIR="/opt/noticeboard-client"               # the Client's files: current/, version (lib/client.sh)
CLIENT_LAUNCHER="/usr/local/bin/noticeboard-client"
KIOSK_SERVICE_FILE="/etc/systemd/system/noticeboard-kiosk.service"   # a headless Client's kiosk
OLD_CLIENT_KIOSK="/usr/local/bin/noticeboard-kiosk.sh"   # a Client's kiosk before 0.9.0 (removed)
CLIENT_UPDATE_SERVICE_FILE="/etc/systemd/system/noticeboard-client-update.service"   # a Client only follows its Server
CLIENT_UPDATE_TIMER_FILE="/etc/systemd/system/noticeboard-client-update.timer"
SERVER_KEY_FILE="/etc/noticeboard/server.pub"      # the Server's key a Client only trusts
DEVICE_MODEL_FILE="/proc/device-tree/model"         # says Raspberry Pi on one (lib/system.sh)
DISPLAY_MANAGER_UNIT="/etc/systemd/system/display-manager.service"   # there's a desktop
SUDOERS_BACKUP_DIR="/root/noticeboard-sudoers-backup"
# The system step (lib/server.sh): its units, and root's own files outside the app's folder
SYSTEM_SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}-system.service"
SYSTEM_PATH_FILE="/etc/systemd/system/${SERVICE_NAME}-system.path"
SYSTEM_STEP="/usr/local/sbin/noticeboard-system"
SERVER_COMMAND="/usr/local/bin/noticeboard"
ROOT_LIB_DIR="/usr/local/lib/noticeboard"
# Raise this, and "installer" in system-requirements.json, whenever this script changes what
# updates can't: the Client, system services, desktop shortcuts or system packages. A Server
# whose last installer run (data/installer.json) is older is told to run it again, or on main
# runs it by itself (the system step).
INSTALLER_VERSION=7
# A Server follows main unless another branch was chosen in the admin panel (choose_branch)
INSTALL_BRANCH=main
# The installer's parts, from the same commit as this script (see load_modules)
INSTALLER_MODULES=(ui branch json release answers system sudo server client desktop firewall)   # installers/lib/<name>.sh
CLIENT_FILES=(kiosk.sh noticeboard-client)   # installers/client/<name>, read in as CLIENT_FILE_<name, . and - as _>
ROOT_FILES=(noticeboard-system noticeboard)  # installers/root/<name>, read in as ROOT_FILE_<name, - as _>
ROOT_LIBS=(branch json release)              # parts root's files load too: copied as ROOT_LIB_<name>
ROLE=""; MODE=""; PLATFORM=""; SERVER_URL=""   # the answers (ui.sh, client.sh)
APPLY=""   # --apply: no questions, the saved answers, only what updates can't do (the system step)

# Everything runs from main(), called on the last line, so a half-downloaded
# script (curl | bash) runs nothing.
main() {
  # ── Root check ──────────────────────────────────────────────────────────────
  if [ "$EUID" -ne 0 ]; then
    echo "ERROR: Run this script with sudo."
    exit 1
  fi

  if [ "${1:-}" = --apply ]; then
    APPLY=1
  fi
  use_latest_installer "$@"
  load_modules
  if [ -n "$APPLY" ]; then
    apply_saved_installation
  else
    run_installer "$@"
  fi
}

# --apply (run by root's system step, noticeboard-system, at main's latest Release; on a Client
# only by noticeboard-client check, from its Server's signed bundle): what updates
# can't do, with the saved answers and no questions: the Server's packages and services (without
# restarting it: update.sh installs the code and restarts it next) and the Client, then the record.
# Never the code, the sudo check, the firewall or a reboot.
apply_saved_installation() {
  load_answers
  if [ -z "$SAVED_ROLE" ]; then
    echo "ERROR: This device has no saved answers (/etc/noticeboard/install.env): run the installer once by hand."
    exit 1
  fi
  set_role "$SAVED_ROLE"
  PLATFORM=$SAVED_PLATFORM
  SERVER_URL=$SAVED_SERVER_URL
  DESKTOP_USER=${SAVED_DISPLAY_USER:-pi}
  INSTALL_BRANCH=main
  echo "Applying installer version $INSTALLER_VERSION ($(role_name "$ROLE"))..."
  if has_server; then
    install_server_packages
    install_server_services --no-restart
  fi
  if has_client; then
    install_client
  fi
  save_answers
  if has_server; then
    write_installer_record
  fi
  echo "Done: installer version $INSTALLER_VERSION applied."
}

# The questions and the steps, in order, once the installer's parts are loaded (the installer
# tests run this with stand-ins for the system's commands)
run_installer() {
  # The user the Noticeboard runs as, and the Client's screen belongs to (the one who invoked sudo)
  DESKTOP_USER="${SUDO_USER:-pi}"

  echo ""
  banner "Noticeboard installer"
  echo ""

  if ! has_tty; then
    echo "ERROR: This installer asks questions, so run it from a terminal."
    exit 1
  fi

  load_answers
  choose_role
  refuse_role_change
  if ! id "$DESKTOP_USER" >/dev/null 2>&1; then
    echo "ERROR: User '$DESKTOP_USER' not found. Run this with sudo from the user the Noticeboard runs as."
    exit 1
  fi
  choose_branch
  if has_client; then
    choose_platform
  fi
  if [ "$ROLE" = client ]; then
    ask_server_url
  fi
  use_branch_installer "$@"

  # Raspberry Pi OS lets its first user run sudo without a password: offered only there
  if is_raspberry_pi; then
    check_sudo_password
  fi
  echo ""

  if has_server; then
    install_server
  fi
  if has_client; then
    install_client
  else
    rm -f "$AUTOSTART_FILE"   # a Server only has no screen of its own (an older one had a kiosk)
    remove_old_kiosks
  fi
  save_answers
  if [ "$ROLE" = client ]; then
    follow_server
  fi
  if has_server; then
    write_installer_record   # last: a run that stopped part way doesn't count
    summary_server
  else
    echo ""
    banner "Installation complete"
  fi
  if has_client; then
    summary_client
  fi
  # Optional, and never allowed to stop the installer before the reboot prompt
  check_firewall || echo "  The firewall step ran into a problem; nothing more was changed."
  if has_client; then
    offer_reboot
  fi
}

# ── Latest installer ──────────────────────────────────────────────────────────
# Whatever copy was started (an old one on this device, or a GitHub link, which can serve a
# stale copy for a few minutes after a push), switch to the latest installer of the
# branch this Server follows (Settings → Software updates), else main's, so what it sets up
# matches the version it installs. A branch whose installer is older than this falls back
# to main's. A link pinned to a commit is never stale. If GitHub can't be reached, carry
# on with this copy. To run a local copy as it is (e.g. to test changes):
#   sudo NOTICEBOARD_INSTALLER_SHA=local bash installers/install.sh
# To install a development branch on any device (a new one, or a Client, which follows no branch
# of its own; SYSTEM_DESIGN §18.7):
#   curl -fsSL https://raw.githubusercontent.com/fructus-sum/noticeboard/<branch>/installers/install.sh #     | sudo NOTICEBOARD_INSTALL_BRANCH=<branch> bash
use_latest_installer() {
  if [ -n "${NOTICEBOARD_INSTALLER_SHA:-}" ]; then
    return 0
  fi
  local branch
  if [[ "${NOTICEBOARD_INSTALL_BRANCH:-}" =~ ^[A-Za-z0-9._/-]{1,100}$ ]]; then
    branch=$NOTICEBOARD_INSTALL_BRANCH
  else
    branch=$(followed_branch)
  fi
  if [ "$branch" != main ]; then
    run_installer_from "$branch" "$@" \
      || echo "The installer from $branch can't be used ($INSTALLER_PROBLEM), so this uses main's."
  fi
  run_installer_from main "$@" || echo "${INSTALLER_PROBLEM^}; carrying on with this one."
}

# Download <branch>'s latest installer (or a Release's, given its tag) and run it instead of this
# one. Only returns if it can't, with the reason in INSTALLER_PROBLEM.
INSTALLER_PROBLEM=""
run_installer_from() {   # run_installer_from <branch> <arguments...>
  local branch=$1 sha file
  shift
  if ! sha=$(curl -fsSL --max-time 20 -H 'Accept: application/vnd.github.sha' \
               "https://api.github.com/repos/$GITHUB_REPO/commits/$branch") \
     || [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
    INSTALLER_PROBLEM="couldn't check GitHub for a newer installer"
    return 1
  fi
  file=$(mktemp /tmp/noticeboard-install.XXXXXX)
  if ! curl -fsSL --max-time 60 -o "$file" \
         "https://raw.githubusercontent.com/$GITHUB_REPO/$sha/installers/install.sh" \
     || ! bash -n "$file"; then
    rm -f "$file"
    INSTALLER_PROBLEM="couldn't download the latest installer"
    return 1
  fi
  # A branch's own installer only if it knows to follow branches (else it would hand back to main's)
  if [ "$branch" != main ] && ! grep -q '^INSTALLER_VERSION=' "$file"; then
    rm -f "$file"
    INSTALLER_PROBLEM="it's too old"
    return 1
  fi
  if [ "$branch" = "${NOTICEBOARD_INSTALLER_RELEASE:-}" ]; then
    echo "Running the installer of Release $branch (${sha:0:7})..."
  elif [ "$branch" = main ]; then
    echo "Running the latest installer (${sha:0:7})..."
  else
    echo "Running the latest installer from $branch (${sha:0:7})..."
  fi
  export NOTICEBOARD_INSTALLER_SHA="$sha" NOTICEBOARD_INSTALLER_BRANCH="$branch"
  exec bash "$file" "$@"
}

# The installer came from the branch this Server followed (a Client's: main's). Once the questions
# are answered, hand over with the answers so far to the installer of what will be installed: the
# chosen branch's, or on main the latest Release's (lib/release.sh; main's own when none is
# published or GitHub can't be asked). A Release's installer doesn't hand over again
# (NOTICEBOARD_INSTALLER_RELEASE).
use_branch_installer() {
  local from=${NOTICEBOARD_INSTALLER_BRANCH:-} ref=$INSTALL_BRANCH tag
  if [ -z "$from" ] || [ "${NOTICEBOARD_INSTALLER_SHA:-}" = local ]; then
    return 0
  fi
  if [ "$INSTALL_BRANCH" = main ]; then
    if [ -n "${NOTICEBOARD_INSTALLER_RELEASE:-}" ]; then
      return 0
    fi
    if tag=$(latest_release); then
      ref=$tag
    fi
  fi
  if [ "$from" = "$ref" ]; then
    return 0
  fi
  # The answers so far; an installer before 0.9.0 reads only NOTICEBOARD_MODE and the branch
  export NOTICEBOARD_MODE="$MODE" NOTICEBOARD_INSTALL_BRANCH="$INSTALL_BRANCH" NOTICEBOARD_ROLE="$ROLE" \
    NOTICEBOARD_PLATFORM="$PLATFORM" NOTICEBOARD_SERVER_URL="$SERVER_URL"
  if [ "$ref" != "$INSTALL_BRANCH" ]; then
    export NOTICEBOARD_INSTALLER_RELEASE="$ref"
  fi
  run_installer_from "$ref" "$@" \
    || echo "The installer from $ref can't be used ($INSTALLER_PROBLEM), so this one carries on."
  unset NOTICEBOARD_MODE NOTICEBOARD_INSTALL_BRANCH NOTICEBOARD_INSTALLER_RELEASE NOTICEBOARD_ROLE \
    NOTICEBOARD_PLATFORM NOTICEBOARD_SERVER_URL
}

# The branch this Server follows (Settings → Software updates), or main
followed_branch() {
  local branch
  branch=$(sed -n 's/^NOTICEBOARD_BRANCH=//p' "$BRANCH_FILE" 2>/dev/null | head -n 1 || true)
  if [[ "$branch" =~ ^[A-Za-z0-9._/-]{1,100}$ ]]; then
    echo "$branch"
  else
    echo main
  fi
}

# ── The installer's parts ─────────────────────────────────────────────────────
# installers/lib/*.sh, installers/client/* and installers/root/*, always from the same commit as this script:
#   NOTICEBOARD_INSTALLER_SHA=local     next to this script (a copy of the repository)
#   NOTICEBOARD_INSTALLER_SHA=<commit>  downloaded from GitHub at that commit: after the switch
#                                       to the latest installer, or a hand-over from an older
#                                       installer, which only downloads install.sh
#   not set (GitHub couldn't be asked for the latest installer): next to this script if it's in
#                                       a copy of the repository, else downloaded at the branch
#                                       this Server follows
# They're read into memory and the download is deleted straight away. Anything missing or
# broken stops the installer here, before it has changed anything.
load_modules() {
  local here="" ref="" dir=""
  if [ -f "${BASH_SOURCE[0]:-}" ]; then
    here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  fi
  case "${NOTICEBOARD_INSTALLER_SHA:-}" in
    local) dir=$here ;;
    "")    if [ -n "$here" ] && [ -f "$here/lib/ui.sh" ]; then dir=$here; else ref=$(followed_branch); fi ;;
    *)     ref=$NOTICEBOARD_INSTALLER_SHA ;;
  esac
  if [ -n "$ref" ]; then
    dir=$(mktemp -d /tmp/noticeboard-installer.XXXXXX)
    if ! download_modules "$ref" "$dir"; then
      rm -rf "$dir"
      echo "ERROR: Couldn't download the rest of the installer from GitHub ($ref). Nothing was changed."
      echo "Check the internet connection and run the installer again."
      exit 1
    fi
  fi
  if [ -z "$dir" ] || ! load_modules_from "$dir"; then
    if [ -n "$ref" ]; then rm -rf "$dir"; fi
    echo "ERROR: Parts of the installer (installers/lib, client, root) are missing or broken,"
    echo "so nothing was changed. Run it with the command from the README, or from a complete copy"
    echo "of the repository."
    exit 1
  fi
  if [ -n "$ref" ]; then rm -rf "$dir"; fi
}

download_modules() {   # download_modules <commit or branch> <folder>
  local name
  mkdir -p "$2/lib" "$2/client" "$2/root"
  for name in "${INSTALLER_MODULES[@]}"; do
    curl -fsSL --max-time 60 -o "$2/lib/$name.sh" \
      "https://raw.githubusercontent.com/$GITHUB_REPO/$1/installers/lib/$name.sh" || return 1
  done
  for name in "${CLIENT_FILES[@]}"; do
    curl -fsSL --max-time 60 -o "$2/client/$name" \
      "https://raw.githubusercontent.com/$GITHUB_REPO/$1/installers/client/$name" || return 1
  done
  for name in "${ROOT_FILES[@]}"; do
    curl -fsSL --max-time 60 -o "$2/root/$name" \
      "https://raw.githubusercontent.com/$GITHUB_REPO/$1/installers/root/$name" || return 1
  done
}

# Load the parts from <folder> (installers/ in a copy of the repository, or the download): each
# module checked with bash -n, then loaded; each of the Client's and root's files checked with bash -n
# and read in as CLIENT_FILE_<name> and ROOT_FILE_<name> (. and - as _), and the parts root's files
# load (ROOT_LIBS) read in as ROOT_LIB_<name>. Fails if anything is missing or broken, or a function
# main() calls isn't there.
load_modules_from() {   # load_modules_from <folder>
  local name file fn
  for name in "${INSTALLER_MODULES[@]}"; do
    file="$1/lib/$name.sh"
    if [ ! -f "$file" ] || ! bash -n "$file"; then return 1; fi
    # shellcheck source=/dev/null
    source "$file" || return 1
  done
  for name in "${CLIENT_FILES[@]}"; do
    file="$1/client/$name"
    if [ ! -s "$file" ] || ! bash -n "$file"; then return 1; fi
    IFS= read -r -d '' "CLIENT_FILE_${name//[.-]/_}" < "$file" || true
  done
  for name in "${ROOT_FILES[@]}"; do
    file="$1/root/$name"
    if [ ! -s "$file" ] || ! bash -n "$file"; then return 1; fi
    IFS= read -r -d '' "ROOT_FILE_${name//[.-]/_}" < "$file" || true
  done
  for name in "${ROOT_LIBS[@]}"; do
    IFS= read -r -d '' "ROOT_LIB_$name" < "$1/lib/$name.sh" || true
  done
  for fn in has_tty banner load_answers choose_role refuse_role_change choose_branch choose_platform \
            ask_server_url is_raspberry_pi check_sudo_password install_server write_installer_record \
            summary_server install_client remove_old_kiosks save_answers summary_client check_firewall offer_reboot \
            install_server_packages install_server_services role_name set_role has_server has_client \
            follow_server write_root_libs; do
    declare -F "$fn" >/dev/null || return 1
  done
}

main "$@"; exit
