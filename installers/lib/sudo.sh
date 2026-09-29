# shellcheck shell=bash
# installers/lib/sudo.sh — offering to make sudo ask the desktop user for a password
#
# Provides
#   check_sudo_password   asks, and only keeps the change once the password is proven to work
#                         through sudo (else the backed-up files are put back) → SUDO_STATUS
#   SUDO_STATUS           one line for the summary, or empty when not checked
#
# Used by
#   install.sh main() (on a Raspberry Pi only); the summaries in server.sh and client.sh print SUDO_STATUS
#
# Uses
#   ui.sh (ask, ask_yes_no); DESKTOP_USER, SUDOERS_BACKUP_DIR (install.sh); visudo, runuser
#
# Change impact
#   A mistake here could lock the user out of sudo: every change is checked by visudo and by
#   the user's own password before it's kept (tests/installers/sudo-password.sh).

# Raspberry Pi OS lets the desktop user run sudo without a password. Offer to make
# it ask for one. A change is only kept once the user's password is proven to work
# through sudo, so nobody can be locked out of sudo.
SUDO_STATUS=""

sudo_asks_password() {
  # -k ignores the password typed to start this installer; -n fails instead of asking
  ! runuser -u "$DESKTOP_USER" -- sudo -k -n true >/dev/null 2>&1
}

nopasswd_rule() {
  # Matches the rule Raspberry Pi OS adds: "<user> ALL=(ALL) NOPASSWD: ALL"
  awk -v u="$DESKTOP_USER" '$1 == u && /NOPASSWD:[[:space:]]*ALL[[:space:]]*$/ { found = 1 } END { exit !found }' "$1"
}

restore_sudoers() {
  local f
  for f in "$@"; do
    install -m 0440 -o root -g root "$SUDOERS_BACKUP_DIR/$(basename "$f")" "$f"
  done
}

check_sudo_password() {
  if [ "$DESKTOP_USER" = root ] || ! id "$DESKTOP_USER" >/dev/null 2>&1 || ! command -v sudo >/dev/null; then
    return 0
  fi

  echo ""
  if sudo_asks_password; then
    SUDO_STATUS="✓ sudo asks $DESKTOP_USER for a password"
    echo "  $SUDO_STATUS"
    return 0
  fi

  SUDO_STATUS="⚠ sudo does not ask $DESKTOP_USER for a password"
  echo "sudo on this device doesn't ask $DESKTOP_USER for a password, so anything running"
  echo "as $DESKTOP_USER can take full control of it. Making it ask is safer."
  echo "You'll then need $DESKTOP_USER's password for commands that start with sudo."
  if ! ask_yes_no "Make sudo ask for a password? (y/n): "; then
    echo "  sudo left as it is."
    return 0
  fi

  if [ "$(passwd -S "$DESKTOP_USER" 2>/dev/null | awk '{print $2}')" != "P" ]; then
    echo "  $DESKTOP_USER has no password yet. Set one with: passwd"
    echo "  Then run this installer again. sudo left as it is."
    return 0
  fi

  # Find the files that let this user skip the password (normally 010_pi-nopasswd)
  local files=() f tmp
  for f in /etc/sudoers.d/*; do
    [ -f "$f" ] || continue
    case "$(basename "$f")" in *~|*.*) continue ;; esac   # sudo skips these names too
    if nopasswd_rule "$f"; then
      files+=("$f")
    fi
  done
  if [ ${#files[@]} -eq 0 ]; then
    echo "  Couldn't find the rule in /etc/sudoers.d that skips the password."
    echo "  sudo left as it is. To see where it comes from: sudo -l -U $DESKTOP_USER"
    return 0
  fi

  # Back up each file, comment the rule out in a copy, and only install a copy that visudo accepts
  mkdir -p "$SUDOERS_BACKUP_DIR"
  chmod 700 "$SUDOERS_BACKUP_DIR"
  for f in "${files[@]}"; do
    cp -p "$f" "$SUDOERS_BACKUP_DIR/$(basename "$f")"
  done
  for f in "${files[@]}"; do
    tmp=$(mktemp)
    awk -v u="$DESKTOP_USER" -v backup="$SUDOERS_BACKUP_DIR/$(basename "$f")" '
      $1 == u && /NOPASSWD:[[:space:]]*ALL[[:space:]]*$/ {
        print "# Disabled by the Noticeboard installer so sudo asks for a password."
        print "# The original file is saved at " backup
        print "# " $0
        next
      }
      { print }' "$f" > "$tmp"
    if ! visudo -cf "$tmp" >/dev/null 2>&1; then
      rm -f "$tmp"
      restore_sudoers "${files[@]}"
      echo "  The change didn't pass visudo's check, so sudo was left as it is."
      return 0
    fi
    install -m 0440 -o root -g root "$tmp" "$f"
    rm -f "$tmp"
  done
  if ! visudo -c >/dev/null 2>&1; then
    restore_sudoers "${files[@]}"
    echo "  The sudo settings didn't pass visudo's check, so sudo was left as it is."
    return 0
  fi

  # Prove the password works through sudo before keeping the change
  local password="" confirmed=""
  echo "  Type $DESKTOP_USER's password to confirm sudo accepts it."
  for _ in 1 2 3; do
    read -rsp "  Password for $DESKTOP_USER: " password </dev/tty || break
    echo ""
    if printf '%s\n' "$password" | runuser -u "$DESKTOP_USER" -- sudo -k -S -p '' true >/dev/null 2>&1; then
      confirmed=1
      break
    fi
    echo "  That password didn't work."
  done
  password=""
  if [ -z "$confirmed" ]; then
    restore_sudoers "${files[@]}"
    echo "  Couldn't confirm the password, so sudo was left as it is."
    return 0
  fi

  if sudo_asks_password; then
    SUDO_STATUS="✓ sudo now asks $DESKTOP_USER for a password"
    echo "  $SUDO_STATUS"
    echo "  To undo:"
    for f in "${files[@]}"; do
      echo "    sudo cp $SUDOERS_BACKUP_DIR/$(basename "$f") $f"
    done
  else
    SUDO_STATUS="⚠ sudo still doesn't ask $DESKTOP_USER for a password (another rule allows it)"
    echo "  $SUDO_STATUS"
    echo "  To see where it comes from: sudo -l -U $DESKTOP_USER"
  fi
}
