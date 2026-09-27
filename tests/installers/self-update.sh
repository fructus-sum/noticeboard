#!/usr/bin/env bash
# shellcheck disable=SC1090,SC2034  # functions are loaded from the installers; the variables set here are read by them
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
T=$(mktemp -d); export T
pass=0; fail=0
ok()  { pass=$((pass+1)); echo "PASS  $1"; }
bad() { fail=$((fail+1)); echo "FAIL  $1"; [ -n "${2:-}" ] && sed 's/^/        /' "$2"; }
GOOD_SHA=0123456789abcdef0123456789abcdef01234567

# run_case <name>: load install.sh's functions, stub curl per $API/$DL, call use_latest_installer
run_case() {
  (
    source <(sed '$d' "$REPO/installers/install.sh")
    curl() {
      echo "curl $*" >> "$T/curl.log"
      case "$*" in
        *api.github.com*) [ "$API" = fail ] && return 22; printf '%s' "$API" ;;
        *raw.githubusercontent.com*)
          [ "$DL" = fail ] && return 22
          local out=""; while [ $# -gt 0 ]; do [ "$1" = -o ] && out="$2"; shift; done
          if [ "$DL" = broken ]; then printf 'main() {\n' > "$out"
          else printf '#!/usr/bin/env bash\necho "NEW INSTALLER RAN sha=$NOTICEBOARD_INSTALLER_SHA args=$*"\n' > "$out"; fi ;;
      esac
    }
    use_latest_installer --some-arg
    echo "CONTINUED WITH THIS COPY"
  ) > "$T/out" 2>&1
}

rm -f "$T/curl.log"; NOTICEBOARD_INSTALLER_SHA=local API=$GOOD_SHA DL=ok run_case
grep -q "CONTINUED" "$T/out" && [ ! -f "$T/curl.log" ] && ok "NOTICEBOARD_INSTALLER_SHA set: runs this copy, no network calls" || bad "skip" "$T/out"
API=$GOOD_SHA DL=ok run_case
grep -q "Running the latest installer (0123456)" "$T/out" && grep -q "NEW INSTALLER RAN sha=$GOOD_SHA args=--some-arg" "$T/out" && ! grep -q CONTINUED "$T/out" \
  && ok "normal: switches to the downloaded installer, passes the commit and arguments" || bad "switch" "$T/out"
grep -q "raw.githubusercontent.com/fructus-sum/noticeboard/$GOOD_SHA/installers/install.sh" "$T/curl.log" && ok "download is pinned to the commit, not main/" || bad "pinned url"
API=fail DL=ok run_case
grep -q "Couldn't check GitHub" "$T/out" && grep -q CONTINUED "$T/out" && ok "GitHub unreachable: says so, carries on with this copy" || bad "api fail" "$T/out"
API="<html>rate limited</html>" DL=ok run_case
grep -q "Couldn't check GitHub" "$T/out" && grep -q CONTINUED "$T/out" && ok "garbage instead of a commit id: carries on" || bad "api garbage" "$T/out"
API=$GOOD_SHA DL=fail run_case
grep -q "Couldn't download the latest installer" "$T/out" && grep -q CONTINUED "$T/out" && ok "download fails: carries on" || bad "dl fail" "$T/out"
API=$GOOD_SHA DL=broken run_case
grep -q "Couldn't download the latest installer" "$T/out" && grep -q CONTINUED "$T/out" && ok "truncated download (fails bash -n): not run, carries on" || bad "dl broken" "$T/out"

# Against the real GitHub only when asked (NB_TEST_NETWORK=1), so the suite runs offline
if [ "${NB_TEST_NETWORK:-}" = 1 ]; then
  echo "=== real GitHub: fetch main's commit, download that installer, switch to it ==="
  ( source <(sed '$d' "$REPO/installers/install.sh"); use_latest_installer ) > "$T/real.out" 2>&1
  sed 's/^/      /' "$T/real.out"
  grep -q "Running the latest installer" "$T/real.out" && grep -q "ERROR: Run this script with sudo." "$T/real.out" \
    && ok "real run: downloaded main's installer and handed over to it" || bad "real run"
else
  echo "(skipped: the real-GitHub check; run with NB_TEST_NETWORK=1)"
fi

echo "=== reboot offer ==="
for answer in "" "Y" "n"; do
  ( source <(sed '$d' "$REPO/installers/install.sh")
    ask() { REPLY="$ANS"; }; systemctl() { echo "systemctl $*"; }
    ANS="$answer" offer_reboot ) > "$T/rb.out" 2>&1
  if [ "$answer" = n ]; then grep -q "Reboot later with: sudo reboot" "$T/rb.out" && ! grep -q "systemctl reboot" "$T/rb.out" && ok "answer 'n': no reboot, says how" || bad "reboot n" "$T/rb.out"
  else grep -q "systemctl reboot" "$T/rb.out" && ok "answer '${answer:-Enter}': reboots" || bad "reboot $answer" "$T/rb.out"; fi
done
rm -rf "$T"; echo "passed=$pass failed=$fail"; [ $fail -eq 0 ]
