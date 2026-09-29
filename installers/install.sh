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
# parts, and the order of the steps (run_installer). The steps are in installers/lib/*.sh, and the Client's
# files it installs in installers/client/ (see load_modules). Older installers hand over by
# downloading only this file, so it must keep its name, pass bash -n and keep the line
# starting INSTALLER_VERSION=.
#
# Used by
#   people (the README's command); older installers and other branches' installers, which hand
#   over to it (use_latest_installer, use_branch_installer)
# Uses
#   installers/lib/*.sh and installers/client/* of the same commit (load_modules); GitHub's API
#   and raw.githubusercontent.com
# Change impact
#   What it installs that updates can't change (the Client, units, shortcuts, packages) only
#   reaches a Server or Client when the installer runs again: raise INSTALLER_VERSION with such a change
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
DEVICE_MODEL_FILE="/proc/device-tree/model"         # says Raspberry Pi on one (lib/system.sh)
DISPLAY_MANAGER_UNIT="/etc/systemd/system/display-manager.service"   # there's a desktop
SUDOERS_BACKUP_DIR="/root/noticeboard-sudoers-backup"
# Raise this, and "installer" in system-requirements.json, whenever this script changes what
# updates can't: the Client, system services, desktop shortcuts or system packages. A Server
# whose last installer run (data/installer.json) is older is told to run it again.
INSTALLER_VERSION=5
# A Server follows main unless another branch was chosen in the admin panel (choose_branch)
INSTALL_BRANCH=main
# The installer's parts, from the same commit as this script (see load_modules)
INSTALLER_MODULES=(ui branch json release answers system sudo server client desktop firewall)   # installers/lib/<name>.sh
CLIENT_FILES=(kiosk.sh noticeboard-client)   # installers/client/<name>, read in as CLIENT_FILE_<name, . and - as _>
ROLE=""; MODE=""; PLATFORM=""; SERVER_URL=""   # the answers (ui.sh, client.sh)

# Everything runs from main(), called on the last line, so a half-downloaded
# script (curl | bash) runs nothing.
main() {
  # ── Root check ──────────────────────────────────────────────────────────────
  if [ "$EUID" -ne 0 ]; then
    echo "ERROR: Run this script with sudo."
    exit 1
  fi

  use_latest_installer "$@"
  load_modules
  run_installer "$@"
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
  if has_server; then
    choose_branch
  fi
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
use_latest_installer() {
  if [ -n "${NOTICEBOARD_INSTALLER_SHA:-}" ]; then
    return 0
  fi
  local branch
  branch=$(followed_branch)
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
# installers/lib/*.sh and installers/client/*, always from the same commit as this script:
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
    echo "ERROR: Parts of the installer (installers/lib, installers/client) are missing or broken,"
    echo "so nothing was changed. Run it with the command from the README, or from a complete copy"
    echo "of the repository."
    exit 1
  fi
  if [ -n "$ref" ]; then rm -rf "$dir"; fi
}

download_modules() {   # download_modules <commit or branch> <folder>
  local name
  mkdir -p "$2/lib" "$2/client"
  for name in "${INSTALLER_MODULES[@]}"; do
    curl -fsSL --max-time 60 -o "$2/lib/$name.sh" \
      "https://raw.githubusercontent.com/$GITHUB_REPO/$1/installers/lib/$name.sh" || return 1
  done
  for name in "${CLIENT_FILES[@]}"; do
    curl -fsSL --max-time 60 -o "$2/client/$name" \
      "https://raw.githubusercontent.com/$GITHUB_REPO/$1/installers/client/$name" || return 1
  done
}

# Load the parts from <folder> (installers/ in a copy of the repository, or the download): each
# module checked with bash -n, then loaded; each of the Client's files checked with bash -n and
# read in as CLIENT_FILE_<name> (. and - as _). Fails if anything is missing or broken, or a
# function main() calls isn't there.
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
  for fn in has_tty banner load_answers choose_role refuse_role_change choose_branch choose_platform \
            ask_server_url is_raspberry_pi check_sudo_password install_server write_installer_record \
            summary_server install_client remove_old_kiosks save_answers summary_client check_firewall offer_reboot; do
    declare -F "$fn" >/dev/null || return 1
  done
}

main "$@"; exit
