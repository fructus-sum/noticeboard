#!/usr/bin/env bash
# shellcheck disable=SC1090,SC2034  # functions are loaded from the installers; the variables set here are read by them
# install.sh's optional firewall step, with ufw, firewalld, nft, iptables, systemctl,
# systemd-run, sshd, ss, ps and apt-get replaced by stand-ins that record every call.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$REPO/tests/helpers/installer.sh"
T=$(mktemp -d); export T
pass=0; fail=0
ok()  { pass=$((pass+1)); echo "PASS  $1"; }
bad() { fail=$((fail+1)); echo "FAIL  $1"; }

# run <name> <mode> '<setup>' <answers...>: check_firewall in a fresh copy of the installer
run() {
  local name=$1 mode=$2 setup=$3; shift 3
  : > "$T/calls.log"
  (
    load_installer
    set -euo pipefail
    # This machine's own firewall programs (ufw, nft, iptables in the sbin folders, e.g. on a CI
    # runner) are out of reach: each case says which exist, with stand-ins
    PATH=$(tr ':' '\n' <<<"$PATH" | grep -vE '/sbin/?$' | paste -sd: -)
    MODE=$mode; INSTALL_DIR="$T/opt"
    MOCK_UFW_STATE=""; MOCK_ACTIVE=""; MOCK_SSHD_PORT=22; MOCK_SOCKET_PORT=""; MOCK_SSH_ANCESTOR=""; MOCK_SSH_CONN=""; MOCK_VNC=""; MOCK_PORT=3000
    log() { echo "$*" >> "$T/calls.log"; }
    slideshow_port() { echo "$MOCK_PORT"; }
    ask() { REPLY="${ANSWERS[0]-}"; ANSWERS=("${ANSWERS[@]:1}"); echo "$1[answered: '$REPLY']"; }
    ask_yes_in_time() { local a="${ANSWERS[0]-}"; ANSWERS=("${ANSWERS[@]:1}"); echo "$2[answered in time: '$a']"; [ "$a" = y ]; }
    systemctl() {
      log "systemctl $*"
      case "$1" in
        is-active) local unit=${*: -1}; [[ " $MOCK_ACTIVE " == *" $unit "* ]] ;;
        show) echo "Listen=[::]:$MOCK_SOCKET_PORT (Stream)" ;;
        *) return 0 ;;
      esac
    }
    systemd-run() { log "systemd-run $*"; }
    sshd() { echo "port $MOCK_SSHD_PORT"; echo "addressfamily any"; }
    ss() {
      case "$*" in
        *established*) if [ -n "$MOCK_SSH_CONN" ]; then echo "0 0 192.168.1.2:22 192.168.1.9:50000"; fi ;;
        *) echo "LISTEN 0 128 0.0.0.0:22 0.0.0.0:*"; if [ -n "$MOCK_VNC" ]; then echo "LISTEN 0 5 0.0.0.0:5900 0.0.0.0:*"; fi ;;
      esac
    }
    ps() {   # ps -o comm=|ppid= -p <pid>: this script, its parent 100 (sshd-session over SSH), then init
      local what=$2 pid=$4
      if [ "$pid" = 100 ]; then
        if [ "$what" = comm= ]; then if [ -n "$MOCK_SSH_ANCESTOR" ]; then echo sshd-session; else echo lxterminal; fi; else echo 1; fi
      else
        if [ "$what" = comm= ]; then echo bash; else echo 100; fi
      fi
    }
    define_ufw() {
      ufw() {
        log "ufw $*"
        case "$1" in
          status) echo "Status: ${MOCK_UFW_STATE:-inactive}"
                  if [ "$MOCK_UFW_STATE" = active ]; then printf 'To Action From\n-- ------ ----\n22/tcp ALLOW Anywhere\n'; fi ;;
          --force) if [ -n "${MOCK_ENABLE_FAILS:-}" ]; then return 1; fi; MOCK_UFW_STATE=active ;;
          disable) MOCK_UFW_STATE=inactive ;;
        esac
      }
    }
    apt-get() { log "apt-get $*"; if [[ "$*" == *install*ufw* ]]; then define_ufw; fi; }
    eval "$setup"
    ANSWERS=("$@")
    check_firewall || echo "PROBLEM (check_firewall failed)"
    echo "END"
  ) > "$T/$name.out" 2>&1
  RC=$?
  OUT="$T/$name.out"; CALLS="$T/calls.log"
}
changes() { grep -E "^ufw (allow|default|--force|disable|reset|delete)|^apt-get|^firewall-cmd .*--(add|reload)|^systemd-run" "$CALLS"; }
line_of() { grep -n -- "$1" "$CALLS" | head -1 | cut -d: -f1; }
done_ok() { [ "$RC" = 0 ] && grep -q "^END$" "$OUT" && ! grep -q PROBLEM "$OUT"; }
show() { echo "----- $1"; cat "$OUT"; echo "----- calls"; cat "$CALLS"; echo "-----"; }

# ── Saying no ──
run no server '' n
done_ok && [ -z "$(changes)" ] && grep -q "allow TCP port 3000" "$OUT" && grep -q "sudo ufw allow 3000/tcp" "$OUT" \
  && ok "no: nothing checked or changed; the reminder names port 3000" || { bad "no"; show no; }
run no8080 server 'MOCK_PORT=8080' n
grep -q "allow TCP port 8080" "$OUT" && grep -q "sudo ufw allow 8080/tcp" "$OUT" && ok "no: the reminder names the Pi's real port (8080)" || { bad "no8080"; show no8080; }
run nodisplay display '' n
done_ok && [ -z "$(changes)" ] && grep -q "needs no incoming port" "$OUT" && ok "no, a Client: nothing changed, no port needed" || { bad "nodisplay"; show nodisplay; }
run blank server '' "" maybe n
[ "$(grep -c "Please type y or n" "$OUT")" = 2 ] && [ -z "$(changes)" ] && ok "Enter or anything else isn't a yes: asks again" || { bad "blank"; show blank; }

# ── A firewall is already on ──
run ufwon server 'define_ufw; MOCK_UFW_STATE=active' y
done_ok && [ "$(changes)" = "ufw allow 3000/tcp" ] && ok "ufw already on: only the slideshow port is added, rules kept" || { bad "ufwon"; show ufwon; }
run ufwondisplay display 'define_ufw; MOCK_UFW_STATE=active' y
done_ok && [ -z "$(changes)" ] && ok "ufw on, a Client: nothing to add" || { bad "ufwondisplay"; show ufwondisplay; }
run firewalld server 'firewall-cmd() { log "firewall-cmd $*"; if [ "$1" = --state ]; then echo running; fi; }' y
done_ok && grep -q -- "--permanent --add-port=3000/tcp" "$CALLS" && grep -q -- "--reload" "$CALLS" && ! grep -q "^ufw\|^apt-get" "$CALLS" \
  && ok "firewalld running: the port is added there, nothing else" || { bad "firewalld"; show firewalld; }
run nftown server 'nft() { printf "table inet filter {\n\tchain input {\n\t\ttype filter hook input priority filter; policy drop;\n\t\ttcp dport 22 accept\n\t}\n}\n"; }' y
done_ok && [ -z "$(changes)" ] && grep -q "left exactly as they are" "$OUT" && grep -q "allow TCP port 3000" "$OUT" \
  && ok "someone's own nftables rules: left alone, port named" || { bad "nftown"; show nftown; }
run nftempty server 'nft() { printf "table inet filter {\n\tchain input {\n\t\ttype filter hook input priority filter; policy accept;\n\t}\n}\n"; }' y n
done_ok && [ -z "$(changes)" ] && grep -q "no firewall turned on" "$OUT" && ok "an empty accept-all nftables chain isn't a firewall: offers setup" || { bad "nftempty"; show nftempty; }
run iptown server 'iptables() { printf -- "-P INPUT ACCEPT\n-A INPUT -p tcp --dport 22 -j ACCEPT\n"; }' y
done_ok && [ -z "$(changes)" ] && grep -q "left exactly as they are" "$OUT" && ok "someone's own iptables rules: left alone" || { bad "iptown"; show iptown; }

# ── No firewall ──
run setupno server '' y n
done_ok && [ -z "$(changes)" ] && grep -q "just for the noticeboard, running Raspberry Pi OS" "$OUT" && grep -q "allow TCP port 3000" "$OUT" \
  && ok "no firewall, setup declined: nothing changed, recommendation explained" || { bad "setupno"; show setupno; }
run setup server 'MOCK_ACTIVE="ssh"' y y y "" ""
expected=$'apt-get install -y -qq ufw\nufw allow 22/tcp\nufw allow 3000/tcp\nufw allow 5353/udp\nufw default deny incoming\nufw default allow outgoing\nufw --force enable'
done_ok && [ "$(changes)" = "$expected" ] && grep -q "The firewall is on" "$OUT" && ! grep -q "systemd-run" "$CALLS" \
  && ok "setup: install, allow SSH/slideshow/mDNS, then defaults, then enable (in that order)" || { bad "setup"; show setup; }
grep -q "SSH port \[22\]" "$OUT" && grep -q "Slideshow port \[3000\]" "$OUT" && ok "setup: both ports confirmed with the user" || bad "port prompts"
run custom server 'MOCK_ACTIVE="ssh"; MOCK_SSHD_PORT=2222' y y y "" ""
grep -q "SSH port \[2222\]" "$OUT" && grep -q "^ufw allow 2222/tcp" "$CALLS" && ! grep -q "^ufw allow 22/tcp" "$CALLS" && ok "custom SSH port from sshd: offered and allowed" || { bad "custom"; show custom; }
run typed server 'MOCK_ACTIVE="ssh"; MOCK_SSHD_PORT=2222' y y y 2200 8081
grep -q "^ufw allow 2200/tcp" "$CALLS" && grep -q "^ufw allow 8081/tcp" "$CALLS" && ! grep -q "allow 2222\|allow 3000" "$CALLS" && ok "typed ports replace the detected ones" || { bad "typed"; show typed; }
run socket server 'MOCK_ACTIVE="ssh.socket"; MOCK_SOCKET_PORT=2022' y y y "" ""
grep -q "SSH port \[2022\]" "$OUT" && ok "SSH socket activation: its port is used" || { bad "socket"; show socket; }
run nossh server 'MOCK_ACTIVE="ssh"' y y n ""
done_ok && ! grep -q "allow 22/tcp" "$CALLS" && grep -q "^ufw --force enable" "$CALLS" && ok "SSH installed but not needed: its port stays closed" || { bad "nossh"; show nossh; }
run badport server 'MOCK_ACTIVE="ssh"' y y y abc 70000 0 ""
[ "$(grep -c "Please type a port number" "$OUT")" = 3 ] && grep -q "^ufw allow 22/tcp" "$CALLS" && ok "invalid ports are asked again" || { bad "badport"; show badport; }
run inactive server 'define_ufw' y y n ""
done_ok && ! grep -q "^apt-get" "$CALLS" && grep -q "installed but turned off" "$OUT" && grep -q "^ufw --force enable" "$CALLS" && ok "ufw installed but off: not reinstalled, rules added, turned on" || { bad "inactive"; show inactive; }
run vnc server 'MOCK_VNC=1' y y n "" y ""
grep -q "^ufw allow 5900/tcp" "$CALLS" && ok "VNC running: asked, and allowed when needed" || { bad "vnc"; show vnc; }
run vncno server 'MOCK_VNC=1' y y n "" n
! grep -q "5900" "$CALLS" && ok "VNC not needed: stays closed" || { bad "vncno"; show vncno; }
run display display 'MOCK_ACTIVE="ssh"' y y y ""
done_ok && ! grep -q "Slideshow port" "$OUT" && ! grep -q "3000" "$CALLS" && grep -q "^ufw --force enable" "$CALLS" && ok "a Client: no slideshow port" || { bad "display"; show display; }
run enablefails server 'MOCK_ENABLE_FAILS=1' y y n ""
done_ok && grep -q "^ufw disable" "$CALLS" && grep -q "left off" "$OUT" && ok "if turning it on fails: turned off again, installer carries on" || { bad "enablefails"; show enablefails; }

# ── Over SSH ──
run sshkeep server 'MOCK_ACTIVE="ssh"; MOCK_SSH_ANCESTOR=1' y y y "" "" y
done_ok && [ "$(line_of "^ufw allow 22/tcp")" -lt "$(line_of "^systemd-run")" ] && [ "$(line_of "^systemd-run")" -lt "$(line_of "^ufw --force enable")" ] \
  && grep -q "on-active=3min" "$CALLS" && grep -q "systemctl stop noticeboard-firewall-undo.timer" "$CALLS" && ! grep -q "^ufw disable" "$CALLS" \
  && ok "over SSH: SSH allowed, undo scheduled, then enabled; confirmed, so the undo is cancelled" || { bad "sshkeep"; show sshkeep; }
run sshtimeout server 'MOCK_ACTIVE="ssh"; MOCK_SSH_CONN=1' y y y "" "" TIMEOUT
done_ok && [ "$(line_of "^ufw --force enable")" -lt "$(line_of "^ufw disable")" ] && grep -q "turned off again" "$OUT" \
  && ok "over SSH, no answer in time: the firewall is turned off again" || { bad "sshtimeout"; show sshtimeout; }
run sshwarn server 'MOCK_ACTIVE="ssh"; MOCK_SSH_ANCESTOR=1' y y n n y "" "" y
grep -q "You're connected over SSH right now" "$OUT" && [ "$(grep -c "Do you need SSH access" "$OUT")" = 2 ] && grep -q "^ufw allow 22/tcp" "$CALLS" \
  && ok "over SSH, 'not needed': warned, and not confirmed, so asked again" || { bad "sshwarn"; show sshwarn; }
run sshblock server 'MOCK_ACTIVE="ssh"; MOCK_SSH_ANCESTOR=1' y y n y ""
done_ok && ! grep -q "allow 22/tcp" "$CALLS" && ! grep -q "^systemd-run" "$CALLS" && grep -q "^ufw --force enable" "$CALLS" \
  && ok "over SSH, blocking confirmed: no SSH rule" || { bad "sshblock"; show sshblock; }
# A machine without systemd-run: this one's own (e.g. a CI runner's, in /usr/bin) is left out of a
# PATH made of links to everything else. Nothing to do where there's none (Windows).
without_program() {   # without_program <name>: PATH without it
  local real dir file name
  real=$(command -v "$1") || return 0
  mkdir -p "$T/without-$1"
  while IFS= read -r dir; do
    for file in "$dir"/*; do
      name=$(basename "$file")
      if [ "$name" != "$1" ] && [ ! -e "$T/without-$1/$name" ] && [ -x "$file" ]; then ln -s "$file" "$T/without-$1/$name"; fi
    done
  done < <(tr ':' '\n' <<<"$PATH")
  PATH="$T/without-$1"
}
run nosysrun server 'MOCK_ACTIVE="ssh"; MOCK_SSH_ANCESTOR=1; unset -f systemd-run; without_program systemd-run' y y y "" ""
done_ok && [ -z "$(changes)" ] && grep -q "Can't set up the automatic undo" "$OUT" && ok "over SSH without systemd-run: nothing changed rather than risk a lockout" || { bad "nosysrun"; show nosysrun; }

grep -h "reset" "$T"/*.out > /dev/null 2>&1; ! grep -q "^ufw reset" "$T"/calls.log && ok "ufw reset is never used (existing rules are kept)" || bad "reset"

# ── The real port helper, reading data/config.json like the server ──
mkdir -p "$T/app/server/utils" "$T/app/data"
cp "$REPO/server/utils/configIO.js" "$T/app/server/utils/"
echo '{ port: 8080 }' > "$T/app/data/config.json"
port=$( load_installer; INSTALL_DIR="$T/app"; NODE_PATH="$REPO/node_modules" slideshow_port )
missing=$( load_installer; INSTALL_DIR="$T/nothing"; slideshow_port )
[ "$port" = 8080 ] && [ "$missing" = 3000 ] && ok "slideshow_port reads config.json (8080), else 3000" || bad "slideshow_port ($port, $missing)"

rm -rf "$T"; echo "passed=$pass failed=$fail"; [ $fail -eq 0 ]
