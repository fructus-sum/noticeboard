#!/usr/bin/env bash
# shellcheck disable=SC1090,SC2016,SC2034  # the installer is loaded from files; $… in the probe is for the installer
# install.sh's parts (installers/lib, installers/kiosk) always come from the same commit as the
# script: next to it for a local copy, else downloaded from GitHub at the commit it was switched
# to, else at the followed branch. Anything missing or broken stops it before any change. And an
# older installer (the baseline, which only downloads install.sh) can hand over to this one.
# GitHub is a stand-in curl that serves this working tree.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
T=$(mktemp -d); export T
BASELINE="${NB_BASELINE:-fc4ba53}"   # the main in use when the refactor started (as tests/upgrade)
SHA=3333333333333333333333333333333333333333
pass=0; fail=0
ok()  { pass=$((pass+1)); echo "PASS  $1"; }
bad() { fail=$((fail+1)); echo "FAIL  $1"; [ -n "${2:-}" ] && sed 's/^/        /' "$2"; }

# "GitHub": this working tree's installers, with install.sh's last line (main) replaced by a probe
PROBE='load_modules; echo "LOADED sha=${NOTICEBOARD_INSTALLER_SHA:-none} $(declare -F install_server write_display_kiosk check_firewall | tr "\n" " ")templates=$([ -n "${KIOSK_TEMPLATE_server:-}" ] && [ -n "${KIOSK_TEMPLATE_display:-}" ] && echo yes)"'
probe_copy() {   # probe_copy <folder>: installers/ with the probe install.sh
  mkdir -p "$1"; cp -r "$REPO/installers/lib" "$REPO/installers/kiosk" "$1/"
  { sed '$d' "$REPO/installers/install.sh"; echo "$PROBE"; } > "$1/install.sh"
}
probe_copy "$T/github/installers"

mkdir -p "$T/bin"
cat > "$T/bin/curl" <<'EOF'
#!/usr/bin/env bash
echo "curl $*" >> "$T/curl.log"
out=""; url=""
while [ $# -gt 0 ]; do [ "$1" = -o ] && { out="$2"; shift; }; url="$1"; shift; done
case "$url" in
  *api.github.com*) printf '%s' "$SHA"; exit 0 ;;
  *raw.githubusercontent.com*)
    path=${url#*/installers/}
    [ -n "${FAIL_PATH:-}" ] && [ "$path" = "$FAIL_PATH" ] && exit 22
    [ -f "$T/github/installers/$path" ] || exit 22
    if [ -n "${BREAK_PATH:-}" ] && [ "$path" = "$BREAK_PATH" ]; then printf 'broken() {\n' > "$out"; else cp "$T/github/installers/$path" "$out"; fi ;;
esac
EOF
chmod +x "$T/bin/curl"
export SHA PATH="$T/bin:$PATH"
leftovers() { ls -d /tmp/noticeboard-installer.* 2>/dev/null | wc -l; }
BEFORE=$(leftovers)

run() {   # run <script> [env...]: runs the probe installer as a file
  rm -f "$T/curl.log"
  env "${@:2}" bash "$1" > "$T/out" 2>&1; RC=$?
}

# ── A local copy (NOTICEBOARD_INSTALLER_SHA=local): the parts next to it, no downloads ──
probe_copy "$T/checkout/installers"
run "$T/checkout/installers/install.sh" NOTICEBOARD_INSTALLER_SHA=local
[ $RC -eq 0 ] && grep -q "LOADED sha=local install_server write_display_kiosk check_firewall templates=yes" "$T/out" && [ ! -f "$T/curl.log" ] \
  && ok "local copy: every module and both kiosk templates loaded from next to it, nothing downloaded" || bad "local" "$T/out"

# ── Not switched (GitHub couldn't be asked), but in a copy of the repository: that copy's parts ──
run "$T/checkout/installers/install.sh" NOTICEBOARD_INSTALLER_SHA=
grep -q "LOADED sha=none" "$T/out" && [ ! -f "$T/curl.log" ] && ok "no commit, in a checkout: its own parts, nothing downloaded" || bad "checkout" "$T/out"

# ── A local copy without its parts: stops, says so ──
mkdir -p "$T/lonely"; cp "$T/checkout/installers/install.sh" "$T/lonely/install.sh"
run "$T/lonely/install.sh" NOTICEBOARD_INSTALLER_SHA=local
[ $RC -eq 1 ] && grep -q "missing or broken" "$T/out" && grep -q "nothing was changed" "$T/out" && ! grep -q LOADED "$T/out" \
  && ok "local copy without installers/lib: stops before doing anything, and says why" || bad "lonely" "$T/out"

# ── Switched to a commit: every part downloaded at that commit, then the download deleted ──
run "$T/lonely/install.sh" NOTICEBOARD_INSTALLER_SHA=$SHA
[ $RC -eq 0 ] && grep -q "LOADED sha=$SHA install_server write_display_kiosk check_firewall templates=yes" "$T/out" \
  && ok "at a commit: all parts downloaded and loaded" || bad "sha" "$T/out"
n_lib=$(grep -c "raw.githubusercontent.com/fructus-sum/noticeboard/$SHA/installers/lib/" "$T/curl.log")
n_kiosk=$(grep -c "raw.githubusercontent.com/fructus-sum/noticeboard/$SHA/installers/kiosk/" "$T/curl.log")
[ "$n_lib" = "$(ls "$REPO/installers/lib" | wc -l)" ] && [ "$n_kiosk" = 2 ] && ! grep -q "/main/installers" "$T/curl.log" \
  && ok "every download pinned to that commit ($n_lib modules, $n_kiosk kiosk templates)" || bad "pinned ($n_lib, $n_kiosk)" "$T/curl.log"
[ "$(leftovers)" = "$BEFORE" ] && ok "the downloaded parts are deleted once loaded" || bad "temp folder left in /tmp"

# ── A download fails, or a part is broken: stops before doing anything ──
run "$T/lonely/install.sh" NOTICEBOARD_INSTALLER_SHA=$SHA FAIL_PATH=lib/firewall.sh
[ $RC -eq 1 ] && grep -q "Couldn't download the rest of the installer from GitHub ($SHA). Nothing was changed." "$T/out" && ! grep -q LOADED "$T/out" \
  && ok "a part can't be downloaded: stops, nothing changed, says to check the connection" || bad "download fails" "$T/out"
run "$T/lonely/install.sh" NOTICEBOARD_INSTALLER_SHA=$SHA BREAK_PATH=lib/server.sh
[ $RC -eq 1 ] && grep -q "missing or broken" "$T/out" && ! grep -q LOADED "$T/out" && ok "a broken part (fails bash -n): stops before loading it" || bad "broken" "$T/out"
run "$T/lonely/install.sh" NOTICEBOARD_INSTALLER_SHA=$SHA FAIL_PATH=kiosk/display.sh
[ $RC -eq 1 ] && ! grep -q LOADED "$T/out" && ok "a kiosk template missing: stops" || bad "template missing" "$T/out"
[ "$(leftovers)" = "$BEFORE" ] && ok "failed downloads are deleted too" || bad "temp folder left after a failure"

# ── Not switched and not in a checkout (e.g. GitHub's API was busy): the followed branch's parts ──
mkdir -p "$T/pi/data"; echo "NOTICEBOARD_BRANCH=feature/x" > "$T/pi/data/update-branch.env"
sed -i "s#^INSTALL_DIR=.*#INSTALL_DIR=\"$T/pi\"#" "$T/lonely/install.sh"
run "$T/lonely/install.sh" NOTICEBOARD_INSTALLER_SHA=
grep -q "LOADED sha=none" "$T/out" && grep -q "noticeboard/feature/x/installers/lib/ui.sh" "$T/curl.log" \
  && ok "no commit, not in a checkout: downloaded at the branch this Pi follows" || bad "followed branch" "$T/out"

# ── The baseline installer (one file) hands over to this one, which fetches its parts at that commit ──
if git -C "$REPO" show "$BASELINE:installers/install.sh" > "$T/old-install.sh" 2>/dev/null; then
  rm -f "$T/curl.log"
  ( source <(sed '$d' "$T/old-install.sh")
    unset NOTICEBOARD_INSTALLER_SHA NOTICEBOARD_INSTALLER_BRANCH; BRANCH_FILE="$T/none"
    use_latest_installer ) > "$T/out" 2>&1
  grep -q "Running the latest installer (3333333)" "$T/out" && grep -q "LOADED sha=$SHA install_server write_display_kiosk check_firewall templates=yes" "$T/out" \
    && grep -q "$SHA/installers/install.sh" "$T/curl.log" && grep -q "$SHA/installers/lib/ui.sh" "$T/curl.log" \
    && ok "baseline installer ($BASELINE) → this install.sh → its parts at the same commit" || bad "handover from the baseline" "$T/out"
else
  bad "baseline $BASELINE not found in this repository"
fi

rm -rf "$T"; echo "passed=$pass failed=$fail"; [ $fail -eq 0 ]
