#!/usr/bin/env bash
# shellcheck disable=SC2034  # the configuration is read by the modules in installers/lib
# install.sh
# Sets up a Raspberry Pi for Noticeboard. It asks what the Pi is for:
#   1) Server + display: runs the server and shows the slideshow on this Pi's screen
#   2) Remote display:   shows the slideshow from a server Pi elsewhere on the network
#
# Run with:  sudo bash installers/install.sh
#   or:      curl -fsSL https://raw.githubusercontent.com/fructus-sum/noticeboard/main/installers/install.sh | sudo bash
#
# This file holds the configuration, the switch to the latest installer, the loading of its
# parts and the order of the steps (main). The steps are in installers/lib/*.sh, and the kiosk
# scripts it installs in installers/kiosk/ (see load_modules). Older installers hand over by
# downloading only this file, so it must keep its name, pass bash -n and keep the line
# starting INSTALLER_VERSION=.
#
# Used by
#   people (the README's command); older installers and other branches' installers, which hand
#   over to it (use_latest_installer, use_branch_installer)
# Uses
#   installers/lib/*.sh and installers/kiosk/*.sh of the same commit (load_modules); GitHub's API
#   and raw.githubusercontent.com
# Change impact
#   What it installs that updates can't change (kiosk scripts, units, shortcuts, packages) only
#   reaches a Pi when the installer runs again: raise INSTALLER_VERSION with such a change
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
KIOSK_SCRIPT="/usr/local/bin/noticeboard-kiosk.sh"
AUTOSTART_FILE="/etc/xdg/autostart/noticeboard-kiosk.desktop"
SUDOERS_BACKUP_DIR="/root/noticeboard-sudoers-backup"
# Raise this, and "installer" in system-requirements.json, whenever this script changes what
# updates can't: kiosk scripts, system services, desktop shortcuts or system packages. A server
# Pi whose last installer run (data/installer.json) is older is told to run it again.
INSTALLER_VERSION=3
# A server Pi follows main unless another branch was chosen in the admin panel (choose_branch)
INSTALL_BRANCH=main
# The installer's parts, from the same commit as this script (see load_modules)
INSTALLER_MODULES=(ui branch json system sudo server display kiosk desktop firewall)   # installers/lib/<name>.sh
KIOSK_TEMPLATES=(server display)                                                        # installers/kiosk/<name>.sh

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

  # Identify the desktop user (the one who invoked sudo)
  DESKTOP_USER="${SUDO_USER:-pi}"

  echo ""
  banner "Noticeboard installer"
  echo ""

  if ! has_tty; then
    echo "ERROR: This installer asks questions, so run it from a terminal."
    exit 1
  fi

  choose_mode
  if [ "$MODE" = server ] && ! id "$DESKTOP_USER" >/dev/null 2>&1; then
    echo "ERROR: User '$DESKTOP_USER' not found. Run this with sudo from the Pi's desktop user."
    exit 1
  fi
  if [ "$MODE" = server ]; then
    choose_branch
    use_branch_installer "$@"
  fi
  if [ "$MODE" = display ]; then
    ask_server_url
  fi

  check_sudo_password
  echo ""

  if [ "$MODE" = server ]; then
    install_server
    summary_server
  else
    install_display
    summary_display
  fi
  # Optional, and never allowed to stop the installer before the reboot prompt
  check_firewall || echo "  The firewall step ran into a problem; nothing more was changed."
  offer_reboot
}

# ── Latest installer ──────────────────────────────────────────────────────────
# Whatever copy was started (an old one on the Pi, or a GitHub link, which can serve a
# stale copy for a few minutes after a push), switch to the latest installer of the
# branch this Pi follows (Settings → Software updates), else main's, so what it sets up
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

# Download <branch>'s latest installer and run it instead of this one. Only returns if it
# can't, with the reason in INSTALLER_PROBLEM.
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
  if [ "$branch" = main ]; then
    echo "Running the latest installer (${sha:0:7})..."
  else
    echo "Running the latest installer from $branch (${sha:0:7})..."
  fi
  export NOTICEBOARD_INSTALLER_SHA="$sha" NOTICEBOARD_INSTALLER_BRANCH="$branch"
  exec bash "$file" "$@"
}

# The installer came from the branch this Pi followed. If the answer to the branch question
# was another branch, hand over to that branch's installer, with the answers so far.
use_branch_installer() {
  local from=${NOTICEBOARD_INSTALLER_BRANCH:-}
  if [ -z "$from" ] || [ "$from" = "$INSTALL_BRANCH" ] || [ "${NOTICEBOARD_INSTALLER_SHA:-}" = local ]; then
    return 0
  fi
  export NOTICEBOARD_MODE="$MODE" NOTICEBOARD_INSTALL_BRANCH="$INSTALL_BRANCH"
  run_installer_from "$INSTALL_BRANCH" "$@" \
    || echo "The installer from $INSTALL_BRANCH can't be used ($INSTALLER_PROBLEM), so this one carries on."
  unset NOTICEBOARD_MODE NOTICEBOARD_INSTALL_BRANCH
}

# The branch this Pi follows (Settings → Software updates), or main
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
# installers/lib/*.sh and installers/kiosk/*.sh, always from the same commit as this script:
#   NOTICEBOARD_INSTALLER_SHA=local     next to this script (a copy of the repository)
#   NOTICEBOARD_INSTALLER_SHA=<commit>  downloaded from GitHub at that commit: after the switch
#                                       to the latest installer, or a hand-over from an older
#                                       installer, which only downloads install.sh
#   not set (GitHub couldn't be asked for the latest installer): next to this script if it's in
#                                       a copy of the repository, else downloaded at the branch
#                                       this Pi follows
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
    echo "ERROR: Parts of the installer (installers/lib, installers/kiosk) are missing or broken,"
    echo "so nothing was changed. Run it with the command from the README, or from a complete copy"
    echo "of the repository."
    exit 1
  fi
  if [ -n "$ref" ]; then rm -rf "$dir"; fi
}

download_modules() {   # download_modules <commit or branch> <folder>
  local name file
  mkdir -p "$2/lib" "$2/kiosk"
  for name in "${INSTALLER_MODULES[@]}"; do
    curl -fsSL --max-time 60 -o "$2/lib/$name.sh" \
      "https://raw.githubusercontent.com/$GITHUB_REPO/$1/installers/lib/$name.sh" || return 1
  done
  for name in "${KIOSK_TEMPLATES[@]}"; do
    file="$2/kiosk/$name.sh"
    curl -fsSL --max-time 60 -o "$file" \
      "https://raw.githubusercontent.com/$GITHUB_REPO/$1/installers/kiosk/$name.sh" || return 1
  done
}

# Load the parts from <folder> (installers/ in a copy of the repository, or the download): each
# module checked with bash -n, then loaded; each kiosk template read in as KIOSK_TEMPLATE_<name>.
# Fails if anything is missing or broken, or a function main() calls isn't there.
load_modules_from() {   # load_modules_from <folder>
  local name file fn
  for name in "${INSTALLER_MODULES[@]}"; do
    file="$1/lib/$name.sh"
    if [ ! -f "$file" ] || ! bash -n "$file"; then return 1; fi
    # shellcheck source=/dev/null
    source "$file" || return 1
  done
  for name in "${KIOSK_TEMPLATES[@]}"; do
    file="$1/kiosk/$name.sh"
    if [ ! -s "$file" ]; then return 1; fi
    IFS= read -r -d '' "KIOSK_TEMPLATE_$name" < "$file" || true
  done
  for fn in has_tty banner choose_mode choose_branch ask_server_url check_sudo_password \
            install_server summary_server install_display summary_display check_firewall offer_reboot; do
    declare -F "$fn" >/dev/null || return 1
  done
}

main "$@"; exit
