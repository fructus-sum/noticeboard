# shellcheck shell=bash disable=SC2034  # ROLE, MODE, PLATFORM and INSTALL_BRANCH are read by install.sh and the other modules
# installers/lib/ui.sh — the installer's questions and headings
#
# Responsibilities
#   Asking, always from the keyboard (/dev/tty), never stdin: under `curl … | sudo bash`, stdin
#   is the script itself. The yes/no and numbered questions ask again until answered; Enter takes
#   the default where there is one. Also the questions every run asks: the role (Client + Server,
#   Client only, Server only), how a Client shows the slideshow, the branch a Server installs, and
#   the reboot at the end (SYSTEM_DESIGN §8, §18.7).
#
# Provides
#   has_tty                           there is a keyboard to ask on
#   ask "<prompt>"                    → REPLY
#   ask_yes_no "<question> (y/n): "   succeeds on y, fails on n
#   ask_choice <default, or ""> [<count>]  "Choose 1 or 2 [<default>]: " (or 1 to <count>) → CHOICE
#   ask_port "<name>" <default>       → PORT_ANSWER, a port from 1 to 65535
#   ask_yes_in_time <seconds> "<question>"   succeeds only on y within that time
#   banner "<title>"                  the boxed heading
#   choose_role                       → ROLE (both | client | server) and MODE (server | display)
#   set_role <role>, has_server, has_client
#   choose_platform                   → PLATFORM (pi | desktop | headless), for a role with a Client
#   choose_branch                     → INSTALL_BRANCH (a Server)
#   offer_reboot                      the last step: reboots unless the answer is n
#
# Used by
#   install.sh main(); sudo.sh, client.sh, server.sh and firewall.sh ask and print through it
#
# Uses
#   branch.sh (read_branch_setting, valid_branch); answers.sh (SAVED_ROLE, SAVED_PLATFORM);
#   system.sh (detect_platform); INSTALL_DIR, OLD_CLIENT_KIOSK, INSTALL_BRANCH (install.sh)
#
# Change impact
#   NOTICEBOARD_ROLE, NOTICEBOARD_PLATFORM, NOTICEBOARD_MODE and NOTICEBOARD_INSTALL_BRANCH carry the
#   answers when install.sh hands over to another installer (use_branch_installer): both sides must
#   agree on them, and an installer before 0.9.0 reads only NOTICEBOARD_MODE (server | display).

PORT_ANSWER=""
CHOICE=""

has_tty() { { true </dev/tty; } 2>/dev/null; }
ask() { read -rp "$1" REPLY </dev/tty; }

ask_yes_no() {   # ask_yes_no "<question> (y/n): " succeeds on y; asks again until y or n
  while true; do
    ask "$1"
    case "$REPLY" in
      [Yy]*) return 0 ;;
      [Nn]*) return 1 ;;
      *) echo "Please type y or n." ;;
    esac
  done
}

ask_choice() {   # ask_choice <default, or empty> [<count>=2]: 1 to count → CHOICE; Enter takes the default
  local count=${2:-2} range
  range="1 or 2"
  if [ "$count" -gt 2 ]; then range="1 to $count"; fi
  while true; do
    ask "Choose $range${1:+ [$1]}: "
    CHOICE="${REPLY:-$1}"
    if [[ "$CHOICE" =~ ^[1-9]$ ]] && [ "$CHOICE" -le "$count" ]; then
      return 0
    fi
    echo "Please type $range."
  done
}

ask_port() {   # ask_port "<name>" <default> sets PORT_ANSWER; Enter keeps the default
  while true; do
    ask "$1 [$2]: "
    PORT_ANSWER="${REPLY:-$2}"
    if [[ "$PORT_ANSWER" =~ ^[0-9]{1,5}$ ]] && [ "$((10#$PORT_ANSWER))" -ge 1 ] && [ "$((10#$PORT_ANSWER))" -le 65535 ]; then
      PORT_ANSWER=$((10#$PORT_ANSWER))
      return 0
    fi
    echo "Please type a port number from 1 to 65535."
  done
}

# Waits at most <seconds>; fails on no, or if nobody answers in time
ask_yes_in_time() {   # ask_yes_in_time <seconds> "<question>"
  read -r -t "$1" -p "$2" REPLY </dev/tty && [[ "$REPLY" == [Yy]* ]]
}

banner() {   # banner "<title>": the title centred in a box
  local width=46 left right
  left=$(( (width - ${#1}) / 2 ))
  right=$(( width - ${#1} - left ))
  echo "╔══════════════════════════════════════════════╗"
  printf '║%*s%s%*s║\n' "$left" "" "$1" "$right" ""
  echo "╚══════════════════════════════════════════════╝"
}

choose_role() {
  # Already answered, when the installer handed over to another's (use_branch_installer); an
  # installer before 0.9.0 passes only NOTICEBOARD_MODE
  case "${NOTICEBOARD_ROLE:-}" in
    both|client|server) set_role "$NOTICEBOARD_ROLE"; return ;;
  esac
  case "${NOTICEBOARD_MODE:-}" in
    server) set_role both; return ;;
    display) set_role client; return ;;
  esac
  # Default to whatever this device already runs, so a re-run only needs Enter
  local default=""
  case "$SAVED_ROLE" in
    both) default=1 ;;
    client) default=2 ;;
    server) default=3 ;;
    *) if [ -d "$INSTALL_DIR/.git" ]; then default=1; elif [ -f "$OLD_CLIENT_KIOSK" ]; then default=2; fi ;;
  esac

  echo "What should this device do?"
  echo "  1) Client + Server: runs the Noticeboard (content, admin panel) and shows the slideshow on its screen"
  echo "  2) Client only: shows the slideshow from a Server elsewhere on your network"
  echo "  3) Server only: runs the Noticeboard, with no screen of its own"
  ask_choice "$default" 3
  case "$CHOICE" in
    1) set_role both ;;
    2) set_role client ;;
    3) set_role server ;;
  esac
}

# ROLE, and MODE for what reads it (server: there's a Server here; display: a Client only)
set_role() {   # set_role both|client|server
  ROLE=$1
  if [ "$ROLE" = client ]; then MODE=display; else MODE=server; fi
}
has_server() { [ "$ROLE" != client ]; }
has_client() { [ "$ROLE" != server ]; }

# Where this device's Client shows the slideshow: pi (Raspberry Pi OS with its desktop), desktop
# (Debian with a desktop), headless (no desktop: cage). Detection preselects the answer.
choose_platform() {
  case "${NOTICEBOARD_PLATFORM:-}" in
    pi|desktop|headless) PLATFORM=$NOTICEBOARD_PLATFORM; return ;;
  esac
  local default
  case "${SAVED_PLATFORM:-$(detect_platform)}" in
    pi) default=1 ;;
    desktop) default=2 ;;
    *) default=3 ;;
  esac
  echo ""
  echo "How does this device show the slideshow?"
  echo "  1) Raspberry Pi with Raspberry Pi OS and its desktop"
  echo "  2) Debian (or similar) with a desktop"
  echo "  3) Minimal or headless: no desktop, the slideshow full screen straight on the screen"
  ask_choice "$default" 3
  case "$CHOICE" in
    1) PLATFORM=pi ;;
    2) PLATFORM=desktop ;;
    3) PLATFORM=headless ;;
  esac
}

# A Server follows main unless another branch was chosen in the admin panel
# (Settings → Software updates). A re-run offers to keep that branch or go back to main.
choose_branch() {
  # Already answered (use_branch_installer)
  if valid_branch "${NOTICEBOARD_INSTALL_BRANCH:-}"; then
    INSTALL_BRANCH=$NOTICEBOARD_INSTALL_BRANCH
    return
  fi
  local current
  current=$(read_branch_setting)
  if [ -z "$current" ] || [ "$current" = main ]; then
    return
  fi
  if ! valid_branch "$current"; then
    echo "The branch setting \"$current\" isn't valid, so this installs main."
    return
  fi

  echo ""
  echo "This noticeboard follows the branch \"$current\" (chosen in Settings → Software updates)."
  echo "  1) Keep $current"
  echo "  2) Go back to main, the stable version"
  ask_choice 1
  if [ "$CHOICE" = 1 ]; then INSTALL_BRANCH=$current; else INSTALL_BRANCH=main; fi
}

# A desktop Client's kiosk only starts when the desktop starts, so finish by offering to reboot
offer_reboot() {
  echo ""
  ask "Reboot now to start the display? (Y/n): "
  case "$REPLY" in
    [Nn]*) echo "Reboot later with: sudo reboot"; echo "" ;;
    *)     echo "Rebooting..."; systemctl reboot ;;
  esac
}
