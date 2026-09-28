# shellcheck shell=bash disable=SC2034  # MODE and INSTALL_BRANCH are read by install.sh and the other modules
# installers/lib/ui.sh — the installer's questions and headings
#
# Responsibilities
#   Asking, always from the keyboard (/dev/tty), never stdin: under `curl … | sudo bash`, stdin
#   is the script itself. The yes/no and 1/2 questions ask again until answered; Enter takes
#   the default where there is one. Also the questions every run asks: whether this device is a Server or
#   a Client, the branch a Server installs, and the reboot at the end.
#
# Provides
#   has_tty                           there is a keyboard to ask on
#   ask "<prompt>"                    → REPLY
#   ask_yes_no "<question> (y/n): "   succeeds on y, fails on n
#   ask_choice <default, or "">       "Choose 1 or 2 [<default>]: " until 1 or 2 → CHOICE
#   ask_port "<name>" <default>       → PORT_ANSWER, a port from 1 to 65535
#   ask_yes_in_time <seconds> "<question>"   succeeds only on y within that time
#   banner "<title>"                  the boxed heading
#   choose_mode                       → MODE (server | display)
#   choose_branch                     → INSTALL_BRANCH (a Server)
#   offer_reboot                      the last step: reboots unless the answer is n
#
# Used by
#   install.sh main(); sudo.sh, display.sh, server.sh and firewall.sh ask and print through it
#
# Uses
#   branch.sh (read_branch_setting, valid_branch); INSTALL_DIR, KIOSK_SCRIPT, INSTALL_BRANCH
#   (install.sh)
#
# Change impact
#   NOTICEBOARD_MODE and NOTICEBOARD_INSTALL_BRANCH carry the answers when install.sh hands over
#   to another branch's installer (use_branch_installer): both sides must agree on them.

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

ask_choice() {   # ask_choice <default, or empty>: 1 or 2 → CHOICE; Enter takes the default
  while true; do
    ask "Choose 1 or 2${1:+ [$1]}: "
    CHOICE="${REPLY:-$1}"
    case "$CHOICE" in
      1|2) return 0 ;;
      *) echo "Please type 1 or 2." ;;
    esac
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

choose_mode() {
  # Already answered, when the installer handed over to another branch's (use_branch_installer)
  case "${NOTICEBOARD_MODE:-}" in
    server|display) MODE=$NOTICEBOARD_MODE; return ;;
  esac
  # Default to whatever this device already runs, so a re-run only needs Enter
  local default=""
  if [ -d "$INSTALL_DIR/.git" ]; then
    default=1
  elif [ -f "$KIOSK_SCRIPT" ]; then
    default=2
  fi

  echo "Is this device the Server or a Client?"
  echo "  1) Server: stores the content, runs the admin panel, shows the slideshow here"
  echo "  2) Client: shows the slideshow from a Server on your network"
  ask_choice "$default"
  if [ "$CHOICE" = 1 ]; then MODE=server; else MODE=display; fi
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

# The kiosk only starts when the desktop starts, so finish by offering to reboot
offer_reboot() {
  echo ""
  ask "Reboot now to start the display? (Y/n): "
  case "$REPLY" in
    [Nn]*) echo "Reboot later with: sudo reboot"; echo "" ;;
    *)     echo "Rebooting..."; systemctl reboot ;;
  esac
}
