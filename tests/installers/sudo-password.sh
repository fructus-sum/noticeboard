#!/usr/bin/env bash
# shellcheck disable=SC1090,SC2034  # functions are loaded from the installers; the variables set here are read by them
# Exercise the installer's check_sudo_password() (installers/lib/sudo.sh) with a temporary sudoers.d folder and a
# simulated sudo: a NOPASSWD rule means no password is needed; otherwise the password
# must be GOOD_PW. Password prompts are fed from fd 7 instead of /dev/tty.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$REPO/tests/helpers/installer.sh"
U=$(id -un); GOOD_PW="correct-horse"
pass=0; fail=0
ok()  { pass=$((pass+1)); echo "PASS  $1"; }
bad() { fail=$((fail+1)); echo "FAIL  $1"; [ -n "${2:-}" ] && sed 's/^/        /' "$2"; }

scenario() {   # scenario <dir> <passwords, one per line> <answers...>
  local dir="$1" pwfile="$1/passwords"; printf '%b' "$2" > "$pwfile"; shift 2
  (
    load_installer   # set -euo pipefail comes from install.sh itself, as in the real installer
    # sudo.sh again, with its sudoers folder and password prompt pointed at this test's
    source <(sed -e "s#/etc/sudoers.d/#$dir/sudoers.d/#g" -e 's#</dev/tty || break#<\&7 || break#' "$REPO/installers/lib/sudo.sh")
    SUDOERS_BACKUP_DIR="$dir/backup"; DESKTOP_USER="$U"; ANSWERS=("$@")
    sudo()    { :; }
    passwd()  { echo "$U ${PASSWD_STATUS:-P} 01/01/2024 0 99999 7 -1"; }
    visudo()  { [ "${VISUDO_FAIL:-0}" = 1 ] && [ "$1" = "-cf" ] && return 1; return 0; }
    install() { cp "${@: -2:1}" "${@: -1}"; }
    runuser() {
      shift 3
      local args=" $* " active=0 sf
      for sf in "$dir"/sudoers.d/*; do             # like sudo: skip names with a dot or ending in ~
        case "$(basename "$sf")" in *.*|*~) continue ;; esac
        grep -qE "^[[:space:]]*($U|%sudo)[[:space:]].*NOPASSWD:[[:space:]]*ALL" "$sf" && active=$((active + 1))
      done
      if [[ "$args" == *" -n "* ]]; then [ "$active" -gt 0 ]; return; fi
      if [[ "$args" == *" -S "* ]]; then local pw; IFS= read -r pw; [ "$active" -gt 0 ] || [ "$pw" = "$GOOD_PW" ]; return; fi
      return 1
    }
    has_tty() { return 0; }
    ask() {
      if [ ${#ANSWERS[@]} -eq 0 ]; then echo "UNEXPECTED QUESTION: $1"; return 1; fi
      REPLY="${ANSWERS[0]}"; ANSWERS=("${ANSWERS[@]:1}")
    }
    check_sudo_password
    echo "STATUS=$SUDO_STATUS"
  ) > "$dir/out" 2>&1 7<"$pwfile"
  echo $? > "$dir/rc"
}
new_pi() {     # new_pi <files...>: fresh folder with Raspberry Pi OS's rule in 010_pi-nopasswd
  local d; d=$(mktemp -d); mkdir -p "$d/sudoers.d"
  echo "$U ALL=(ALL) NOPASSWD: ALL" > "$d/sudoers.d/010_pi-nopasswd"
  cp "$d/sudoers.d/010_pi-nopasswd" "$d/original"
  echo "$d"
}
unchanged() { cmp -s "$1/sudoers.d/010_pi-nopasswd" "$1/original"; }

d=$(new_pi); scenario "$d" 'nope1\nnope2\nnope3\n' y
grep -q "Couldn't confirm the password" "$d/out" && unchanged "$d" && grep -q "STATUS=⚠ sudo does not ask" "$d/out" \
  && ok "wrong password 3 times -> rule restored, sudo unchanged" || bad "wrong password" "$d/out"

d=$(new_pi); scenario "$d" 'nope\ncorrect-horse\n' y
f="$d/sudoers.d/010_pi-nopasswd"
if grep -q "^# $U ALL=(ALL) NOPASSWD: ALL$" "$f" && ! grep -qE "^$U" "$f" && cmp -s "$d/backup/010_pi-nopasswd" "$d/original" \
   && grep -q "STATUS=✓ sudo now asks" "$d/out" && grep -q "sudo cp $d/backup/010_pi-nopasswd $f" "$d/out"; then
  ok "wrong then right password -> rule commented out, backup saved, undo command shown"
else bad "right password" "$d/out"; fi
echo "      edited file:"; sed 's/^/        | /' "$f"
scenario "$d" '' # no answers: any question is a failure
grep -q "STATUS=✓ sudo asks $U for a password" "$d/out" && ! grep -q UNEXPECTED "$d/out" \
  && ok "run again afterwards -> reports sudo already asks, no question" || bad "second run" "$d/out"

d=$(new_pi); scenario "$d" '' maybe n
grep -q "Please type y or n" "$d/out" && grep -q "sudo left as it is" "$d/out" && unchanged "$d" \
  && ok "'maybe' re-asks, 'n' leaves sudo unchanged" || bad "answer n" "$d/out"

d=$(new_pi); PASSWD_STATUS=L scenario "$d" '' y
grep -q "has no password yet" "$d/out" && unchanged "$d" && [ ! -d "$d/backup" ] \
  && ok "account without a usable password -> refuses, nothing touched" || bad "locked account" "$d/out"

d=$(new_pi); VISUDO_FAIL=1 scenario "$d" 'correct-horse\n' y
grep -q "didn't pass visudo's check" "$d/out" && unchanged "$d" \
  && ok "visudo rejects the edited copy -> original kept" || bad "visudo failure" "$d/out"

d=$(mktemp -d); mkdir -p "$d/sudoers.d"; echo "%sudo ALL=(ALL) NOPASSWD: ALL" > "$d/sudoers.d/020_group"; cp "$d/sudoers.d/020_group" "$d/original-group"
scenario "$d" '' y
grep -q "Couldn't find the rule" "$d/out" && cmp -s "$d/sudoers.d/020_group" "$d/original-group" \
  && ok "passwordless only via a group rule -> explains, changes nothing" || bad "group rule" "$d/out"

d=$(new_pi); echo "$U ALL=(ALL) NOPASSWD: ALL" > "$d/sudoers.d/old.rules"
scenario "$d" 'correct-horse\n' y
grep -q "^# $U ALL" "$d/sudoers.d/010_pi-nopasswd" && [ "$(cat "$d/sudoers.d/old.rules")" = "$U ALL=(ALL) NOPASSWD: ALL" ] \
  && ok "files sudo ignores (name with a dot) are left alone" || bad "dotted file" "$d/out"

echo "passed=$pass failed=$fail"; [ $fail -eq 0 ]
